import type { GameData, Location } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import type { NewsDraft } from '../../engine/pipeline';
import { formatBerries } from '../genesis/text';
import { statTotal } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { shipHere } from '../voyage/plan';
import {
  carried,
  destroyItem,
  ensureHands,
  HandsError,
  itemOf,
  itemStory,
  makeItem,
} from './items';

/**
 * Treasure (Phase 6): caches buried on islands, sunk in wrecks and hidden in ruins, made with the
 * world (data/hands.json `treasure`) and real wealth in it: once dug up, a cache is gone, and
 * others dig too. Maps are true (the spot), partial (the right island) or fake. A month's treasure
 * hunt at a place searches with whatever maps point there, or on luck alone.
 */

const CACHE_NAMES = {
  buried: 'a buried chest',
  sunken: "a wreck's strongbox",
  ruins: 'a hoard in the ruins',
} as const;

/** Things a cache may hold besides its Berries. */
const CACHE_ITEMS = [
  'weapon_sabre',
  'weapon_nodachi',
  'weapon_rifle',
  'weapon_naginata',
  'item_flame_dial',
  'item_impact_dial',
  'item_navigator_kit',
  'item_seastone_net',
  'item_den_den_mushi',
];

export function isCache(item: Entity | undefined): boolean {
  return item?.item?.defId === 'cache';
}

/** Caches still in the world (not dug up). */
export function caches(state: WorldState): Entity[] {
  return Object.values(state.entities)
    .filter((e) => isCache(e) && e.item?.container !== 'destroyed')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function siteFor(
  data: GameData,
  regions: readonly string[],
  container: string,
  rng: Rng,
): Location | null {
  const pool = Object.values(data.locations)
    .filter((l) => regions.includes(l.region) && !l.id.includes('test'))
    .filter((l) => {
      const f = l.features as readonly string[];
      if (container === 'ruins') return f.includes('ruins');
      return f.includes('coast') || f.includes('deep_sea') || f.includes('clouds');
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return pool.length > 0 ? rng.pick(pool) : null;
}

/** Bury the world's caches (once, with the world layer). */
export function buildCaches(state: WorldState, data: GameData, tick: number, rng: Rng): void {
  const t = data.hands.treasure;
  t.caches.forEach((group, g) => {
    for (let i = 0; i < group.count; i++) {
      const r = rng.fork('cache', g, i);
      const container = r
        .fork('kind')
        .weightedPick(
          Object.entries(group.containers).filter(([, w]) => (w ?? 0) > 0) as [string, number][],
          ([, w]) => w,
        )?.[0] as keyof typeof CACHE_NAMES | undefined;
      if (!container) continue;
      const site = siteFor(data, group.regions, container, r.fork('site'));
      if (!site) continue;
      const contents = r.fork('item?').chance(group.item) ? r.fork('item').pick(CACHE_ITEMS) : null;
      makeItem(state, data, {
        defId: 'cache',
        name: CACHE_NAMES[container],
        container,
        place: site.id,
        tick,
        story: `Hidden at ${site.name}, long ago.`,
        extra: { value: r.fork('value').int(group.value.min, group.value.max), contents },
      });
    }
  });
  for (const canon of t.canon) {
    makeItem(state, data, {
      defId: 'cache',
      name: canon.name,
      origin: 'canon',
      container: canon.container,
      place: canon.place,
      tick,
      story: canon.text,
      extra: { value: canon.value, contents: null },
    });
  }
}

/** A treasure map comes into the person's hands: true, partial or fake by the odds. */
export function giveMap(env: LifeEnv, kind?: 'true' | 'partial' | 'fake'): Entity {
  const { state, data, p, tick, rng } = env;
  const odds = data.hands.treasure.maps;
  const mapKind =
    kind ??
    rng.fork('mapKind').weightedPick(
      [
        ['true', odds.true],
        ['partial', odds.partial],
        ['fake', odds.fake],
      ] as const,
      ([, w]) => w,
    )?.[0] ??
    'fake';
  const all = caches(state);
  let target: Entity | null = null;
  let site: string | null = null;
  if (mapKind !== 'fake' && all.length > 0) {
    target = rng.fork('mapTarget').pick(all);
    site = target.item?.place ?? null;
  }
  if (!site) {
    const places = Object.values(data.locations).filter((l) =>
      (l.features as readonly string[]).includes('coast'),
    );
    site = places.length > 0 ? rng.fork('mapSite').pick(places).id : null;
  }
  const where = site ? (data.locations[site]?.name ?? 'an island') : 'an island';
  const map = makeItem(state, data, {
    defId: 'item_treasure_map',
    name: `A map to ${where}`,
    container: 'held',
    holder: p.entity,
    tick,
    story: `Came to ${p.entity.name}.`,
    extra: {
      mapKind: target ? (mapKind as 'true' | 'partial') : 'fake',
      target: target?.id ?? null,
      contents: site,
    },
  });
  const text = renderLife(env, data.hands.lines['mapFound'] ?? '', {});
  lifeLog(env, text, { tags: ['personal', 'treasure'] });
  reportLine(env, text, 'good');
  return map;
}

/** Whether the person can reach a sunken cache: gills, a diving bell, or a coated ship moored here. */
export function canDive(state: WorldState, data: GameData, env: Pick<LifeEnv, 'p'>): boolean {
  const { p } = env;
  if (data.hands.treasure.divers.includes(p.c.race)) return true;
  if (carried(state, p.entity).some((i) => i.item?.defId === 'item_diving_bell')) return true;
  return shipHere(state, p)?.ship?.coated === true;
}

/** A month's treasure hunt where the person stands. Returns the cache found, if any. */
export function huntMonth(env: LifeEnv, scale: number, rng: Rng): Entity | null {
  const { state, data, p, tick } = env;
  const here = p.place.location?.id;
  if (!here || p.place.atSea) return null;
  const t = data.hands.treasure;
  const maps = carried(state, p.entity).filter(
    (i) => i.item?.defId === 'item_treasure_map' && i.item.contents === here,
  );
  const hands = ensureHands(p.entity);
  const sought = new Map<string, number>();
  for (const map of maps) {
    const b = map.item;
    if (!b) continue;
    if (b.mapKind === 'fake') {
      // Three months of searching where a fake map points and the truth sinks in.
      const key = `fake:${map.id}`;
      hands.tally[key] = (hands.tally[key] ?? 0) + 1;
      if ((hands.tally[key] ?? 0) >= 3) {
        delete hands.tally[key];
        destroyItem(state, data, map, tick, 'Proved a fake.');
        delete state.entities[map.id];
        reportLine(env, `The map to ${p.place.name} was a fake. You tore it up.`, 'bad');
      }
      continue;
    }
    const cache = itemOf(state, b.target);
    if (!cache || cache.item?.container === 'destroyed') continue;
    const chance = b.mapKind === 'true' ? t.find.true : t.find.partial;
    sought.set(cache.id, Math.max(sought.get(cache.id) ?? 0, chance));
  }
  // Luck and sharp eyes: any cache here, without a map.
  const eyes = Math.max(0.3, statTotal(p.entity, 'perception', tick) / 50);
  for (const cache of caches(state)) {
    if (cache.item?.place !== here) continue;
    sought.set(cache.id, Math.max(sought.get(cache.id) ?? 0, t.find.none * eyes));
  }
  for (const [id, base] of [...sought.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const cache = itemOf(state, id);
    if (!cache?.item) continue;
    if (cache.item.container === 'sunken' && !canDive(state, data, env)) continue;
    if (!rng.fork('find', id).chance(Math.min(0.97, base * scale))) continue;
    digUp(env, cache);
    return cache;
  }
  if (sought.size === 0 || maps.length > 0)
    reportLine(env, renderLife(env, data.hands.lines['treasureNothing'] ?? '', {}), 'plain');
  return null;
}

/** The cache is found: its Berries and whatever lay with it are yours, and it is gone. */
export function digUp(env: LifeEnv, cache: Entity): void {
  const { state, data, p, tick } = env;
  const b = cache.item;
  if (!b) return;
  const value = b.value ?? 0;
  pay(env, value);
  if (b.contents && (data.weapons[b.contents] || data.items[b.contents])) {
    makeItem(state, data, {
      defId: b.contents,
      container: 'held',
      holder: p.entity,
      tick,
      quality: 60,
      story: `Found in ${cache.name} at ${p.place.name}.`,
    });
  }
  destroyItem(state, data, cache, tick, `Dug up by ${p.entity.name}.`);
  for (const map of carried(state, p.entity)) {
    if (map.item?.defId === 'item_treasure_map' && map.item.target === cache.id) {
      destroyItem(state, data, map, tick, 'Its X has been dug up.');
      delete state.entities[map.id];
    }
  }
  const hands = ensureHands(p.entity);
  hands.tally['treasure'] = (hands.tally['treasure'] ?? 0) + 1;
  const text = renderLife(env, data.hands.lines['treasureFound'] ?? '', {
    item: cache.name,
    amount: formatBerries(value),
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'treasure', 'money', 'deed'] });
  reportLine(env, text, 'good');
  p.c.life?.deeds.push({ tick, text });
  itemStory(cache, tick, text);
}

/** Each year, others dig too: a cache may be found by someone else, and is gone (rich ones are news). */
export function cachesYear(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  news: NewsDraft[],
): void {
  if (tick % 12 !== 6) return;
  for (const cache of caches(state)) {
    if (!rng.fork('dig', cache.id).chance(data.hands.treasure.othersPerYear)) continue;
    const where = data.locations[cache.item?.place ?? '']?.name ?? 'an island';
    destroyItem(state, data, cache, tick, `Dug up by treasure hunters at ${where}.`);
    if ((cache.item?.value ?? 0) >= 5000000) {
      news.push({
        text: `Treasure hunters struck it rich at ${where}: ${cache.name}, worth ${formatBerries(cache.item?.value ?? 0)} Berries.`,
        tags: ['news', 'treasure'],
        ...(cache.item?.place ? { place: cache.item.place } : {}),
      });
    }
  }
}

/** Sell a treasure map in a market (true or not, dealers pay the same). Throws when nobody buys. */
export function mapWorth(data: GameData): number {
  return data.hands.treasure.mapPrice;
}

export { HandsError };
