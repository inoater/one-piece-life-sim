import type { TickContext, TickStep } from '../engine/pipeline';
import type { WorldState } from '../engine/state';

/**
 * Step 4: update world state (factions, territory, economy).
 *
 * Each world system is a function in the list below; Phase 3 adds factions, territory and the
 * economy as one line each. Today the only member is the entropy probe.
 */
export type WorldSystem = (state: WorldState, ctx: TickContext) => void;

/** Random draws the probe makes per tick. */
export const PROBE_DRAWS = 8;

/**
 * Entropy probe (dev only). When the world was created with `probe: true`, it draws random
 * numbers every tick and folds them into a flag. That makes the world's hash depend on the RNG,
 * so the determinism tests (same seed gives the same hash, different seeds differ, replays match)
 * actually test something. Worlds without the flag are untouched.
 */
export const entropyProbe: WorldSystem = (state, ctx) => {
  if (state.flags['dev.probe'] !== true) return;
  const rng = ctx.rng.fork('probe');
  const previous = state.flags['dev.probe.acc'];
  let acc = typeof previous === 'number' ? previous : 0;
  for (let i = 0; i < PROBE_DRAWS; i++) acc = (Math.imul(acc, 31) + rng.nextU32()) | 0;
  state.flags['dev.probe.acc'] = acc;
  const draws = state.flags['dev.probe.draws'];
  state.flags['dev.probe.draws'] = (typeof draws === 'number' ? draws : 0) + PROBE_DRAWS;
};

export const WORLD_SYSTEMS: readonly WorldSystem[] = [entropyProbe];

export function createUpdateWorldStep(systems: readonly WorldSystem[]): TickStep {
  return {
    id: 'updateWorld',
    run(state, ctx) {
      for (const system of systems) system(state, ctx);
    },
  };
}

export const updateWorld = createUpdateWorldStep(WORLD_SYSTEMS);
