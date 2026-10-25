import type { GameData, Lane, TravelMode } from '../../engine/data/schemas';
import { TRAVEL_MODES } from '../../engine/data/schemas';
import { entityIds } from '../../engine/entities';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import {
  flagOf,
  humanAgeOf,
  isBedRest,
  isJailed,
  requirementReason,
  type Person,
} from '../life/body';
import { lanesFrom, laneZone, withDevFixtures } from '../places/graph';
import { priceMult } from '../places/place';
import { monthlyMiles, modeSpeed, monthsToCover, navigatorBonus } from './progress';
import { shipNumbers } from '../hands/ships';

/**
 * The planning screen (Phase 3): from where the player stands, every place a lane reaches, and for
 * each way of getting there whether it is possible (with the reason when not), how long it would
 * take, and what it would cost. Starting a voyage asks the same function, so the page never offers
 * a trip the world will refuse.
 */

const MIN_AGE: Record<TravelMode, number> = {
  own: 14,
  crew: 12,
  passenger: 6,
  stowaway: 10,
  marine: 15,
  foot: 12,
};

export interface ModeOption {
  mode: TravelMode;
  /** Null when this way is open; otherwise why not. */
  lock: string | null;
  months: number;
  /** Berries it will cost up front (fare, or nothing). */
  cost: number;
  /** Own ship: person-months of stores needed, and aboard. */
  suppliesNeeded: number;
  suppliesAboard: number;
}

export interface RouteOption {
  lane: Lane;
  to: string;
  miles: number;
  danger: number;
  /** The sea it crosses, for its danger modifier. */
  zone: string;
  requires: Lane['requires'];
  modes: ModeOption[];
}

/** The ship the player owns that is moored where they are, if any. */
export function shipHere(state: WorldState, p: Person): Entity | null {
  const here = p.place.location?.id;
  if (!here) return null;
  for (const id of entityIds(state)) {
    const e = state.entities[id];
    if (e?.ship && e.ship.ownerId === p.entity.id && !e.ship.sunk && e.ship.place === here)
      return e;
  }
  return null;
}

/** Every ship the player owns, afloat. */
export function shipsOf(state: WorldState, ownerId: string): Entity[] {
  return entityIds(state)
    .map((id) => state.entities[id] as Entity)
    .filter((e) => e.ship && e.ship.ownerId === ownerId && !e.ship.sunk);
}

function hasEternalPose(p: Person, to: string): boolean {
  return p.c.travel?.eternalPoses.includes(to) ?? false;
}

/** Months the Log Pose still needs at this place before it points onward. */
export function poseWait(state: WorldState, p: Person): number {
  const loc = p.place.location;
  if (!loc || loc.logPose === undefined) return 0;
  const arrived = p.c.travel?.arrivedTick ?? -Infinity;
  return Math.max(0, arrived + loc.logPose - state.tick);
}

function laneLock(state: WorldState, p: Person, lane: Lane, to: string): string | null {
  if (lane.closedBy && flagOf(state, p.entity, lane.closedBy) === true) {
    return lane.closedText ?? 'Closed';
  }
  if (lane.needsFlag && flagOf(state, p.entity, lane.needsFlag) === undefined) {
    return lane.needsText ?? 'Not open to you';
  }
  if (lane.requires === 'log_pose' && !hasEternalPose(p, to)) {
    const wait = poseWait(state, p);
    if (wait > 0) {
      return `The Log Pose is still setting on this island (${wait === 1 ? '1 more month' : `${wait} more months`})`;
    }
  }
  return null;
}

function modeLock(
  state: WorldState,
  data: GameData,
  p: Person,
  lane: Lane,
  to: string,
  mode: TravelMode,
  ship: Entity | null,
  months: number,
): string | null {
  const tick = state.tick;
  const life = p.c.life;
  if (lane.land !== (mode === 'foot')) return lane.land ? 'Only on foot' : 'Not on foot';
  if (humanAgeOf(data, p, tick) < MIN_AGE[mode]) return 'Too young to travel this way';
  if (life && isJailed(life, tick)) return 'Not from a cell';
  if (
    life &&
    (mode === 'own' || mode === 'crew' || mode === 'foot') &&
    isBedRest(data, life, tick)
  ) {
    return 'On bed rest';
  }
  if (mode !== 'own' && mode !== 'foot' && lane.traffic === 0)
    return 'No ship takes travellers this way';
  switch (mode) {
    case 'own': {
      if (!ship?.ship) return 'You have no ship moored here';
      if (ship.ship.hull <= 0) return 'Your ship needs repairs';
      // Phase 6: in the yard for a refit; the hands her own design needs.
      if (ship.ship.refitUntil !== undefined && ship.ship.refitUntil > tick)
        return 'She is in the yard being refitted';
      const minCrew = shipNumbers(data, ship).minCrew;
      if (ship.ship.crew + 1 < minCrew) {
        return `Needs a crew of ${minCrew} (you have ${ship.ship.crew + 1} with yourself)`;
      }
      if (lane.requires === 'log_pose' && !p.c.travel?.logPose && !hasEternalPose(p, to)) {
        return 'Needs a Log Pose';
      }
      if (lane.requires === 'eternal_pose' && !hasEternalPose(p, to)) {
        return 'Needs an Eternal Pose to this island';
      }
      if (lane.requires === 'coated_ship' && !ship.ship.coated) return 'Needs a coated hull';
      return null;
    }
    case 'crew': {
      const job = life?.job ? data.jobs[life.job.id] : undefined;
      if (job?.travels) return null;
      const hand = data.jobs['job_ships_hand'];
      if (!hand) return 'Nobody is hiring hands';
      return requirementReason(state, data, p, hand.requires, tick);
    }
    case 'passenger': {
      const fare = fareFor(state, data, p) * months;
      if (p.c.berries < fare) return `The fare is ${formatBerries(fare)} Berries`;
      return null;
    }
    case 'stowaway':
      return null;
    case 'marine': {
      const job = life?.job?.id;
      if (job !== 'job_marine_recruit' && p.entity.flags['marine.enlisted'] !== true) {
        return 'Only for those who serve in the Marines';
      }
      const from = p.place.location;
      const dest = data.locations[to];
      if (!from?.features.includes('marine_base') && !dest?.features.includes('marine_base')) {
        return 'No Marine ship sails this way';
      }
      return null;
    }
    case 'foot':
      return null;
  }
}

/** A passenger's fare a month from here. */
export function fareFor(state: WorldState, data: GameData, p: Person): number {
  return Math.round(data.travel.fare * priceMult(state, data, p.place.id));
}

/** Every route from where the player stands, with each way of taking it. */
export function routeOptions(state: WorldState, data: GameData, p: Person): RouteOption[] {
  const here = p.place.location;
  if (!here || p.place.atSea) return [];
  const tick = state.tick;
  const ship = shipHere(state, p);
  const out: RouteOption[] = [];
  for (const edge of lanesFrom(data, here.id, withDevFixtures(state))) {
    const lane = edge.lane;
    const blocked = laneLock(state, p, lane, edge.to);
    const modes: ModeOption[] = [];
    for (const mode of TRAVEL_MODES) {
      if (lane.land !== (mode === 'foot')) continue;
      const speed = modeSpeed(data, mode, ship, tick);
      const nav =
        mode === 'own'
          ? navigatorBonus(data, p.entity, tick)
          : mode === 'foot'
            ? 1
            : data.travel.navigator.npc;
      const pace = (t: number) =>
        mode === 'foot' ? data.travel.walkSpeed : monthlyMiles(data, lane, speed || 1, nav, t);
      const months = monthsToCover(lane.miles, pace, tick);
      const lock = blocked ?? modeLock(state, data, p, lane, edge.to, mode, ship, months);
      const mouths = ship?.ship ? ship.ship.crew + 1 : 1;
      modes.push({
        mode,
        lock,
        months,
        cost: mode === 'passenger' ? fareFor(state, data, p) * months : 0,
        suppliesNeeded: mode === 'own' ? mouths * months : 0,
        suppliesAboard: mode === 'own' ? (ship?.ship?.supplies ?? 0) : 0,
      });
    }
    out.push({
      lane,
      to: edge.to,
      miles: lane.miles,
      danger: lane.danger,
      zone: laneZone(data, lane),
      requires: lane.requires,
      modes,
    });
  }
  return out;
}

/** Why the player cannot set out along this lane this way, or null. */
export function sailLock(
  state: WorldState,
  data: GameData,
  p: Person,
  laneId: string,
  mode: TravelMode,
): string | null {
  if (!p.c.alive) return 'Your life has ended';
  if (p.place.atSea) return 'Already at sea';
  const route = routeOptions(state, data, p).find((r) => r.lane.id === laneId);
  if (!route) return 'That lane does not leave from here';
  const option = route.modes.find((m) => m.mode === mode);
  if (!option) return mode === 'foot' ? 'Not on foot' : 'Only on foot';
  return option.lock;
}
