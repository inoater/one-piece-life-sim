import type {
  Birthplace,
  GameData,
  Location,
  PLACE_FEATURES,
  SAFETY_LEVELS,
  WEALTH_LEVELS,
} from '../../engine/data/schemas';
import type { CharacterData, Voyage, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { laneZone } from './graph';

/**
 * Where someone is (Phase 3), as the life loop sees it: what there is to do there (features), how
 * rich and how safe it is, its climate, and whose ways its people share. Phase 2 read all of this
 * from the birthplace; now a person can be anywhere on the map, or at sea.
 */

type Feature = (typeof PLACE_FEATURES)[number];
type Safety = (typeof SAFETY_LEVELS)[number];
type Wealth = (typeof WEALTH_LEVELS)[number];

export interface Place {
  /** A location id, or the lane's id while at sea. */
  id: string;
  name: string;
  /** How a story names it mid-sentence: "Loguetown", "the village", "the open sea". */
  home: string;
  region: string;
  climate: string;
  wealth: Wealth;
  safety: Safety;
  danger: number;
  features: readonly Feature[];
  /** Whose ways the people here share: names, races and work (a birthplace). */
  culture: Birthplace;
  atSea: boolean;
  /** The map node, when ashore. */
  location: Location | null;
}

export function safetyOf(data: GameData, danger: number): Safety {
  const table = data.travel.safetyByDanger;
  return table[Math.max(0, Math.min(table.length - 1, Math.round(danger)))] ?? 'medium';
}

export function placeFromLocation(data: GameData, loc: Location): Place | null {
  const culture = data.birthplaces[loc.culture];
  if (!culture) return null;
  return {
    id: loc.id,
    name: loc.name,
    home: loc.home ?? loc.name,
    region: loc.region,
    climate: loc.climate,
    wealth: loc.wealth,
    safety: safetyOf(data, loc.danger),
    danger: loc.danger,
    features: loc.features,
    culture,
    atSea: false,
    location: loc,
  };
}

/** The open sea along a voyage's lane. */
export function seaPlace(data: GameData, voyage: Voyage, fallback: Birthplace): Place {
  const lane = data.lanes[voyage.lane];
  const from = data.locations[voyage.from];
  const culture = (from && data.birthplaces[from.culture]) || fallback;
  const danger = lane?.danger ?? 2;
  return {
    id: voyage.lane,
    name: 'At sea',
    home: 'the open sea',
    region: lane ? laneZone(data, lane) : (from?.region ?? culture.region),
    climate: from?.climate ?? 'temperate',
    wealth: data.travel.atSea.wealth,
    safety: safetyOf(data, danger),
    danger,
    features: data.travel.atSea.features,
    culture,
    atSea: true,
    location: null,
  };
}

/** A place built from a birthplace alone (worlds whose data has no map node for it). */
function placeFromBirthplace(birthplace: Birthplace): Place {
  return {
    id: birthplace.location,
    name: birthplace.name,
    home: birthplace.home,
    region: birthplace.region,
    climate: 'temperate',
    wealth: birthplace.wealth,
    safety: birthplace.safety,
    danger: 1,
    features: birthplace.features,
    culture: birthplace,
    atSea: false,
    location: null,
  };
}

/** The location id someone stands on (their birthplace's node until they have moved). */
export function locationIdOf(data: GameData, c: CharacterData): string | null {
  if (c.travel?.voyage) return null;
  return c.place ?? data.birthplaces[c.birthplace]?.location ?? null;
}

/** Where a person is now. */
export function placeOf(data: GameData, c: CharacterData, birthplace: Birthplace): Place {
  const voyage = c.travel?.voyage;
  if (voyage) return seaPlace(data, voyage, birthplace);
  const loc = data.locations[c.place ?? birthplace.location];
  return (loc && placeFromLocation(data, loc)) ?? placeFromBirthplace(birthplace);
}

/**
 * A place's prosperity (0 to 100) as it stands, from its location entity. Without one (a world
 * not yet built) it is the level its wealth settles at.
 */
export function prosperityOf(state: WorldState, data: GameData, placeId: string): number {
  const entity = state.entities[placeId];
  const stat = entity?.place?.prosperity;
  if (stat) return Math.max(0, Math.min(100, statValue(stat, state.tick)));
  const loc = data.locations[placeId];
  return loc ? data.world.economy.prosperity[loc.wealth] : 50;
}

/** Prices and wages at a place: 1 at prosperity 50, more where times are good. */
export function priceMult(state: WorldState, data: GameData, placeId: string): number {
  const p = prosperityOf(state, data, placeId);
  return Math.max(0.6, 1 + (p - 50) * data.world.economy.priceSlope);
}
