import { formatGeneratedId, isEntityId } from './ids';
import type { Entity, EntityType, FlagValue, Origin, Stat, WorldState } from './state';
import { PUBLIC_KNOWLEDGE } from './state';

/**
 * Entity helpers. Entities live in a plain object keyed by id, so the state stays JSON.
 *
 * Never rely on object key order for game logic: use `entityIds`, which is sorted, so iteration
 * order cannot depend on how a save was written or in which order things were created.
 */

export function mintGeneratedId(state: WorldState): string {
  state.counters.genId += 1;
  return formatGeneratedId(state.counters.genId);
}

const sortedIds = new WeakMap<object, { keys: string[]; sorted: string[] }>();

/**
 * All entity ids in a stable (sorted) order. The sort is reused while the set of keys is exactly
 * the same, in the same insertion order (checked every call, so it can never be stale): a full
 * world has thousands of entities and many systems walk them every month. Do not mutate it.
 */
export function entityIds(state: WorldState): readonly string[] {
  const keys = Object.keys(state.entities);
  const cached = sortedIds.get(state.entities);
  if (cached && cached.keys.length === keys.length && cached.keys.every((k, i) => k === keys[i])) {
    return cached.sorted;
  }
  const sorted = [...keys].sort();
  sortedIds.set(state.entities, { keys, sorted });
  return sorted;
}

export function getEntity(state: WorldState, id: string): Entity | undefined {
  return state.entities[id];
}

export function requireEntity(state: WorldState, id: string): Entity {
  const entity = state.entities[id];
  if (!entity) throw new Error(`No entity with id "${id}"`);
  return entity;
}

/** Add an entity with an explicit id (canon slugs). Throws on a bad or duplicate id. */
export function addEntity(state: WorldState, entity: Entity): Entity {
  if (!isEntityId(entity.id)) throw new Error(`"${entity.id}" is not a valid entity id`);
  if (entity.id in state.entities) throw new Error(`Entity "${entity.id}" already exists`);
  state.entities[entity.id] = entity;
  return entity;
}

export interface NewEntityInit {
  type: EntityType;
  origin: Origin;
  name: string;
  tier?: 1 | 2;
  flags?: Record<string, FlagValue>;
  stats?: Record<string, Stat>;
  knownBy?: string[];
}

/** Create a runtime entity with a fresh `gen_` id, created at the current tick. */
export function createEntity(state: WorldState, init: NewEntityInit): Entity {
  const entity: Entity = {
    id: mintGeneratedId(state),
    type: init.type,
    origin: init.origin,
    name: init.name,
    createdTick: state.tick,
    tier: init.tier ?? (init.origin === 'generated' ? 2 : 1),
    flags: init.flags ?? {},
    stats: init.stats ?? {},
    knownBy: init.knownBy ?? [PUBLIC_KNOWLEDGE],
  };
  state.entities[entity.id] = entity;
  return entity;
}

/**
 * Entities whose tier is due to act this tick (rule 5), in id order.
 * Tier 1 follows `tier1Due` (monthly by default), tier 2 follows `tier2Due` (quarterly).
 */
export function dueEntities(
  state: WorldState,
  tiers: { tier1Due: boolean; tier2Due: boolean },
  filter: (entity: Entity) => boolean = () => true,
): Entity[] {
  const out: Entity[] = [];
  for (const id of entityIds(state)) {
    const entity = state.entities[id] as Entity;
    const due = entity.tier === 1 ? tiers.tier1Due : tiers.tier2Due;
    if (due && filter(entity)) out.push(entity);
  }
  return out;
}
