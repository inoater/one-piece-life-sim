import { appendLog } from './log';
import { DEFAULT_WORLD_CONFIG, type WorldConfig, type WorldState } from './state';

/**
 * Creating a world. On its own this is an empty world (no lore, no people). Character genesis
 * (src/systems/genesis) creates one at the player's entry month and fills it with the player and
 * their family; Phase 3 adds the canon cast. Nothing here needs game data, so it is a pure function
 * of its options.
 */

export interface CreateWorldOptions {
  seed: string;
  /**
   * Turns on the entropy probe: a dev-only system that draws random numbers every tick. An empty
   * world consumes no randomness, so without it "same seed, same hash" would pass even if the RNG
   * were broken. See src/systems/world.ts.
   */
  probe?: boolean;
  /** The month the clock starts on. Defaults to tick 0 (Year 0, month 1). */
  startTick?: number;
  config?: WorldConfig;
  /**
   * Write the "A new world begins" line. Character genesis turns it off: it writes the player's
   * past first, so the chronicle reads in order, and then a line of its own.
   */
  intro?: boolean;
}

export function createWorld(options: CreateWorldOptions): WorldState {
  const seed = options.seed.trim();
  if (seed.length === 0) throw new Error('A world needs a non-empty seed');
  const startTick = options.startTick ?? 0;
  if (!Number.isInteger(startTick)) throw new RangeError(`startTick must be an integer`);
  const state: WorldState = {
    seed,
    tick: startTick,
    openEnded: false,
    config: { ...(options.config ?? DEFAULT_WORLD_CONFIG) },
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
  if (options.intro === false) return state;
  appendLog(state, startTick, {
    kind: 'system',
    summary: `A new world begins (seed "${seed}").`,
    tags: ['system', 'world'],
    cause: 'sys:create',
  });
  return state;
}
