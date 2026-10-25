import type { GameData } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';
import { ensureLife } from '../life/body';
import { laneZone } from '../places/graph';
import { priceMult } from '../places/place';
import { shipNumbers } from '../hands/ships';
import { supplyCapacity } from './commands';
import { fareFor, poseWait, routeOptions, shipHere, shipsOf } from './plan';
import { monthsLeft, mouthsAboard, vesselNow } from './progress';

/**
 * What the travel screens show (Phase 3): where the player is, the voyage they are on (progress,
 * the vessel, the captain's order), every route from here with each way of taking it, and, in
 * port, what the harbour sells. Plain data for the page; every reason comes from the same rules
 * the actions check.
 */

export interface PlaceBrief {
  id: string;
  name: string;
  region: string;
  regionName: string;
  climate: string;
  danger: number;
  wealth: string;
  /** Months until the Log Pose sets here (Grand Line), 0 when it has. Null off the Grand Line. */
  poseWait: number | null;
}

export interface VoyageView {
  from: PlaceBrief;
  to: PlaceBrief;
  mode: string;
  modeName: string;
  miles: number;
  done: number;
  months: number;
  monthsLeft: number;
  estimate: number;
  order: string;
  orders: { id: string; name: string; description: string }[];
  captain: boolean;
  vessel: null | {
    name: string;
    className: string;
    hull: number;
    maxHull: number;
    crew: number;
    morale: number;
    supplies: number;
    /** Months the stores last for everyone aboard (own ship). */
    suppliesMonths: number | null;
    captainName: string | null;
  };
  danger: number;
  zone: string;
}

export interface RouteModeView {
  mode: string;
  name: string;
  lock: string | null;
  months: number;
  cost: number;
  suppliesNeeded: number;
  suppliesAboard: number;
  route: string;
  risk: string;
}

export interface RouteView {
  lane: string;
  to: PlaceBrief;
  miles: number;
  danger: number;
  zone: string;
  zoneName: string;
  requires: string;
  description: string | null;
  modes: RouteModeView[];
}

export interface HarbourView {
  ship: null | {
    id: string;
    name: string;
    className: string;
    hull: number;
    maxHull: number;
    crew: number;
    minCrew: number;
    maxCrew: number;
    morale: number;
    supplies: number;
    capacity: number;
    coated: boolean;
    speed: number;
    /** Here, or moored elsewhere (by name). */
    where: string;
    here: boolean;
  };
  forSale: {
    id: string;
    name: string;
    description: string;
    cost: number;
    speed: number;
    hull: number;
    minCrew: number;
    cargo: number;
  }[];
  hireCost: number;
  wage: number;
  provisionCost: number;
  repairCost: number | null;
  coating: number | null;
  logPose: number | null;
  eternalPoses: { id: string; name: string; cost: number; owned: boolean }[];
  fare: number;
  hasLogPose: boolean;
  poses: string[];
}

export interface TravelView {
  atSea: boolean;
  here: PlaceBrief | null;
  voyage: VoyageView | null;
  routes: RouteView[];
  harbour: HarbourView | null;
  visited: string[];
}

export const REGION_NAMES: Record<string, string> = {
  east_blue: 'East Blue',
  west_blue: 'West Blue',
  north_blue: 'North Blue',
  south_blue: 'South Blue',
  paradise: 'Paradise',
  new_world: 'New World',
  sky: 'Sky islands',
  fishman_island: 'Fish-Man Island',
  wano: 'Wano',
  red_line: 'The Red Line',
  calm_belt: 'The Calm Belt',
};

export function brief(data: GameData, id: string, wait: number | null = null): PlaceBrief {
  const loc = data.locations[id];
  return {
    id,
    name: loc?.name ?? id,
    region: loc?.region ?? '',
    regionName: REGION_NAMES[loc?.region ?? ''] ?? loc?.region ?? '',
    climate:
      data.world.climates[(loc?.climate ?? 'temperate') as keyof typeof data.world.climates]
        ?.name ?? '',
    danger: loc?.danger ?? 0,
    wealth: loc?.wealth ?? 'medium',
    poseWait: loc?.logPose === undefined ? null : wait,
  };
}

export function travelView(state: WorldState, data: GameData): TravelView | null {
  const p = ensureLife(state, data);
  if (!p) return null;
  const travel = p.c.travel;
  const visited = travel?.visited ?? (p.place.location ? [p.place.location.id] : []);
  const voyage = travel?.voyage ?? null;
  const modeName = (id: string) => data.travel.modes.find((m) => m.id === id)?.name ?? id;

  if (voyage) {
    const vessel = vesselNow(state, voyage);
    const lane = data.lanes[voyage.lane];
    const zone = lane ? laneZone(data, lane) : '';
    return {
      atSea: true,
      here: null,
      visited,
      routes: [],
      harbour: null,
      voyage: {
        from: brief(data, voyage.from),
        to: brief(data, voyage.to),
        mode: voyage.mode,
        modeName: modeName(voyage.mode),
        miles: voyage.miles,
        done: Math.round(voyage.done),
        months: voyage.months,
        monthsLeft: monthsLeft(data, state, p.c) ?? 0,
        estimate: voyage.estimate,
        order: voyage.order,
        orders: Object.entries(data.travel.orders).map(([id, o]) => ({
          id,
          name: o.name,
          description: o.description,
        })),
        captain: voyage.mode === 'own',
        vessel: vessel
          ? {
              name: vessel.name,
              className: data.vessels[vessel.vessel]?.name ?? vessel.vessel,
              hull: Math.round(vessel.hull),
              maxHull: Math.round(vessel.maxHull),
              crew: vessel.crew,
              morale: Math.round(vessel.morale),
              supplies: vessel.supplies,
              suppliesMonths:
                voyage.mode === 'own' ? Math.floor(vessel.supplies / mouthsAboard(vessel)) : null,
              captainName: vessel.captain ?? null,
            }
          : null,
        danger: lane?.danger ?? 0,
        zone: REGION_NAMES[zone] ?? zone,
      },
    };
  }

  const here = p.place.location;
  if (!here) return { atSea: false, here: null, visited, voyage: null, routes: [], harbour: null };
  const routes: RouteView[] = routeOptions(state, data, p).map((r) => ({
    lane: r.lane.id,
    to: brief(data, r.to),
    miles: r.miles,
    danger: r.danger,
    zone: r.zone,
    zoneName: REGION_NAMES[r.zone] ?? r.zone,
    requires: r.requires,
    description: r.lane.description ?? null,
    modes: r.modes.map((m) => {
      const def = data.travel.modes.find((d) => d.id === m.mode);
      return {
        mode: m.mode,
        name: def?.name ?? m.mode,
        lock: m.lock,
        months: m.months,
        cost: m.cost,
        suppliesNeeded: m.suppliesNeeded,
        suppliesAboard: m.suppliesAboard,
        route: def?.route ?? '',
        risk: def?.risk ?? '',
      };
    }),
  }));

  const mult = priceMult(state, data, here.id);
  const ship = shipHere(state, p) ?? shipsOf(state, p.entity.id)[0] ?? null;
  const vessel = ship?.ship ? data.vessels[ship.ship.vessel] : undefined;
  const yard = here.features.includes('shipyard');
  const docks = here.features.includes('docks');
  const own = ship?.ship ? shipNumbers(data, ship) : null;
  const damage = ship?.ship && own ? own.maxHull - ship.ship.hull : 0;
  const harbour: HarbourView = {
    ship:
      ship?.ship && vessel
        ? {
            id: ship.id,
            name: ship.name,
            className: vessel.name,
            hull: Math.round(ship.ship.hull),
            maxHull: own?.maxHull ?? vessel.hull,
            crew: ship.ship.crew,
            minCrew: own?.minCrew ?? vessel.minCrew,
            maxCrew: own?.maxCrew ?? vessel.maxCrew,
            morale: Math.round(ship.ship.morale),
            supplies: ship.ship.supplies,
            capacity: supplyCapacity(data, ship),
            coated: ship.ship.coated,
            speed: own?.speed ?? vessel.speed,
            where: data.locations[ship.ship.place ?? '']?.name ?? 'at sea',
            here: ship.ship.place === here.id,
          }
        : null,
    forSale: Object.values(data.vessels)
      .filter((v) => v.cost !== null && here.features.includes(v.soldAt))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))
      .map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        cost: Math.round((v.cost ?? 0) * mult),
        speed: v.speed,
        hull: v.hull,
        minCrew: v.minCrew,
        cargo: v.cargo,
      })),
    hireCost: docks ? data.travel.hireCost : 0,
    wage: data.travel.crewWage,
    provisionCost: Math.round(data.travel.provisions.costPerMonth * mult),
    repairCost:
      damage > 0 && (yard || docks)
        ? Math.round(
            (yard ? damage : Math.ceil(damage / 2)) *
              data.travel.repair.perHull *
              (yard ? 1 : data.travel.repair.docksMult) *
              mult,
          )
        : null,
    coating: data.travel.coating.at.includes(here.id) ? data.travel.coating.cost : null,
    logPose: data.travel.logPose.at.includes(here.id) ? data.travel.logPose.cost : null,
    eternalPoses: here.eternalPoses.map((id) => ({
      id,
      name: data.locations[id]?.name ?? id,
      cost: data.travel.eternalPose.cost,
      owned: travel?.eternalPoses.includes(id) ?? false,
    })),
    fare: fareFor(state, data, p),
    hasLogPose: travel?.logPose ?? false,
    poses: (travel?.eternalPoses ?? []).map((id) => data.locations[id]?.name ?? id),
  };
  return {
    atSea: false,
    here: brief(data, here.id, poseWait(state, p)),
    visited,
    voyage: null,
    routes,
    harbour,
  };
}
