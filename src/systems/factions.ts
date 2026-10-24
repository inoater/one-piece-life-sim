import type { GameData } from '../engine/data/schemas';
import type { Entity, WorldState } from '../engine/state';
import { addMod, makeStat, pruneExpired, removeModsBySource, statValue } from '../engine/stats';
import { spawnDueFactions } from './places/setup';

/**
 * Factions, territory and the economy (Phase 3), a world system in step 4.
 *
 * Every faction (and canon crew) is an organization entity whose strength is a Stat (rule 3): the
 * base moves by its yearly trend ("low, rising" for the Revolutionary Army), events and beats add
 * named modifiers, and two modifiers are recomputed every month: what its member crews or kingdoms
 * add (the pirates are the sum of every crew sailing), and the places it holds. Opinions between
 * factions are Stats too. Prosperity lives on the places, and its modifiers expire on schedule.
 */

export const MEMBERS = 'Member crews and kingdoms';
export const TERRITORY = 'Territory held';

export function orgEntities(state: WorldState): Entity[] {
  return Object.keys(state.entities)
    .sort()
    .map((id) => state.entities[id] as Entity)
    .filter((e) => e.org !== undefined);
}

export function strengthOf(entity: Entity, tick: number): number {
  const stat = entity.stats['strength'];
  return stat ? Math.max(0, statValue(stat, tick)) : 0;
}

/** Places held by each faction now. */
export function territory(state: WorldState): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of Object.keys(state.entities).sort()) {
    const controller = state.entities[id]?.place?.controller;
    if (!controller) continue;
    const list = out.get(controller) ?? [];
    list.push(id);
    out.set(controller, list);
  }
  return out;
}

function setMod(entity: Entity, source: string, value: number): void {
  const stat = (entity.stats['strength'] ??= makeStat(0));
  removeModsBySource(stat, source);
  if (Math.abs(value) >= 0.05)
    addMod(stat, { source, value: Math.round(value * 10) / 10, kind: 'flat' });
}

export function factionsMonth(state: WorldState, data: GameData, tick: number): void {
  spawnDueFactions(state, data, tick);
  const orgs = orgEntities(state);

  for (const entity of orgs) {
    const org = entity.org;
    const strength = entity.stats['strength'];
    if (!org || !strength) continue;
    pruneExpired(strength, tick);
    for (const opinion of Object.values(org.opinions)) pruneExpired(opinion, tick);
    if (!org.active) continue;
    const trend = data.factions[entity.id]?.trend ?? 0;
    if (trend !== 0) strength.base = Math.max(0, Math.min(100, strength.base + trend / 12));
  }

  // What members add to their umbrella: a share of each active member's strength.
  const sums = new Map<string, { strength: number; count: number }>();
  for (const entity of orgs) {
    const org = entity.org;
    if (!org?.umbrella || !org.active) continue;
    const s = sums.get(org.umbrella) ?? { strength: 0, count: 0 };
    s.strength += strengthOf(entity, tick);
    s.count += 1;
    sums.set(org.umbrella, s);
  }
  const held = territory(state);
  const per = data.world.factions;
  for (const entity of orgs) {
    const s = sums.get(entity.id);
    const members = s ? s.count * per.crewStrength + s.strength * per.umbrellaShare : 0;
    setMod(entity, MEMBERS, Math.min(per.umbrellaCap, members));
    const places = held.get(entity.id)?.length ?? 0;
    setMod(entity, TERRITORY, entity.org?.active ? places * per.territoryStrength : 0);
  }

  for (const id of Object.keys(state.entities).sort()) {
    const place = state.entities[id]?.place;
    if (place) pruneExpired(place.prosperity, tick);
  }
}

/** Opinion of one faction about another, as it stands. */
export function opinionOf(entity: Entity, toward: string, tick: number): number {
  const stat = entity.org?.opinions[toward];
  return stat ? statValue(stat, tick) : 0;
}
