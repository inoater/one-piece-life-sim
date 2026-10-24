import { dateOf, formatDate } from '../../engine/calendar';
import type { Activity, Job, Outcome, Risk } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Effort, Entity } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import {
  flagOf,
  humanAgeOf,
  isBedRest,
  isJailed,
  isMarried,
  livingRelations,
  raceYearsFor,
  reputation,
  requirementReason,
  slotsOf,
  stageOf,
  statTotal,
  vigorPoolOf,
} from './body';
import { AFTER_TEXT, applyLifeEffect, arrest, type Cast, type EffectScope } from './effects';
import { lifeLog, pay, renderLife, reportLine, reportOf, withCause, type LifeEnv } from './env';
import { injure, restore, setExhausted, speedHealing } from './health';
import { advanceJob } from './jobs';
import { childWords, parentWords, siblingWords } from './people';
import { breakthrough, trainStat } from './training';
import { tagWeight, traitLock } from './traits';
import { practise } from '../powers/practice';
import { monthsLeft } from '../voyage/progress';

/**
 * The player's month (step 1 of the tick): each activity in the routine, in order, up to the
 * number of slots the stage of life allows. Each one costs Vigor by effort, trains its stats
 * through the training formula, may earn or cost Berries, draws one written outcome, and may hurt
 * or get the character arrested. Spending past the Vigor pool leaves them exhausted.
 *
 * Locked activities are skipped with the reason (age, place, injury, money, a cell); the planner
 * shows the same reasons, from the same function.
 */

const MAX_FRIENDS = 8;

// ---- Why an activity cannot be done -------------------------------------------------------------

export function doctorCost(env: Pick<LifeEnv, 'data' | 'life' | 'tick'>): number {
  const { data, life, tick } = env;
  const order = ['none', 'minor', 'serious', 'severe'] as const;
  let worst = 0;
  for (const injury of life.injuries) {
    if (injury.healTick > tick) worst = Math.max(worst, order.indexOf(injury.severity));
  }
  if (worst === 0 && life.illnesses.some((i) => i.healTick > tick)) worst = 1;
  return data.life.doctor.cost[order[worst] ?? 'none'];
}

/** "At sea: 2 months to the next island" (the plan's wording), from the voyage's progress. */
export function atSeaReason(env: Pick<LifeEnv, 'data' | 'p' | 'state'>): string {
  const left = monthsLeft(env.data, env.state, env.p.c);
  if (left === null) return 'At sea';
  return `At sea: ${left === 1 ? '1 month' : `${left} months`} to the next island`;
}

export function lockReason(env: LifeEnv, act: Activity): string | null {
  const { data, state, tick, p, life } = env;
  if (!p.c.alive) return 'Your life has ended';
  if (isJailed(life, tick)) {
    return `In a cell until ${formatDate(dateOf(data.calendar, life.jailedUntil ?? tick))}`;
  }
  if (p.place.atSea && !act.tags.includes('at_sea')) return atSeaReason(env);
  const humanAge = humanAgeOf(data, p, tick);
  if (humanAge < act.minAge) return `From age ${raceYearsFor(data, p.race, act.minAge)}`;
  if (act.maxAge !== undefined && humanAge >= act.maxAge + 1) return 'Too old for this';
  if (act.automatic) return 'Happens by itself';
  if (act.physical && isBedRest(data, life, tick)) {
    const injury = life.injuries.find((i) => i.healTick > tick && i.severity !== 'minor');
    return `On bed rest${injury ? ` (${injury.name})` : ''}`;
  }
  const reason = requirementReason(state, data, p, act.requires, tick);
  if (reason) return reason;
  const locked = traitLock(data, p.c, act.id, tick);
  if (locked) return locked;
  if (act.worksJob && life.job) {
    const job = data.jobs[life.job.id];
    if (job?.physical && isBedRest(data, life, tick)) return 'On bed rest';
    if (p.place.atSea && !job?.travels) return atSeaReason(env);
  }
  if (act.cost && p.c.berries < act.cost.max)
    return `Costs up to ${formatBerries(act.cost.max)} Berries`;
  if (act.doctor) {
    const cost = doctorCost(env);
    if (p.c.berries < cost) return `The doctor wants ${formatBerries(cost)} Berries`;
  }
  return null;
}

// ---- Outcomes -----------------------------------------------------------------------------------

/** One of each kind of person an outcome may name, chosen for this month. */
export function chooseCast(env: LifeEnv, rng: Rng): Cast {
  const { state, p } = env;
  const cast: Cast = {};
  for (const kind of [
    'parent',
    'sibling',
    'friend',
    'mentor',
    'child',
    'sweetheart',
    'protege',
    'rival',
    'guardian',
  ] as const) {
    const people = livingRelations(state, p.c, kind);
    if (people.length > 0) cast[kind] = people.length === 1 ? people[0] : rng.pick(people);
  }
  if (isMarried(p.entity) && cast['sweetheart']) cast['spouse'] = cast['sweetheart'];
  return cast;
}

function canHaveChild(env: LifeEnv, humanAge: number): boolean {
  const { data, life, p, state } = env;
  const f = data.life.family;
  if (humanAge < f.fertile.min || humanAge > f.fertile.max) return false;
  if (life.expecting.length > 0) return false;
  return livingRelations(state, p.c, 'child').length + life.expecting.length < f.maxChildren;
}

export function outcomeAllowed(
  env: LifeEnv,
  outcome: Outcome,
  cast: Cast,
  humanAge: number,
): boolean {
  const { state, p, life } = env;
  const r = outcome.requires;
  if (r.parentAlive !== undefined && r.parentAlive !== (cast['parent'] !== undefined)) return false;
  if (r.hasSibling !== undefined && r.hasSibling !== (cast['sibling'] !== undefined)) return false;
  if (r.relation && !cast[r.relation]) return false;
  if (r.noRelation && cast[r.noRelation]) return false;
  if (r.married !== undefined && r.married !== isMarried(p.entity)) return false;
  if (r.minAge !== undefined && humanAge < r.minAge) return false;
  if (r.maxAge !== undefined && humanAge >= r.maxAge + 1) return false;
  for (const [flag, wanted] of Object.entries(r.flags)) {
    const actual = flagOf(state, p.entity, flag);
    if (
      typeof wanted === 'number'
        ? !(typeof actual === 'number' && actual >= wanted)
        : actual !== wanted
    )
      return false;
  }
  if (r.notFlags.some((f) => flagOf(state, p.entity, f) !== undefined)) return false;
  if (r.features.some((f) => !p.place.features.includes(f))) return false;
  for (const effect of outcome.effects) {
    if (effect.kind === 'conceive' && !canHaveChild(env, humanAge)) return false;
    if (effect.kind === 'marry' && (isMarried(p.entity) || !cast['sweetheart'])) return false;
    if (effect.kind === 'joinGang' && life.gang !== null) return false;
    if (effect.kind === 'relationship') {
      const kind = effect.role;
      const have = livingRelations(state, p.c, kind).length;
      if (kind === 'friend' ? have >= MAX_FRIENDS : have > 0 && kind !== 'rival') return false;
    }
  }
  return true;
}

/**
 * Weight times how much the character's stats favour it: (1 + f x (stat - 50) / 50) per stat, and
 * (Phase 4) how their traits weigh its tags ("misfortune" x2 for the Unlucky).
 */
function outcomeWeight(env: LifeEnv, outcome: Outcome): number {
  let weight = outcome.weight * tagWeight(env.data, env.p.c, outcome.tags);
  for (const [stat, factor] of Object.entries(outcome.statWeights)) {
    const value = statTotal(env.p.entity, stat, env.tick);
    weight *= Math.max(0.1, 1 + (factor ?? 0) * ((value - 50) / 50));
  }
  return weight;
}

export function pickOutcome(
  env: LifeEnv,
  outcomes: readonly Outcome[],
  cast: Cast,
  rng: Rng,
): Outcome | undefined {
  const humanAge = humanAgeOf(env.data, env.p, env.tick);
  const allowed = outcomes.filter((o) => outcomeAllowed(env, o, cast, humanAge));
  return rng.weightedPick(allowed, (o) => outcomeWeight(env, o));
}

function nameOf(entity: Entity | undefined, fallback: string): string {
  return entity?.name ?? fallback;
}

const NOTABLE = new Set([
  'relationship',
  'marry',
  'conceive',
  'joinGang',
  'trait',
  'deed',
  'injury',
  'arrest',
]);

export interface OutcomeSource {
  /** "act_spar", "job_fisher". */
  id: string;
  name: string;
  category: string;
  tags: readonly string[];
  effort: Effort;
  /** Extra text variables ({job}). */
  vars?: Record<string, string>;
}

/** Write an outcome into the chronicle and apply what it does. Returns the sentence. */
export function runOutcome(
  base: LifeEnv,
  source: OutcomeSource,
  outcome: Outcome,
  cast: Cast,
  rng: Rng,
): string {
  const env = withCause(base, `${source.id}#${outcome.id}`, undefined, rng);
  const { p, life } = env;
  const scope: EffectScope = { cast };
  outcome.effects.forEach((effect, i) => {
    if (!AFTER_TEXT.has(effect.kind))
      applyLifeEffect(withCause(env, env.cause, undefined, rng.fork('pre', i)), effect, scope);
  });
  const spouse = cast['spouse'] ?? cast['sweetheart'];
  const text = renderLife(env, outcome.text, {
    ...(source.vars ?? {}),
    other: nameOf(scope.other, 'someone'),
    amount: formatBerries(scope.amount ?? 0),
    parent: cast['parent'] ? parentWords(cast['parent']) : 'your family',
    sibling: cast['sibling'] ? siblingWords(p.c, cast['sibling']) : 'your family',
    friend: nameOf(cast['friend'], 'a friend'),
    mentor: nameOf(cast['mentor'], 'your teacher'),
    sweetheart: nameOf(cast['sweetheart'], 'your sweetheart'),
    spouse: nameOf(spouse, 'your spouse'),
    child: cast['child'] ? childWords(cast['child']).replace(/^your \w+ /, '') : 'your child',
    protege: nameOf(cast['protege'], 'your apprentice'),
    gang: life.gang ?? 'your gang',
  });
  const kinds = new Set(outcome.effects.map((e) => e.kind));
  if (kinds.has('deed')) life.deeds.push({ tick: env.tick, text });
  const tags = new Set<string>(['personal', ...source.tags, ...outcome.tags]);
  if (
    source.category === 'social' ||
    kinds.has('relationship') ||
    kinds.has('opinion') ||
    kinds.has('marry')
  )
    tags.add('relationship');
  if (tags.has('fight') || tags.has('crime')) tags.add('combat');
  if (kinds.has('berries') || tags.has('work')) tags.add('money');
  if (tags.has('family')) tags.delete('personal');
  const notable = [...kinds].some((k) => NOTABLE.has(k));
  const record = outcome.quiet
    ? null
    : lifeLog(env, text, {
        kind: notable ? 'event' : 'life',
        tags: [...tags],
        others: scope.other ? [scope.other.id] : [],
      });
  const after = record ? withCause(env, env.cause, record.seq) : env;
  outcome.effects.forEach((effect, i) => {
    if (AFTER_TEXT.has(effect.kind))
      applyLifeEffect(
        withCause(after, after.cause, after.causeSeq, rng.fork('post', i)),
        effect,
        scope,
      );
  });
  reportOf(env).done.push({
    activity: source.name,
    effort: source.effort,
    outcome: text,
    id: env.cause,
  });
  return text;
}

// ---- One activity -------------------------------------------------------------------------------

function rollRisk(env: LifeEnv, risk: Risk, effortRisk: number, rng: Rng): void {
  const exhaustedMult = env.life.exhausted ? 1.5 : 1;
  if (risk.injury > 0 && rng.fork('injury?').chance(risk.injury * effortRisk * exhaustedMult)) {
    injure(withCause(env, env.cause, env.causeSeq, rng.fork('injury')), {
      severity: 'roll',
      area: 'roll',
      cause: risk.cause,
      risk,
    });
  }
  if (risk.arrest > 0 && env.p.c.alive && rng.fork('arrest?').chance(risk.arrest)) {
    const fine = risk.fine ? rng.fork('fine').int(risk.fine.min, risk.fine.max) : 0;
    const months = risk.jailMonths
      ? rng.fork('jail').int(risk.jailMonths.min, risk.jailMonths.max)
      : 1;
    arrest(withCause(env, env.cause, env.causeSeq, rng.fork('arrest')), fine, months);
  }
}

function teacherMultiplier(env: LifeEnv, act: Activity): number {
  if (!act.usesMentor) return act.teacher;
  const mentors = livingRelations(env.state, env.p.c, 'mentor');
  if (mentors.length === 0) return act.teacher;
  const legendary = mentors.some((m) => m.flags['mentor.legendary'] === true);
  const t = env.data.life.training;
  return act.teacher * (legendary ? t.legendaryMentor : t.mentor);
}

function trainGains(
  env: LifeEnv,
  gains: Readonly<Partial<Record<string, number>>>,
  scale: number,
  effort: Effort,
  rng: Rng,
): void {
  const { data, p, tick } = env;
  for (const [stat, base] of Object.entries(gains)) {
    const { gain, ratio } = trainStat(data, p.entity, p.c, stat, (base ?? 0) * scale, tick);
    if (
      effort === 'hard' &&
      gain > 0 &&
      ratio >= data.character.softCap.above &&
      rng.fork('limit', stat).chance(data.life.training.breakthroughChance)
    ) {
      breakthrough(env, stat, 'Breakthrough (training)');
    }
  }
}

function doctorVisit(env: LifeEnv, act: Activity, rng: Rng): Outcome | undefined {
  const { data, life, tick, p } = env;
  const find = (id: string) => act.outcomes.find((o) => o.id === id);
  const cost = doctorCost(env);
  pay(env, -cost);
  const ailing =
    life.injuries.some((i) => i.healTick > tick) || life.illnesses.some((i) => i.healTick > tick);
  if (!ailing) return find('checkup');
  const chance = Math.min(0.95, data.life.doctor.intellect[p.place.wealth] / 100);
  if (rng.fork('doctor').chance(chance)) {
    speedHealing(env, data.life.doctor.months);
    restore(env, 0.15);
    return find('treated');
  }
  return find('no_help');
}

export interface SlotResult {
  ran: boolean;
  vigor: number;
  restful: boolean;
}

export function runActivity(
  env: LifeEnv,
  act: Activity,
  effort: Effort,
  index: number,
  cast: Cast,
): SlotResult {
  const { data, p, life, tick } = env;
  const reason = lockReason(env, act);
  if (reason && !(act.automatic && reason === 'Happens by itself')) {
    reportLine(
      env,
      `${act.name}: skipped (${reason.charAt(0).toLowerCase()}${reason.slice(1)}).`,
      'plain',
    );
    return { ran: false, vigor: 0, restful: false };
  }
  const eff = data.life.efforts[effort];
  const rng = env.rng.fork('slot', index, act.id);
  const vigor = act.restful ? 0 : eff.vigor + act.extraVigor;
  const atSea = p.place.atSea && act.category === 'train_body' ? data.travel.atSea.trainBody : 1;
  const scale = eff.gain * stageOf(data, p, tick).training * teacherMultiplier(env, act) * atSea;
  const actEnv = withCause(env, act.id, undefined, rng);

  if (act.cost) pay(actEnv, -rng.fork('cost').int(act.cost.min, act.cost.max));
  trainGains(actEnv, act.gains, scale, effort, rng.fork('train'));
  if (act.earn) pay(actEnv, Math.round(rng.fork('earn').int(act.earn.min, act.earn.max) * eff.pay));
  if (act.regen > 0) restore(actEnv, act.regen);
  if (act.speedsHealing > 0) speedHealing(actEnv, act.speedsHealing);
  if (act.fame) reputation(p.entity, 'fame').base += act.fame;
  if (act.infamy) reputation(p.entity, 'infamy').base += act.infamy;

  // Phase 4: practice for a power track (drills, sparring, a real fight), and the technique used.
  const practised = act.practice
    ? practise(
        actEnv,
        act,
        effort,
        eff.gain * stageOf(data, p, tick).training,
        rng.fork('practice'),
      )
    : null;

  let outcomes: readonly Outcome[] = act.outcomes;
  let source: OutcomeSource = {
    id: act.id,
    name: act.name,
    category: act.category,
    tags: act.tags,
    effort,
    vars: { technique: practised?.technique ?? 'a plain punch' },
  };
  let risk = act.risk;
  let chosen: Outcome | undefined;

  if (act.worksJob && life.job) {
    const job: Job | undefined = data.jobs[life.job.id];
    if (job) {
      pay(actEnv, Math.round(rng.fork('wage').int(job.income.min, job.income.max) * eff.pay));
      trainGains(actEnv, job.gains, scale, effort, rng.fork('jobTrain'));
      if (job.fame) reputation(p.entity, 'fame').base += job.fame;
      if (job.infamy) reputation(p.entity, 'infamy').base += job.infamy;
      outcomes = job.outcomes;
      source = {
        id: job.id,
        name: job.name,
        category: 'work',
        tags: job.tags,
        effort,
        vars: { job: job.name.toLowerCase() },
      };
      risk = job.risk;
      advanceJob(actEnv, job);
    }
  }
  if (act.doctor) chosen = doctorVisit(actEnv, act, rng.fork('visit'));
  chosen ??= pickOutcome(actEnv, outcomes, cast, rng.fork('outcome'));
  if (chosen) runOutcome(actEnv, source, chosen, cast, rng.fork('apply'));
  if (p.c.alive) rollRisk(actEnv, risk, eff.risk, rng.fork('risk'));
  return { ran: true, vigor: vigor + (practised?.vigor ?? 0), restful: act.restful };
}

// ---- The month ----------------------------------------------------------------------------------

export function resolveRoutine(env: LifeEnv): void {
  const { data, life, p, tick } = env;
  const report = reportOf(env);
  const pool = vigorPoolOf(data, p.entity, tick);
  report.vigor.pool = pool;
  if (isJailed(life, tick)) {
    reportLine(env, 'In a cell: nothing to do but wait.', 'alert');
    return;
  }
  const cast = chooseCast(env, env.rng.fork('cast'));
  const slots = slotsOf(data, p, tick);
  let spent = 0;
  let rested = false;
  const ran: number[] = [];

  if (slots === 0) {
    const automatic = Object.values(data.activities)
      .filter((a) => a.automatic && lockReason(env, a) === 'Happens by itself')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    automatic.forEach((act, i) => runActivity(env, act, 'normal', i, cast));
  }

  const count = Math.min(slots, life.routine.length);
  for (let i = 0; i < count && p.c.alive; i++) {
    const slot = life.routine[i];
    if (!slot) continue;
    const act = data.activities[slot.activity];
    if (!act) {
      reportLine(env, `An activity in your routine no longer exists (${slot.activity}).`, 'plain');
      continue;
    }
    const result = runActivity(env, act, slot.effort, i, cast);
    if (!result.ran) continue;
    spent += result.vigor;
    rested ||= result.restful;
    if (act.oneOff) ran.push(i);
  }
  if (ran.length > 0) life.routine = life.routine.filter((_, i) => !ran.includes(i));
  report.vigor.spent = spent;
  if (!p.c.alive) return;

  const ex = data.life.exhaustion;
  if (spent > pool) {
    setExhausted(env, true);
    if (env.rng.fork('exhaustion').chance(ex.injuryChance)) {
      injure(withCause(env, 'sys:exhaustion'), {
        severity: 'roll',
        area: 'roll',
        cause: 'exhaustion',
      });
    }
  } else if (life.exhausted && (rested || spent <= ex.restBelow * pool)) {
    setExhausted(env, false);
  }
}
