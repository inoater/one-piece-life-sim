import {
  tickOfWhen,
  type Faction,
  type GameData,
  type Location,
  type PopulationTier,
} from '../../engine/data/schemas';
import { PUBLIC_KNOWLEDGE, type Entity, type WorldState } from '../../engine/state';
import { makeStat } from '../../engine/stats';
import { sortedValues } from '../genesis/options';
import { isDev, locations, withDevFixtures } from './graph';

/**
 * The world layer (Phase 3): the map's places as location entities (who holds them, how they are
 * doing, who lives there as numbers), the factions and canon crews as organization entities, and
 * the canon cast. Built once per world, from game data, the first time it is needed: at the start
 * of a new life, or the first month of a world saved before Phase 3.
 *
 * A world that begins after Year 0 has a past: `runHistory` (places/history.ts) plays the canon
 * layer and the world's events from Year 0 up to the start, without the player, so a life that
 * begins in Year 30 begins after Roger's execution (or after whatever happened instead).
 */

export const WORLD_BUILT = 'world.built';

/** Occupations that exist among a place's people, by weight. */
export function occupationsOf(data: GameData, loc: Location): { id: string; weight: number }[] {
  const culture = data.birthplaces[loc.culture];
  return sortedValues(data.occupations)
    .filter(
      (o) =>
        !o.special &&
        o.weight > 0 &&
        (o.places.length === 0 || o.places.includes(loc.culture)) &&
        (o.races.length === 0 || o.races.some((r) => culture?.races.includes(r))),
    )
    .map((o) => ({ id: o.id, weight: o.weight }));
}

/** Split adults among a place's occupations. */
export function jobsFor(data: GameData, loc: Location, adults: number): Record<string, number> {
  const pool = occupationsOf(data, loc);
  const total = pool.reduce((sum, o) => sum + o.weight, 0);
  const jobs: Record<string, number> = {};
  if (total <= 0) return jobs;
  for (const o of pool) jobs[o.id] = Math.round((adults * o.weight) / total);
  return jobs;
}

export function makeLocationEntity(data: GameData, loc: Location, tick: number): Entity {
  const total = data.world.population.residents[loc.population as PopulationTier];
  const ages = data.world.population.ages;
  const adults = Math.round(total * ages.adults);
  return {
    id: loc.id,
    type: 'location',
    origin: loc.origin === 'generated' ? 'generated' : 'canon',
    name: loc.name,
    createdTick: tick,
    tier: 2,
    flags: {},
    stats: {},
    knownBy: [PUBLIC_KNOWLEDGE],
    place: {
      controller: loc.controller,
      prosperity: makeStat(data.world.economy.prosperity[loc.wealth]),
      residents: {
        children: Math.round(total * ages.children),
        adults,
        elders: Math.round(total * ages.elders),
      },
      jobs: jobsFor(data, loc, adults),
    },
  };
}

export function makeFactionEntity(faction: Faction, tick: number): Entity {
  const opinions: Record<string, ReturnType<typeof makeStat>> = {};
  for (const [org, value] of Object.entries(faction.opinions)) opinions[org] = makeStat(value);
  return {
    id: faction.id,
    type: 'organization',
    origin: faction.dev ? 'generated' : 'canon',
    name: faction.name,
    createdTick: tick,
    tier: 1,
    flags: {},
    stats: { strength: makeStat(faction.strength) },
    knownBy: [PUBLIC_KNOWLEDGE],
    org: {
      kind: faction.kind,
      active: faction.active,
      leaderId: faction.captain ?? null,
      members: [],
      opinions,
      umbrella: faction.umbrella ?? null,
      home: faction.home ?? null,
      foundedTick: faction.founded ? tickOfWhen(faction.founded) : Math.min(0, tick),
      endedTick: null,
    },
  };
}

/** Bring into being every faction founded by `tick` that does not exist yet. */
export function spawnDueFactions(state: WorldState, data: GameData, tick: number): Entity[] {
  const dev = withDevFixtures(state);
  const out: Entity[] = [];
  for (const id of Object.keys(data.factions).sort()) {
    const faction = data.factions[id] as Faction;
    if (faction.dev && !dev) continue;
    if (id in state.entities) continue;
    if (faction.founded && tickOfWhen(faction.founded) > tick) continue;
    const entity = makeFactionEntity(faction, tick);
    state.entities[id] = entity;
    out.push(entity);
  }
  return out;
}

/** Location entities for every place on the map that does not have one. */
export function ensurePlaces(state: WorldState, data: GameData, tick: number): void {
  for (const loc of locations(data, withDevFixtures(state))) {
    if (loc.id in state.entities) continue;
    if (isDev(loc) && !withDevFixtures(state)) continue;
    state.entities[loc.id] = makeLocationEntity(data, loc, tick);
  }
}

export function worldBuilt(state: WorldState): boolean {
  return state.flags[WORLD_BUILT] === true;
}
