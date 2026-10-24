import type { GameData, Lane, Location } from '../../engine/data/schemas';
import type { Voyage, WorldState } from '../../engine/state';
import { ensureLife, type Person } from '../life/body';
import { placeFromLocation, type Place } from '../places/place';

/**
 * What an event is about (Phase 3): the month, the player (when the event happens to them), where
 * it happens, and, at sea, the voyage and its lane. Conditions, weights and roles all read this.
 * A world event has no player: its place is somewhere in the world.
 */
export interface StoryCtx {
  state: WorldState;
  data: GameData;
  tick: number;
  /** The player, alive. Null for world events (and worlds nobody is playing). */
  p: Person | null;
  place: Place | null;
  voyage: Voyage | null;
  lane: Lane | null;
}

/** The story around the player this month. */
export function playerStory(state: WorldState, data: GameData, tick: number): StoryCtx {
  const p = ensureLife(state, data);
  const voyage = p?.c.travel?.voyage ?? null;
  return {
    state,
    data,
    tick,
    p,
    place: p?.place ?? null,
    voyage,
    lane: voyage ? (data.lanes[voyage.lane] ?? null) : null,
  };
}

/** The story at a place in the world, with nobody in particular (world events). */
export function worldStory(
  state: WorldState,
  data: GameData,
  tick: number,
  loc: Location,
): StoryCtx {
  return {
    state,
    data,
    tick,
    p: null,
    place: placeFromLocation(data, loc),
    voyage: null,
    lane: null,
  };
}
