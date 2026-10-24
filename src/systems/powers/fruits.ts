import type { FruitDef, FruitHolder, GameData } from '../../engine/data/schemas';
import { tickOfWhen } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import { Rng } from '../../engine/rng';
import {
  PUBLIC_KNOWLEDGE,
  type Entity,
  type FruitState,
  type WorldState,
} from '../../engine/state';
import { addMod, STAT_IDS } from '../../engine/stats';
import { entityIds, mintGeneratedId } from '../../engine/entities';
import { formatBerries } from '../genesis/text';
import { ageYears } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, withCause, type LifeEnv } from '../life/env';
import { die, hurt, injure } from '../life/health';
import { giveTraitTo } from '../life/traits';
import { locations, shortestMiles, withDevFixtures } from '../places/graph';
import { canonIndex, fruitDefOf, fruitLook, generateFruit } from './catalogue';
import { applyCanonEra } from './movesets';
import { bonusStat, ensurePowers, powerSource } from './state';
import { line, openTrack, powerCtxOf, refreshPowerMods, tell } from './tracks';

/**
 * Devil Fruits in the world (Phase 4).
 *
 * One fruit, one world: every fruit is one entity (rule 2) whose `fruit` block says where it is
 * and whose it is, with its history. Canon fruits follow their canon users by date (data/fruits
 * `holders`), pushed by the canon mode like the beats are; a canon user the world does not
 * simulate is held by name. When a user dies the fruit grows again in an ordinary fruit somewhere
 * (near where they died, near trade, or anywhere for rare fruits), known to nobody (rule 4) until a
 * rumour, a find or a market sale. Wild fruits are found by someone now and then (eaten, or sold
 * to a black market); market fruits are bought. Every change goes through `setUser`,
 * `carryFruit` and `releaseFruit`, so there is never more than one of anything.
 */

export const FRUITS_BUILT = 'fruits.built';
const CURSE_SOURCE = 'Sea water (Devil Fruit curse)';
const SEASTONE_SOURCE = 'Seastone (Devil Fruit curse)';

export function fruitsBuilt(state: WorldState): boolean {
  return state.flags[FRUITS_BUILT] === true;
}

/** Fruit entities, in id order. */
export function fruitEntities(state: WorldState): Entity[] {
  const out: Entity[] = [];
  for (const id of entityIds(state)) {
    const e = state.entities[id] as Entity;
    if (e.type === 'fruit' && e.fruit !== undefined) out.push(e);
  }
  return out;
}

/** The fruit someone (or something with a body) has eaten, if any. */
export function eatenFruit(state: WorldState, entity: Entity): Entity | undefined {
  const id = entity.character?.powers?.fruit?.id ?? entity.flags['fruit'];
  if (typeof id !== 'string') return undefined;
  const fruit = state.entities[id];
  return fruit?.fruit?.userId === entity.id ? fruit : undefined;
}

export function isFruitUser(state: WorldState, entity: Entity): boolean {
  return eatenFruit(state, entity) !== undefined;
}

function history(fruit: Entity, tick: number, text: string): void {
  fruit.fruit?.history.push({ tick, text });
}

/** "the Gum-Gum Fruit" */
export function fruitName(data: GameData, fruit: Entity): string {
  return `the ${fruitDefOf(data, fruit)?.name ?? fruit.name}`;
}

// ---- Who has it ---------------------------------------------------------------------------

function clearOwner(state: WorldState, fruit: Entity): void {
  const f = fruit.fruit as FruitState;
  for (const id of [f.userId, f.holderId]) {
    if (!id) continue;
    const owner = state.entities[id];
    if (!owner) continue;
    if (owner.flags['fruit'] === fruit.id) delete owner.flags['fruit'];
    const powers = owner.character?.powers;
    if (powers) {
      powers.items = powers.items.filter((i) => i !== fruit.id);
      if (powers.fruit?.id === fruit.id) powers.fruit = null;
    }
  }
  f.userId = null;
  f.userName = null;
  f.holderId = null;
  f.userUntil = null;
  f.price = null;
}

export interface UserOptions {
  tick: number;
  text: string;
  /** Known to the world (a famous user), or to nobody. */
  public?: boolean;
  /** They know which fruit it is. */
  identified?: boolean;
  /** Months until an unidentified fruit is understood. */
  discovery?: number;
  until?: number | null;
  /** The canon anomaly: a second fruit, the first kept. */
  keepOther?: boolean;
}

/**
 * Make someone (a person, or an object or animal with a body) the fruit's user. A person gains the
 * fruit's type track, the curse, and the fruit's first techniques.
 */
export function setUser(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  user: Entity,
  options: UserOptions,
): void {
  const f = fruit.fruit as FruitState;
  const def = fruitDefOf(data, fruit);
  // A second fruit for the same body (only the canon anomaly survives one): the first is kept.
  const held = user.character?.powers?.fruit;
  const previous = options.keepOther || (held && held.id !== fruit.id) ? held : null;
  clearOwner(state, fruit);
  f.container = 'eaten';
  f.userId = user.id;
  f.place = null;
  f.waitingSince = null;
  f.userUntil = options.until ?? null;
  history(fruit, options.tick, options.text);
  if (options.public) fruit.knownBy = [PUBLIC_KNOWLEDGE];
  user.flags['fruit'] = fruit.id;
  const c = user.character;
  if (!c || !def) return;
  const powers = ensurePowers(c);
  const identified = options.identified ?? true;
  powers.fruit = {
    id: fruit.id,
    eatenTick: options.tick,
    identified,
    knownAt: identified ? options.tick : options.tick + (options.discovery ?? 3),
    awakened: false,
    secret: false,
    dud: false,
  };
  giveTraitTo(data, user, data.powers.fruit.cursedTrait, 'Ate a Devil Fruit', options.tick);
  if (previous) user.flags['fruit.first'] = previous.id;
  const trackId = fruitTrackOf(data, def);
  if (trackId) {
    const ctx = {
      state,
      data,
      tick: options.tick,
      rng: Rng.root(`fruit:${fruit.id}`),
      entity: user,
      c,
      placeId: c.place ?? null,
    };
    openTrack(ctx, trackId, { source: def.name, quiet: true });
  }
  learnFruitTechniques(data, user, options.tick, state);
  refreshPowerMods(data, user, options.tick, state);
  // A canon character's fruit mastery and moves are their era's (data/movesets).
  if (user.id in data.cast) {
    delete user.flags['moveset.era'];
    applyCanonEra(state, data, user, options.tick);
  }
}

/** A fruit's techniques up to the user's mastery join their moveset. */
export function learnFruitTechniques(
  data: GameData,
  user: Entity,
  tick: number,
  state?: WorldState,
): void {
  const c = user.character;
  const powers = c?.powers;
  if (!c || !powers?.fruit || powers.fruit.dud) return;
  const fruitEntity = state?.entities[powers.fruit.id];
  const def = fruitEntity ? fruitDefOf(data, fruitEntity) : data.fruits[powers.fruit.id];
  if (!def) return;
  const mastery = fruitMastery(data, c);
  const techs = [...def.techniques, ...(powers.fruit.secret ? (def.secret?.techniques ?? []) : [])];
  for (const tech of techs) {
    if (tech.mastery > mastery) continue;
    if (powers.moves.some((m) => m.id === tech.id)) continue;
    powers.moves.push({
      id: tech.id,
      source: 'fruit',
      mastery: 10,
      uses: 0,
      learnedTick: tick,
      lastUsed: null,
      faded: false,
      ...(def.origin === 'generated' ? { def: tech } : {}),
    });
  }
}

export function fruitTrackOf(data: GameData, def: FruitDef): string | null {
  const track = Object.values(data.tracks).find(
    (t) => t.family === 'fruit' && t.fruitType === def.type,
  );
  return track?.id ?? null;
}

/** The fruit's mastery (0 to 100): the progress on its type's track. */
export function fruitMastery(data: GameData, c: Entity['character']): number {
  const fruitId = c?.powers?.fruit?.id;
  if (!c || !fruitId) return 0;
  for (const [id, ts] of Object.entries(c.powers?.tracks ?? {})) {
    if (data.tracks[id]?.family === 'fruit') return ts.progress;
  }
  return 0;
}

/** Someone carries the fruit, uneaten. */
export function carryFruit(
  state: WorldState,
  fruit: Entity,
  holder: Entity,
  tick: number,
  text: string,
): void {
  const f = fruit.fruit as FruitState;
  clearOwner(state, fruit);
  f.container = 'held';
  f.holderId = holder.id;
  f.place = null;
  history(fruit, tick, text);
  const c = holder.character;
  if (!c) return;
  const powers = ensurePowers(c);
  if (!powers.items.includes(fruit.id)) powers.items.push(fruit.id);
  const known = powers.known[fruit.id];
  powers.known[fruit.id] = {
    tick,
    place: null,
    userId: null,
    identified: known?.identified ?? false,
  };
}

/** Where a fruit grows again: near where its user died, near trade, or anywhere (rare fruits). */
export function rebirthPlace(
  state: WorldState,
  data: GameData,
  from: string | null,
  def: FruitDef | undefined,
  rng: Rng,
): string {
  const rules = data.powers.fruit.rebirth;
  const places = locations(data, withDevFixtures(state)).filter((l) => l.population !== 'none');
  const legendary = def?.rarity === 'legendary' || def?.rarity === 'rare';
  const weight = (id: string) => {
    const loc = data.locations[id];
    if (!loc) return 0;
    let w = rules.anywhere;
    if (
      !legendary &&
      from &&
      data.locations[from] &&
      shortestMiles(data, from, id) <= rules.nearbyMiles
    )
      w += rules.nearby;
    if (!legendary && (loc.features.includes('market') || loc.features.includes('docks')))
      w += rules.trade;
    return w;
  };
  const pick = rng.weightedPick(
    places.map((l) => l.id),
    weight,
  );
  return pick ?? places[0]?.id ?? 'loc_unknown';
}

/**
 * The user is gone: the fruit grows again in an ordinary fruit somewhere, and nobody knows where.
 * Called for every death (killCharacter, the player's death, a relative's), and for unnamed users.
 */
export function releaseFruit(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  tick: number,
  why: string,
  rng: Rng,
  causeSeq?: number,
): void {
  const f = fruit.fruit;
  if (!f) return;
  const from = f.userId ? (state.entities[f.userId]?.character?.place ?? null) : f.place;
  clearOwner(state, fruit);
  const def = fruitDefOf(data, fruit);
  f.container = 'tree';
  f.place = rebirthPlace(state, data, from, def, rng.fork('rebirth', fruit.id, tick));
  f.bornTick = tick;
  f.waitingSince = null;
  fruit.knownBy = [];
  history(fruit, tick, `${why}; it grew again in an ordinary fruit somewhere.`);
  appendLog(state, tick, {
    kind: 'world',
    summary: renderLine(data, 'fruitReborn', { title: def?.name ?? fruit.name, cause: why }),
    tags: ['world', 'fruit'],
    targetIds: [fruit.id],
    place: f.place,
    cause: 'sys:fruit',
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy: [],
  });
}

/** A death: if they had eaten a fruit, it returns to the world. */
export function releaseFruitOf(
  state: WorldState,
  data: GameData,
  user: Entity,
  tick: number,
  rng: Rng,
  causeSeq?: number,
): void {
  if (!fruitsBuilt(state)) return;
  // Every fruit this body ate (the canon anomaly may hold two).
  for (const fruit of fruitEntities(state)) {
    if (fruit.fruit?.userId === user.id)
      releaseFruit(state, data, fruit, tick, `${user.name} died`, rng.fork(fruit.id), causeSeq);
  }
}

function renderLine(data: GameData, id: string, vars: Record<string, string>): string {
  let text = line(data, id);
  for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---- Building the fruits of a world ---------------------------------------------------------

function makeFruitEntity(
  id: string,
  name: string,
  origin: 'canon' | 'generated',
  tick: number,
  f: FruitState,
): Entity {
  return {
    id,
    type: 'fruit',
    origin,
    name,
    createdTick: tick,
    // Fruits do not act (fruitsMonth moves them), so they stay off the monthly Tier 1 walk.
    tier: 2,
    flags: {},
    stats: {},
    knownBy: [],
    fruit: f,
  };
}

function blankState(
  defId: string,
  look: string,
  tick: number,
  place: string | null,
  container: FruitState['container'],
): FruitState {
  return {
    defId,
    container,
    userId: null,
    userName: null,
    holderId: null,
    place,
    price: null,
    canonNext: 0,
    bornTick: tick,
    userUntil: null,
    waitingSince: null,
    look,
    history: [],
  };
}

function holderTicks(h: FruitHolder): { from: number; to: number } {
  return { from: tickOfWhen(h.from), to: h.to ? tickOfWhen(h.to) : Infinity };
}

/** Objects and animals with a body that can eat a fruit (Lassoo, Funkfreed). */
function ensureBodies(state: WorldState, data: GameData, tick: number): void {
  for (const body of data.powers.fruit.bodies) {
    if (body.id in state.entities) continue;
    state.entities[body.id] = {
      id: body.id,
      type: 'item',
      origin: 'canon',
      name: body.name,
      createdTick: tick,
      tier: 1,
      flags: { body: true, place: body.place },
      stats: {},
      knownBy: [PUBLIC_KNOWLEDGE],
    };
  }
}

/** Put a canon holder in place (at world build, or on their date). False if they cannot take it. */
function giveToHolder(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  def: FruitDef,
  holder: FruitHolder,
  tick: number,
): boolean {
  const f = fruit.fruit as FruitState;
  const text = holder.how ? `${holder.name} ${holder.how}.` : `${holder.name} ate it.`;
  if (holder.char) {
    const user = state.entities[holder.char];
    if (!user?.character?.alive) return false;
    setUser(state, data, fruit, user, { tick, text, public: true });
    return true;
  }
  if (holder.body) {
    const body = state.entities[holder.body];
    if (!body) return false;
    setUser(state, data, fruit, body, { tick, text, public: true });
    return true;
  }
  clearOwner(state, fruit);
  f.container = 'eaten';
  f.userName = holder.name;
  f.place = null;
  f.userUntil = holder.to ? tickOfWhen(holder.to) + 1 : null;
  // Someone the world only names (not one of the cast) is not famous: nobody knows what they ate.
  fruit.knownBy = [];
  history(fruit, tick, text);
  void def;
  return true;
}

/**
 * Every canon fruit as it stands at `tick` (its canon users by date), the bodies that can eat
 * them, once per world. A world built at Year 0 then plays its history month by month.
 */
export function buildFruitLayer(state: WorldState, data: GameData, tick: number, rng: Rng): void {
  if (fruitsBuilt(state)) return;
  state.flags[FRUITS_BUILT] = true;
  ensureBodies(state, data, tick);
  for (const id of Object.keys(data.fruits).sort()) {
    const def = data.fruits[id] as FruitDef;
    const r = rng.fork('fruit', id);
    const f = blankState(
      id,
      def.look ?? fruitLook(data, r.fork('look')),
      tick,
      def.start?.place ?? null,
      def.start?.container ?? 'unknown',
    );
    const fruit = makeFruitEntity(id, def.name, 'canon', tick, f);
    state.entities[id] = fruit;
    let next = 0;
    let lapsed = false;
    def.holders.forEach((h, i) => {
      const span = holderTicks(h);
      if (span.from <= tick) next = i + 1;
      if (span.from <= tick && span.to < tick) lapsed = true;
    });
    f.canonNext = next;
    const current = def.holders.find((h) => {
      const span = holderTicks(h);
      return span.from <= tick && tick <= span.to;
    });
    if (current && giveToHolder(state, data, fruit, def, current, tick)) continue;
    if (lapsed || current) {
      // Its last user died before this world began (or is not here): it is out there somewhere.
      f.container = 'tree';
      f.place = rebirthPlace(state, data, null, def, r.fork('place'));
      history(fruit, tick, 'Its last user died; it grew again in an ordinary fruit somewhere.');
    } else if (!f.place) {
      f.place = rebirthPlace(state, data, null, def, r.fork('place'));
    }
  }
}

/** Generated fruits for a world: a few in every world, many more in Random mode. */
export function seedGeneratedFruits(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
): Entity[] {
  if (state.flags['fruits.generated'] === true) return [];
  state.flags['fruits.generated'] = true;
  const rules = data.powers.fruit;
  const count =
    state.config.canonMode === 'random' ? rules.generatedRandomMode : rules.generatedPerWorld;
  const taken = new Set(fruitEntities(state).map((e) => fruitDefOf(data, e)?.power ?? ''));
  const made: Entity[] = [];
  for (let i = 0; i < count; i++) {
    made.push(makeGeneratedFruit(state, data, tick, rng.fork('generated', i), taken));
  }
  return made;
}

/** One new fruit, lying somewhere in the world. */
export function makeGeneratedFruit(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  taken?: Set<string>,
  culture?: string,
): Entity {
  const id = mintGeneratedId(state);
  const pool = taken ?? new Set(fruitEntities(state).map((e) => fruitDefOf(data, e)?.power ?? ''));
  const def = generateFruit(data, rng.fork('def'), {
    id: `fruit_${id}`,
    taken: pool,
    ...(culture ? { culture } : {}),
  });
  const place = rebirthPlace(state, data, null, def, rng.fork('place'));
  const f = blankState(def.id, def.look ?? fruitLook(data, rng.fork('look')), tick, place, 'tree');
  f.def = def;
  const fruit = makeFruitEntity(id, def.name, 'generated', tick, f);
  history(fruit, tick, 'It grew in an ordinary fruit, a power nobody had seen before.');
  state.entities[id] = fruit;
  return fruit;
}

// ---- The month ------------------------------------------------------------------------------

function handoverChance(state: WorldState, data: GameData): number {
  return data.powers.fruit.handover[state.config.canonMode] ?? 1;
}

/** A canon user's date has come: they take the fruit, if it is free (or wait for it a while). */
function canonHandover(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  def: FruitDef,
  tick: number,
  rng: Rng,
): void {
  const f = fruit.fruit as FruitState;
  const holder = def.holders[f.canonNext];
  if (!holder || tickOfWhen(holder.from) > tick) return;
  const user = holder.char ? state.entities[holder.char] : undefined;
  if (holder.char && (!user || !user.character?.alive || user.origin !== 'canon')) {
    f.canonNext += 1;
    return;
  }
  if (holder.char && user && f.userId === user.id) {
    f.canonNext += 1;
    return;
  }
  if (f.container === 'eaten' || f.container === 'held') {
    const owner = f.userId ?? f.holderId;
    const previous = def.holders[f.canonNext - 1];
    const prevOwner = previous?.char ?? previous?.body;
    const waiting = f.waitingSince ?? tick;
    f.waitingSince = waiting;
    // Still with the canon user before (alive past their date, or off-screen): wait a while.
    const stillPrevious =
      (owner !== null && owner === prevOwner) ||
      (owner === null && previous !== undefined && f.userName === previous.name);
    if (stillPrevious && tick - waiting <= data.powers.fruit.handoverWait) return;
    // Someone else has it (the player, a stranger): the story loses this.
    state.canon.divergences.push({
      tick,
      kind: 'fruit',
      ...(holder.char ? { entity: holder.char } : {}),
      text: renderLine(data, 'fruitDiverged', {
        title: def.name,
        name: holder.name,
        other: owner
          ? (state.entities[owner]?.name ?? 'someone else')
          : (f.userName ?? 'someone else'),
      }),
    });
    f.waitingSince = null;
    f.canonNext += 1;
    return;
  }
  f.canonNext += 1;
  if (!rng.fork('handover', def.id, f.canonNext).chance(handoverChance(state, data))) return;
  giveToHolder(state, data, fruit, def, holder, tick);
}

function strangerYears(data: GameData, rng: Rng): number {
  const r = data.powers.fruit.strangerYears;
  return rng.int(r.min, r.max);
}

/** A black market's place: the nearest place with an underworld. */
function nearestMarket(state: WorldState, data: GameData, from: string): string | null {
  let best: string | null = null;
  let bestMiles = Infinity;
  for (const loc of locations(data, withDevFixtures(state))) {
    if (!loc.features.includes('underworld')) continue;
    const miles = shortestMiles(data, from, loc.id);
    if (miles < bestMiles || (miles === bestMiles && best !== null && loc.id < best)) {
      best = loc.id;
      bestMiles = miles;
    }
  }
  return best;
}

export function marketPrice(data: GameData, def: FruitDef | undefined, rng: Rng): number {
  const range = data.powers.fruit.prices[def?.rarity ?? 'common'] ?? {
    min: 100_000_000,
    max: 100_000_000,
  };
  return Math.round(rng.int(range.min, range.max) / 1_000_000) * 1_000_000;
}

/** A Tier 2 adult at this place who could eat a fruit they found. */
function finderAt(state: WorldState, place: string, tick: number, rng: Rng): Entity | undefined {
  const people = entityIds(state)
    .map((id) => state.entities[id] as Entity)
    .filter(
      (e) =>
        e.tier === 2 &&
        e.character?.alive &&
        e.character.place === place &&
        !e.character.powers?.fruit &&
        e.origin === 'generated',
    );
  const adults = people.filter((e) => (e.character ? ageYears(e.character, tick) : 0) >= 16);
  return adults.length > 0 ? rng.pick(adults) : undefined;
}

/** Whether canon still has a claim on this fruit (its next canon user's date is still to come). */
function reserved(state: WorldState, def: FruitDef | undefined, f: FruitState): boolean {
  if (!def || def.origin !== 'canon') return false;
  if (f.canonNext >= def.holders.length) return false;
  return state.config.canonMode !== 'random';
}

function yearlyFate(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  tick: number,
  rng: Rng,
  news: NewsDraft[],
): void {
  const f = fruit.fruit as FruitState;
  const def = fruitDefOf(data, fruit);
  const rules = data.powers.fruit;
  if (f.container === 'market' && f.place) {
    if (!rng.fork('sold').chance(rules.marketSoldPerYear)) return;
    clearOwner(state, fruit);
    f.container = 'eaten';
    f.userName = 'a buyer whose name never reached the papers';
    f.userUntil = tick + strangerYears(data, rng.fork('years')) * 12;
    history(
      fruit,
      tick,
      `Sold on the black market at ${data.locations[f.place]?.name ?? f.place}.`,
    );
    f.place = null;
    return;
  }
  if (!['tree', 'unknown', 'sea', 'chest'].includes(f.container) || !f.place) return;
  if (reserved(state, def, f)) return;
  if (!rng.fork('found').chance(rules.wildFoundPerYear)) return;
  const place = f.place;
  const placeName = data.locations[place]?.name ?? place;
  if (rng.fork('sell?').chance(rules.sellChance)) {
    const market = nearestMarket(state, data, place);
    if (market) {
      clearOwner(state, fruit);
      f.container = 'market';
      f.place = market;
      f.price = marketPrice(data, def, rng.fork('price'));
      fruit.knownBy = [];
      history(
        fruit,
        tick,
        `Found on ${placeName} and sold to the black market at ${data.locations[market]?.name ?? market}.`,
      );
      return;
    }
  }
  const finder = finderAt(state, place, tick, rng.fork('finder'));
  if (finder) {
    setUser(state, data, fruit, finder, {
      tick,
      text: `${finder.name} found it on ${placeName} and ate it.`,
      identified: false,
      discovery: rng.fork('discover').int(rules.discoveryMonths.min, rules.discoveryMonths.max),
    });
    return;
  }
  clearOwner(state, fruit);
  f.container = 'eaten';
  f.userName = `a stranger on ${placeName}`;
  f.userUntil = tick + strangerYears(data, rng.fork('years')) * 12;
  f.place = null;
  history(fruit, tick, `Someone on ${placeName} found it and ate it.`);
  void news;
}

/** The fruits' month (step 4): canon users take theirs on their date, strangers die, wild fruits are found. */
export function fruitsMonth(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  news: NewsDraft[],
): void {
  if (!fruitsBuilt(state)) return;
  // Streams are forked only for a fruit that has something to roll this month (there are many).
  for (const fruit of fruitEntities(state)) {
    const f = fruit.fruit as FruitState;
    const def = fruitDefOf(data, fruit);
    // An unnamed or off-screen user's time is up first, so the next canon user finds it free.
    if (f.userUntil !== null && f.userUntil <= tick && f.userId === null && f.userName !== null) {
      releaseFruit(
        state,
        data,
        fruit,
        tick,
        `${f.userName.replace(/^a /, 'A ')} died`,
        rng.fork(fruit.id, 'release'),
      );
    }
    const due = def && def.origin === 'canon' ? def.holders[f.canonNext] : undefined;
    if (def && due && tickOfWhen(due.from) <= tick)
      canonHandover(state, data, fruit, def, tick, rng.fork(fruit.id, 'canon'));
    const yearly =
      f.container === 'market' ||
      ((f.container === 'tree' ||
        f.container === 'unknown' ||
        f.container === 'sea' ||
        f.container === 'chest') &&
        !reserved(state, def, f));
    if (yearly && (tick - f.bornTick) % 12 === 11)
      yearlyFate(state, data, fruit, tick, rng.fork(fruit.id, 'year'), news);
  }
}

// ---- The player's fruit -------------------------------------------------------------------

/** Modifiers from the user's fruit, rebuilt with the rest (rule 3). Needs the world for generated fruits. */
export function applyFruitMods(
  state: WorldState | undefined,
  data: GameData,
  entity: Entity,
): void {
  const c = entity.character;
  const record = c?.powers?.fruit;
  if (!c || !record || record.dud) return;
  const fruit = state?.entities[record.id];
  const def = fruit ? fruitDefOf(data, fruit) : data.fruits[record.id];
  if (!def) return;
  const mastery = fruitMastery(data, c);
  const source = powerSource(def.name);
  const scale = 0.5 + mastery / 200;
  for (const boost of def.boosts) {
    const stat = entity.stats[boost.stat];
    if (stat) addMod(stat, { source, value: Math.round(boost.pct * scale * 10) / 10, kind: 'pct' });
  }
  if (record.awakened || entity.flags['fruit.awakened'] === true) {
    for (const boost of data.powers.fruit.awakened[def.type] ?? []) {
      const stat = entity.stats[boost.stat];
      if (stat)
        addMod(stat, {
          source: powerSource(`${def.name} awakened`),
          value: boost.pct,
          kind: 'pct',
        });
    }
  }
  const perMastery = data.powers.fruit.combatPerMastery[def.rarity] ?? 0;
  const combat = Math.round(mastery * perMastery * 10) / 10;
  if (combat > 0)
    addMod(bonusStat(entity, data.powers.combatBonusStat), { source, value: combat, kind: 'flat' });
}

/** Eat a fruit the player carries. A second fruit kills (the canon anomaly is a hidden trait). */
export function eatFruit(env: LifeEnv, fruitId: string): void {
  const { state, data, p, tick } = env;
  const powers = ensurePowers(p.c);
  if (!powers.items.includes(fruitId)) throw new Error('You are not carrying that fruit');
  const fruit = state.entities[fruitId];
  const def = fruitDefOf(data, fruit);
  if (!fruit?.fruit || !def) throw new Error('That is not a Devil Fruit');
  const known = powers.known[fruitId];
  const identified = known?.identified ?? false;
  const nameOrNot = identified ? def.name : 'a swirled fruit nobody could name';
  if (powers.fruit) {
    const anomaly = p.c.traits.some((t) => data.traits[t]?.flags['body.anomaly'] === true);
    if (!anomaly) {
      tell(
        powerCtxOf(env),
        line(data, 'secondFruit'),
        { title: nameOrNot },
        ['fruit', 'death'],
        'alert',
      );
      releaseFruit(
        state,
        data,
        fruit,
        tick,
        `It was eaten by ${p.entity.name}, who already had a fruit`,
        env.rng,
      );
      die(withCause(env, 'sys:fruit'), 'eating a second Devil Fruit');
      return;
    }
    // The anomaly: a second power (canon: Blackbeard). The second fruit's record replaces the
    // first on the sheet; both fruits name this body as their user.
    setUser(state, data, fruit, p.entity, {
      tick,
      text: `${p.entity.name} ate it, a second fruit.`,
      identified,
      keepOther: true,
    });
    return;
  }
  const rules = data.powers.fruit;
  setUser(state, data, fruit, p.entity, {
    tick,
    text: `${p.entity.name} ate it.`,
    identified,
    discovery: env.rng.fork('discover').int(rules.discoveryMonths.min, rules.discoveryMonths.max),
  });
  const record = p.c.powers?.fruit;
  if (!record) return;
  if (def.zoan === 'artificial' && !env.rng.fork('smile').chance(rules.smileWorks)) {
    record.dud = true;
    record.identified = true;
    record.knownAt = tick;
    powers.moves = powers.moves.filter((m) => m.source !== 'fruit');
    for (const id of Object.keys(powers.tracks))
      if (data.tracks[id]?.family === 'fruit') delete powers.tracks[id];
    giveTraitTo(data, p.entity, 'trait_only_smile', 'A SMILE that failed', tick);
    tell(powerCtxOf(env), line(data, 'smileDud'), { title: def.name }, ['fruit'], 'bad');
    return;
  }
  tell(powerCtxOf(env), line(data, identified ? 'ateKnown' : 'ateUnknown'), { title: nameOrNot }, [
    'fruit',
  ]);
  if (env.p.c.life)
    env.p.c.life.deeds.push({
      tick,
      text: `Ate ${identified ? `the ${def.name}` : 'a Devil Fruit'}.`,
    });
}

/** Learn which fruit a carried (or eaten) fruit is: the encyclopedia, or a scholar. */
export function identifyFruit(
  env: LifeEnv,
  fruitId: string,
  how: 'encyclopedia' | 'scholar',
): void {
  const { state, data, p, tick } = env;
  const powers = ensurePowers(p.c);
  const fruit = state.entities[fruitId];
  const def = fruitDefOf(data, fruit);
  if (!def) throw new Error('That is not a Devil Fruit');
  const own = powers.fruit?.id === fruitId;
  if (!own && !powers.items.includes(fruitId)) throw new Error('You do not have that fruit');
  if (how === 'encyclopedia') {
    const book = powers.items.find(
      (id) => state.entities[id]?.flags['item.kind'] === 'encyclopedia',
    );
    if (!book) throw new Error(`You need the ${data.powers.fruit.encyclopedia.name}`);
  } else {
    if (p.place.atSea || !p.place.features.includes('library'))
      throw new Error('No scholar here: it takes a library');
    const fee = data.powers.fruit.identifyFee;
    if (p.c.berries < fee) throw new Error(`The scholar wants ${formatBerries(fee)} Berries`);
    pay(env, -fee);
  }
  powers.known[fruitId] = { tick, place: null, userId: own ? p.entity.id : null, identified: true };
  if (own && powers.fruit) {
    powers.fruit.identified = true;
    powers.fruit.knownAt = Math.min(powers.fruit.knownAt ?? tick, tick);
  }
  tell(powerCtxOf(env), line(data, 'identified'), { title: def.name }, ['fruit']);
}

/** After eating an unknown fruit: months of discoveries, then understanding. */
export function discoveryMonth(env: LifeEnv): void {
  const { state, data, p, tick } = env;
  const record = p.c.powers?.fruit;
  if (!record || record.dud || record.identified) return;
  const fruit = state.entities[record.id];
  const def = fruitDefOf(data, fruit);
  if (!def) return;
  if (record.knownAt !== null && tick >= record.knownAt) {
    record.identified = true;
    ensurePowers(p.c).known[record.id] = {
      tick,
      place: null,
      userId: p.entity.id,
      identified: true,
    };
    tell(powerCtxOf(env), line(data, 'discovered'), { title: def.name }, ['fruit']);
    return;
  }
  const text = renderLife(env, line(data, 'discovering'), {
    title: def.description.replace(/\.$/, '').replace(/^The user /, 'you '),
  });
  lifeLog(env, text, { tags: ['personal', 'power', 'fruit'] });
  reportLine(env, text, 'plain');
}

/** Their fruit's deeper truth (an event chain's end): another name, a new branch of techniques. */
export function revealSecret(env: LifeEnv): void {
  const { state, data, p, tick } = env;
  const record = p.c.powers?.fruit;
  if (!record || record.dud || record.secret) return;
  const def = fruitDefOf(data, state.entities[record.id]);
  if (!def?.secret) return;
  record.secret = true;
  learnFruitTechniques(data, p.entity, tick, state);
  tell(powerCtxOf(env), line(data, 'secret'), { title: def.secret.name, other: def.secret.text }, [
    'fruit',
  ]);
}

/** In the sea or touching seastone: a fruit user loses most of every stat while it lasts. */
export function curse(env: LifeEnv, until: number, seastone = false): void {
  const { state, data, p } = env;
  if (!isFruitUser(state, p.entity)) return;
  const source = seastone ? SEASTONE_SOURCE : CURSE_SOURCE;
  for (const id of STAT_IDS) {
    if (id === 'luck') continue;
    const stat = p.entity.stats[id];
    if (!stat) continue;
    const existing = stat.mods.find((m) => m.source === source);
    if (existing) existing.expiresTick = Math.max(existing.expiresTick ?? until, until);
    else
      addMod(stat, { source, value: data.powers.fruit.cursePct, kind: 'pct', expiresTick: until });
  }
}

/** Whether the curse holds them now (they cannot use the fruit). */
export function cursedNow(entity: Entity, tick: number): boolean {
  const stat = entity.stats['strength'];
  return (stat?.mods ?? []).some(
    (m) =>
      (m.source === CURSE_SOURCE || m.source === SEASTONE_SOURCE) &&
      (m.expiresTick ?? Infinity) > tick,
  );
}

/**
 * A fruit user goes overboard: the sea takes everything, so they sink. With anyone aboard to dive
 * after them (hired hands, shipmates, a Fish-Man), they are hauled out half-drowned; alone, they
 * drown. Returns true when the overboard was a fruit user's (and has been dealt with).
 */
export function fruitUserOverboard(env: LifeEnv, crewAboard: number): boolean {
  const { state, data, p, tick } = env;
  if (!isFruitUser(state, p.entity)) return false;
  curse(env, tick + 1);
  const ctx = powerCtxOf(env);
  if (crewAboard <= 0) {
    tell(ctx, line(data, 'sankAlone'), {}, ['fruit', 'voyage'], 'alert');
    die(
      withCause(env, 'sys:overboard'),
      'drowned, a Devil Fruit user with nobody to dive after them',
    );
    return true;
  }
  tell(ctx, line(data, 'sankRescued'), {}, ['fruit', 'voyage'], 'bad');
  if (env.rng.fork('rescue', 'hurt').chance(0.35)) {
    injure(withCause(env, 'sys:overboard', undefined, env.rng.fork('hurt')), {
      severity: 'minor',
      area: 'torso',
      cause: 'accident',
    });
  } else {
    hurt(withCause(env, 'sys:overboard'), 0.15, 'accident', 'the sea');
  }
  return true;
}

// ---- Finding, buying, rumours ---------------------------------------------------------------

/** Fruits for sale on the black market here. */
export function marketHere(state: WorldState, placeId: string): Entity[] {
  return fruitEntities(state).filter(
    (e) => e.fruit?.container === 'market' && e.fruit.place === placeId,
  );
}

export function buyFruit(env: LifeEnv, fruitId: string): void {
  const { state, data, p, tick } = env;
  const fruit = state.entities[fruitId];
  const f = fruit?.fruit;
  if (!fruit || !f || f.container !== 'market' || f.place !== p.place.id)
    throw new Error('That fruit is not for sale here');
  const price = f.price ?? 0;
  if (p.c.berries < price) throw new Error(`It costs ${formatBerries(price)} Berries`);
  pay(env, -price);
  carryFruit(state, fruit, p.entity, tick, `Bought on the black market by ${p.entity.name}.`);
  tell(powerCtxOf(env), line(data, 'bought'), { amount: formatBerries(price) }, ['fruit', 'money']);
}

/** An event gives a fruit: a named canon one if free, else a wild one here, else a new one. */
export function findFruit(
  env: LifeEnv,
  options: { fruit?: string; rarity?: FruitDef['rarity'] },
): Entity | null {
  const { state, data, p, tick } = env;
  let fruit: Entity | undefined;
  if (options.fruit) {
    const named = state.entities[options.fruit];
    if (named?.fruit && named.fruit.container !== 'eaten' && named.fruit.container !== 'held')
      fruit = named;
  }
  if (!fruit && !p.place.atSea) {
    fruit = fruitEntities(state).find(
      (e) =>
        e.fruit?.place === p.place.id &&
        ['tree', 'unknown', 'chest', 'sea'].includes(e.fruit.container) &&
        !reserved(state, fruitDefOf(data, e), e.fruit),
    );
  }
  if (!fruit) {
    fruit = makeGeneratedFruit(
      state,
      data,
      tick,
      env.rng.fork('newfruit'),
      undefined,
      p.place.culture.id,
    );
    if (options.rarity && fruit.fruit?.def) fruit.fruit.def.rarity = options.rarity;
  }
  carryFruit(state, fruit, p.entity, tick, `Found by ${p.entity.name}.`);
  tell(
    powerCtxOf(env),
    line(data, 'foundFruit'),
    { title: fruit.fruit?.look ?? 'a swirled fruit' },
    ['fruit'],
  );
  return fruit;
}

/** A rumour: about a real fruit out there (where it lies, or its price), or nothing true at all. */
export function hearRumour(env: LifeEnv): void {
  const { state, data, p, tick, rng } = env;
  const powers = ensurePowers(p.c);
  const out = fruitEntities(state).filter((e) => {
    const f = e.fruit;
    return (
      f &&
      f.place &&
      ['tree', 'market', 'chest', 'unknown'].includes(f.container) &&
      !reserved(state, fruitDefOf(data, e), f)
    );
  });
  const real =
    out.length > 0 && rng.fork('true?').chance(0.55) ? rng.fork('which').pick(out) : null;
  const places = locations(data, withDevFixtures(state)).filter((l) => l.population !== 'none');
  const placeId = real?.fruit?.place ?? rng.fork('where').pick(places).id;
  const name = real
    ? rng.fork('named?').chance(0.5)
      ? (fruitDefOf(data, real)?.name ?? 'a Devil Fruit')
      : 'a Devil Fruit'
    : rng.fork('fake').pick(Object.values(data.fruits)).name;
  powers.rumours.push({ tick, fruitId: real?.id ?? null, name, place: placeId });
  if (powers.rumours.length > 20) powers.rumours.splice(0, powers.rumours.length - 20);
  const text = renderLife(env, line(data, 'rumour'), {
    title: name,
    destination: data.locations[placeId]?.name ?? placeId,
  });
  lifeLog(env, text, { tags: ['personal', 'fruit', 'rumour'] });
  reportLine(env, text, 'plain');
}

/** A Devil Fruit carried by the dead passes with their Berries (it is a thing, not a power). */
export function passCarriedFruits(
  state: WorldState,
  dead: Entity,
  heir: Entity,
  tick: number,
): number {
  const items = [...(dead.character?.powers?.items ?? [])];
  let passed = 0;
  for (const id of items) {
    const item = state.entities[id];
    if (item?.fruit) {
      carryFruit(state, item, heir, tick, `Passed to ${heir.name} on ${dead.name}'s death.`);
      passed += 1;
    } else if (item && heir.character) {
      const powers = ensurePowers(heir.character);
      if (!powers.items.includes(id)) powers.items.push(id);
      passed += 1;
    }
  }
  return passed;
}

export { canonIndex };
