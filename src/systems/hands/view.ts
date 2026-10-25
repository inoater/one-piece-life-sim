import type { GameData } from '../../engine/data/schemas';
import { CRAFTS, ShipDesignSchema, type ShipDesign } from '../../engine/data/defs';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { playerPerson, type Person } from '../life/body';
import { priceMult } from '../places/place';
import { shipHere } from '../voyage/plan';
import {
  craftSkill,
  gradeCount,
  materialCost,
  recipeLock,
  schoolFor,
  temperLock,
} from './crafting';
import { callable, hasSnail, readVivre, vivreLock, type VivreReading } from './gear';
import { betsThisMonth, denHere, gambleLock } from './gambling';
import { carried, itemDefOf, weaponDefOf } from './items';
import {
  cargoCapacity,
  cargoCount,
  goodPrice,
  ITEM_KIND_NAMES,
  ownShip,
  sellPrice,
  spreadFor,
  stockHere,
  tradesHere,
  type StockLine,
} from './market';
import {
  buildLock,
  buildMonths,
  buildPrice,
  designStats,
  hullsAllowed,
  refitPrice,
  stockDesign,
  yardOf,
  type ShipStats,
} from './ships';
import { armourOf, itemAttack, weaponOfEntity } from './weapons';

/**
 * What the Gear and Ship pages show (Phase 6): what the player carries and what each thing is, the
 * market here (gear, trade goods), the workshop (recipes, the project), treasure maps, the snail
 * and the cards, the tables, and their ship with the ship creator's parts. Built from the same
 * functions the commands check, so the page never offers what the world will refuse.
 */

export interface ItemView {
  id: string;
  name: string;
  /** "Blades", "dial", "map". */
  kind: string;
  description: string;
  weapon: boolean;
  grade: string | null;
  quality: number;
  sharpness: number | null;
  durability: { now: number; max: number } | null;
  black: boolean;
  /** Months toward turning black, as a share (0 to 1), when it has begun. */
  blackening: number | null;
  curse: null | {
    name: string;
    description: string;
    tamed: boolean;
    how: string;
    act: 'fate' | 'cleanse' | null;
  };
  wielded: boolean;
  worn: boolean;
  wearable: boolean;
  attack: number | null;
  charges: number | null;
  usable: boolean;
  sell: number | null;
  sharpen: number | null;
  mend: number | null;
  temper: string | null;
  vivre: VivreReading | null;
  /** A map: where it points (true, partial and fake look alike to whoever holds them). */
  map: string | null;
  history: { date: number; text: string }[];
}

export interface DesignPreview {
  design: ShipDesign;
  stats: ShipStats;
  yard: { name: string; size: number; skill: number } | null;
  price: { yard: number; self: number };
  months: { yard: number; self: number };
  lock: { yard: string | null; self: string | null };
  /** When refitting the ship moored here: the price, and why it cannot be done. */
  refit: null | { price: number; lock: string | null };
}

export interface HandsView {
  berries: number;
  place: {
    name: string;
    atSea: boolean;
    smithy: boolean;
    market: boolean;
    black: boolean;
    yard: { name: string; size: number; skill: number } | null;
  };
  carried: ItemView[];
  weapon: null | {
    name: string;
    attack: number;
    combat: number;
    accuracy: number;
    seastone: boolean;
  };
  armour: number;
  skills: { id: string; name: string; value: number }[];
  crafts: { id: string; value: number; school: number }[];
  stock: (StockLine & { lock: string | null })[];
  goods: {
    capacity: number;
    used: number;
    spread: number;
    list: {
      id: string;
      name: string;
      buy: number | null;
      sell: number | null;
      have: number;
      /** What the held units cost on average. */
      paid: number | null;
      black: boolean;
    }[];
  };
  recipes: {
    id: string;
    name: string;
    description: string;
    craft: string;
    makes: string;
    months: number;
    skill: number;
    cost: number | null;
    lock: string | null;
  }[];
  project: null | {
    name: string;
    done: number;
    needed: number;
    place: string;
    here: boolean;
    quality: number;
  };
  build: null | { name: string; done: number; needed: number; by: 'yard' | 'self'; place: string };
  ship: null | {
    id: string;
    name: string;
    here: boolean;
    design: ShipDesign;
    stats: ShipStats;
    hull: number;
    maxHull: number;
    care: number;
    inYard: boolean;
    history: { tick: number; text: string }[];
  };
  creator: {
    hulls: {
      id: string;
      name: string;
      description: string;
      size: number;
      cost: number;
      length: { min: number; max: number };
    }[];
    materials: { id: string; name: string; description: string }[];
    rigs: { id: string; name: string; description: string }[];
    drives: { id: string; name: string; description: string; cost: number }[];
    rooms: { id: string; name: string; description: string; cost: number }[];
    weapons: { id: string; name: string; description: string; cost: number; perDeck: number }[];
    figureheads: { id: string; name: string; description: string; cost: number }[];
    colours: string[];
    designs: ShipDesign[];
    blueprints: ShipDesign[];
    shipbuilding: number;
  };
  treasure: { found: number };
  gambling: null | {
    games: { id: string; name: string; description: string; payout: number }[];
    betsLeft: number;
    maxStake: number;
    lock: string | null;
  };
  calls: null | {
    hasSnail: boolean;
    people: { id: string; name: string; called: boolean; vivre: string | null }[];
  };
  tally: Record<string, number>;
}

const CRAFT_NAMES: Record<string, string> = {
  smithing: 'Smithing',
  gunsmithing: 'Gunsmithing',
  shipbuilding: 'Shipbuilding',
  medicine: 'Medicine',
  cooking: 'Cooking',
  invention: 'Invention',
};
export { CRAFT_NAMES };

function itemView(state: WorldState, data: GameData, p: Person, item: Entity): ItemView {
  const b = item.item;
  const w = weaponDefOf(data, item);
  const d = itemDefOf(data, item);
  const hands = p.c.hands;
  const smithy = !p.place.atSea && (p.place.features as readonly string[]).includes('smithy');
  const pm = priceMult(state, data, p.place.location?.id ?? '');
  const curseRule = b?.curse ? data.hands.curses[b.curse.id] : undefined;
  const reading = b?.defId === 'item_vivre_card' ? readVivre(state, data, item) : null;
  const mapTo =
    b?.defId === 'item_treasure_map' && b.contents
      ? (data.locations[b.contents]?.name ?? 'an island')
      : null;
  const grade =
    b?.grade && b.grade !== 'ungraded' ? (data.hands.grades[b.grade]?.name ?? b.grade) : null;
  return {
    id: item.id,
    name: item.name,
    kind: w
      ? (data.hands.families[w.family]?.name ?? w.family)
      : (ITEM_KIND_NAMES[d?.kind ?? ''] ?? 'Item'),
    description: w?.description ?? d?.description ?? '',
    weapon: w !== undefined,
    grade,
    quality: Math.round(b?.quality ?? 50),
    sharpness: b?.sharpness !== undefined ? Math.round(b.sharpness) : null,
    durability:
      b?.durability !== undefined && b.maxDurability !== undefined
        ? { now: Math.round(b.durability), max: b.maxDurability }
        : null,
    black: b?.black === true,
    blackening:
      b?.blackness && !b.black ? Math.min(1, b.blackness / data.hands.black.months) : null,
    curse:
      b?.curse && curseRule
        ? {
            name: curseRule.name,
            description: curseRule.description,
            tamed: b.curse.tamed,
            how: curseRule.tame.text,
            act: b.curse.tamed
              ? null
              : curseRule.tame.kind === 'fate'
                ? 'fate'
                : curseRule.tame.kind === 'ritual'
                  ? 'cleanse'
                  : null,
          }
        : null,
    wielded: hands?.wield.includes(item.id) ?? false,
    worn: hands?.armour === item.id,
    wearable: d?.kind === 'armour',
    attack: w ? Math.round(itemAttack(data, item) * 10) / 10 : null,
    charges: b?.charges ?? null,
    usable: d?.effect !== undefined,
    sell: sellPrice(state, data, p, item),
    sharpen:
      smithy && b?.sharpness !== undefined && b.sharpness < 100 && !b.black
        ? Math.round(data.hands.edge.sharpenCost * pm)
        : null,
    mend:
      smithy &&
      b?.durability !== undefined &&
      b.maxDurability !== undefined &&
      b.durability < b.maxDurability
        ? Math.round((b.maxDurability - b.durability) * data.hands.edge.repairPerPoint * pm)
        : null,
    temper: w?.family === 'blade' ? temperLock({ state, data, p, tick: state.tick }, item) : null,
    vivre: reading,
    map: mapTo,
    history: (b?.history ?? []).slice(-6).map((h) => ({ date: h.tick, text: h.text })),
  };
}

function part<T extends { id: string; name: string; description: string }>(x: T) {
  return { id: x.id, name: x.name, description: x.description };
}

export function handsView(state: WorldState, data: GameData): HandsView | null {
  const p = playerPerson(state, data);
  if (!p?.c.alive || !p.c.life) return null;
  const tick = state.tick;
  const env = { state, data, p, tick };
  const features = p.place.features as readonly string[];
  const loc = p.place.location;
  const hands = p.c.hands;
  const items = carried(state, p.entity);
  const weapon = weaponOfEntity(state, data, p.entity);
  const stock = stockHere(state, data, p).map((l) => ({
    ...l,
    lock: p.c.berries < l.price ? `Costs ${formatBerries(l.price)} Berries` : null,
  }));
  const spread = spreadFor(data, p, tick);
  const goods = data.hands.goods.map((g) => {
    const here = loc && !p.place.atSea && tradesHere(data, loc, g.id);
    const mid = here && loc ? goodPrice(state, data, loc.id, g.id) : 0;
    const have = hands?.cargo[g.id] ?? 0;
    return {
      id: g.id,
      name: g.name,
      buy: here ? Math.round(mid * (1 + spread)) : null,
      sell: here ? Math.round(mid * (1 - spread)) : null,
      have,
      paid: have > 0 ? Math.round((hands?.paid[g.id] ?? 0) / have) : null,
      black: g.black,
    };
  });
  const recipes = Object.values(data.recipes)
    .filter((r) => !r.storyLocked)
    .sort((a, b) => a.craft.localeCompare(b.craft) || a.skill - b.skill || (a.id < b.id ? -1 : 1))
    .map((r) => {
      const id = r.makes.weapon ?? r.makes.item ?? '';
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        craft: r.craft,
        makes: data.weapons[id]?.name ?? data.items[id]?.name ?? id,
        months: r.months,
        skill: r.skill,
        cost: materialCost(env, r),
        lock: hands?.project ? 'You are already working on something' : recipeLock(env, r),
      };
    });
  const project = hands?.project;
  const projectName = project
    ? project.recipe.startsWith('temper:')
      ? `Tempering ${state.entities[project.recipe.slice(7)]?.name ?? 'a blade'}`
      : (data.recipes[project.recipe]?.name ?? project.recipe)
    : '';
  const shipEntity = ownShip(state, p);
  const s = shipEntity?.ship;
  const design = shipEntity ? stockDesign(data, shipEntity) : null;
  const plans = items
    .map((i) => itemDefOf(data, i)?.design ?? i.item?.design)
    .filter((x): x is ShipDesign => !!x);
  const allowed = new Set(hullsAllowed(state, data, p).map((h) => h.id));
  const den = denHere(env);
  const g = data.hands.gambling;
  return {
    berries: p.c.berries,
    place: {
      name: p.place.name,
      atSea: p.place.atSea,
      smithy: !p.place.atSea && features.includes('smithy'),
      market: !p.place.atSea && features.includes('market'),
      black: !p.place.atSea && features.includes('underworld'),
      yard: yardOf(data, loc?.id),
    },
    carried: items.map((i) => itemView(state, data, p, i)),
    weapon: weapon
      ? {
          name: weapon.name,
          attack: weapon.attack,
          combat: weapon.combat,
          accuracy: weapon.accuracy,
          seastone: weapon.seastone,
        }
      : null,
    armour: armourOf(state, data, p.entity),
    skills: Object.entries(data.hands.families).map(([id, f]) => ({
      id,
      name: f.name,
      value: Math.round((hands?.skills[id] ?? 0) * 10) / 10,
    })),
    crafts: CRAFTS.map((c) => ({
      id: c,
      value: Math.round(craftSkill(p.entity, c) * 10) / 10,
      school: schoolFor(data, loc?.id, c),
    })),
    stock,
    goods: {
      capacity: cargoCapacity(state, data, p),
      used: cargoCount(p.entity),
      spread: Math.round(spread * 1000) / 10,
      list: goods,
    },
    recipes,
    project: project
      ? {
          name: projectName,
          done: project.done,
          needed: project.needed,
          place:
            project.place === 'sea'
              ? 'at sea'
              : (data.locations[project.place]?.name ?? project.place),
          here: project.place === (p.place.atSea ? 'sea' : loc?.id),
          quality: Math.round(project.quality),
        }
      : null,
    build: hands?.build
      ? {
          name: hands.build.design.name ?? 'your ship',
          done: hands.build.done,
          needed: hands.build.needed,
          by: hands.build.by,
          place: data.locations[hands.build.place]?.name ?? hands.build.place,
        }
      : null,
    ship:
      shipEntity && s && design
        ? {
            id: shipEntity.id,
            name: shipEntity.name,
            here: shipHere(state, p)?.id === shipEntity.id,
            design,
            stats: designStats(data, design),
            hull: Math.round(s.hull),
            maxHull: shipEntity.stats['hull']?.base ?? s.hull,
            care: s.care ?? 0,
            inYard: s.refitUntil !== undefined && s.refitUntil > tick,
            history: (s.history ?? []).slice(-8),
          }
        : null,
    creator: {
      hulls: data.ships.hulls
        .filter((h) => allowed.has(h.id))
        .map((h) => ({ ...part(h), size: h.size, cost: h.cost, length: h.length })),
      materials: data.ships.materials.map(part),
      rigs: data.ships.rigs.map(part),
      drives: data.ships.drives
        .filter((d) => !d.storyLocked)
        .map((d) => ({ ...part(d), cost: d.cost })),
      rooms: data.ships.rooms.map((r) => ({ ...part(r), cost: r.cost })),
      weapons: data.ships.weapons
        .filter((w) => !w.storyLocked)
        .map((w) => ({ ...part(w), cost: w.cost, perDeck: w.perDeck })),
      figureheads: data.ships.figureheads.map((f) => ({ ...part(f), cost: f.cost })),
      colours: [...data.ships.colours],
      designs: [...(hands?.designs ?? [])],
      blueprints: plans,
      shipbuilding: Math.round((hands?.crafts.shipbuilding ?? 0) * 10) / 10,
    },
    treasure: { found: hands?.tally['treasure'] ?? 0 },
    gambling: den
      ? {
          games: g.games.map((x) => ({
            id: x.id,
            name: x.name,
            description: x.description,
            payout: x.payout,
          })),
          betsLeft: Math.max(0, g.perMonth - betsThisMonth(env)),
          maxStake: g.maxStake,
          lock: gambleLock(env, 1),
        }
      : null,
    calls: {
      hasSnail: hasSnail(state, data, p.entity),
      people: callable(state, p).map((e) => ({
        id: e.id,
        name: e.name,
        called: hands?.last[`call:${e.id}`] === tick,
        vivre: vivreLock(env, e.id),
      })),
    },
    tally: { ...(hands?.tally ?? {}) },
  };
}

/** The ship creator's live numbers for a design (a request the page makes as the design changes). */
export function designPreview(
  state: WorldState,
  data: GameData,
  input: unknown,
): DesignPreview | null {
  const p = playerPerson(state, data);
  const parsed = ShipDesignSchema.safeParse(input);
  if (!p || !parsed.success) return null;
  const design = parsed.data;
  const env = { state, data, p };
  const yard = yardOf(data, p.place.location?.id);
  const skill = p.c.hands?.crafts.shipbuilding ?? 0;
  const here = shipHere(state, p);
  let refit: DesignPreview['refit'] = null;
  if (here && yard) {
    const old = stockDesign(data, here);
    const sameHull =
      old.hull === design.hull && old.material === design.material && old.length === design.length;
    const stats = designStats(data, design);
    const price = refitPrice(env, here, design);
    refit = {
      price,
      lock: !sameHull
        ? 'A refit keeps her hull, length and material'
        : (stats.errors[0] ??
          (p.c.berries < price ? `Costs ${formatBerries(price)} Berries` : null)),
    };
  }
  return {
    design,
    stats: designStats(data, design),
    yard,
    price: { yard: buildPrice(env, design, 'yard'), self: buildPrice(env, design, 'self') },
    months: {
      yard: buildMonths(data, design, yard?.skill ?? 50, 'yard'),
      self: buildMonths(data, design, skill, 'self'),
    },
    lock: { yard: buildLock(env, design, 'yard'), self: buildLock(env, design, 'self') },
    refit,
  };
}

/** For the debug panel and tests: how many of each grade exist now. */
export function gradeCounts(state: WorldState): Record<string, number> {
  return Object.fromEntries(
    ['supreme', 'great', 'skillful', 'graded'].map((g) => [g, gradeCount(state, g)]),
  );
}
