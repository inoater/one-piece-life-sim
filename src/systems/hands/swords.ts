import type { GameData, Weapon } from '../../engine/data/schemas';
import type { SwordGrade } from '../../engine/data/defs';
import { tickOfWhen } from '../../engine/data/defs';
import { entityIds } from '../../engine/entities';
import { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { worldBuilt } from '../places/setup';
import { locationIdOf } from '../places/place';
import {
  carried,
  destroyItem,
  ensureHands,
  exists,
  giveItem,
  makeItem,
  placeItem,
  syncGear,
} from './items';
import { buildCaches } from './treasure';

/**
 * The world's blades (Phase 6): every canon weapon is one entity whose holders follow the story
 * by date (keyframes in data/weapons, `approx` where the manga is vague), and every graded sword
 * canon counts but never names is made once, with a name of its own, when the world is built. A
 * grade's count can never be exceeded: swords are moved, sold, lost and destroyed, never copied.
 * When a holder dies their weapons are left where they fell, and in time a dealer picks them up.
 */

export const HANDS_BUILT_FLAG = 'hands.built';

export function handsBuilt(state: WorldState): boolean {
  return state.flags[HANDS_BUILT_FLAG] === true;
}

function templateFor(data: GameData, grade: SwordGrade): Weapon | undefined {
  return Object.values(data.weapons).find((w) => w.template && w.grade === grade);
}

/** A name for a generated graded sword, never one already in use. */
function swordName(data: GameData, rng: Rng, taken: Set<string>): string {
  const n = data.hands.swords.names;
  for (let i = 0; i < 40; i++) {
    const r = rng.fork('name', i);
    const name = r.chance(0.35) ? r.pick(n.single) : `${r.pick(n.first)}${r.pick(n.second)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(n.first)}${rng.pick(n.second)} ${taken.size}`;
  taken.add(fallback);
  return fallback;
}

/** A Tier 2 person who might carry a graded sword (a swordsman, a samurai, a hunter). */
function candidateHolders(state: WorldState, data: GameData): Entity[] {
  const occs = new Set(data.hands.swords.occupations);
  const out: Entity[] = [];
  for (const id of entityIds(state)) {
    const e = state.entities[id];
    const c = e?.character;
    if (!e || !c?.alive || e.origin !== 'generated' || !c.npc) continue;
    if (c.occupation && occs.has(c.occupation)) out.push(e);
  }
  return out;
}

/** Build the world's blades and treasure (once per world, with the world layer). */
export function buildHandsLayer(state: WorldState, data: GameData, tick: number, rng: Rng): void {
  if (handsBuilt(state)) return;
  state.flags[HANDS_BUILT_FLAG] = true;
  const taken = new Set<string>(Object.values(data.weapons).map((w) => w.name));
  // Canon weapons: one entity each, placed where the story has them now.
  for (const w of Object.values(data.weapons).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!w.canon) continue;
    const item = makeItem(state, data, {
      defId: w.id,
      origin: 'canon',
      container: 'collection',
      holderName: 'unknown',
      tick,
      story: w.description ?? w.name,
      extra: { canonNext: 0 },
    });
    applyCanonFrames(state, data, item, tick);
  }
  // The graded swords canon counts but does not name.
  const holders = candidateHolders(state, data);
  const places = Object.entries(data.hands.swords.places).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const counts: [SwordGrade, number][] = [];
  for (const grade of ['supreme', 'great', 'skillful'] as const) {
    const cap = data.hands.grades[grade].count ?? 0;
    const canon = Object.values(data.weapons).filter((w) => w.canon && w.grade === grade).length;
    counts.push([grade, Math.max(0, cap - canon)]);
  }
  counts.push(['graded', data.hands.swords.graded]);
  for (const [grade, count] of counts) {
    const template = templateFor(data, grade);
    if (!template) continue;
    const price = data.hands.grades[grade].price;
    for (let i = 0; i < count; i++) {
      const r = rng.fork('sword', grade, i);
      const name = swordName(data, r, taken);
      const cursed = r.fork('curse?').chance(data.hands.swords.curseChance);
      const curse = cursed
        ? r.fork('curse').pick(['misfortune', 'bloodthirst', 'haunting'] as const)
        : null;
      const quality = Math.min(100, Math.max(0, template.quality + r.fork('q').int(-6, 6)));
      const place = r.fork('place').weightedPick(places, ([, w]) => w)?.[0] ?? 'loc_wano';
      const roll = r.fork('where').float(0, 1);
      // The best blades are mostly in collections; lesser ones in shops and in swordsmen's hands.
      const heldShare = grade === 'supreme' ? 0 : grade === 'great' ? 0.15 : 0.35;
      const holder = holders.length > 0 && roll < heldShare ? r.fork('holder').pick(holders) : null;
      const container =
        holder !== null
          ? 'held'
          : grade === 'supreme'
            ? roll < 0.7
              ? 'collection'
              : 'ruins'
            : roll < 0.55
              ? 'market'
              : roll < 0.8
                ? 'collection'
                : 'ruins';
      const item = makeItem(state, data, {
        defId: template.id,
        name,
        origin: 'generated',
        container,
        holder,
        place: holder ? null : place,
        price: container === 'market' ? r.fork('price').int(price.min, price.max) : null,
        quality,
        grade,
        tick,
        story: `${name}, a blade of the ${data.hands.grades[grade].name}, made long ago by a smith whose name is half forgotten.`,
        ...(curse ? { extra: { curse: { id: curse, tamed: false, checks: 0 } } } : {}),
      });
      if (container === 'collection' && item.item) item.item.holderName = 'a collector';
    }
  }
  buildCaches(state, data, tick, rng.fork('caches'));
}

/** The keyframe a canon weapon should be at by `tick` (the latest that has begun), or -1. */
function frameAt(w: Weapon, tick: number): number {
  let at = -1;
  w.canon?.holders.forEach((h, i) => {
    if (tickOfWhen(h.from) <= tick) at = i;
  });
  return at;
}

/** Put a canon weapon where the story has it by now (unless someone took it off the story). */
export function applyCanonFrames(
  state: WorldState,
  data: GameData,
  item: Entity,
  tick: number,
): void {
  const b = item.item;
  const w = data.weapons[b?.defId ?? ''];
  if (!b || !w?.canon || (b.canonNext ?? -1) < 0 || !exists(item)) return;
  // Taken by the player, or by anyone the story does not name: off the story for good.
  if (b.holderId) {
    const holder = state.entities[b.holderId];
    const named = w.canon.holders.some((h) => h.holder === b.holderId);
    if (b.holderId === state.playerId || (holder && !named)) {
      b.canonNext = -1;
      return;
    }
  }
  if (w.canon.destroyed && tickOfWhen(w.canon.destroyed) <= tick) {
    destroyItem(state, data, item, tick, w.canon.destroyedText ?? `${item.name} was destroyed.`);
    b.canonNext = -1;
    return;
  }
  const at = frameAt(w, tick);
  if (at < 0 || at < (b.canonNext ?? 0) - 1) return;
  if (at === (b.canonNext ?? 0) - 1) return;
  const frame = w.canon.holders[at];
  if (!frame) return;
  b.canonNext = at + 1;
  const holder = frame.holder ? state.entities[frame.holder] : undefined;
  if (holder?.character?.alive) {
    giveItem(state, data, item, holder, tick, `In the hands of ${holder.name}.`);
    return;
  }
  const castName = frame.holder ? data.cast[frame.holder]?.name : undefined;
  const fallen = holder?.character && !holder.character.alive;
  placeItem(
    state,
    data,
    item,
    {
      place:
        frame.place ?? (fallen && holder?.character ? locationIdOf(data, holder.character) : null),
      container: frame.container ?? (fallen ? 'lying' : frame.place ? 'held' : 'collection'),
      price: frame.price ?? null,
      holderName: frame.holderName ?? castName ?? null,
    },
    tick,
    frame.holderName ? `With ${frame.holderName}.` : undefined,
  );
  // "Held" by someone the world does not simulate: kept as lying with their name on it.
  if (b.container === 'held' && !b.holderId) b.container = 'lying';
}

/**
 * The world's month for blades: canon weapons follow the story; unclaimed blades lying where
 * someone fell are picked up by a dealer after half a year.
 */
export function swordsMonth(state: WorldState, data: GameData, tick: number, rng: Rng): void {
  for (const id of entityIds(state)) {
    const e = state.entities[id];
    const b = e?.item;
    if (!e || !b || b.container === 'destroyed') continue;
    if ((b.canonNext ?? -1) >= 0) {
      applyCanonFrames(state, data, e, tick);
      continue;
    }
    if (b.container === 'lying' && b.family && b.place && (b.grade ?? 'ungraded') !== 'ungraded') {
      const since = b.history.at(-1)?.tick ?? tick;
      if (tick - since >= 6) {
        const price = data.hands.grades[b.grade ?? 'graded']?.price;
        placeItem(
          state,
          data,
          e,
          {
            place: b.place,
            container: 'market',
            price: price ? rng.fork('dealer', e.id).int(price.min, price.max) : 100000,
          },
          tick,
          `Picked up by a dealer at ${data.locations[b.place]?.name ?? 'a port'}.`,
        );
      }
    }
  }
}

/** Whoever dies leaves their weapons and gear where they fell (the player's pass to an heir). */
export function releaseItemsOf(
  state: WorldState,
  data: GameData,
  dead: Entity,
  tick: number,
): void {
  const hands = dead.character?.hands;
  if (!hands || hands.items.length === 0) return;
  const place = dead.character ? locationIdOf(data, dead.character) : null;
  for (const item of carried(state, dead)) {
    placeItem(
      state,
      data,
      item,
      { place, container: place ? 'lying' : 'sunken' },
      tick,
      `Left where ${dead.name} fell${place ? ` at ${data.locations[place]?.name ?? 'a port'}` : ', at sea'}.`,
    );
  }
}

/** The things a dead player carried pass to their heir. Returns how many. */
export function passItems(
  state: WorldState,
  data: GameData,
  dead: Entity,
  heir: Entity,
  tick: number,
): number {
  let n = 0;
  for (const item of carried(state, dead)) {
    giveItem(state, data, item, heir, tick, `Inherited by ${heir.name} from ${dead.name}.`);
    n += 1;
  }
  const from = dead.character?.hands;
  if (from && Object.keys(from.cargo).length > 0) {
    const to = ensureHands(heir);
    for (const [good, qty] of Object.entries(from.cargo))
      to.cargo[good] = (to.cargo[good] ?? 0) + qty;
    for (const [good, paid] of Object.entries(from.paid))
      to.paid[good] = (to.paid[good] ?? 0) + paid;
    from.cargo = {};
    from.paid = {};
  }
  syncGear(state, data, heir);
  return n;
}

/**
 * Give a world built before Phase 6 its blades and treasure, and turn a player's old gear (bought
 * as counts in Phase 4) into items: the first month it runs.
 */
export function ensureHandsLayer(state: WorldState, data: GameData): boolean {
  if (!worldBuilt(state)) return false;
  let changed = false;
  if (!handsBuilt(state)) {
    buildHandsLayer(state, data, state.tick, Rng.root(state.seed).fork('hands-layer'));
    changed = true;
  }
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const c = player?.character;
  if (player && c && !c.hands) {
    ensureHands(player);
    for (const [id, n] of Object.entries(c.powers?.gear ?? {})) {
      if (!data.weapons[id]) continue;
      for (let i = 0; i < n; i++) {
        makeItem(state, data, {
          defId: id,
          origin: 'player',
          container: 'held',
          holder: player,
          tick: state.tick,
          story: `Bought by ${player.name} before anyone wrote it down.`,
        });
      }
    }
    syncGear(state, data, player);
    changed = true;
  }
  return changed;
}
