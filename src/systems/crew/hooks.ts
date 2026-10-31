/**
 * Hooks the crew fills in when it loads (Phase 8). A module with no imports, like heart/hooks.ts,
 * so the heart's Recruit intent, a fight's aftermath, a talk and a deed can reach the crew without
 * importing it (and without caring in which order the modules that import each other load).
 */

export interface CrewHooks {
  /** Someone agreed to join (the Recruit intent, a spared enemy, a freed captive). */
  join?: (env: unknown, other: unknown, seq: number | undefined, how: string) => void;
  /** Someone left the player's side (a goodbye, a desertion milestone, a mutiny). */
  leave?: (state: unknown, data: unknown, otherId: string, why: string) => void;
  /** A deed of the player's, by its tags: the creed reads it. */
  deed?: (env: unknown, tags: readonly string[], seq: number | undefined) => void;
  /** The player talked with someone (arcs that need talking). */
  talked?: (state: unknown, otherId: string) => void;
  /** A fight of the player's is over (morale, loyalty, bounties, the captain's log, loot). */
  fought?: (state: unknown, data: unknown, battle: unknown) => void;
}

export const crewHooks: CrewHooks = {};
