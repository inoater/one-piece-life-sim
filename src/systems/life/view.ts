import { dateOf, formatDate } from '../../engine/calendar';
import type { Activity, ActivityCategory, GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import { EFFORTS, type Effort, type WorldState } from '../../engine/state';
import { statLabel } from '../../engine/stats';
import { formatBerries } from '../genesis/text';
import { doctorCost, lockReason } from './activities';
import {
  ageYears,
  humanAgeOf,
  isBedRest,
  isJailed,
  maxHealthOf,
  personOf,
  reputationValue,
  slotsOf,
  stageOf,
  vigorPoolOf,
} from './body';
import { continueOptions, lifeRecap, type ContinueOption, type LifeRecap } from './death';
import type { LifeEnv } from './env';
import { commitMax, commitMults, commitOf, overtimeSlots, slotVigor } from './drive';
import { jobLock } from './jobs';
import { loanLock } from './money';
import { priceMult } from '../places/place';

/**
 * What the page sees of the life being played (Phase 2): plain data for the header bars, the
 * Actions planner, the month-end card and the death screen. Locks come from the same functions the
 * month uses, so the planner never promises what the month will refuse.
 */

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  train_body: 'Train body',
  train_mind: 'Train mind',
  train_spirit: 'Train spirit',
  work: 'Work',
  social: 'Social',
  explore: 'Explore',
  rest: 'Rest',
  crime: 'Crime',
  special: 'Special',
};

export interface ActivityView {
  id: string;
  name: string;
  category: ActivityCategory;
  description: string;
  /** Why it cannot be done now, or null. */
  lock: string | null;
  restful: boolean;
  oneOff: boolean;
  /** "Strength, Dexterity". */
  trains: string[];
  earns: string | null;
  costs: string | null;
  /** How dangerous: none, low, some, high. */
  risk: 'none' | 'low' | 'some' | 'high';
  crime: boolean;
  usesMentor: boolean;
  extraVigor: number;
  /** Phase 4: the power it practises, as a phrase ("Swordsmanship (drill)"), or null. */
  practice: string | null;
  /** Phase 6: may fill more than one slot (another shift, more hours on the project). */
  repeatable: boolean;
}

const PRACTICE_WORD: Record<string, string> = {
  drill: 'drills',
  spar: 'sparring x1.5',
  fight: 'a real fight x3',
  teach: 'teaching x0.5',
};

function practiceLabel(
  data: GameData,
  practice: NonNullable<Activity['practice']>,
  c: { powers?: { tracks: Record<string, unknown>; focus: string | null } },
): string {
  const named = practice.tracks
    .filter((t) => c.powers?.tracks[t] !== undefined)
    .map((t) => data.tracks[t]?.name ?? t);
  const what =
    practice.tracks.length === 0
      ? c.powers?.focus
        ? (data.tracks[c.powers.focus]?.name ?? 'your focus')
        : 'your fighting styles'
      : named.length > 0
        ? named.join(' or ')
        : (data.tracks[practice.tracks[0] ?? '']?.name ?? 'a power');
  return `${what} (${PRACTICE_WORD[practice.kind] ?? practice.kind})`;
}

export interface JobView {
  id: string;
  name: string;
  description: string;
  requirement: string;
  income: string;
  lock: string | null;
  risk: 'none' | 'low' | 'some' | 'high';
}

export interface LifeView {
  id: string;
  name: string;
  alive: boolean;
  age: number;
  stage: string;
  generation: number;
  health: { current: number; max: number };
  vigor: { pool: number; planned: number };
  exhausted: boolean;
  bedRest: boolean;
  /** "In a cell until March, Year 12", or null. */
  jailed: string | null;
  slots: number;
  /**
   * Phase 6, a month scaled by Vigor: overtime slots this pool opens beyond `slots` (each costs
   * `surcharge` more Vigor), and how many points past Hard a slot may be pushed, with what each
   * level multiplies (`commitGains[n]` is the gain multiplier at n points; index 0 is plain Hard).
   */
  drive: {
    overtime: number;
    surcharge: number;
    perSlot: number;
    commitMax: number;
    commitPer: number;
    commitGains: number[];
    commitPay: number;
    commitRisk: number;
  };
  efforts: { id: Effort; name: string; vigor: number }[];
  routine: {
    activity: string;
    name: string;
    effort: Effort;
    lock: string | null;
    vigor: number;
    /** Points committed past Hard (as it will run: never more than the pool allows). */
    commit: number;
    overtime: boolean;
  }[];
  categories: { id: ActivityCategory; label: string }[];
  activities: ActivityView[];
  job: null | { id: string; name: string; months: number; title: string | null; income: string };
  jobs: JobView[];
  money: {
    berries: number;
    debt: number;
    interestPct: number;
    livingCost: number;
    paysOwnWay: boolean;
    loans: { amount: number; lock: string | null }[];
    doctorCost: number;
  };
  injuries: { name: string; area: string; severity: string; heals: string; months: number }[];
  illnesses: { name: string; heals: string; months: number }[];
  fame: number;
  infamy: number;
  gang: string | null;
  report: null | {
    dateLabel: string;
    done: { activity: string; effort: Effort; outcome: string }[];
    vigor: { pool: number; spent: number };
    berries: { income: number; costs: number };
    lines: { text: string; tone: 'good' | 'bad' | 'plain' | 'alert' }[];
  };
  /** When the life has ended: the recap and who to carry on as. */
  recap: LifeRecap | null;
  continuation: ContinueOption[];
  /** Earlier lives in this world, most recent first. */
  lineage: { id: string; name: string; age: number; cause: string | null }[];
}

function riskLevel(injury: number, arrest: number): ActivityView['risk'] {
  const r = injury + arrest;
  return r <= 0 ? 'none' : r < 0.03 ? 'low' : r < 0.08 ? 'some' : 'high';
}

const range = (r: { min: number; max: number } | undefined) =>
  r
    ? r.min === r.max
      ? formatBerries(r.min)
      : `${formatBerries(r.min)} to ${formatBerries(r.max)}`
    : null;

export function lifeView(state: WorldState, data: GameData): LifeView | null {
  const p = state.playerId ? personOf(data, state.entities[state.playerId]) : null;
  if (!p || !p.c.life) return null;
  const life = p.c.life;
  const tick = state.tick;
  const env: LifeEnv = {
    state,
    data,
    tick,
    rng: Rng.root(state.seed).fork('view'),
    p,
    life,
    cause: 'view',
  };
  const label = (t: number) => formatDate(dateOf(data.calendar, t));
  const alive = p.c.alive;
  const slots = alive ? slotsOf(data, p, tick) : 0;
  const efforts = EFFORTS.map((id) => ({
    id,
    name: data.life.efforts[id].name,
    vigor: data.life.efforts[id].vigor,
  }));
  const pool = vigorPoolOf(data, p.entity, tick);
  const overtime = slots > 0 ? overtimeSlots(data, pool, slots) : 0;
  const routine = life.routine.slice(0, Math.max(slots, life.routine.length)).map((slot, i) => {
    const act = data.activities[slot.activity];
    const over = i >= slots;
    return {
      activity: slot.activity,
      name: act?.name ?? slot.activity,
      effort: slot.effort,
      lock:
        i >= slots + overtime
          ? slots === 0
            ? 'More than this age allows'
            : 'Not enough Vigor for this much overtime'
          : act
            ? lockReason(env, act)
            : 'No longer exists',
      vigor: act ? slotVigor(data, act, slot, over, pool) : 0,
      commit: commitOf(data, slot, pool),
      overtime: over,
    };
  });
  const cMax = commitMax(data, pool);
  const drive: LifeView['drive'] = {
    overtime,
    surcharge: data.life.drive.overtime.surcharge,
    perSlot: data.life.drive.overtime.perSlot,
    commitMax: cMax,
    commitPer: data.life.drive.commit.per,
    commitGains: Array.from({ length: cMax + 1 }, (_, n) => commitMults(data, n).gain),
    commitPay: data.life.drive.commit.pay,
    commitRisk: data.life.drive.commit.risk,
  };

  const activities: ActivityView[] = Object.values(data.activities)
    .filter((a) => !a.automatic)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      description: a.description,
      lock: alive ? lockReason(env, a) : 'Your life has ended',
      restful: a.restful,
      oneOff: a.oneOff,
      trains: Object.keys(a.gains).map(statLabel),
      earns: a.worksJob && life.job ? range(data.jobs[life.job.id]?.income) : range(a.earn),
      costs: a.doctor ? formatBerries(doctorCost(env)) : range(a.cost),
      risk: riskLevel(a.risk.injury, a.risk.arrest),
      crime: a.category === 'crime' || a.infamy > 0,
      usesMentor: a.usesMentor,
      extraVigor: a.extraVigor,
      practice: a.practice ? practiceLabel(data, a.practice, p.c) : null,
      repeatable: a.worksJob || a.craft,
    }));

  const currentJob = life.job ? data.jobs[life.job.id] : undefined;
  const jobs: JobView[] = Object.values(data.jobs)
    .sort((a, b) => a.minAge - b.minAge || (a.id < b.id ? -1 : 1))
    .map((j) => ({
      id: j.id,
      name: j.name,
      description: j.description,
      requirement: [`Age ${j.minAge}+`, j.requirementText].filter((t) => t !== '').join(', '),
      income: range(j.income) ?? '',
      lock: jobLock(state, data, p, j, tick),
      risk: riskLevel(j.risk.injury, j.risk.arrest),
    }));

  const m = data.life.money;
  const report = life.report;
  const lineage: LifeView['lineage'] = [];
  let previous = life.predecessorId;
  for (let guard = 0; previous && guard < 50; guard++) {
    const before = state.entities[previous];
    const bc = before?.character;
    if (!before || !bc) break;
    lineage.push({
      id: before.id,
      name: before.name,
      age: ageYears(bc, bc.death?.tick ?? tick),
      cause: bc.death?.cause ?? null,
    });
    previous = bc.life?.predecessorId;
  }

  return {
    id: p.entity.id,
    name: p.entity.name,
    alive,
    age: ageYears(p.c, tick),
    stage: stageOf(data, p, tick).name,
    generation: life.generation,
    health: { current: Math.round(life.health), max: maxHealthOf(data, p.entity, tick) },
    vigor: {
      pool,
      planned: routine
        .slice(0, slots + overtime)
        .reduce((sum, s) => sum + (s.lock ? 0 : s.vigor), 0),
    },
    exhausted: life.exhausted,
    bedRest: isBedRest(data, life, tick),
    jailed: isJailed(life, tick) ? `In a cell until ${label(life.jailedUntil ?? tick)}` : null,
    slots,
    drive,
    efforts,
    routine,
    categories: (Object.keys(CATEGORY_LABEL) as ActivityCategory[]).map((id) => ({
      id,
      label: CATEGORY_LABEL[id],
    })),
    activities,
    job:
      life.job && currentJob
        ? {
            id: currentJob.id,
            name: currentJob.name,
            months: life.job.months,
            title: currentJob.ranks
              ? String(p.entity.flags[currentJob.ranks.flag] ?? '') || null
              : null,
            income: range(currentJob.income) ?? '',
          }
        : null,
    jobs,
    money: {
      berries: p.c.berries,
      debt: life.debt,
      interestPct: m.interestPct,
      livingCost: p.place.atSea
        ? 0
        : Math.round(m.livingCost[p.place.wealth] * priceMult(state, data, p.place.id)),
      paysOwnWay: humanAgeOf(data, p, tick) >= m.independentAge,
      loans: m.loans.map((amount) => ({
        amount,
        lock: alive ? loanLock(env, amount) : 'Your life has ended',
      })),
      doctorCost: doctorCost(env),
    },
    injuries: life.injuries
      .filter((i) => i.healTick > tick)
      .map((i) => ({
        name: i.name,
        area: i.area,
        severity: i.severity,
        heals: label(i.healTick),
        months: i.healTick - tick,
      })),
    illnesses: life.illnesses
      .filter((i) => i.healTick > tick)
      .map((i) => ({ name: i.name, heals: label(i.healTick), months: i.healTick - tick })),
    fame: reputationValue(p.entity, 'fame', tick),
    infamy: reputationValue(p.entity, 'infamy', tick),
    gang: life.gang,
    report: report
      ? {
          dateLabel: label(report.tick),
          done: report.done.map((d) => ({
            activity: d.activity,
            effort: d.effort,
            outcome: d.outcome,
          })),
          vigor: { ...report.vigor },
          berries: { ...report.berries },
          lines: report.lines.map((l) => ({ ...l })),
        }
      : null,
    recap: alive ? null : lifeRecap(state, data, p.entity.id),
    continuation: alive ? [] : continueOptions(state, data),
    lineage,
  };
}
