import type { GameData } from '../../engine/data/schemas';
import type { TickStep } from '../../engine/pipeline';
import { Rng } from '../../engine/rng';
import { buildFruitLayer, seedGeneratedFruits } from '../powers/fruits';
import { buildHandsLayer } from '../hands/swords';
import type { WorldState } from '../../engine/state';
import { runTickInPlace } from '../../engine/tick';
import { spawnDueCast } from '../canon/cast';
import { populate } from './people';
import { ensurePlaces, spawnDueFactions, WORLD_BUILT, worldBuilt } from './setup';

/**
 * Building a world's layer of places, factions and people, and its past (Phase 3).
 *
 * A world needs its map, factions and canon cast before its first month. When the world begins
 * after Year 0 (a life entered in Year 30), the years before are played first without the player:
 * the canon cast is born and follows its keyframes, beats fire or diverge by the canon mode, the
 * factions rise and fall, world events and epidemics happen, and the news is written. Then the
 * world is populated with its Tier 2 people as they are at the start. The past uses the same
 * pipeline steps and the same keyed random streams as the present.
 */

/** The steps that make up the world's past: no player actions, no voyages, no aging of a life. */
let historySteps: readonly TickStep[] | null = null;

export function setHistoryPipeline(steps: readonly TickStep[]): void {
  historySteps = steps;
}

/** Play the world from `from` up to (not including) `to`, without the player. */
export function runHistory(state: WorldState, data: GameData, from: number, to: number): void {
  if (to <= from) return;
  if (!historySteps) throw new Error('The history pipeline has not been registered');
  const player = state.playerId;
  const now = state.tick;
  state.playerId = null;
  try {
    const rng = Rng.root(state.seed);
    for (let t = from; t < to; t++) {
      state.tick = t;
      runTickInPlace(state, data, rng, historySteps);
    }
  } finally {
    state.playerId = player;
    state.tick = now;
  }
}

/**
 * Build the world layer if this world does not have one yet: places, factions and the canon cast
 * as they were in Year 0, the history up to now, and the Tier 2 people. Returns true if it built.
 */
export function ensureWorldLayer(state: WorldState, data: GameData): boolean {
  if (worldBuilt(state)) return false;
  state.flags[WORLD_BUILT] = true;
  const start = state.tick;
  const from = Math.min(0, start);
  ensurePlaces(state, data, from);
  spawnDueFactions(state, data, from);
  spawnDueCast(state, data, from);
  // Phase 4: every canon fruit as it was then, before the history plays its handovers.
  buildFruitLayer(state, data, from, Rng.root(state.seed).fork('fruits'));
  runHistory(state, data, from, start);
  populate(state, data, start, Rng.root(state.seed).fork('populate'));
  seedGeneratedFruits(state, data, start, Rng.root(state.seed).fork('generated-fruits'));
  // Phase 6: the world's blades, canon and graded, and its treasure.
  buildHandsLayer(state, data, start, Rng.root(state.seed).fork('hands-layer'));
  return true;
}
