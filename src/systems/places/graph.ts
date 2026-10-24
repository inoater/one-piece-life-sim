import type { GameData, Lane, Location } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';

/**
 * The world map as a graph (Phase 3): places are nodes, sea lanes are edges. Everything here reads
 * data only (and one world flag), so the planner, the canon layer and the news all agree on what
 * is next to what and how far it is.
 *
 * Dev fixtures (places and lanes tagged "dev") exist only in worlds made with the dev fixtures.
 */

export function withDevFixtures(state: Pick<WorldState, 'flags'>): boolean {
  return state.flags['dev.fixtures'] === true;
}

export function isDev(item: { tags: readonly string[] }): boolean {
  return item.tags.includes('dev');
}

export function locationOf(data: GameData, id: string): Location | undefined {
  return data.locations[id];
}

/** The places of the world, in id order (dev fixtures only when asked). */
export function locations(data: GameData, dev = false): Location[] {
  return Object.values(data.locations)
    .filter((l) => dev || !isDev(l))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface Edge {
  lane: Lane;
  /** The place at the far end. */
  to: string;
}

interface GraphCache {
  out: Map<string, Edge[]>;
  outDev: Map<string, Edge[]>;
  /** Every lane both ways, one-way or not: for distances, which news and fate ignore direction in. */
  both: Map<string, Edge[]>;
  /** Region -> regions a lane joins it to. */
  near: Map<string, Set<string>>;
}

const caches = new WeakMap<GameData, GraphCache>();

function graph(data: GameData): GraphCache {
  let cache = caches.get(data);
  if (cache) return cache;
  const out = new Map<string, Edge[]>();
  const outDev = new Map<string, Edge[]>();
  const both = new Map<string, Edge[]>();
  const near = new Map<string, Set<string>>();
  const push = (map: Map<string, Edge[]>, from: string, edge: Edge) => {
    const list = map.get(from) ?? [];
    list.push(edge);
    map.set(from, list);
  };
  const lanes = Object.values(data.lanes).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const lane of lanes) {
    const forward = { lane, to: lane.to };
    const back = { lane, to: lane.from };
    push(outDev, lane.from, forward);
    if (!lane.oneWay) push(outDev, lane.to, back);
    push(both, lane.from, forward);
    push(both, lane.to, back);
    const dev =
      isDev(lane) ||
      isDev(data.locations[lane.from] ?? { tags: [] }) ||
      isDev(data.locations[lane.to] ?? { tags: [] });
    if (!dev) {
      push(out, lane.from, forward);
      if (!lane.oneWay) push(out, lane.to, back);
      const a = data.locations[lane.from]?.region;
      const b = data.locations[lane.to]?.region;
      if (a && b && a !== b) {
        if (!near.has(a)) near.set(a, new Set());
        if (!near.has(b)) near.set(b, new Set());
        near.get(a)?.add(b);
        near.get(b)?.add(a);
      }
    }
  }
  cache = { out, outDev, both, near };
  caches.set(data, cache);
  return cache;
}

/** Lanes leaving a place, in lane id order. */
export function lanesFrom(data: GameData, placeId: string, dev = false): Edge[] {
  return (dev ? graph(data).outDev : graph(data).out).get(placeId) ?? [];
}

/** The lane between two places in this direction, if any. */
export function laneBetween(
  data: GameData,
  from: string,
  to: string,
  dev = true,
): Lane | undefined {
  return lanesFrom(data, from, dev).find((e) => e.to === to)?.lane;
}

/** The sea a lane crosses: its zone, or the region it starts in. */
export function laneZone(data: GameData, lane: Lane): string {
  return lane.zone ?? data.locations[lane.from]?.region ?? 'east_blue';
}

/**
 * Shortest sea distance between two places in miles, following lanes either way and ignoring what
 * they require (a role-holder in the canon layer, or news, gets through regardless). Infinity when
 * there is no route.
 */
export function shortestMiles(data: GameData, from: string, to: string): number {
  if (from === to) return 0;
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let at: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        at = id;
      }
    }
    if (at === null) return Infinity;
    if (at === to) return best;
    done.add(at);
    for (const edge of graph(data).both.get(at) ?? []) {
      const next = best + edge.lane.miles;
      if (next < (dist.get(edge.to) ?? Infinity)) dist.set(edge.to, next);
    }
  }
}

/** Whether two seas are joined by at least one lane. */
export function regionsNear(data: GameData, a: string, b: string): boolean {
  return graph(data).near.get(a)?.has(b) ?? false;
}

/** Months news takes to travel from one place to another (world.json `news.delay`). */
export function newsDelay(data: GameData, from: string | null | undefined, to: string): number {
  const d = data.world.news.delay;
  if (!from) return 0;
  if (from === to) return d.place;
  const a = data.locations[from]?.region;
  const b = data.locations[to]?.region;
  if (!a || !b) return d.far;
  if (a === b) return d.region;
  return regionsNear(data, a, b) ? d.near : d.far;
}
