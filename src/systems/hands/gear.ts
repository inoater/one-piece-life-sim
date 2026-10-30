import type { GameData } from '../../engine/data/schemas';
import { addMod } from '../../engine/stats';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { maxHealthOf, type Person } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { restore, speedHealing } from '../life/health';
import { locationIdOf } from '../places/place';
import { ageYears } from '../life/body';
import { carried, ensureHands, giveItem, HandsError, itemDefOf, itemOf, makeItem } from './items';
import { useUp } from './market';
import { moveAxis } from '../heart/bonds';

/**
 * Gear and inventions (Phase 6): things to use in a fight (dials, seastone nets, a stimulant),
 * meals and medicines with months of effect, Den Den Mushi to call the people you know, and Vivre
 * Cards that point to their owner and burn down as their life fades.
 */

/** What a person can use in a fight from what they carry: charges by item kind. */
export function battleKit(
  state: WorldState,
  data: GameData,
  entity: Entity,
): Record<string, number> {
  const kit: Record<string, number> = {};
  for (const item of carried(state, entity)) {
    const def = itemDefOf(data, item);
    if (!def?.battle) continue;
    const charges = item.item?.charges ?? 1;
    if (charges > 0) kit[def.id] = (kit[def.id] ?? 0) + charges;
  }
  return kit;
}

/**
 * After a fight: the charges used come off the things carried. A thing with no charges left that
 * never refills (a net, a dose) is used up; a dial waits to be refilled.
 */
export function spendKit(
  state: WorldState,
  data: GameData,
  entity: Entity,
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  tick: number,
): void {
  for (const [defId, had] of Object.entries(before)) {
    if (!defId.startsWith('item_')) continue;
    let used = Math.max(0, had - (after[defId] ?? 0));
    const def = data.items[defId];
    for (const item of carried(state, entity)) {
      if (used <= 0) break;
      if (item.item?.defId !== defId) continue;
      const charges = item.item.charges ?? 1;
      const take = Math.min(used, charges);
      used -= take;
      if (charges - take > 0 || (def?.kind === 'dial' && def.charges !== undefined)) {
        item.item.charges = charges - take;
      } else {
        item.item.charges = 1;
        useUp(state, data, item, tick);
      }
    }
  }
}

/** Dials that refill by themselves (sunlight, wind) take on a charge a month. */
export function rechargeMonth(state: WorldState, data: GameData, entity: Entity): void {
  for (const item of carried(state, entity)) {
    const def = itemDefOf(data, item);
    const b = item.item;
    if (!def || !b || def.recharge <= 0 || def.charges === undefined) continue;
    b.charges = Math.min(def.charges, (b.charges ?? 0) + def.recharge);
  }
}

/** An impact or reject dial soaks up the blows of a fight it saw: a charge back for each fight. */
export function absorbBlows(state: WorldState, data: GameData, entity: Entity): void {
  for (const item of carried(state, entity)) {
    const def = itemDefOf(data, item);
    const b = item.item;
    if (!def?.battle || !b || def.recharge > 0 || def.kind !== 'dial' || def.charges === undefined)
      continue;
    if (def.battle.effect === 'impact' || def.battle.effect === 'reject')
      b.charges = Math.min(def.charges, (b.charges ?? 0) + 1);
  }
}

/** How strongly a made thing works: a poor cook's meal does half, a master's half again. */
function strength(quality: number): number {
  return 0.5 + Math.max(0, Math.min(100, quality)) / 100;
}

/** Eat a meal or take a medicine you carry: its months of effect, Health back, a cure. */
export function useCarried(env: LifeEnv, itemId: string): void {
  const { state, data, p, tick } = env;
  const item = itemOf(state, itemId);
  const def = itemDefOf(data, item);
  if (!item || !def || item.item?.holderId !== p.entity.id)
    throw new HandsError('You do not carry that');
  const effect = def.effect;
  if (!effect) throw new HandsError(`${def.name} is not something you eat or take`);
  const k = strength(item.item?.quality ?? 50);
  const source = `${def.name} (${def.kind === 'meal' ? 'meal' : 'medicine'})`;
  for (const mod of effect.statMods) {
    const stat = p.entity.stats[mod.stat];
    if (stat)
      addMod(stat, {
        source,
        value: Math.round(mod.value * k * 10) / 10,
        kind: mod.kind,
        expiresTick: tick + effect.months,
      });
  }
  if (effect.heal > 0) restore(env, effect.heal * k);
  if (effect.speedsHealing > 0) speedHealing(env, effect.speedsHealing);
  if (effect.cures) env.life.illnesses = env.life.illnesses.filter((i) => i.healTick <= tick);
  ensureHands(p.entity).last[def.kind] = tick;
  const text = renderLife(env, data.hands.lines['meal'] ?? '', { item: def.name.toLowerCase() });
  lifeLog(env, text, { tags: ['personal', def.kind === 'meal' ? 'meal' : 'health'] });
  reportLine(env, text, 'good');
  useUp(state, data, item, tick);
}

// ---- Den Den Mushi ------------------------------------------------------------------------------

/** People you can call: everyone you know who is alive, and numbers you were given. */
export function callable(state: WorldState, p: Person): Entity[] {
  const ids = new Set<string>([
    ...p.c.relationships.map((r) => r.id),
    ...(p.c.hands?.contacts ?? []),
  ]);
  return [...ids]
    .sort()
    .map((id) => state.entities[id])
    .filter((e): e is Entity => !!e?.character?.alive && e.id !== p.entity.id);
}

export function hasSnail(state: WorldState, data: GameData, entity: Entity): boolean {
  return carried(state, entity).some(
    (i) => itemDefOf(data, i)?.kind === 'den_den' && !itemDefOf(data, i)?.storyLocked,
  );
}

/**
 * Ring someone on the Den Den Mushi (Phase 7 will make it a conversation): an hour's talk warms
 * them a little, once a month each, and whatever news their harbour has reaches you now.
 */
export function call(env: LifeEnv, targetId: string): void {
  const { state, data, p, tick } = env;
  if (!hasSnail(state, data, p.entity)) throw new HandsError('You need a Den Den Mushi');
  const other = callable(state, p).find((e) => e.id === targetId);
  if (!other) throw new HandsError('You do not have their number');
  const hands = ensureHands(p.entity);
  const key = `call:${other.id}`;
  const last = hands.last[key];
  if (last !== undefined && tick - last < data.hands.calls.everyMonths)
    throw new HandsError(`You already called ${other.name} this month`);
  hands.last[key] = tick;
  const there = other.character ? locationIdOf(data, other.character) : null;
  if (there) {
    for (const item of state.news) {
      if (item.place === there && (item.reachTick === null || (item.reachTick ?? 0) > tick))
        item.reachTick = tick;
    }
  }
  const text = renderLife(env, data.hands.lines['called'] ?? '', { other: other.name });
  const record = lifeLog(env, text, { tags: ['personal', 'relationship'], others: [other.id] });
  reportLine(env, text, 'plain');
  // Phase 7: a call is a talk at a distance: warmth on both sides, traced to the call.
  const theirs = other.character?.relationships.find((r) => r.id === p.entity.id);
  if (theirs)
    moveAxis(data, theirs, 'affection', data.hands.calls.opinion, 'Calls', record.seq, tick);
  const mine = p.c.relationships.find((r) => r.id === other.id);
  if (mine)
    moveAxis(data, mine, 'affection', data.hands.calls.opinion / 2, 'Calls', record.seq, tick);
  if (theirs) theirs.lastSeen = tick;
}

// ---- Vivre Cards --------------------------------------------------------------------------------

/** Someone who would tear you a scrap of their card: they know you well, and think well of you. */
export function vivreLock(
  env: Pick<LifeEnv, 'state' | 'data' | 'p'>,
  targetId: string,
): string | null {
  const { state, data, p } = env;
  const here = p.place.location?.id;
  if (!here || !data.hands.vivre.places.includes(here))
    return `Vivre Cards are made only in the New World (${data.hands.vivre.places.map((id) => data.locations[id]?.name ?? id).join(', ')})`;
  const other = state.entities[targetId];
  if (!other?.character?.alive) return 'They are not alive';
  const theirs = other.character.relationships.find((r) => r.id === p.entity.id);
  const opinion = theirs
    ? theirs.opinion.base +
      theirs.opinion.mods.reduce((s, m) => s + (m.kind === 'flat' ? m.value : 0), 0)
    : 0;
  if (opinion < data.hands.vivre.opinion) return `${other.name} does not trust you with that yet`;
  if (
    carried(state, p.entity).some(
      (i) => i.item?.defId === 'item_vivre_card' && i.item.target === targetId,
    )
  )
    return 'You already have their card';
  if (p.c.berries < data.hands.vivre.cost)
    return `The paper costs ${formatBerries(data.hands.vivre.cost)} Berries`;
  return null;
}

export function getVivreCard(env: LifeEnv, targetId: string): Entity {
  const { state, data, p, tick } = env;
  const lock = vivreLock(env, targetId);
  if (lock) throw new HandsError(lock);
  const other = state.entities[targetId] as Entity;
  pay(env, -data.hands.vivre.cost);
  const card = makeItem(state, data, {
    defId: 'item_vivre_card',
    name: `${other.name}'s Vivre Card`,
    origin: 'player',
    container: 'held',
    holder: p.entity,
    tick,
    story: `Torn from ${other.name}'s card for ${p.entity.name}.`,
    extra: { target: other.id },
  });
  const text = renderLife(env, data.hands.lines['vivreGot'] ?? '', { other: other.name });
  lifeLog(env, text, { tags: ['personal', 'relationship'], others: [other.id] });
  reportLine(env, text, 'good');
  return card;
}

export interface VivreReading {
  name: string;
  /** Where it creeps toward: a place, or the open sea. */
  toward: string;
  /** "steady", "burning low", "ashes". */
  burn: 'steady' | 'low' | 'ashes';
}

/** What a Vivre Card shows now: which way its owner is, and how their life burns. */
export function readVivre(state: WorldState, data: GameData, card: Entity): VivreReading | null {
  const target = state.entities[card.item?.target ?? ''];
  const c = target?.character;
  if (!target || !c) return null;
  if (!c.alive) return { name: target.name, toward: 'nowhere', burn: 'ashes' };
  const place = locationIdOf(data, c);
  const toward = place ? (data.locations[place]?.name ?? 'somewhere') : 'the open sea';
  let share = 1;
  if (c.life) share = c.life.health / Math.max(1, maxHealthOf(data, target, state.tick));
  const race = data.races[c.race];
  if (race) {
    const end = race.lifespan.min;
    if (ageYears(c, state.tick) > end * 0.95) share = Math.min(share, 0.3);
  }
  return { name: target.name, toward, burn: share < data.hands.vivre.low ? 'low' : 'steady' };
}

/** Things an event can put in someone's hands when it names nothing in particular. */
const FOUND_POOL = [
  'weapon_sword',
  'weapon_dagger',
  'weapon_sabre',
  'weapon_flintlock',
  'weapon_spear',
  'item_flame_dial',
  'item_breath_dial',
  'item_sea_charts',
  'item_tonic',
];

/**
 * Something comes into the person's hands (an event's `findItem`): the thing named, made new; an
 * unheld graded sword lying near here ("graded"), never a copy; or something ordinary.
 */
export function findSomething(env: LifeEnv, defId?: string, graded = false): Entity {
  const { state, data, p, tick, rng } = env;
  const where = p.place.atSea ? 'at sea' : `at ${p.place.name}`;
  let item: Entity | undefined;
  if (graded) {
    const region = p.place.region;
    const loose = Object.values(state.entities)
      .filter((e) => {
        const b = e.item;
        if (!b?.family || (b.grade ?? 'ungraded') === 'ungraded' || (b.canonNext ?? -1) >= 0)
          return false;
        if (!['lying', 'ruins', 'buried'].includes(b.container) || !b.place) return false;
        return data.locations[b.place]?.region === region;
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const pick = loose.length > 0 ? rng.fork('graded').pick(loose) : undefined;
    if (pick) {
      giveItem(state, data, pick, p.entity, tick, `Found by ${p.entity.name} ${where}.`);
      item = pick;
    }
  }
  if (!item) {
    const id =
      defId && (data.weapons[defId] || data.items[defId])
        ? defId
        : rng.fork('found').pick(FOUND_POOL);
    item = makeItem(state, data, {
      defId: id,
      container: 'held',
      holder: p.entity,
      tick,
      quality: rng.fork('q').int(35, 65),
      story: `Found by ${p.entity.name} ${where}.`,
    });
  }
  const text = renderLife(env, data.hands.lines['found'] ?? '', {
    item: item.name.toLowerCase().startsWith('a ') ? item.name : `a ${item.name.toLowerCase()}`,
  });
  lifeLog(env, text, { tags: ['personal', 'gear'] });
  reportLine(env, text, 'good');
  return item;
}
