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
