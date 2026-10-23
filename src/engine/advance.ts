import type { GameData } from './data/schemas';
import { isKnownBy } from './knowledge';
import type { SideEffect, TickStep } from './pipeline';
import type { Rng } from './rng';
import type { PendingDecision, WorldState } from './state';
import { runTickInPlace } from './tick';

/**
 * Time controls: Next Month, Skip 3 Months, Skip to Next Event.
 *
 * Every plan stops early when an event needs a decision, so a skip can never run past a choice
 * the player has to make. Plans also stop at the present (tick `presentTick`) unless the world is
 * open-ended, which is how the Phase 2 epilogue hands over to free play, and stop for good when
 * the player's character dies (`halted`), until they choose who to continue as.
 *
 * `advanceBatch` does a bounded chunk of work and says whether it is finished. The host calls it
 * in a loop and yields to the event loop between chunks so a long run never freezes the page and
 * can be cancelled. Results never depend on how the work was chunked.
 */

export type AdvancePlan = { kind: 'months'; count: number } | { kind: 'untilEvent' };

/** `ended`: the world has nobody left to play (the player died); see `AdvanceOptions.halted`. */
export type StopReason = 'completed' | 'decision' | 'event' | 'present' | 'ended';

/**
 * What to do when an event needs a decision:
 *  - stop: leave it pending and stop (the UI, which has a player to ask)
 *  - auto-first / auto-random: resolve it and keep going (headless runs have nobody to ask)
 */
export type DecisionPolicy = 'stop' | 'auto-first' | 'auto-random';

export interface AdvanceOptions {
  pipeline: readonly TickStep[];
  decisions: DecisionPolicy;
  /** Applies a choice. Injected so the engine does not depend on the systems layer. */
  resolveDecision: (
    state: WorldState,
    data: GameData,
    decisionId: number,
    choiceId: string,
  ) => void;
  /**
   * True when time must not move at all until the player acts (their character has died and they
   * must choose who to continue as). Injected for the same reason as `resolveDecision`.
   */
  halted?: (state: WorldState) => boolean;
}

/** Progress through a plan. Mutated by `advanceBatch`; pass the same cursor to continue. */
export interface Cursor {
  remaining: number;
}

export interface BatchResult {
  ticksRun: number;
  /** null means "not finished, call again with the same cursor". */
  stop: StopReason | null;
  effects: SideEffect[];
}

export function newCursor(plan: AdvancePlan, data: GameData): Cursor {
  if (plan.kind === 'months') {
    if (!Number.isInteger(plan.count) || plan.count < 0) {
      throw new RangeError(`Cannot advance ${plan.count} months`);
    }
    return { remaining: plan.count };
  }
  return { remaining: data.settings.time.untilEventCap };
}

function autoResolve(
  state: WorldState,
  data: GameData,
  rng: Rng,
  decision: PendingDecision,
  options: AdvanceOptions,
): void {
  const choice =
    options.decisions === 'auto-first'
      ? decision.choices[0]
      : rng.fork('autoresolve', decision.id).pick(decision.choices);
  if (!choice) throw new Error(`Decision ${decision.id} has no choices`);
  options.resolveDecision(state, data, decision.id, choice.id);
}

function sawVisibleEvent(state: WorldState, logLengthBefore: number): boolean {
  for (let i = logLengthBefore; i < state.log.length; i++) {
    const record = state.log[i];
    if (record && record.kind === 'event' && isKnownBy(record.knownBy, state.playerId)) return true;
  }
  return false;
}

export function advanceBatch(
  state: WorldState,
  data: GameData,
  rng: Rng,
  plan: AdvancePlan,
  cursor: Cursor,
  options: AdvanceOptions,
  maxTicks: number,
): BatchResult {
  const effects: SideEffect[] = [];
  let ticksRun = 0;

  while (ticksRun < maxTicks) {
    if (state.pending.length > 0) {
      if (options.decisions === 'stop') return { ticksRun, stop: 'decision', effects };
      for (const decision of [...state.pending]) autoResolve(state, data, rng, decision, options);
    }
    if (options.halted?.(state)) return { ticksRun, stop: 'ended', effects };
    if (cursor.remaining <= 0) return { ticksRun, stop: 'completed', effects };
    if (!state.openEnded && state.tick >= data.calendar.presentTick) {
      return { ticksRun, stop: 'present', effects };
    }

    const logLengthBefore = state.log.length;
    const out = runTickInPlace(state, data, rng, options.pipeline);
    effects.push(...out.effects);
    ticksRun += 1;
    cursor.remaining -= 1;

    if (state.pending.length > 0 && options.decisions === 'stop') {
      return { ticksRun, stop: 'decision', effects };
    }
    if (options.halted?.(state)) return { ticksRun, stop: 'ended', effects };
    if (plan.kind === 'untilEvent' && sawVisibleEvent(state, logLengthBefore)) {
      return { ticksRun, stop: 'event', effects };
    }
  }
  return { ticksRun, stop: null, effects };
}

export interface AdvanceResult {
  ticksRun: number;
  stop: StopReason;
  effects: SideEffect[];
}

/** Synchronous, run-to-the-end version for headless tools and tests. Mutates `state`. */
export function advance(
  state: WorldState,
  data: GameData,
  rng: Rng,
  plan: AdvancePlan,
  options: AdvanceOptions,
): AdvanceResult {
  const cursor = newCursor(plan, data);
  const effects: SideEffect[] = [];
  let ticksRun = 0;
  for (;;) {
    const batch = advanceBatch(state, data, rng, plan, cursor, options, 1024);
    ticksRun += batch.ticksRun;
    effects.push(...batch.effects);
    if (batch.stop !== null) return { ticksRun, stop: batch.stop, effects };
  }
}
