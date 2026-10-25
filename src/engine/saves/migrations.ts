import { SaveError } from './codec';
import { DEFAULT_WORLD_CONFIG } from '../state';
import { SAVE_VERSION } from '../version';

/**
 * Save migrations: every version bump ships a function so old saves keep loading.
 *
 * `MIGRATIONS[n]` upgrades a version-n envelope to version n+1. It receives and returns the whole
 * envelope (state included), because a migration may need to touch metadata as well as state.
 *
 * How to bump the version:
 *   1. Change the persisted shape (state schema or envelope).
 *   2. Raise SAVE_VERSION in version.ts.
 *   3. Add MIGRATIONS[oldVersion] here, returning an envelope with `saveVersion: oldVersion + 1`.
 *   4. Keep a save from the old version in tests/fixtures so the migration stays tested.
 *
 * tests/engine/saves.test.ts fails if a version in 1..SAVE_VERSION-1 has no migration.
 */

export type RawEnvelope = Record<string, unknown>;
export type Migration = (envelope: RawEnvelope) => RawEnvelope;

function stateOf(envelope: RawEnvelope): Record<string, unknown> {
  const state = envelope['state'];
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new SaveError('invalid', 'The save has no world state');
  }
  return state as Record<string, unknown>;
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * 1 -> 2 (Phase 1, character genesis): worlds gain `config` (canon mode, difficulty). A version 1
   * world was made before world setup existed, so it gets the defaults. Entities gain an optional
   * `character` block, which old entities simply do not have.
   */
  1: (envelope) => ({
    ...envelope,
    saveVersion: 2,
    state: { ...stateOf(envelope), config: { ...DEFAULT_WORLD_CONFIG } },
  }),
  /**
   * 2 -> 3 (Phase 2, the life loop): characters gain an optional `life` block (health, routine,
   * job, debt). A version 2 world has no life loop yet, so nothing is added here: the life loop
   * gives the player a fresh life block (full Health, empty routine) the first month it runs.
   * Rules decide what "fresh" means, and migrations do not read game data.
   */
  2: (envelope) => ({ ...envelope, saveVersion: 3, state: { ...stateOf(envelope) } }),
  /**
   * 3 -> 4 (Phase 3, the world): worlds gain the canon layer's state (no beat has a fate yet), the
   * event engine's cooldowns, and a population setting. Places, factions, the canon cast and the
   * Tier 2 people are built from game data the first month the world runs (migrations do not read
   * data), with the canon history up to the save's month; a player with no `place` is wherever
   * their birthplace is on the map.
   */
  3: (envelope) => {
    const state = stateOf(envelope);
    const config = (state['config'] ?? {}) as Record<string, unknown>;
    return {
      ...envelope,
      saveVersion: 4,
      state: {
        ...state,
        config: { ...config, population: 'full' },
        canon: { beats: {}, divergences: [] },
        eventState: {},
      },
    };
  },
  /**
   * 4 -> 5 (Phase 4, powers): characters gain optional `powers`, `personality` and `traitInfo`
   * blocks, and fruit entities a `fruit` block. Nothing is added here: the fruits of the world
   * (one entity each, with their canon users) are built from game data the first month the world
   * runs, and a person's powers block is made the first time a power touches them. The canon
   * cast's old `fruit` flag (a name) is replaced by the fruit's own record then.
   */
  4: (envelope) => ({ ...envelope, saveVersion: 5, state: { ...stateOf(envelope) } }),
  /**
   * 5 -> 6 (Phase 5, battles): no fight is in progress, and the battle counter starts at 0.
   * Characters' fight records begin with their next fight; the canon cast's Combat Power is
   * calibrated to its ladder rung the next month it is updated.
   */
  5: (envelope) => {
    const state = stateOf(envelope);
    const counters = (state['counters'] ?? {}) as Record<string, unknown>;
    return {
      ...envelope,
      saveVersion: 6,
      state: { ...state, battle: null, counters: { ...counters, battleId: 0 } },
    };
  },
  /**
   * 6 -> 7 (Phase 6, hands): every new field is optional, so the state itself is unchanged. The
   * first month the world runs, it gains its blades (canon and graded) and its treasure, and the
   * player's gear bought in Phases 4 and 5 (counts) becomes items (systems/hands/swords.ts).
   */
  6: (envelope) => ({ ...envelope, saveVersion: 7, state: { ...stateOf(envelope) } }),
};

export interface MigrationResult {
  envelope: RawEnvelope;
  from: number;
  /** True when at least one migration ran. */
  migrated: boolean;
}

export function migrateEnvelope(
  raw: RawEnvelope,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SAVE_VERSION,
): MigrationResult {
  const from = raw['saveVersion'];
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new SaveError('invalid', 'The save has no valid version number');
  }
  if (from > target) {
    throw new SaveError(
      'version',
      `This save was made by a newer version of the game (save format ${from}; this build reads up to ${target}). Update the game to open it.`,
    );
  }
  let envelope = raw;
  for (let version = from; version < target; version++) {
    const migrate = table[version];
    if (!migrate) {
      throw new SaveError(
        'version',
        `No migration exists from save format ${version} to ${version + 1}, so this save cannot be opened`,
      );
    }
    envelope = migrate(envelope);
    if (envelope['saveVersion'] !== version + 1) {
      throw new SaveError(
        'version',
        `The migration from save format ${version} did not produce format ${version + 1}`,
      );
    }
  }
  return { envelope, from, migrated: from !== target };
}
