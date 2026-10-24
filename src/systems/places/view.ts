import { dateOf, formatDate } from '../../engine/calendar';
import { tickOfWhen, type GameData } from '../../engine/data/schemas';
import type { Entity, WorldState } from '../../engine/state';
import { describeBreakdown, statBreakdown, type BreakdownLine } from '../../engine/stats';
import { beatState, orderedBeats, windowOf } from '../canon/beats';
import { cutoffTick } from '../canon/cast';
import { FEATURE_LABEL, ensureLife, type Feature } from '../life/body';
import { newsHeard } from '../news';
import { localFlagActive } from '../story/world-effects';
import { titleOf } from '../story/roles';
import { opinionOf, orgEntities, strengthOf, territory } from '../factions';
import { REGION_NAMES, travelView, type RouteView } from '../voyage/view';
import { isDev, lanesFrom, locations, withDevFixtures } from './graph';
import { locationIdOf, prosperityOf, safetyOf } from './place';

/**
 * What the world screens show (Phase 3): the map's places and lanes, one place in detail, the
 * factions, and the canon timeline with its Divergence Log. Plain data for the page.
 */

const label = (data: GameData, tick: number) => formatDate(dateOf(data.calendar, tick));

export interface MapPlaceView {
  id: string;
  name: string;
  shortName: string;
  region: string;
  regionName: string;
  kind: string;
  x: number;
  y: number;
  danger: number;
  population: string;
  controller: string | null;
  here: boolean;
  visited: boolean;
  destination: boolean;
  /** A lane from where the player stands leads here. */
  reachable: boolean;
  epidemic: boolean;
  generated: boolean;
}

export interface MapLaneView {
  id: string;
  from: string;
  to: string;
  miles: number;
  danger: number;
  requires: string;
  current: string;
  oneWay: boolean;
  land: boolean;
}

export interface MapView {
  places: MapPlaceView[];
  lanes: MapLaneView[];
  here: string | null;
  voyage: null | { from: string; to: string; lane: string; progress: number; foot: boolean };
}

export function mapView(state: WorldState, data: GameData): MapView {
  const dev = withDevFixtures(state);
  const p = ensureLife(state, data);
  const c = p?.c ?? (state.playerId ? state.entities[state.playerId]?.character : undefined);
  const here = c && data.birthplaces[c.birthplace] ? locationIdOf(data, c) : null;
  const voyage = c?.travel?.voyage ?? null;
  const visited = new Set(c?.travel?.visited ?? (here ? [here] : []));
  const reachable = new Set(here ? lanesFrom(data, here, dev).map((e) => e.to) : []);
  const tick = state.tick;
  const places: MapPlaceView[] = locations(data, dev).map((loc) => {
    const controller = state.entities[loc.id]?.place?.controller ?? loc.controller;
    return {
      id: loc.id,
      name: loc.name,
      shortName: loc.shortName ?? loc.name,
      region: loc.region,
      regionName: REGION_NAMES[loc.region] ?? loc.region,
      kind: loc.kind,
      x: loc.map.x,
      y: loc.map.y,
      danger: loc.danger,
      population: loc.population,
      controller: controller
        ? (state.entities[controller]?.name ?? data.factions[controller]?.name ?? null)
        : null,
      here: loc.id === here,
      visited: visited.has(loc.id),
      destination: voyage?.to === loc.id,
      reachable: reachable.has(loc.id),
      epidemic: localFlagActive(state, loc.id, 'epidemic', tick),
      generated: loc.origin === 'generated',
    };
  });
  const lanes: MapLaneView[] = Object.values(data.lanes)
    .filter(
      (l) =>
        dev ||
        (!isDev(l) &&
          !isDev(data.locations[l.from] ?? { tags: [] }) &&
          !isDev(data.locations[l.to] ?? { tags: [] })),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((l) => ({
      id: l.id,
      from: l.from,
      to: l.to,
      miles: l.miles,
      danger: l.danger,
      requires: l.requires,
      current: l.current,
      oneWay: l.oneWay,
      land: l.land,
    }));
  return {
    places,
    lanes,
    here,
    voyage: voyage
      ? {
          from: voyage.from,
          to: voyage.to,
          lane: voyage.lane,
          progress: voyage.miles > 0 ? voyage.done / voyage.miles : 0,
          foot: voyage.mode === 'foot',
        }
      : null,
  };
}

const SAFETY_WORDS = {
  high: 'safe',
  medium: 'middling',
  low: 'dangerous',
  very_low: 'very dangerous',
} as const;

export interface PlaceDetailView {
  id: string;
  name: string;
  kind: string;
  regionName: string;
  climateName: string;
  description: string;
  generated: boolean;
  population: { tier: string; residents: number; named: number };
  wealth: string;
  danger: number;
  safety: string;
  prosperity: { value: number; description: string; lines: BreakdownLine[] };
  controller: { id: string; name: string } | null;
  features: string[];
  trades: { name: string; count: number }[];
  logPose: number | null;
  eternalPoses: string[];
  notables: { id: string; name: string; title: string }[];
  epidemic: boolean;
  news: { dateLabel: string; text: string }[];
  here: boolean;
  /** The player's voyage is bound here. */
  bound: boolean;
  visited: boolean;
  route: RouteView | null;
}

export function placeView(
  state: WorldState,
  data: GameData,
  id: string,
  omniscient = false,
): PlaceDetailView | null {
  const loc = data.locations[id];
  if (!loc) return null;
  const tick = state.tick;
  const entity = state.entities[id];
  const place = entity?.place;
  const controller = place?.controller ?? loc.controller;
  const residents = place
    ? place.residents.children + place.residents.adults + place.residents.elders
    : data.world.population.residents[loc.population];
  let named = 0;
  for (const e of Object.values(state.entities))
    if (e.character?.npc && e.character.alive && e.character.place === id) named += 1;
  const prosperity = place?.prosperity;
  const breakdown = prosperity ? statBreakdown(prosperity, tick) : null;
  const notables = Object.keys(data.cast)
    .sort()
    .map((cid) => state.entities[cid])
    .filter((e): e is Entity => {
      const c = e?.character;
      if (!e || !c?.alive || c.place !== id) return false;
      const status = e.flags['status'];
      return (
        omniscient ||
        (status !== 'hidden' && status !== 'imprisoned') ||
        loc.id === 'loc_impel_down'
      );
    })
    .map((e) => ({ id: e.id, name: e.name, title: titleOf(data, e) }));
  const travel = travelView(state, data);
  const route = travel?.routes.find((r) => r.to.id === id) ?? null;
  const visited = travel?.visited.includes(id) ?? false;
  const trades = Object.entries(place?.jobs ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([occ, count]) => ({ name: data.occupations[occ]?.name ?? occ, count }));
  const news = state.news
    .filter((n) => n.place === id && (omniscient || newsHeard(n, tick)))
    .slice(-5)
    .reverse()
    .map((n) => ({ dateLabel: label(data, n.tick), text: n.text }));
  return {
    id,
    name: loc.name,
    kind: loc.kind,
    regionName: REGION_NAMES[loc.region] ?? loc.region,
    climateName: data.world.climates[loc.climate].name,
    description: loc.description,
    generated: loc.origin === 'generated',
    population: { tier: loc.population, residents, named },
    wealth: loc.wealth,
    danger: loc.danger,
    safety: SAFETY_WORDS[safetyOf(data, loc.danger)],
    prosperity: {
      value: Math.round(prosperityOf(state, data, id)),
      description: breakdown ? describeBreakdown('Prosperity', breakdown) : '',
      lines: breakdown?.lines ?? [],
    },
    controller: controller
      ? {
          id: controller,
          name: state.entities[controller]?.name ?? data.factions[controller]?.name ?? controller,
        }
      : null,
    features: loc.features.map((f) => FEATURE_LABEL[f as Feature] ?? f),
    trades,
    logPose: loc.logPose ?? null,
    eternalPoses: loc.eternalPoses.map((e) => data.locations[e]?.name ?? e),
    notables,
    epidemic: localFlagActive(state, id, 'epidemic', tick),
    news,
    here: travel?.here?.id === id,
    bound: travel?.voyage?.to.id === id,
    visited,
    route,
  };
}

export interface FactionView {
  id: string;
  name: string;
  shortName: string;
  kind: string;
  active: boolean;
  generated: boolean;
  strength: number;
  description: string;
  goal: string;
  breakdown: string;
  places: number;
  leader: string | null;
  umbrella: string | null;
  opinions: { id: string; name: string; value: number }[];
}

export function factionViews(
  state: WorldState,
  data: GameData,
  includeGenerated = false,
): FactionView[] {
  const tick = state.tick;
  const held = territory(state);
  return orgEntities(state)
    .filter((e) => includeGenerated || e.origin !== 'generated')
    .map((e) => {
      const org = e.org;
      const def = data.factions[e.id];
      const stat = e.stats['strength'];
      const leader = org?.leaderId ? state.entities[org.leaderId] : undefined;
      return {
        id: e.id,
        name: e.name,
        shortName: def?.shortName ?? e.name.replace(/^The /, ''),
        kind: org?.kind ?? '',
        active: org?.active ?? false,
        generated: e.origin === 'generated',
        strength: Math.round(strengthOf(e, tick) * 10) / 10,
        description: def?.description ?? '',
        goal: def?.goal ?? '',
        breakdown: stat ? describeBreakdown('Strength', statBreakdown(stat, tick)) : '',
        places: held.get(e.id)?.length ?? 0,
        leader: leader
          ? `${leader.name}${leader.character?.alive === false ? ' (dead)' : ''}`
          : null,
        umbrella: org?.umbrella ? (state.entities[org.umbrella]?.name ?? org.umbrella) : null,
        opinions: Object.keys(org?.opinions ?? {})
          .sort()
          .map((other) => ({
            id: other,
            name: state.entities[other]?.name ?? data.factions[other]?.name ?? other,
            value: Math.round(opinionOf(e, other, tick)),
          }))
          .filter((o) => o.value !== 0),
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || b.strength - a.strength || (a.id < b.id ? -1 : 1),
    );
}

export interface BeatView {
  id: string;
  name: string;
  anchor: string;
  window: string;
  place: string;
  status: 'pending' | 'fired' | 'diverged' | 'beyond';
  when: string | null;
  past: boolean;
}

export interface CanonView {
  mode: string;
  modeSummary: string;
  cutoff: string;
  beats: BeatView[];
  divergences: { dateLabel: string; kind: string; text: string; beat: string | null }[];
  counts: { fired: number; diverged: number; pending: number };
  cast: { alive: number; dead: number; diverged: number };
}

export function canonView(state: WorldState, data: GameData): CanonView {
  const tick = state.tick;
  const mode = data.creation.canonModes.find((m) => m.id === state.config.canonMode);
  const cutoff = cutoffTick(data);
  const beats: BeatView[] = orderedBeats(state, data).map((beat) => {
    const st = beatState(state, beat.id);
    const { from, to } = windowOf(beat);
    const beyond = from > cutoff;
    return {
      id: beat.id,
      name: beat.name,
      anchor: beat.anchor,
      window: from === to ? label(data, from) : `${label(data, from)} to ${label(data, to)}`,
      place: data.locations[beat.place]?.name ?? beat.place,
      status: beyond && st.status === 'pending' ? 'beyond' : st.status,
      when: st.tick !== undefined ? label(data, st.tick) : null,
      past: tickOfWhen(beat.window.to) < tick,
    };
  });
  let alive = 0;
  let dead = 0;
  let diverged = 0;
  for (const id of Object.keys(data.cast)) {
    const e = state.entities[id];
    if (!e?.character) continue;
    if (e.character.alive) alive += 1;
    else dead += 1;
    if (e.origin === 'canon-diverged') diverged += 1;
  }
  return {
    mode: mode?.name ?? state.config.canonMode,
    modeSummary: mode?.summary ?? '',
    cutoff: data.canonRules.cutoff.label,
    beats,
    divergences: [...state.canon.divergences].reverse().map((d) => ({
      dateLabel: label(data, d.tick),
      kind: d.kind,
      text: d.text,
      beat: d.beat ? (data.canon[d.beat]?.name ?? d.beat) : null,
    })),
    counts: {
      fired: beats.filter((b) => b.status === 'fired').length,
      diverged: beats.filter((b) => b.status === 'diverged').length,
      pending: beats.filter((b) => b.status === 'pending').length,
    },
    cast: { alive, dead, diverged },
  };
}

export interface WorldSummary {
  built: boolean;
  factions: FactionView[];
  canon: {
    mode: string;
    fired: number;
    diverged: number;
    pending: number;
    divergences: number;
    cutoff: string;
  };
  population: { named: number; residents: number; places: number; crews: number };
}

export function worldSummary(state: WorldState, data: GameData): WorldSummary {
  let named = 0;
  let residents = 0;
  let places = 0;
  let crews = 0;
  for (const e of Object.values(state.entities)) {
    if (e.character?.npc && e.character.alive) named += 1;
    if (e.place) {
      places += 1;
      residents += e.place.residents.children + e.place.residents.adults + e.place.residents.elders;
    }
    if (e.org?.kind === 'crew' && e.org.active) crews += 1;
  }
  const canon = canonView(state, data);
  return {
    built: state.flags['world.built'] === true,
    factions: factionViews(state, data).filter((f) => f.kind !== 'crew' || f.active),
    canon: {
      mode: canon.mode,
      fired: canon.counts.fired,
      diverged: canon.counts.diverged,
      pending: canon.counts.pending,
      divergences: state.canon.divergences.length,
      cutoff: canon.cutoff,
    },
    population: { named, residents, places, crews },
  };
}
