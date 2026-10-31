import { dateOf } from '../../engine/calendar';
import { crewEffect } from '../crew/fx';
import type { GameData, Lane, TravelMode } from '../../engine/data/schemas';
import type { CharacterData, Entity, VesselState, Voyage, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';

/**
 * How fast a voyage goes (Phase 3, the plan's formula):
 *
 *   months = ceil(distance / (ship speed x wind and current modifier x navigator bonus))
 *
 * The same numbers drive the planner's estimate and each month's progress at sea, so a voyage the
 * planner says takes two months does take two months, unless the sea has other ideas.
 */

/** A navigator's bonus from a stat: 1 + (stat - from) x per, between 1 and 1 + max. */
export function navigatorBonus(data: GameData, navigator: Entity | null, tick: number): number {
  const n = data.travel.navigator;
  if (!navigator) return n.npc;
  const stat = navigator.stats[n.stat];
  const value = stat ? statValue(stat, tick) : 0;
  return 1 + Math.max(0, Math.min(n.max, (value - n.from) * n.per));
}

export function windOf(data: GameData, tick: number): number {
  return data.travel.wind[dateOf(data.calendar, tick).seasonId] ?? 1;
}

export function currentOf(data: GameData, lane: Lane): number {
  return data.travel.currents[lane.current];
}

/** Miles a month on a lane at this speed, this month. */
export function monthlyMiles(
  data: GameData,
  lane: Lane,
  speed: number,
  navigator: number,
  tick: number,
): number {
  return speed * currentOf(data, lane) * windOf(data, tick) * navigator;
}

export function estimateMonths(miles: number, perMonth: number): number {
  return Math.max(1, Math.ceil(miles / Math.max(1, perMonth) - 1e-9));
}

/**
 * Months to cover a distance when the pace changes month by month (the wind follows the seasons):
 * the plan's formula applied one month at a time, starting with the month `from` is processed.
 * With a steady pace it is exactly ceil(miles / pace).
 */
export function monthsToCover(
  miles: number,
  paceAt: (tick: number) => number,
  from: number,
): number {
  let covered = 0;
  for (let m = 0; m < 240; m++) {
    covered += Math.max(1, paceAt(from + m));
    if (covered >= miles - 1e-6) return m + 1;
  }
  return 240;
}

/** The speed of whatever carries a traveller in this mode (own ship: its speed stat). */
export function modeSpeed(
  data: GameData,
  mode: TravelMode,
  ship: Entity | null,
  tick: number,
): number {
  if (mode === 'foot') return data.travel.walkSpeed;
  if (mode === 'own') {
    const stat = ship?.stats['speed'];
    return stat ? statValue(stat, tick) : 0;
  }
  const carrier = data.vessels[data.travel.carriers[mode]];
  return carrier?.speed ?? 100;
}

// ---- The vessel the traveller is aboard ---------------------------------------------------------

/** The player's own ship on a voyage, or null when someone else's ship carries them. */
export function ownShipOf(state: WorldState, voyage: Voyage): Entity | null {
  if (!voyage.shipId) return null;
  const ship = state.entities[voyage.shipId];
  return ship?.ship ? ship : null;
}

/** A copy of the vessel's state: own ship or carrier, read the same way. */
export function vesselNow(state: WorldState, voyage: Voyage): VesselState | null {
  if (voyage.vessel) return { ...voyage.vessel };
  const ship = ownShipOf(state, voyage);
  if (!ship?.ship) return null;
  const s = ship.ship;
  const maxHull = ship.stats['hull'] ? statValue(ship.stats['hull'], state.tick) : s.hull;
  const speed = ship.stats['speed'] ? statValue(ship.stats['speed'], state.tick) : 0;
  return {
    name: ship.name,
    vessel: s.vessel,
    hull: s.hull,
    maxHull,
    speed,
    crew: s.crew,
    morale: s.morale,
    supplies: s.supplies,
  };
}

export type VesselField = 'hull' | 'crew' | 'morale' | 'supplies';

/** Change the vessel's hull, crew, morale or supplies, within their bounds. Returns the change made. */
export function changeVessel(
  state: WorldState,
  voyage: Voyage,
  field: VesselField,
  by: number,
): number {
  const target = voyage.vessel ?? ownShipOf(state, voyage)?.ship;
  if (!target) return 0;
  const now = vesselNow(state, voyage);
  const before = target[field];
  let after = before + by;
  if (field === 'hull') after = Math.min(now?.maxHull ?? after, after);
  if (field === 'morale') after = Math.max(0, Math.min(100, after));
  if (field === 'crew') after = Math.max(0, Math.round(after));
  if (field === 'supplies') after = Math.max(0, Math.round(after * 10) / 10);
  if (field === 'hull') after = Math.round(after * 10) / 10;
  target[field] = after;
  return after - before;
}

/** People aboard who eat from the ship's stores: the hands, and the player. */
export function mouthsAboard(vessel: VesselState): number {
  return vessel.crew + 1;
}

// ---- Progress -----------------------------------------------------------------------------------

/** Miles a month for this voyage now (ignoring the captain's order). */
export function voyagePace(
  state: WorldState,
  data: GameData,
  voyage: Voyage,
  tick: number,
): number {
  const lane = data.lanes[voyage.lane];
  if (!lane) return 1;
  const player = state.playerId ? state.entities[state.playerId] : null;
  // Walking is not helped by winds and currents.
  if (voyage.mode === 'foot') return data.travel.walkSpeed;
  const vessel = vesselNow(state, voyage);
  const navigator =
    voyage.mode === 'own' ? navigatorBonus(data, player ?? null, tick) : data.travel.navigator.npc;
  // Phase 8: the helm, the rigging and the navigator at their posts (own ship, with a crew).
  const posts =
    voyage.mode === 'own' ? Math.max(0.3, 1 + crewEffect(state, data, 'voyage.pace')) : 1;
  return monthlyMiles(data, lane, vessel?.speed ?? 100, navigator, tick) * posts;
}

/** Whole months still to go at the current pace, or null when not at sea. */
export function monthsLeft(data: GameData, state: WorldState, c: CharacterData): number | null {
  const voyage = c.travel?.voyage;
  if (!voyage) return null;
  return monthsToCover(
    Math.max(0, voyage.miles - voyage.done),
    (t) => voyagePace(state, data, voyage, t),
    state.tick,
  );
}
