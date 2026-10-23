/**
 * One id system for every entity (players, NPCs, crews, ships, fruits, weapons, places).
 *
 * - Canon entities use readable slugs: `char_gol_d_roger`, `org_marines`, `loc_east_blue_village`.
 *   A slug is stable forever, so canon data files and save files can refer to it.
 * - Everything the game invents at runtime uses a global counter: `gen_000412`. The entity's
 *   `type` field says what it is; the id does not.
 */

export const CANON_PREFIXES = ['char', 'org', 'ship', 'item', 'fruit', 'loc'] as const;

export const CANON_ID = /^(?:char|org|ship|item|fruit|loc)_[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const GENERATED_ID = /^gen_\d{6,}$/;

export const ID_FORMAT_HINT =
  'a canon slug such as "char_gol_d_roger" (char, org, ship, item, fruit or loc prefix) or a generated id such as "gen_000412"';

export function isCanonId(id: string): boolean {
  return CANON_ID.test(id);
}

export function isGeneratedId(id: string): boolean {
  return GENERATED_ID.test(id);
}

export function isEntityId(id: string): boolean {
  return isCanonId(id) || isGeneratedId(id);
}

/** gen_000001, gen_000412, ... (widens past six digits rather than overflowing). */
export function formatGeneratedId(counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`Generated id counter must be a positive integer, got ${counter}`);
  }
  return `gen_${String(counter).padStart(6, '0')}`;
}
