import type { TickContext, TickStep } from '../engine/pipeline';
import type { WorldState } from '../engine/state';
import { spawnDueCast } from './canon/cast';
import { factionsMonth } from './factions';
import { peopleYear } from './places/people';
import { epidemicsMonth, residentsYear } from './places/residents';
import { worldBuilt } from './places/setup';
import { fruitsMonth } from './powers/fruits';
import { handsWorldMonth } from './hands/month';
import { heartWorldQuarter } from './heart/world';

/**
 * Step 4: update world state (factions, territory, economy).
 *
 * Each world system is a function in the list below. Phase 3 brings the world: canon characters
 * born this month, factions and territory, the places' Tier 3 people and their epidemics, and the
 * Tier 2 people's births and deaths. A bare world (no map built, as in the Phase 0 tools) is left
 * as it is: only the entropy probe runs there.
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

/** The world's month (Phase 3). */
export const worldMonth: WorldSystem = (state, ctx) => {
  if (!worldBuilt(state)) return;
  const { data, tick } = ctx;
  spawnDueCast(state, data, tick);
  factionsMonth(state, data, tick);
  residentsYear(state, data, tick);
  epidemicsMonth(state, data, tick, ctx.rng.fork('epidemic'), ctx.newsDrafts);
  peopleYear({ state, data, tick, rng: ctx.rng.fork('people'), newsDrafts: ctx.newsDrafts });
  // Phase 4: canon users take their fruits on their dates; wild fruits are found, markets sell.
  fruitsMonth(state, data, tick, ctx.rng.fork('fruits'), ctx.newsDrafts);
  // Phase 6: canon weapons follow the story; markets settle; others dig treasure.
  handsWorldMonth(state, data, tick, ctx.rng.fork('hands'), ctx.newsDrafts);
  // Phase 7: Tier 2 people befriend, fall out, duel and betray each other.
  heartWorldQuarter(state, data, tick, ctx.rng.fork('heart'), ctx.newsDrafts);
};

export const WORLD_SYSTEMS: readonly WorldSystem[] = [entropyProbe, worldMonth];

export function createUpdateWorldStep(systems: readonly WorldSystem[]): TickStep {
  return {
    id: 'updateWorld',
    run(state, ctx) {
      for (const system of systems) system(state, ctx);
    },
  };
}

export const updateWorld = createUpdateWorldStep(WORLD_SYSTEMS);
