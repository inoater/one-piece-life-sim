import {
  advance as advanceWith,
  type AdvanceOptions,
  type AdvancePlan,
  type DecisionPolicy,
} from './engine/advance';
import type { GameData } from './engine/data/schemas';
import type { Rng } from './engine/rng';
import type { WorldState } from './engine/state';
import { runTick, runTickInPlace, type TickOutput } from './engine/tick';
import { resolveDecision } from './systems/events';
import { PIPELINE } from './systems';

/**
 * The simulation core: `tick(state, data, rng) -> state`.
 *
 * This file wires the generic engine (src/engine) to the game systems (src/systems). Everything
 * that needs "the simulation" (the worker, the headless tools, the tests) imports it from here.
 *
 * The engine never touches the page, storage or the clock (rule 7); see tests/engine/lint.test.ts.
 */

/** Advance one month. Pure: the input state is not modified. */
export function tick(state: WorldState, data: GameData, rng: Rng): WorldState {
  return runTick(state, data, rng, PIPELINE).state;
}

/** Advance one month, mutating `state`. Same result as `tick`, without copying. */
export function tickInPlace(state: WorldState, data: GameData, rng: Rng): TickOutput {
  return runTickInPlace(state, data, rng, PIPELINE);
}

export function advanceOptions(decisions: DecisionPolicy = 'stop'): AdvanceOptions {
  return { pipeline: PIPELINE, decisions, resolveDecision };
}

/** Run a plan to its end (headless tools and tests). Mutates `state`. */
export function advance(
  state: WorldState,
  data: GameData,
  rng: Rng,
  plan: AdvancePlan,
  decisions: DecisionPolicy = 'stop',
) {
  return advanceWith(state, data, rng, plan, advanceOptions(decisions));
}

export { PIPELINE, PIPELINE_IDS } from './systems';
export { applyAction, ActionSchema, ActionError, type Action } from './systems/actions';
export { createWorld } from './engine/world';
export { Rng } from './engine/rng';
export { createLife, describeAppearance, type GenesisResult } from './systems/genesis/generate';
export { GenesisError, defaultOptions, type GenesisOptions } from './systems/genesis/options';
export { characterSheet, playerSummary, type CharacterSheet } from './systems/genesis/sheet';
export { genesisStats, type GenesisStats } from './systems/genesis/stats-report';
