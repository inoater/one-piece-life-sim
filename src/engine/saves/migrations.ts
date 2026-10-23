import { SaveError } from './codec';
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

/** Version 1 is the first release, so there is nothing to migrate from yet. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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
