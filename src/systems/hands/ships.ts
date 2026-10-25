import type { GameData, ShipRules } from '../../engine/data/schemas';
import { ShipDesignSchema, type ShipDesign } from '../../engine/data/defs';
import { createEntity } from '../../engine/entities';
import type { Rng } from '../../engine/rng';
import { makeStat } from '../../engine/stats';
import { PUBLIC_KNOWLEDGE, type Entity, type WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import type { Person } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { priceMult } from '../places/place';
import { shipsOf } from '../voyage/plan';
import { carried, destroyItem, ensureHands, HandsError, itemDefOf } from './items';

/**
 * Ships, fully (Phase 6): the ship creator's maths, building at a yard or with your own hands,
 * refits, repairs and battle damage, upkeep and rot, a ship's history, and the guardian spirit a
 * well-loved ship may gain. A ship's speed, hull and cargo stay the entity's stats (Phase 3), so
 * the voyage code needs nothing new: the design only decides what they are.
 */

type Hull = ShipRules['hulls'][number];

export interface ShipStats {
  speed: number;
  hull: number;
  cargo: number;
  berths: number;
  minCrew: number;
  comfort: number;
  stealth: number;
  upkeep: number;
  cost: number;
  months: number;
  cannons: number;
  ram: number;
  boarding: number;
  /** Speed kept in a dead calm (a share), and help running from a sea fight. */
  calm: number;
  escape: number;
  calmBelt: boolean;
  seaKingProof: boolean;
  rot: number | null;
  rooms: { used: number; max: number };
  /** Shipwright skill this design needs, and the yard size. */
  skill: number;
  size: number;
  /** Problems that stop it being built ("Too many rooms"), and things worth knowing. */
  errors: string[];
  warnings: string[];
}

const LOUD = new Set(['red', 'gold', 'orange', 'yellow', 'purple']);

function part<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  return list.find((x) => x.id === id);
}

/** The live numbers of a design, as the ship creator shows them while it changes. */
export function designStats(data: GameData, design: ShipDesign): ShipStats {
  const s = data.ships;
  const errors: string[] = [];
  const warnings: string[] = [];
  const hull = part(s.hulls, design.hull);
  const material = part(s.materials, design.material);
  const rig = part(s.rigs, design.rig);
  const figure = part(s.figureheads, design.figurehead) ?? s.figureheads[0];
  if (!hull || !material || !rig || !figure) {
    return {
      speed: 0,
      hull: 0,
      cargo: 0,
      berths: 0,
      minCrew: 1,
      comfort: 0,
      stealth: 0,
      upkeep: 0,
      cost: 0,
      months: 0,
      cannons: 0,
      ram: 0,
      boarding: 0,
      calm: 0,
      escape: 0,
      calmBelt: false,
      seaKingProof: false,
      rot: null,
      rooms: { used: 0, max: 0 },
      skill: 0,
      size: 0,
      errors: ['That design names parts that do not exist'],
      warnings: [],
    };
  }
  const length = Math.max(hull.length.min, Math.min(hull.length.max, design.length));
  if (length !== design.length)
    warnings.push(
      `A ${hull.name.toLowerCase()} is built ${hull.length.min} to ${hull.length.max} times its usual length`,
    );
  let cost = hull.cost * length * length * material.cost * rig.cost;
  let comfort = figure.morale / 2;
  let berthsTaken = 0;
  let seaKingProof = false;
  const rooms = [...new Set(design.rooms)];
  for (const id of rooms) {
    const room = part(s.rooms, id);
    if (!room) {
      errors.push(`There is no room "${id}"`);
      continue;
    }
    cost += room.cost;
    comfort += room.comfort;
    berthsTaken += room.berths;
    if (room.effect === 'seastone') seaKingProof = true;
  }
  const roomMax = Math.max(0, Math.round(hull.rooms * length));
  if (rooms.length > roomMax)
    errors.push(
      `A ${hull.name.toLowerCase()} this long has room for ${roomMax} room${roomMax === 1 ? '' : 's'}`,
    );
  let cannons = 0;
  let ram = 0;
  let boarding = 0;
  for (const [id, count] of Object.entries(design.weapons)) {
    if (count <= 0) continue;
    const w = part(s.weapons, id);
    if (!w) {
      errors.push(`There is no ship weapon "${id}"`);
      continue;
    }
    if (w.storyLocked) errors.push(`${w.name}: only the story can give a ship that`);
    const most = w.perDeck === 0 ? 1 : w.perDeck * hull.decks;
    if (count > most)
      errors.push(
        most === 0
          ? `A ${hull.name.toLowerCase()} has no deck for ${w.name.toLowerCase()}s`
          : `At most ${most} ${w.name.toLowerCase()}${most === 1 ? '' : 's'}`,
      );
    cost += w.cost * count;
    cannons += w.cannons * count;
    ram += w.ram * count;
    boarding += w.boarding * count;
  }
  let calm = 0;
  let escape = 0;
  let calmBelt = false;
  for (const id of [...new Set(design.drives)]) {
    const d = part(s.drives, id);
    if (!d) {
      errors.push(`There is no drive "${id}"`);
      continue;
    }
    if (d.storyLocked) errors.push(`${d.name}: only the story can give a ship that`);
    cost += d.cost;
    calm = Math.max(calm, d.calm);
    escape += d.escape;
    calmBelt ||= d.calmBelt;
  }
  cost += figure.cost;
  const berths = Math.max(1, Math.round(hull.berths * length) - berthsTaken);
  const minCrew = Math.max(1, Math.ceil(hull.minCrew * rig.hands * length));
  if (minCrew > berths) errors.push(`She needs ${minCrew} hands but has berths for ${berths}`);
  const skill = Math.min(
    100,
    Math.max(hull.skill + Math.max(0, (length - 1) * 60), material.skill),
  );
  const loud = (LOUD.has(design.hullColour) ? 4 : 0) + (LOUD.has(design.sailColour) ? 4 : 0);
  return {
    speed: Math.round(hull.speed * material.speed * rig.speed * (1 + (length - 1) * 0.25)),
    hull: Math.round(hull.hull * material.hull * length),
    cargo: Math.max(0, Math.round(hull.cargo * length)),
    berths,
    minCrew,
    comfort: Math.round(comfort * 10) / 10,
    stealth: Math.max(0, Math.min(100, Math.round(70 - hull.size * 8 - figure.fame * 40 - loud))),
    upkeep: Math.round(cost * s.upkeep * material.upkeep),
    cost: Math.round(cost),
    months: Math.round(hull.months * length * (1 + material.skill / 200) * 10) / 10,
    cannons: Math.round(cannons * 10) / 10,
    ram,
    boarding,
    calm,
    escape: Math.round(escape * 100) / 100,
    calmBelt,
    seaKingProof,
    rot: material.rot,
    rooms: { used: rooms.length, max: roomMax },
    skill: Math.round(skill),
    size: hull.size,
    errors,
    warnings,
  };
}

/** The yard where the person stands: how big a ship it can build and how good its shipwrights. */
export function yardOf(
  data: GameData,
  placeId: string | null | undefined,
): { size: number; skill: number; name: string } | null {
  if (!placeId) return null;
  const special = data.ships.yards.places[placeId];
  const loc = data.locations[placeId];
  if (special) return special;
  if (!loc) return null;
  const features = loc.features as readonly string[];
  if (features.includes('shipyard'))
    return { ...data.ships.yards.shipyard, name: `the shipyard at ${loc.name}` };
  if (features.includes('docks'))
    return { ...data.ships.yards.docks, name: `the docks at ${loc.name}` };
  return null;
}

/** Hull designs this person may build: every ordinary hull, and those their blueprints allow. */
export function hullsAllowed(state: WorldState, data: GameData, p: Person): Hull[] {
  const fromPlans = new Set(
    carried(state, p.entity)
      .map((i) => itemDefOf(data, i)?.design?.hull ?? i.item?.design?.hull)
      .filter((h): h is string => !!h),
  );
  return data.ships.hulls.filter((h) => !h.blueprint || fromPlans.has(h.id));
}

/** Why this design cannot be built here, by this yard or these hands (null: it can). */
export function buildLock(
  env: Pick<LifeEnv, 'state' | 'data' | 'p'>,
  design: ShipDesign,
  by: 'yard' | 'self',
): string | null {
  const { state, data, p } = env;
  if (p.place.atSea) return 'Ships are built ashore';
  const yard = yardOf(data, p.place.location?.id);
  if (!yard) return 'There is no yard here';
  const stats = designStats(data, design);
  if (stats.errors.length > 0) return stats.errors[0] ?? 'That design cannot be built';
  if (stats.size > yard.size)
    return `${yard.name.charAt(0).toUpperCase()}${yard.name.slice(1)} cannot build a ship that big`;
  if (!hullsAllowed(state, data, p).some((h) => h.id === design.hull))
    return 'That hull needs a blueprint';
  const material = part(data.ships.materials, design.material);
  const needs = [
    material?.needs,
    ...design.drives.map((d) => part(data.ships.drives, d)?.needs),
  ].filter((x): x is string => !!x);
  for (const need of needs) {
    if (!carried(state, p.entity).some((i) => i.item?.defId === need))
      return `Needs ${data.items[need]?.name ?? need}`;
  }
  const hands = p.c.hands;
  if (hands?.build) return 'A ship of yours is already on the slipway';
  const price = buildPrice(env, design, by);
  if (p.c.berries < price) return `It costs ${formatBerries(price)} Berries`;
  if (by === 'self' && (hands?.crafts.shipbuilding ?? 0) < stats.skill * 0.4)
    return `Your shipbuilding (${Math.floor(hands?.crafts.shipbuilding ?? 0)}) is too far short of the ${stats.skill} this design needs`;
  return null;
}

/** What a yard charges for the design here, or the materials for building it yourself. */
export function buildPrice(
  env: Pick<LifeEnv, 'state' | 'data' | 'p'>,
  design: ShipDesign,
  by: 'yard' | 'self',
): number {
  const { state, data, p } = env;
  const cost = designStats(data, design).cost * priceMult(state, data, p.place.location?.id ?? '');
  return Math.round(by === 'self' ? cost * (1 - data.ships.build.selfDiscount) : cost);
}

/** Months a build takes: longer when the shipwright's skill falls short of the design's. */
export function buildMonths(
  data: GameData,
  design: ShipDesign,
  skill: number,
  by: 'yard' | 'self',
): number {
  const stats = designStats(data, design);
  const short = Math.max(0, stats.skill - skill);
  const base = stats.months * (by === 'self' ? 1.5 : 1);
  return Math.round(base * (1 + short * data.ships.build.shortfall) * 10) / 10;
}

/** Lay the keel: pay the yard (or buy the materials) and put the design on the slipway. */
export function startBuild(env: LifeEnv, input: ShipDesign, by: 'yard' | 'self'): void {
  const { state, data, p, tick } = env;
  const design = ShipDesignSchema.parse(input);
  const lock = buildLock(env, design, by);
  if (lock) throw new HandsError(lock);
  const yard = yardOf(data, p.place.location?.id);
  const hands = ensureHands(p.entity);
  const price = buildPrice(env, design, by);
  pay(env, -price);
  // A treasure tree's wood (or another needed part) is used up.
  const material = part(data.ships.materials, design.material);
  for (const need of [
    material?.needs,
    ...design.drives.map((d) => part(data.ships.drives, d)?.needs),
  ]) {
    if (!need) continue;
    const item = carried(state, p.entity).find((i) => i.item?.defId === need);
    if (item)
      destroyItem(state, data, item, tick, `Built into the ${shipWords(design.name ?? 'ship')}.`);
  }
  const skill = by === 'yard' ? (yard?.skill ?? 50) : (hands.crafts.shipbuilding ?? 0);
  hands.build = {
    design: { ...design, name: design.name ?? defaultName(data, env.rng) },
    place: p.place.location?.id ?? '',
    by,
    done: 0,
    needed: buildMonths(data, design, skill, by),
    sinceTick: tick,
    quality: by === 'yard' ? Math.min(100, 40 + skill / 2) : 0,
  };
  const text = renderLife(env, data.hands.lines['buildStart'] ?? '', {
    ship: shipWords(hands.build.design.name ?? 'ship'),
    place: p.place.name,
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'voyage', 'money'] });
  reportLine(env, `${text} ${formatBerries(price)} Berries.`, 'plain');
}

function defaultName(data: GameData, rng: Rng): string {
  return rng.fork('shipName').pick(data.travel.shipNames);
}

function shipWords(name: string): string {
  return name.replace(/^the /i, '');
}

/** Pay the yard to put more hands on it: each month saved costs a share of the price. */
export function hastenBuild(env: LifeEnv, months: number): void {
  const { data, p } = env;
  const build = p.c.hands?.build;
  if (!build) throw new HandsError('Nothing of yours is on the slipway');
  if (build.by !== 'yard') throw new HandsError('Only a yard can be paid to hurry');
  const left = build.needed - build.done;
  const saved = Math.min(months, Math.max(0, left - 0.5));
  if (saved <= 0) throw new HandsError('She is nearly done already');
  const cost = Math.round(designStats(data, build.design).cost * data.ships.build.hasten * saved);
  if (p.c.berries < cost) throw new HandsError(`Hurrying costs ${formatBerries(cost)} Berries`);
  pay(env, -cost);
  build.needed = Math.round((build.needed - saved) * 10) / 10;
  reportLine(env, `You paid ${formatBerries(cost)} Berries to hurry the work.`, 'plain');
}

/** A month of your own work on your own ship (the "Work on your project" activity at her yard). */
export function buildMonth(env: LifeEnv, scale: number, rng: Rng): void {
  const { data, p } = env;
  const hands = ensureHands(p.entity);
  const build = hands.build;
  if (!build) return;
  const school =
    data.hands.schools.find((s) => s.place === build.place && s.crafts.includes('shipbuilding'))
      ?.teacher ?? 1;
  const step = Math.min(build.needed - build.done, scale * school);
  const skill = hands.crafts.shipbuilding ?? 0;
  const q = 25 + skill * 0.65 + rng.fork('q').float(-10, 10) + (school - 1) * 10;
  build.quality =
    build.done + step > 0 ? (build.quality * build.done + q * step) / (build.done + step) : q;
  build.done = Math.round((build.done + step) * 1000) / 1000;
  const gain = data.hands.craft.perMonth * scale * school * (1 - skill / 110);
  hands.crafts.shipbuilding = Math.min(100, Math.round((skill + gain) * 100) / 100);
  if (build.done + 1e-9 >= build.needed) launch(env);
  else
    reportLine(
      env,
      renderLife(env, data.hands.lines['buildWork'] ?? '', {
        ship: shipWords(build.design.name ?? 'ship'),
      }),
      'plain',
    );
}

/** A yard's month on a ship it was paid for. */
export function yardMonth(env: LifeEnv): void {
  const build = env.p.c.hands?.build;
  if (!build || build.by !== 'yard') return;
  build.done = Math.round((build.done + 1) * 1000) / 1000;
  if (build.done + 1e-9 >= build.needed) launch(env);
}

/** Set a ship entity's numbers from a design (and the quality of the work). */
export function applyDesign(data: GameData, ship: Entity, design: ShipDesign, quality = 50): void {
  const stats = designStats(data, design);
  const hull = part(data.ships.hulls, design.hull);
  const workmanship = 0.9 + Math.max(0, Math.min(100, quality)) / 500;
  const maxHull = Math.round(stats.hull * workmanship);
  ship.stats['speed'] = makeStat(stats.speed);
  ship.stats['hull'] = makeStat(maxHull);
  ship.stats['cargo'] = makeStat(stats.cargo);
  if (ship.ship) {
    ship.ship.design = design;
    if (hull) ship.ship.vessel = hull.vessel;
    ship.ship.hull = Math.min(ship.ship.hull, maxHull);
    ship.ship.coated ||= false;
  }
}

/** The finished ship slides into the water: yours, at her yard. An old ship is traded in. */
export function launch(env: LifeEnv): Entity | null {
  const { state, data, p, tick } = env;
  const hands = ensureHands(p.entity);
  const build = hands.build;
  if (!build) return null;
  hands.build = null;
  for (const old of shipsOf(state, p.entity.id)) {
    const worth = resaleValue(state, data, old, build.place);
    pay(env, worth);
    if (old.ship) {
      old.ship.ownerId = null;
      old.ship.crew = 0;
    }
    reportLine(
      env,
      `The yard took the ${shipWords(old.name)} in trade for ${formatBerries(worth)} Berries.`,
      'plain',
    );
  }
  const name = build.design.name ?? 'the new ship';
  const ship = createEntity(state, {
    type: 'ship',
    origin: 'player',
    name,
    tier: 1,
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  ship.ship = {
    vessel: part(data.ships.hulls, build.design.hull)?.vessel ?? 'vessel_dinghy',
    ownerId: p.entity.id,
    place: build.place,
    hull: 0,
    crew: 0,
    morale: data.travel.morale.start,
    supplies: 0,
    coated: false,
    sunk: false,
    care: 0,
    spirit: 'dormant',
    builtTick: tick,
    history: [],
  };
  applyDesign(data, ship, build.design, build.quality);
  ship.ship.hull = ship.stats['hull']?.base ?? 1;
  shipStory(
    ship,
    tick,
    `Launched at ${data.locations[build.place]?.name ?? 'a yard'}${build.by === 'self' ? `, built by ${p.entity.name}'s own hands` : ''}.`,
  );
  const text = renderLife(env, data.hands.lines['launched'] ?? '', { ship: shipWords(name) });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'voyage', 'deed'] });
  reportLine(env, text, 'good');
  p.c.life?.deeds.push({ tick, text });
  return ship;
}

/** What a yard would give for a ship: a share of what she cost, by her hull. */
export function resaleValue(
  state: WorldState,
  data: GameData,
  ship: Entity,
  placeId: string,
): number {
  const s = ship.ship;
  if (!s) return 0;
  const cost = s.design ? designStats(data, s.design).cost : (data.vessels[s.vessel]?.cost ?? 0);
  const maxHull = ship.stats['hull']?.base ?? data.vessels[s.vessel]?.hull ?? 1;
  return Math.round(
    cost *
      data.ships.build.resale *
      Math.max(0, s.hull / maxHull) *
      priceMult(state, data, placeId),
  );
}

/** A stock ship's design, for refitting a ship bought ready-made. */
export function stockDesign(data: GameData, ship: Entity): ShipDesign {
  const existing = ship.ship?.design;
  if (existing) return existing;
  const hull = data.ships.hulls.find((h) => h.vessel === ship.ship?.vessel) ?? data.ships.hulls[0];
  return ShipDesignSchema.parse({
    name: ship.name,
    hull: hull?.id ?? 'dinghy',
    material: 'common_wood',
    rig: 'square',
  });
}

/** What a refit to this design would cost: the new parts, and the yard's labour. */
export function refitPrice(
  env: Pick<LifeEnv, 'state' | 'data' | 'p'>,
  ship: Entity,
  design: ShipDesign,
): number {
  const { state, data, p } = env;
  const before = designStats(data, stockDesign(data, ship));
  const after = designStats(data, design);
  const added = Math.max(0, after.cost - before.cost);
  const labour = (added + 2000) * data.ships.build.refitLabour;
  return Math.round((added + labour) * priceMult(state, data, p.place.location?.id ?? ''));
}

/**
 * Refit the ship moored here to a new design: rooms, guns, drives, figurehead, colours, name.
 * The hull and its material stay what they are. Structural work keeps her in the yard a month.
 */
export function refitShip(env: LifeEnv, ship: Entity, input: ShipDesign): void {
  const { data, p, tick } = env;
  const design = ShipDesignSchema.parse(input);
  const old = stockDesign(data, ship);
  if (design.hull !== old.hull || design.material !== old.material || design.length !== old.length)
    throw new HandsError('A refit cannot change her hull: that is a new ship');
  const yard = yardOf(data, p.place.location?.id);
  if (!yard) throw new HandsError('There is no yard here');
  const stats = designStats(data, design);
  if (stats.errors.length > 0) throw new HandsError(stats.errors[0] ?? 'That refit cannot be done');
  for (const id of design.drives) {
    const need = part(data.ships.drives, id)?.needs;
    if (
      need &&
      !old.drives.includes(id) &&
      !carried(env.state, p.entity).some((i) => i.item?.defId === need)
    )
      throw new HandsError(`Needs ${data.items[need]?.name ?? need}`);
  }
  const price = refitPrice(env, ship, design);
  if (p.c.berries < price) throw new HandsError(`The refit costs ${formatBerries(price)} Berries`);
  pay(env, -price);
  const structural =
    JSON.stringify([...design.rooms].sort()) !== JSON.stringify([...old.rooms].sort()) ||
    JSON.stringify(design.weapons) !== JSON.stringify(old.weapons) ||
    JSON.stringify([...design.drives].sort()) !== JSON.stringify([...old.drives].sort()) ||
    design.rig !== old.rig;
  const s = ship.ship;
  if (!s) return;
  const share = s.hull / Math.max(1, ship.stats['hull']?.base ?? s.hull);
  applyDesign(data, ship, design, 50);
  s.hull = Math.round((ship.stats['hull']?.base ?? s.hull) * share);
  if (design.name && design.name !== ship.name) {
    shipStory(ship, tick, `Renamed the ${shipWords(design.name)}.`);
    ship.name = design.name;
  }
  if (structural && data.ships.build.refitMonths > 0)
    s.refitUntil = tick + data.ships.build.refitMonths;
  shipStory(ship, tick, `Refitted at ${p.place.name}.`);
  const text = renderLife(env, data.hands.lines['refitted'] ?? '', { ship: shipWords(ship.name) });
  lifeLog(env, text, { tags: ['personal', 'voyage', 'money'] });
  reportLine(env, `${text} ${formatBerries(price)} Berries.`, 'plain');
}

/** Add a line to a ship's story (rule 6). */
export function shipStory(ship: Entity, tick: number, text: string): void {
  const s = ship.ship;
  if (!s) return;
  s.history ??= [];
  s.history.push({ tick, text });
  if (s.history.length > 40) s.history.splice(1, s.history.length - 40);
}

/**
 * The moment a ship of the player's should sink: a guardian spirit, once, keeps her afloat with a
 * scrap of hull. Returns true when she was saved.
 */
export function spiritSaves(env: LifeEnv, ship: Entity): boolean {
  const s = ship.ship;
  if (!s || s.spirit !== 'awake') return false;
  s.spirit = 'spent';
  s.hull = Math.max(1, Math.round((ship.stats['hull']?.base ?? 10) * 0.1));
  s.sunk = false;
  shipStory(ship, env.tick, 'Should have sunk, and did not.');
  const text = renderLife(env, env.data.hands.lines['spiritSaved'] ?? '', {
    ship: shipWords(ship.name),
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'voyage'] });
  reportLine(env, text, 'good');
  return true;
}

/**
 * A month of a ship's life (the player's): upkeep, rot past her years, care (repaired, crewed,
 * never abandoned) and, after years of it, perhaps a spirit.
 */
export function shipMonth(env: LifeEnv): void {
  const { state, data, p, tick, rng } = env;
  for (const ship of shipsOf(state, p.entity.id)) {
    const s = ship.ship;
    if (!s) continue;
    const max = ship.stats['hull']?.base ?? 1;
    if (s.refitUntil !== undefined && s.refitUntil <= tick + 1) {
      delete s.refitUntil;
      reportLine(
        env,
        renderLife(env, data.hands.lines['refitted'] ?? '', { ship: shipWords(ship.name) }),
        'good',
      );
    }
    // Upkeep: a stock ship's from her price, a designed one's from her design.
    const stats = s.design ? designStats(data, s.design) : null;
    const upkeep = stats
      ? stats.upkeep
      : Math.round((data.vessels[s.vessel]?.cost ?? 0) * data.ships.upkeep);
    if (upkeep > 0) pay(env, -upkeep);
    // Rot: past her material's years, she loses hull until repaired.
    const rot = stats?.rot ?? 20;
    const age = tick - (s.builtTick ?? ship.createdTick);
    if (rot !== null && age > rot * 12 && s.hull > 1) s.hull = Math.max(1, s.hull - max * 0.01);
    // Care and the spirit.
    const neglected =
      s.hull < max * data.ships.spirit.neglect || (s.crew === 0 && s.place === null);
    s.care = Math.max(0, (s.care ?? 0) + (neglected ? -3 : 1));
    if (s.spirit === undefined) s.spirit = 'dormant';
    if (
      s.spirit === 'dormant' &&
      s.care >= data.ships.spirit.care &&
      rng.fork('spirit', ship.id).chance(data.ships.spirit.chance)
    ) {
      s.spirit = 'awake';
      shipStory(ship, tick, 'A spirit woke aboard her, though nobody saw it.');
      const text = renderLife(env, data.hands.lines['spiritWoke'] ?? '', {
        ship: shipWords(ship.name),
      });
      lifeLog(env, text, { tags: ['personal', 'voyage'] });
    }
  }
}

/** A design as text, to save or share as a file (the creator's blueprints). */
export function exportDesign(design: ShipDesign): string {
  return JSON.stringify(ShipDesignSchema.parse(design), null, 2);
}

/** A shared design read back in: checked against the schema and the parts in data. */
export function importDesign(data: GameData, text: string): ShipDesign {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HandsError('That is not a ship design (it is not JSON)');
  }
  const parsed = ShipDesignSchema.safeParse(raw);
  if (!parsed.success) throw new HandsError('That is not a ship design');
  const stats = designStats(data, parsed.data);
  if (stats.errors.some((e) => e.startsWith('There is no') || e.includes('do not exist')))
    throw new HandsError(stats.errors[0] ?? 'That design names unknown parts');
  return parsed.data;
}

/** The Marines' standard design for a rank (Phase 9 issues them). */
export function standardDesign(data: GameData, rank: string): ShipDesign | null {
  return data.ships.standard[rank] ?? null;
}

export { formatBerries };

/**
 * A ship's own numbers, whether she was built from a design or bought stock: her maximum hull,
 * speed, and the hands she needs and holds (the voyage code asks this, not the vessel table).
 */
export function shipNumbers(
  data: GameData,
  ship: Entity,
): { maxHull: number; speed: number; minCrew: number; maxCrew: number } {
  const s = ship.ship;
  const vessel = data.vessels[s?.vessel ?? ''];
  const stats = s?.design ? designStats(data, s.design) : null;
  return {
    maxHull: ship.stats['hull']?.base ?? vessel?.hull ?? s?.hull ?? 1,
    speed: ship.stats['speed']?.base ?? vessel?.speed ?? 100,
    minCrew: stats ? stats.minCrew : (vessel?.minCrew ?? 1),
    maxCrew: stats ? stats.berths : (vessel?.maxCrew ?? 1),
  };
}
