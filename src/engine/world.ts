import { appendLog } from './log';
import type { WorldState } from './state';

/**
 * Creating an empty world: tick 0, no entities, one log line. Phase 1 fills it with a character;
 * Phase 3 with the canon cast. Nothing here needs game data, so it is a pure function of the seed.
 */

export interface CreateWorldOptions {
  seed: string;
  /**
   * Turns on the entropy probe: a dev-only system that draws random numbers every tick. An empty
   * world consumes no randomness, so without it "same seed, same hash" would pass even if the RNG
   * were broken. See src/systems/world.ts.
   */
  probe?: boolean;
}

export function createWorld(options: CreateWorldOptions): WorldState {
  const seed = options.seed.trim();
  if (seed.length === 0) throw new Error('A world needs a non-empty seed');
  const state: WorldState = {
    seed,
    tick: 0,
    openEnded: false,
    playerId: null,
    counters: { genId: 0, logSeq: 0, decisionId: 0, newsSeq: 0 },
    entities: {},
    log: [],
    news: [],
    scheduled: [],
    pending: [],
    queue: [],
    flags: {},
  };
  if (options.probe) state.flags['dev.probe'] = true;
  appendLog(state, 0, {
    kind: 'system',
    summary: `A new world begins (seed "${seed}").`,
    tags: ['system', 'world'],
    cause: 'sys:create',
  });
  return state;
}
