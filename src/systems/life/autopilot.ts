import type { Activity, ActivityCategory, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Effort, RoutineSlot, WorldState } from '../../engine/state';
import { ensureLife, humanAgeOf, isUnwell, slotsOf, vigorPoolOf } from './body';
import { doctorCost, lockReason } from './activities';
import type { LifeEnv } from './env';
import { jobLock, takeJob } from './jobs';
import { repay } from './money';
import { sortedValues } from '../genesis/options';
import { circle, together } from '../heart/bonds';
import { talk, talkLock } from '../heart/talk';
import { companionPrice, speciesHere, takeCompanion } from '../heart/companions';

/**
 * A stand-in player for headless runs (balancing, the lifespan check, the 40-outcomes check). It
 * plans each month the way a sensible person would: rest when exhausted, see a doctor when hurt,
 * take the best job going, keep a shift in the routine, pay down debt, and spend the rest of the
 * month training, with friends, or exploring. `variety` makes it try everything available, so a
 * test life meets as many outcomes as it can.
 */

const CATEGORY_WEIGHT: Record<ActivityCategory, number> = {
  train_body: 3,
  train_mind: 2,
  train_spirit: 1.2,
  work: 1,
  social: 2,
  explore: 1,
  rest: 0.3,
  crime: 0.15,
  special: 2,
};

export interface AutopilotOptions {
  /** Pick uniformly among everything available, to see as much of the content as possible. */
  variety?: boolean;
  /** Phase 7: say nothing to anyone (the balancing tools that predate the heart). */
  quietHeart?: boolean;
}

export function autopilot(
  state: WorldState,
  data: GameData,
  rng: Rng,
  options: AutopilotOptions = {},
): void {
  const p = ensureLife(state, data);
  if (!p?.c.life) return;
  const life = p.c.life;
  const tick = state.tick;
  const env: LifeEnv = { state, data, tick, rng, p, life, cause: 'sys:autopilot' };
  const slots = slotsOf(data, p, tick);
  if (slots === 0) {
    life.routine = [];
    return;
  }

  if (!life.job && humanAgeOf(data, p, tick) >= 12) {
    const jobs = sortedValues(data.jobs)
      .filter((j) => jobLock(state, data, p, j, tick) === null)
      .sort((a, b) => b.income.min + b.income.max - (a.income.min + a.income.max));
    const best = options.variety
      ? jobs.length > 0
        ? rng.fork('job').pick(jobs)
        : undefined
      : jobs[0];
    if (best) takeJob(env, best);
  }
  if (life.debt > 0 && p.c.berries > 3000) repay(env, p.c.berries - 2000);

  const usable = sortedValues(data.activities).filter((a) => lockReason(env, a) === null);
  const byId = (id: string) => usable.find((a) => a.id === id);
  const plan: Activity[] = [];
  const add = (act: Activity | undefined) => {
    if (act && plan.length < slots && !plan.includes(act)) plan.push(act);
  };

  if (isUnwell(life, tick)) {
    if (p.c.berries >= doctorCost(env) + 500) add(byId('act_see_doctor'));
    add(byId('act_recover'));
  }
  if (life.exhausted) add(usable.find((a) => a.restful && !a.doctor));
  const work = usable.find((a) => a.worksJob);
  if (work && !options.variety) add(work);
  else if (work && rng.fork('work?').chance(0.6)) add(work);

  const pickRng = rng.fork('pick');
  for (let i = 0; plan.length < slots && i < 12; i++) {
    const left = usable.filter((a) => !plan.includes(a) && !a.doctor);
    const choice = pickRng
      .fork(i)
      .weightedPick(left, (a) =>
        options.variety ? 1 : CATEGORY_WEIGHT[a.category] * (a.restful ? 0.3 : 1),
      );
    if (!choice) break;
    add(choice);
  }

  const pool = vigorPoolOf(data, p.entity, tick);
  const working = plan.filter((a) => !a.restful);
  const costOf = (e: Effort) => data.life.efforts[e].vigor;
  let effort: Effort = 'normal';
  if (working.length * costOf('hard') <= pool && rng.fork('hard?').chance(0.3)) effort = 'hard';
  else if (working.length * costOf('normal') > pool) effort = 'light';
  const routine: RoutineSlot[] = plan.map((a) => ({
    activity: a.id,
    effort: a.restful ? 'normal' : effort,
  }));
  life.routine = routine;
  if (!options.quietHeart) talkAround(env, rng.fork('talk'), options.variety === true);
}

/** What a sensible person says to the people around them (Phase 7); `variety` tries anything. */
const SENSIBLE = [
  'int_chat',
  'int_joke',
  'int_meal',
  'int_compliment',
  'int_ask_dream',
  'int_train_together',
  'int_ask_rumour',
  'int_ask_number',
  'int_swear',
  'int_confess',
  'int_propose',
  'int_marry',
  'int_recruit',
  'int_ask_teacher',
  'int_apologise',
  'int_forgive',
  'int_ask_help',
  'int_ask_loan',
] as const;

/**
 * A word or two with someone here, most months: the heart of a headless life. Never throws: a
 * talk that is not possible is simply not had.
 */
function talkAround(env: LifeEnv, rng: Rng, variety: boolean): void {
  const { state, data, tick, p } = env;
  if (humanAgeOf(data, p, tick) < 8 || state.battle || !rng.fork('talk?').chance(0.7)) return;
  // Now and then, an animal to keep them company, when they can well afford one.
  const pets = p.c.relationships.filter((r) => r.kind === 'companion').length;
  const kinds = speciesHere(data, p).filter((s) => p.c.berries >= companionPrice(env, s) * 5);
  if (pets === 0 && kinds.length > 0 && rng.fork('pet?').chance(0.03)) {
    try {
      takeCompanion(env, rng.fork('pet').pick(kinds).id);
    } catch {
      // Not to be had after all.
    }
  }
  const here = circle(state, p.entity).filter(({ other }) => together(data, p.entity, other));
  if (here.length === 0) return;
  const ids = variety ? Object.keys(data.intents).sort() : [...SENSIBLE];
  for (let i = 0; i < 2; i++) {
    const r = rng.fork('who', i);
    const { other } = r.pick(here);
    const open = ids.filter((id) => {
      const intent = data.intents[id];
      if (!intent || intent.fight || intent.topic === 'person' || intent.topic === 'place')
        return false;
      // Borrow only when short of money.
      if (id === 'int_ask_loan' && p.c.berries >= 800 && !r.fork('loan?').chance(0.05))
        return false;
      return talkLock(state, data, p, other, intent, { amount: 300 }) === null;
    });
    const id = r.fork('intent').pick(open.length > 0 ? open : ['']);
    if (!id) continue;
    try {
      talk({ ...env, cause: 'sys:autopilot' }, other.id, id, { amount: 300 });
    } catch {
      // Not possible after all (Berries spent on the first talk, say): nothing said.
    }
  }
}
