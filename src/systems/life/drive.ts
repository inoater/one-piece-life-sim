import type { Activity, GameData } from '../../engine/data/schemas';
import type { RoutineSlot } from '../../engine/state';

/**
 * A month scaled by Vigor (Phase 6, data/life.json `drive`).
 *
 * The stage of life sets how many activity slots a month holds; a deep Vigor pool opens more:
 * one overtime slot for every `perSlot` Vigor, up to `max`, each costing a little extra. And a Hard
 * slot can be pushed past Hard: each point committed costs one more Vigor and multiplies what the
 * slot gives (training, practice, a job's pay, a craft's progress) with diminishing returns, at
 * more risk. How far one can push is also set by the pool. Spending past the pool still leaves the
 * character exhausted, so the drive is a budget, not a free lunch.
 */

/** Overtime slots a pool this deep opens, for a stage with `baseSlots` slots of its own. */
export function overtimeSlots(data: GameData, pool: number, baseSlots: number): number {
  const o = data.life.drive.overtime;
  if (baseSlots < o.fromSlots) return 0;
  return Math.max(0, Math.min(o.max, Math.floor(pool / o.perSlot)));
}

/** How many points past Hard a pool this deep allows on one slot. */
export function commitMax(data: GameData, pool: number): number {
  const c = data.life.drive.commit;
  return Math.max(0, Math.min(c.max ?? c.gain.length, Math.floor(pool / c.per)));
}

/** The commitment a slot actually carries: only on Hard, never beyond what the pool allows. */
export function commitOf(data: GameData, slot: RoutineSlot, pool: number): number {
  if (slot.effort !== 'hard' || !slot.commit) return 0;
  return Math.min(slot.commit, commitMax(data, pool));
}

/** What a commitment multiplies: the slot's gains, its pay, and its risk. */
export function commitMults(
  data: GameData,
  commit: number,
): { gain: number; pay: number; risk: number } {
  const c = data.life.drive.commit;
  let gain = 1;
  for (let i = 0; i < commit; i++) gain += i < c.gain.length ? (c.gain[i] ?? 0) : c.tail;
  return {
    gain: Math.round(gain * 1000) / 1000,
    pay: 1 + c.pay * commit,
    risk: 1 + c.risk * commit,
  };
}

/**
 * The Vigor a slot costs: its effort, the activity's own extra, its commitment, and the overtime
 * surcharge when it sits beyond the stage's slots. Rest costs nothing.
 */
export function slotVigor(
  data: GameData,
  act: Activity,
  slot: RoutineSlot,
  overtime: boolean,
  pool: number,
): number {
  if (act.restful) return 0;
  const base =
    act.fight?.kind === 'group'
      ? data.battle.spar.groupVigor
      : data.life.efforts[slot.effort].vigor + act.extraVigor;
  return base + commitOf(data, slot, pool) + (overtime ? data.life.drive.overtime.surcharge : 0);
}
