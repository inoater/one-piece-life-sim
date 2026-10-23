import type { Activity, ActivityCategory, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Effort, RoutineSlot, WorldState } from '../../engine/state';
import { ensureLife, humanAgeOf, isUnwell, slotsOf, vigorPoolOf } from './body';
import { doctorCost, lockReason } from './activities';
import type { LifeEnv } from './env';
import { jobLock, takeJob } from './jobs';
import { repay } from './money';
import { sortedValues } from '../genesis/options';

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
}
