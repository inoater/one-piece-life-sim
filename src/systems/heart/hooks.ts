/**
 * Hooks the heart fills in when it loads (Phase 7). A module with no imports, so the life loop's
 * personality drift can tell the heart about a deed without importing it (and without caring in
 * which order the modules that import each other happen to load).
 */

export interface DeedHook {
  /** A deed of the player's: its weight on their conscience and what people will say of it. */
  fire?: (env: unknown, tags: readonly string[], seq: number | undefined) => void;
}

export const deedHook: DeedHook = {};

export interface FeastHook {
  /** The player has won a battle with people of theirs about: a banquet. */
  fire?: (state: unknown, data: unknown) => void;
}

export const feastHook: FeastHook = {};
