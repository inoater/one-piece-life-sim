import type { GameData, ItemDef, Location, Weapon } from '../../engine/data/schemas';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { statTotal, type Person } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { priceMult } from '../places/place';
import { shipHere, shipsOf } from '../voyage/plan';
import {
  carried,
  ensureHands,
  giveItem,
  HandsError,
  itemOf,
  itemStory,
  makeItem,
  placeItem,
  weaponDefOf,
} from './items';
import { qualityMult } from './weapons';

/**
 * Markets and the economy (Phase 6). Each place buys and sells trade goods by its prosperity
 * (Phase 3) and by what it makes and wants; prices move with supply, so a hold of spices drives the
 * price down where it is sold and up where it was bought, and months bring both back. Weapons and
 * gear are sold where a place has the right trade (a smithy, a market, the black market), and the
 * one-of-a-kind things lying in a shop (a graded sword) are sold as themselves.
 */

/** How an item kind is named on the page. */
export const ITEM_KIND_NAMES: Record<string, string> = {
  dial: 'Dial',
  seastone: 'Seastone',
  den_den: 'Den Den Mushi',
  vivre: 'Vivre Card',
  navigation: 'Navigation',
  medicine: 'Medicine',
  prosthetic: 'Prosthetic',
  armour: 'Armour',
  clothing: 'Clothing',
  meal: 'Meal',
  blueprint: 'Blueprint',
  map: 'Treasure map',
  material: 'Material',
  tool: 'Tool',
  document: 'Document',
  story: 'Story',
};

const SIZE_FACTOR: Record<string, number> = {
  none: 3,
  hamlet: 2,
  village: 1.5,
  town: 1,
  city: 0.7,
  capital: 0.5,
};

function matches(loc: Location, keys: readonly string[]): boolean {
  return keys.some((k) => k === loc.region || (loc.features as readonly string[]).includes(k));
}

/** The stock a market settles at for a good: plenty where it is made, little where it is wanted. */
export function usualStock(data: GameData, loc: Location, goodId: string): number {
  const good = data.hands.goods.find((g) => g.id === goodId);
  if (!good) return 1;
  const made = matches(loc, good.made);
  const wanted = matches(loc, good.wanted);
  if (made && !wanted) return 1.6;
  if (wanted && !made) return 0.5;
  return 1;
}

/** Whether a good can be bought or sold here at all (contraband only through the black market). */
export function tradesHere(data: GameData, loc: Location | null, goodId: string): boolean {
  if (!loc) return false;
  const good = data.hands.goods.find((g) => g.id === goodId);
  if (!good) return false;
  const features = loc.features as readonly string[];
  if (good.black) return features.includes('underworld');
  return features.includes('market');
}

export function stockOf(
  state: WorldState,
  data: GameData,
  placeId: string,
  goodId: string,
): number {
  const loc = data.locations[placeId];
  if (!loc) return 1;
  return state.entities[placeId]?.place?.market?.[goodId] ?? usualStock(data, loc, goodId);
}

/** A good's middle price here, before the dealer's margin. */
export function goodPrice(
  state: WorldState,
  data: GameData,
  placeId: string,
  goodId: string,
): number {
  const good = data.hands.goods.find((g) => g.id === goodId);
  if (!good) return 0;
  const m = data.hands.market;
  const stock = stockOf(state, data, placeId, goodId);
  const scarcity = Math.max(0.35, Math.min(2.5, 1 + m.elasticity * (1 - stock)));
  return good.base * priceMult(state, data, placeId) * scarcity;
}

/** The dealer's margin each way, narrowed by Charisma. */
export function spreadFor(data: GameData, p: Person, tick: number): number {
  const m = data.hands.market;
  const cha = statTotal(p.entity, 'charisma', tick);
  return Math.max(0.02, m.spread - m.charisma * (cha - 50));
}

/** The person's own ship, wherever she is: aboard, moored here, or elsewhere. */
export function ownShip(state: WorldState, p: Person): Entity | null {
  const voyage = p.c.travel?.voyage;
  if (voyage?.shipId) return state.entities[voyage.shipId] ?? null;
  return shipHere(state, p) ?? shipsOf(state, p.entity.id)[0] ?? null;
}

/** How much a person can carry in trade goods: their ship's hold (less her stores), or a pack. */
export function cargoCapacity(state: WorldState, data: GameData, p: Person): number {
  const ship = p.c.travel?.voyage?.shipId
    ? state.entities[p.c.travel.voyage.shipId]
    : shipHere(state, p);
  const onFoot = data.hands.market.onFoot;
  if (!ship?.ship) return onFoot;
  const cargo = ship.stats['cargo']?.base ?? 0;
  const stores = ship.ship.supplies / Math.max(1, data.travel.provisions.perCargo);
  return Math.max(onFoot, Math.floor(cargo * data.hands.market.cargoPerPoint - stores));
}

export function cargoCount(entity: Entity): number {
  return Object.values(entity.character?.hands?.cargo ?? {}).reduce((s, n) => s + n, 0);
}

function nudgeStock(
  state: WorldState,
  data: GameData,
  placeId: string,
  goodId: string,
  by: number,
) {
  const place = state.entities[placeId]?.place;
  const loc = data.locations[placeId];
  if (!place || !loc) return;
  place.market ??= {};
  const now = place.market[goodId] ?? usualStock(data, loc, goodId);
  place.market[goodId] = Math.max(0.05, Math.min(4, Math.round((now + by) * 10000) / 10000));
}

/**
 * Buy (`qty` > 0) or sell (`qty` < 0) a trade good here. Each unit moves the stock, so a big
 * trade pays a worse price for its last units than its first. Returns the Berries paid (negative
 * when selling).
 */
export function tradeGood(env: LifeEnv, goodId: string, qty: number): number {
  const { state, data, p, tick } = env;
  const here = p.place.location;
  if (!here || p.place.atSea) throw new HandsError('There is no market at sea');
  if (!tradesHere(data, here, goodId)) throw new HandsError('Nobody here deals in that');
  const good = data.hands.goods.find((g) => g.id === goodId);
  if (!good || qty === 0) throw new HandsError('Nothing to trade');
  const hands = ensureHands(p.entity);
  const have = hands.cargo[goodId] ?? 0;
  if (qty < 0 && have < -qty)
    throw new HandsError(`You have only ${have} ${good.name.toLowerCase()}`);
  if (qty > 0 && cargoCount(p.entity) + qty > cargoCapacity(state, data, p))
    throw new HandsError(
      `There is room for ${Math.max(0, cargoCapacity(state, data, p) - cargoCount(p.entity))} more`,
    );
  const spread = spreadFor(data, p, tick);
  const impact = (data.hands.market.impact * (SIZE_FACTOR[here.population] ?? 1)) / 1;
  let total = 0;
  const units = Math.abs(qty);
  for (let i = 0; i < units; i++) {
    const mid = goodPrice(state, data, here.id, goodId);
    total += qty > 0 ? mid * (1 + spread) : mid * (1 - spread);
    nudgeStock(state, data, here.id, goodId, qty > 0 ? -impact : impact);
  }
  const amount = Math.round(total);
  if (qty > 0) {
    if (p.c.berries < amount)
      throw new HandsError(
        `That costs ${formatBerries(amount)} Berries (you have ${formatBerries(p.c.berries)})`,
      );
    pay(env, -amount);
    hands.cargo[goodId] = have + units;
    hands.paid[goodId] = (hands.paid[goodId] ?? 0) + amount;
  } else {
    pay(env, amount);
    const share = units / have;
    const cost = (hands.paid[goodId] ?? 0) * share;
    hands.paid[goodId] = Math.max(0, (hands.paid[goodId] ?? 0) - cost);
    hands.cargo[goodId] = have - units;
    if (hands.cargo[goodId] === 0) {
      delete hands.cargo[goodId];
      delete hands.paid[goodId];
    }
    hands.tally['profit'] = (hands.tally['profit'] ?? 0) + Math.round(amount - cost);
  }
  hands.tally['trades'] = (hands.tally['trades'] ?? 0) + 1;
  p.entity.flags['hands.cargo'] = cargoCount(p.entity) > 0;
  const text = renderLife(env, data.hands.lines['traded'] ?? '', {
    good: `${units} ${good.name.toLowerCase()} ${qty > 0 ? 'bought' : 'sold'}`,
    amount: formatBerries(amount),
  });
  lifeLog(env, text, { tags: ['personal', 'money', 'trade'] });
  reportLine(env, text, qty > 0 ? 'plain' : 'good');
  return qty > 0 ? amount : -amount;
}

/** A share of the hold lost (pirates, a storm, spoilage). */
export function loseCargo(env: LifeEnv, share: number): void {
  const hands = env.p.c.hands;
  if (!hands) return;
  for (const [id, n] of Object.entries(hands.cargo)) {
    const lost = Math.ceil(n * share);
    hands.cargo[id] = n - lost;
    hands.paid[id] = (hands.paid[id] ?? 0) * (1 - lost / Math.max(1, n));
    if (hands.cargo[id] <= 0) {
      delete hands.cargo[id];
      delete hands.paid[id];
    }
  }
  env.p.entity.flags['hands.cargo'] = cargoCount(env.p.entity) > 0;
}

/** Each month, markets that trading has moved drift back toward their usual stock. */
export function marketsMonth(state: WorldState, data: GameData): void {
  const drift = data.hands.market.drift;
  for (const loc of Object.values(data.locations)) {
    const market = state.entities[loc.id]?.place?.market;
    if (!market) continue;
    for (const [good, stock] of Object.entries(market)) {
      const usual = usualStock(data, loc, good);
      const next = stock + (usual - stock) * drift;
      if (Math.abs(next - usual) < 0.01) delete market[good];
      else market[good] = Math.round(next * 10000) / 10000;
    }
  }
}

// ---- Weapons and gear for sale ------------------------------------------------------------------

export interface StockLine {
  /** A data id (a new one made to order) or an item entity id (that very thing). */
  key: string;
  name: string;
  description: string;
  kind: string;
  price: number;
  /** Through the black market. */
  black: boolean;
  /** One of a kind: an item entity in this shop. */
  unique: boolean;
  grade: string | null;
}

function soldHere(
  loc: Location,
  def: { soldAt: readonly string[]; regions: readonly string[]; places?: readonly string[] },
): { ok: boolean; black: boolean } {
  const features = loc.features as readonly string[];
  if (def.regions.length > 0 && !def.regions.includes(loc.region))
    return { ok: false, black: false };
  if (def.places && def.places.length > 0) {
    if (!def.places.includes(loc.id)) return { ok: false, black: false };
    if (def.soldAt.length === 0) return { ok: true, black: false };
  }
  const open = def.soldAt.filter((f) => f !== 'underworld').some((f) => features.includes(f));
  if (open) return { ok: true, black: false };
  if (def.soldAt.includes('underworld') && features.includes('underworld'))
    return { ok: true, black: true };
  return { ok: false, black: false };
}

/** What a weapon or an item from data costs here. */
export function listPrice(
  state: WorldState,
  data: GameData,
  def: Weapon | ItemDef,
  placeId: string,
  black: boolean,
): number {
  const base = def.price ?? 0;
  return Math.round(
    base * priceMult(state, data, placeId) * (black ? data.hands.market.blackMarkup : 1),
  );
}

/** Everything for sale where the person stands. */
export function stockHere(state: WorldState, data: GameData, p: Person): StockLine[] {
  const loc = p.place.location;
  if (!loc || p.place.atSea) return [];
  const out: StockLine[] = [];
  for (const w of Object.values(data.weapons).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (w.template || w.canon || w.price === undefined || w.tags.includes('dev')) continue;
    const sold = soldHere(loc, w);
    if (!sold.ok) continue;
    out.push({
      key: w.id,
      name: w.name,
      description: w.description ?? '',
      kind: data.hands.families[w.family]?.name ?? w.family,
      price: listPrice(state, data, w, loc.id, sold.black),
      black: sold.black,
      unique: false,
      grade: null,
    });
  }
  for (const d of Object.values(data.items).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (d.price === null || d.storyLocked) continue;
    const sold = soldHere(loc, d);
    if (!sold.ok) continue;
    out.push({
      key: d.id,
      name: d.name,
      description: d.description,
      kind: ITEM_KIND_NAMES[d.kind] ?? d.kind,
      price: listPrice(state, data, d, loc.id, sold.black),
      black: sold.black,
      unique: false,
      grade: null,
    });
  }
  // One-of-a-kind things lying in the shops here.
  for (const e of Object.values(state.entities)) {
    const b = e.item;
    if (!b || b.container !== 'market' || b.place !== loc.id || b.price === null) continue;
    const w = weaponDefOf(data, e);
    out.push({
      key: e.id,
      name: e.name,
      description: w?.description ?? data.items[b.defId]?.description ?? '',
      kind: w
        ? (data.hands.families[w.family]?.name ?? w.family)
        : (ITEM_KIND_NAMES[data.items[b.defId]?.kind ?? ''] ?? 'Item'),
      price: b.price,
      black:
        (loc.features as readonly string[]).includes('underworld') &&
        (b.grade === 'great' || b.grade === 'supreme'),
      unique: true,
      grade:
        b.grade && b.grade !== 'ungraded' ? (data.hands.grades[b.grade]?.name ?? b.grade) : null,
    });
  }
  return out;
}

/** Buy something for sale here: made new, or that very thing off the shelf. */
export function buyItem(env: LifeEnv, key: string): Entity {
  const { state, data, p, tick } = env;
  const line = stockHere(state, data, p).find((l) => l.key === key);
  if (!line) throw new HandsError('That is not for sale here');
  if (p.c.berries < line.price)
    throw new HandsError(
      `It costs ${formatBerries(line.price)} Berries (you have ${formatBerries(p.c.berries)})`,
    );
  pay(env, -line.price);
  const where = p.place.name;
  let item: Entity;
  if (line.unique) {
    const found = itemOf(state, key);
    if (!found) throw new HandsError('That is not for sale here');
    item = found;
    giveItem(state, data, item, p.entity, tick, `Bought by ${p.entity.name} at ${where}.`);
  } else {
    item = makeItem(state, data, {
      defId: key,
      container: 'held',
      holder: p.entity,
      tick,
      story: `Bought new by ${p.entity.name} at ${where}.`,
    });
  }
  const text = renderLife(env, data.hands.lines['bought'] ?? '', {
    item: item.name,
    amount: formatBerries(line.price),
  });
  lifeLog(env, text, { tags: ['personal', 'money', 'gear'] });
  reportLine(env, text, 'plain');
  return item;
}

/** What a dealer here would pay for something you carry (null: nobody here buys it). */
export function sellPrice(
  state: WorldState,
  data: GameData,
  p: Person,
  item: Entity,
): number | null {
  const loc = p.place.location;
  const b = item.item;
  if (!loc || p.place.atSea || !b) return null;
  const features = loc.features as readonly string[];
  if (
    !features.includes('market') &&
    !features.includes('smithy') &&
    !features.includes('underworld')
  )
    return null;
  const w = weaponDefOf(data, item);
  const d = data.items[b.defId];
  if (d?.storyLocked) return null;
  let value: number;
  if (w && b.grade && b.grade !== 'ungraded') {
    const g = data.hands.grades[b.grade];
    value = g ? (g.price.min + g.price.max) / 2 : 0;
  } else
    value =
      w?.price ?? d?.price ?? (b.defId === 'item_treasure_map' ? data.hands.treasure.mapPrice : 0);
  if (value <= 0) return null;
  const wear =
    b.durability !== undefined && b.maxDurability
      ? 0.5 + (0.5 * b.durability) / b.maxDurability
      : 1;
  return Math.round(
    value *
      data.hands.market.sellRatio *
      qualityMult(data, b.quality) *
      wear *
      priceMult(state, data, loc.id),
  );
}

/**
 * Sell something you carry. A graded or canon blade goes onto this shop's shelf at a dealer's
 * price (it stays in the world); an ordinary thing is simply gone.
 */
export function sellItem(env: LifeEnv, itemId: string): number {
  const { state, data, p, tick } = env;
  const item = itemOf(state, itemId);
  if (!item || item.item?.holderId !== p.entity.id) throw new HandsError('You do not carry that');
  const price = sellPrice(state, data, p, item);
  if (price === null) throw new HandsError('Nobody here would buy that');
  const here = p.place.location?.id ?? null;
  const w = weaponDefOf(data, item);
  const unique = (item.item?.grade && item.item.grade !== 'ungraded') || w?.canon !== undefined;
  pay(env, price);
  if (unique) {
    placeItem(
      state,
      data,
      item,
      { place: here, container: 'market', price: Math.round(price * 2.2) },
      tick,
      `Sold by ${p.entity.name} to a dealer at ${p.place.name}.`,
    );
  } else {
    placeItem(state, data, item, { place: null, container: 'destroyed' }, tick);
    delete state.entities[item.id];
  }
  const text = renderLife(env, data.hands.lines['sold'] ?? '', {
    item: item.name,
    amount: formatBerries(price),
  });
  lifeLog(env, text, { tags: ['personal', 'money', 'gear'] });
  reportLine(env, text, 'good');
  return price;
}

/** Use a carried thing up (a meal, a dose): the entity is gone (ordinary things only). */
export function useUp(state: WorldState, data: GameData, item: Entity, tick: number): void {
  const charges = item.item?.charges;
  if (charges !== undefined && charges > 1) {
    if (item.item) item.item.charges = charges - 1;
    return;
  }
  placeItem(state, data, item, { place: null, container: 'destroyed' }, tick);
  delete state.entities[item.id];
}

export { carried, itemStory };
