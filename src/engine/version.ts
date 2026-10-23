/**
 * Version constants.
 *
 * ENGINE_VERSION is informational: it is written into save envelopes, never into world state, so
 * a patch release does not change any state hash.
 *
 * SAVE_VERSION covers the persisted shape (envelope + world state). Bumping it requires a
 * migration in `saves/migrations.ts`; a test fails if one is missing.
 */
export const ENGINE_VERSION = '0.1.0';
export const SAVE_VERSION = 1;

/** Version of the `.opsim` file wrapper (magic bytes, version byte, gzip payload). */
export const CONTAINER_VERSION = 1;

/** Identifies how `stateHash` was computed, so a future algorithm change is detectable. */
export const HASH_ALGO = 'cyrb128-canonical-v1';
