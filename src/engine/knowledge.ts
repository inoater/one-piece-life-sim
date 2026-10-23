import { PUBLIC_KNOWLEDGE } from './state';

/**
 * Rule 4: the world stores what is true; the player sees what they know.
 *
 * Every fact (log record, entity) carries `knownBy`: a list of entity ids, or '*' for common
 * knowledge. The engine is omniscient for now, but every reader that shows facts to a player goes
 * through `isKnownBy`, so fog of war is one change here rather than a rewrite of every screen.
 */

export function isKnownBy(
  knownBy: readonly string[],
  viewerId: string | null,
  omniscient = false,
): boolean {
  if (omniscient) return true;
  if (knownBy.includes(PUBLIC_KNOWLEDGE)) return true;
  return viewerId !== null && knownBy.includes(viewerId);
}
