import type { ItemDef, GameData, Weapon } from '../../engine/data/schemas';
import type { ItemContainer, SwordGrade } from '../../engine/data/defs';
import { createEntity } from '../../engine/entities';
import { addMod } from '../../engine/stats';
import {
  PUBLIC_KNOWLEDGE,
  type Entity,
  type HandsData,
  type ItemState,
  type Origin,
  type WorldState,
} from '../../engine/state';
import { ensurePowers } from '../powers/state';
import { refreshPowerMods } from '../powers/tracks';

/**
 * Items as entities (Phase 6, rule 2): every weapon, piece of gear, treasure cache and map that
 * matters is an entity with an `item` block, carried by someone (their `hands.items`) or lying
 * somewhere. A graded sword is one entity for as long as it exists, so the world can never hold
 * more of a grade than canon allows; its wielders and its story are written on it (rule 6).
 */

export class HandsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandsError';
  }
}

export function freshHands(): HandsData {
  return {
    items: [],
    wield: [],
    armour: null,
    skills: {},
    crafts: {},
    project: null,
    build: null,
    cargo: {},
    paid: {},
    designs: [],
    contacts: [],
    last: {},
    tally: {},
  };
}

export function ensureHands(entity: Entity): HandsData {
  const c = entity.character;
  if (!c) throw new HandsError(`${entity.name} cannot carry anything`);
  if (!c.hands) c.hands = freshHands();
  return c.hands;
}

/** The item entity behind an id, if it is one. */
export function itemOf(state: WorldState, id: string | null | undefined): Entity | undefined {
  if (!id) return undefined;
  const e = state.entities[id];
  return e?.item ? e : undefined;
}

export function weaponDefOf(data: GameData, item: Entity | undefined): Weapon | undefined {
  const id = item?.item?.defId;
  return id ? data.weapons[id] : undefined;
}

export function itemDefOf(data: GameData, item: Entity | undefined): ItemDef | undefined {
  const id = item?.item?.defId;
  return id ? data.items[id] : undefined;
}

/** What a person carries, in the order they came by it (items that no longer exist dropped). */
export function carried(state: WorldState, entity: Entity): Entity[] {
  const out: Entity[] = [];
  for (const id of entity.character?.hands?.items ?? []) {
    const item = itemOf(state, id);
    if (item && item.item?.holderId === entity.id) out.push(item);
  }
  return out;
}

export function isWeapon(data: GameData, item: Entity | undefined): boolean {
  return weaponDefOf(data, item) !== undefined;
}

export interface NewItem {
  /** A weapon id or an item id from data ("cache" for a treasure cache). */
  defId: string;
  name?: string;
  origin?: Origin;
  container: ItemContainer;
  holder?: Entity | null;
  holderName?: string | null;
  place?: string | null;
  price?: number | null;
  quality?: number;
  grade?: SwordGrade;
  tick: number;
  /** The first line of its story ("Forged at Loguetown", "Found in a wreck"). */
  story: string;
  extra?: Partial<ItemState>;
}

/** Make a new item entity. Weapons get their family, grade, edge and durability from data. */
export function makeItem(state: WorldState, data: GameData, init: NewItem): Entity {
  const weapon = data.weapons[init.defId];
  const def = data.items[init.defId];
  const name = init.name ?? weapon?.name ?? def?.name ?? 'something';
  const entity = createEntity(state, {
    type: 'item',
    origin: init.origin ?? 'generated',
    name,
    tier: 1,
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  const quality = Math.max(0, Math.min(100, init.quality ?? weapon?.quality ?? 50));
  const block: ItemState = {
    defId: init.defId,
    container: init.container,
    holderId: init.holder?.id ?? null,
    holderName: init.holderName ?? null,
    place: init.place ?? null,
    price: init.price ?? null,
    quality,
    history: [{ tick: init.tick, text: init.story }],
  };
  if (weapon) {
    const family = data.hands.families[weapon.family];
    block.family = weapon.family;
    block.grade = init.grade ?? weapon.grade;
    if (weapon.family === 'blade' || weapon.family === 'polearm') block.sharpness = 100;
    block.maxDurability = family?.durability ?? 50;
    block.durability = block.maxDurability;
    if (weapon.black) block.black = true;
    if (weapon.seastone) block.seastone = true;
    if (weapon.curse) block.curse = { id: weapon.curse, tamed: false, checks: 0 };
    block.wielders = [];
  }
  if (def?.charges !== undefined) block.charges = def.charges;
  Object.assign(block, init.extra ?? {});
  entity.item = block;
  if (init.holder) attach(state, data, entity, init.holder, init.tick);
  return entity;
}

/** Add a line to an item's story (rule 6). */
export function itemStory(item: Entity, tick: number, text: string): void {
  if (!item.item) return;
  item.item.history.push({ tick, text });
  if (item.item.history.length > 40) item.item.history.splice(1, item.item.history.length - 40);
}

function closeWielding(item: Entity, holderId: string | null, tick: number): void {
  const w = item.item?.wielders;
  const last = w?.[w.length - 1];
  if (last && last.to === null && (holderId === null || last.id === holderId)) last.to = tick;
}

function detach(state: WorldState, data: GameData, item: Entity, tick: number): void {
  const b = item.item;
  if (!b) return;
  const holder = b.holderId ? state.entities[b.holderId] : undefined;
  const hands = holder?.character?.hands;
  if (hands) {
    hands.items = hands.items.filter((id) => id !== item.id);
    hands.wield = hands.wield.filter((id) => id !== item.id);
    if (hands.armour === item.id) hands.armour = null;
  }
  closeWielding(item, b.holderId, tick);
  b.holderId = null;
  b.holderName = null;
  if (holder) syncGear(state, data, holder);
}

function attach(
  state: WorldState,
  data: GameData,
  item: Entity,
  holder: Entity,
  tick: number,
): void {
  const b = item.item;
  if (!b) return;
  const hands = ensureHands(holder);
  if (!hands.items.includes(item.id)) hands.items.push(item.id);
  b.holderId = holder.id;
  b.holderName = null;
  b.container = 'held';
  b.place = null;
  b.price = null;
  if (b.family) {
    b.wielders ??= [];
    b.wielders.push({ id: holder.id, name: holder.name, from: tick, to: null });
    if (b.wielders.length > 30) b.wielders.splice(0, b.wielders.length - 30);
  }
  // A weapon in a free hand is taken up at once; a worn thing is put on.
  const def = data.items[b.defId];
  if (b.family && canWieldMore(state, holder, item)) hands.wield.push(item.id);
  if (def?.kind === 'armour' && hands.armour === null) hands.armour = item.id;
  syncGear(state, data, holder);
}

/** Up to three blades (the three-sword style), or one weapon of any other kind. */
export function canWieldMore(state: WorldState, holder: Entity, item: Entity): boolean {
  const hands = holder.character?.hands;
  if (!hands || hands.wield.includes(item.id)) return false;
  const wielded = hands.wield.map((id) => itemOf(state, id)).filter((x): x is Entity => !!x);
  if (wielded.length === 0) return true;
  const blade = item.item?.family === 'blade';
  return blade && wielded.length < 3 && wielded.every((w) => w.item?.family === 'blade');
}

/** The item passes into someone's hands (bought, found, given, taken from the fallen). */
export function giveItem(
  state: WorldState,
  data: GameData,
  item: Entity,
  holder: Entity,
  tick: number,
  story?: string,
): void {
  detach(state, data, item, tick);
  attach(state, data, item, holder, tick);
  if (story) itemStory(item, tick, story);
}

/** The item is put down somewhere: lying, for sale, buried, in a collection. */
export function placeItem(
  state: WorldState,
  data: GameData,
  item: Entity,
  where: {
    place: string | null;
    container: ItemContainer;
    price?: number | null;
    holderName?: string | null;
  },
  tick: number,
  story?: string,
): void {
  detach(state, data, item, tick);
  const b = item.item;
  if (!b) return;
  b.container = where.container;
  b.place = where.place;
  b.price = where.price ?? null;
  b.holderName = where.holderName ?? null;
  if (story) itemStory(item, tick, story);
}

/** Gone for good: broken, melted, eaten by the sea. Its entity stays, for the story (rule 6). */
export function destroyItem(
  state: WorldState,
  data: GameData,
  item: Entity,
  tick: number,
  story: string,
): void {
  placeItem(state, data, item, { place: null, container: 'destroyed' }, tick, story);
}

/** Whether a thing still exists in the world (a destroyed sword counts no more). */
export function exists(item: Entity): boolean {
  return item.item !== undefined && item.item.container !== 'destroyed';
}

// ---- What carrying things does ---------------------------------------------------------------

const GEAR_SOURCE = ' (gear)';

/**
 * Bring the person's derived gear up to date with what they carry: the counts fighting styles ask
 * for (swords, a gun, a bow), the modifiers worn things give (armour's weight, clothes' looks, a
 * prosthetic's restored strength), each with its source for the tooltip (rule 3).
 */
export function syncGear(state: WorldState, data: GameData, entity: Entity): void {
  const c = entity.character;
  if (!c?.hands) return;
  const items = carried(state, entity);
  const powers = ensurePowers(c);
  const counts: Record<string, number> = {};
  for (const item of items) {
    const w = weaponDefOf(data, item);
    const kind = w?.gear ?? (w ? data.hands.families[w.family]?.gear : undefined);
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
  }
  for (const key of Object.keys(powers.gear)) {
    if (key === 'swords' || key === 'gun' || key === 'bow' || key.startsWith('weapon_'))
      delete powers.gear[key];
  }
  for (const [kind, n] of Object.entries(counts)) powers.gear[kind] = n;
  // Modifiers from things worn or carried: cleared and laid down again.
  for (const stat of Object.values(entity.stats))
    stat.mods = stat.mods.filter((m) => !m.source.endsWith(GEAR_SOURCE));
  const worn = new Set<string>();
  for (const item of items) {
    const def = itemDefOf(data, item);
    if (!def || worn.has(def.id)) continue;
    if (def.kind === 'armour' && c.hands.armour !== item.id) continue;
    worn.add(def.id);
    for (const mod of def.statMods) {
      const stat = entity.stats[mod.stat];
      if (stat)
        addMod(stat, { source: `${item.name}${GEAR_SOURCE}`, value: mod.value, kind: mod.kind });
    }
    if (def.restores) restoreLimb(data, entity, def.restores, item.name);
  }
  // The weapon term of Combat Power follows what is in hand.
  refreshPowerMods(data, entity, state.tick, state);
}

/** A prosthetic gives back most of what a lost part took (its loss trait's penalties). */
function restoreLimb(data: GameData, entity: Entity, area: string, name: string): void {
  const rule = data.life.injuries.areas.find((a) => a.id === area);
  const trait = rule?.lossTrait ? data.traits[rule.lossTrait] : undefined;
  if (!trait || !entity.character?.traits.includes(trait.id)) return;
  for (const mod of trait.statMods) {
    if (mod.value >= 0) continue;
    const stat = entity.stats[mod.stat];
    if (stat)
      addMod(stat, {
        source: `${name}${GEAR_SOURCE}`,
        value: Math.round(-mod.value * 0.75 * 10) / 10,
        kind: mod.kind,
      });
  }
}
