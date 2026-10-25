import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import { Rng } from '../../engine/rng';
import { SCAR_AREAS, type RoutineSlot, type WorldState } from '../../engine/state';
import { ensureLife, playerPerson, slotsOf, vigorPoolOf } from './body';
import { commitMax, overtimeSlots } from './drive';
import { continueAs, type ContinueMode } from './death';
import type { LifeEnv } from './env';
import { die, injure } from './health';
import { jobLock, quitJob, takeJob } from './jobs';
import { borrow, repay } from './money';

/**
 * What the player can do between months (Phase 2): plan the routine, take or leave a job, borrow
 * and repay, and, after a death, choose who to continue as. These run between ticks, so their
 * randomness is keyed to the log position at which they happen.
 */

export class LifeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifeError';
  }
}

function commandEnv(state: WorldState, data: GameData, what: string): LifeEnv {
  const p = ensureLife(state, data);
  if (!p?.c.life) throw new LifeError('Nobody alive is being played');
  return {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('command', what, state.counters.logSeq),
    p,
    life: p.c.life,
    cause: `action:${what}`,
  };
}

export function setRoutine(
  state: WorldState,
  data: GameData,
  routine: readonly RoutineSlot[],
): void {
  const env = commandEnv(state, data, 'life/routine');
  const slots = slotsOf(data, env.p, state.tick);
  // Phase 6: a deep Vigor pool opens overtime slots, and lets a Hard slot be pushed further.
  const pool = vigorPoolOf(data, env.p.entity, state.tick);
  const overtime = slots > 0 ? overtimeSlots(data, pool, slots) : 0;
  if (routine.length > slots + overtime) {
    throw new LifeError(
      overtime > 0
        ? `You have ${slots} activity slot${slots === 1 ? '' : 's'} a month, and Vigor for ${overtime} more`
        : `You have ${slots} activity slot${slots === 1 ? '' : 's'} a month at this age`,
    );
  }
  const most = commitMax(data, pool);
  for (const slot of routine) {
    const act = data.activities[slot.activity];
    if (!act) throw new LifeError(`There is no activity "${slot.activity}"`);
    if (act.automatic) throw new LifeError(`${act.name} happens by itself`);
    if (slot.commit && slot.effort !== 'hard')
      throw new LifeError('Only a Hard effort can be pushed further');
    if (slot.commit && act.restful) throw new LifeError(`${act.name} cannot be pushed`);
    if ((slot.commit ?? 0) > most)
      throw new LifeError(
        most === 0
          ? 'Your Vigor is too low to push past Hard'
          : `Your Vigor allows pushing ${most} past Hard at most`,
      );
  }
  env.life.routine = routine.map((s) => ({
    activity: s.activity,
    effort: s.effort,
    ...(s.commit && s.effort === 'hard' ? { commit: s.commit } : {}),
  }));
}

export function chooseJob(state: WorldState, data: GameData, jobId: string | null): void {
  const env = commandEnv(state, data, 'life/job');
  if (jobId === null) {
    if (!env.life.job) throw new LifeError('You have no job to leave');
    quitJob(env);
    return;
  }
  const job = data.jobs[jobId];
  if (!job) throw new LifeError(`There is no job "${jobId}"`);
  const reason = jobLock(state, data, env.p, job, state.tick);
  if (reason) throw new LifeError(reason);
  if (env.life.job) quitJob(env);
  takeJob(env, job);
  const work = Object.values(data.activities).find((a) => a.worksJob);
  const slots = slotsOf(data, env.p, state.tick);
  if (
    work &&
    !env.life.routine.some((s) => s.activity === work.id) &&
    env.life.routine.length < slots
  ) {
    env.life.routine.push({ activity: work.id, effort: 'normal' });
  }
}

export function takeLoan(state: WorldState, data: GameData, amount: number): void {
  borrow(commandEnv(state, data, 'life/borrow'), amount);
}

export function payDebt(state: WorldState, data: GameData, amount: number): void {
  repay(commandEnv(state, data, 'life/repay'), amount);
}

export function carryOn(
  state: WorldState,
  data: GameData,
  mode: ContinueMode,
  targetId?: string,
): void {
  continueAs(state, data, mode, targetId);
}

/** Past the present: random events take over from the canon (the Year 39 epilogue). */
export function enterOpenEnded(state: WorldState, data: GameData): void {
  if (state.openEnded) throw new LifeError('The world is already open-ended');
  if (state.tick < data.calendar.presentTick)
    throw new LifeError('The present has not arrived yet');
  state.openEnded = true;
  appendLog(state, state.tick, {
    kind: 'event',
    summary: `${data.life.epilogue.title}. ${data.life.epilogue.text}`,
    tags: ['world', 'epilogue'],
    cause: 'action:life/openEnded',
  });
}

// ---- Debug ---------------------------------------------------------------------------------------

export function debugInjure(
  state: WorldState,
  data: GameData,
  severity: 'minor' | 'serious' | 'severe',
  area: (typeof SCAR_AREAS)[number] | 'roll',
): void {
  injure(commandEnv(state, data, 'debug/injure'), { severity, area, cause: 'accident' });
}

export function debugKill(state: WorldState, data: GameData, cause: string): void {
  const env = commandEnv(state, data, 'debug/kill');
  die(env, cause);
}

export function hasPlayer(state: WorldState, data: GameData): boolean {
  return playerPerson(state, data) !== null;
}
