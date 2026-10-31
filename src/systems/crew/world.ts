import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import { Rng } from '../../engine/rng';
import type { CrewWorld, Entity, WorldState } from '../../engine/state';
import { entityIds } from '../../engine/entities';
import { winChance } from '../battle/battle';
import { foePower } from '../battle/fighters';
import { pairOf } from '../heart/bonds';
import { moveAxis } from '../heart/bonds';
import { combatPowerOf, humanAgeOf, reputation } from '../life/body';
import { injure } from '../life/health';
import { pay, type LifeEnv } from '../life/env';
import { isDev, lanesFrom, locations } from '../places/graph';
import { makeNpc } from '../places/people';
import { openTrack, powerCtxFor, setStage } from '../powers/tracks';
import { crewSay, meet } from './members';
import { crewEffect } from './posts';
import { conclude, recruitOf } from './recruit';
import { hereOf, CrewError, crewLedBy, onHand } from './state';

/**
 * Where recruits come from (Phase 8), the world's side: each port's "Looking for a ship" list,
 * refreshed each quarter and sized by the port's wealth (and the recruiter at their post); the
 * cells of a Marine base and the condemned; an underworld's auction block; deserters from the
 * service; and a handful of hidden extraordinary people each world seeds, found only by
 * following rumours and exploring. Everyone listed is a whole person (Phase 3's named people),
 * with a past, a trade, traits, powers, and sometimes a secret.
 */

export function crewWorld(state: WorldState): CrewWorld {
  state.crews ??= { boards: {}, prisons: {}, auctions: {}, legends: [] };
  return state.crews;
}

/** Someone looking for a ship (or found by a recruiting mission): a person of the place, now. */
export function makeCandidate(
  env: LifeEnv,
  placeId: string,
  source: string,
  rng: Rng,
  power = 1,
): Entity | null {
  const { state, data, tick, p } = env;
  const loc = data.locations[placeId];
  if (!loc) return null;
  const rules = data.crew.recruit.boards;
  const e = makeNpc(
    state,
    data,
    loc,
    rng,
    tick,
    rng.fork('age').int(rules.ages.min, rules.ages.max),
  );
  if (!e?.character) return null;
  e.knownBy = [p.entity.id];
  e.flags['recruit.source'] = source;
  if (power !== 1)
    for (const id of [
      'strength',
      'speed',
      'durability',
      'dexterity',
      'willpower',
      'perception',
      'intellect',
    ])
      if (e.stats[id]) e.stats[id].base = Math.round(e.stats[id].base * power * 10) / 10;
  if (rng.fork('debt').chance(0.15)) e.flags['recruit.debt'] = true;
  // Some carry a hidden past; a few were sent to watch whoever takes them on.
  if (rng.fork('spy').chance(rules.spyChance)) {
    e.character.secret = { id: 'spy', found: false };
    e.flags['spy.for'] = rng.fork('faction').pick(data.crew.spies.factions);
  } else if (rng.fork('secret').chance(rules.secretChance)) {
    const pick = rng.fork('which').weightedPick(data.crew.recruit.secrets, (s) => s.weight);
    if (pick) e.character.secret = { id: pick.id, found: false };
  }
  return e;
}

function refresh(
  list: { tick: number; ids: string[] } | undefined,
  tick: number,
  months: number,
): boolean {
  return !list || tick - list.tick >= months;
}

/**
 * Someone listed who was never met goes back to being one of the island's numbers when the list
 * is made anew (rule 5: Tier 3 stays statistics until the player meets someone). Anyone met,
 * pitched, held, carrying something or caught up in the world stays a person.
 */
function dissolve(state: WorldState, ids: readonly string[], placeId: string): void {
  const gone = new Set<string>();
  for (const id of ids) {
    const e = state.entities[id];
    const c = e?.character;
    if (!e || !c?.alive) continue;
    if (c.relationships.length > 0 || c.recruit || e.flags['crew.of'] !== undefined) continue;
    if (e.flags['legend'] !== undefined || e.flags['prisoner.of'] !== undefined) continue;
    if ((c.hands?.items.length ?? 0) > 0 || c.powers?.fruit) continue;
    gone.add(id);
  }
  if (gone.size === 0) return;
  // Nothing else may point at them (a sword held, a fruit carried).
  for (const e of Object.values(state.entities)) {
    const holder = e.item?.holderId ?? e.fruit?.holderId ?? null;
    if (holder && gone.has(holder)) gone.delete(holder);
  }
  const here = state.entities[placeId]?.place;
  for (const id of gone) {
    const occupation = state.entities[id]?.character?.occupation;
    delete state.entities[id];
    if (here) {
      here.residents.adults += 1;
      if (occupation) here.jobs[occupation] = (here.jobs[occupation] ?? 0) + 1;
    }
  }
}

/** The lists at the place the player stands (made the month they are there, rule 5). */
export function listingsMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  const placeId = hereOf(data, p.entity);
  const loc = placeId ? data.locations[placeId] : undefined;
  // Children do not go looking for crews.
  if (!placeId || !loc || humanAgeOf(data, p, tick) < 14) return;
  const w = crewWorld(state);
  const rules = data.crew.recruit;
  const rng = Rng.root(state.seed).fork(
    'crew-lists',
    placeId,
    Math.floor(tick / rules.boards.refreshMonths),
  );
  if (
    loc.features.includes('docks') &&
    refresh(w.boards[placeId], tick, rules.boards.refreshMonths)
  ) {
    dissolve(state, w.boards[placeId]?.ids ?? [], placeId);
    const size = Math.round(
      (rules.boards.sizes[loc.wealth] ?? 2) * (1 + crewEffect(state, data, 'port.board')),
    );
    const ids: string[] = [];
    for (let i = 0; i < size; i++) {
      const defector =
        loc.features.includes('marine_base') && i === 0 && rng.fork('defector?').chance(0.4);
      const e = makeCandidate(env, placeId, defector ? 'defector' : 'board', rng.fork('board', i));
      if (!e?.character) continue;
      if (defector) e.character.occupation = 'occ_marine';
      ids.push(e.id);
    }
    w.boards[placeId] = { tick, ids };
    // A captain hears who is looking for a ship; anyone else can read the board on the Crew page.
    if (ids.length > 0 && crewLedBy(state, p.entity))
      crewSay(
        env,
        crewLedBy(state, p.entity),
        null,
        'boardHere',
        { count: String(ids.length), place: loc.name },
        'plain',
        ['board'],
        false,
      );
  }
  if (loc.features.includes('marine_base') && refresh(w.prisons[placeId], tick, 6)) {
    dissolve(state, w.prisons[placeId]?.ids ?? [], placeId);
    const ids: string[] = [];
    for (let i = 0; i < rules.prisons.size; i++) {
      const e = makeCandidate(env, placeId, 'prison', rng.fork('cell', i), 1.15);
      if (!e) continue;
      e.flags['status'] = 'imprisoned';
      e.flags['bounty'] = Math.round(combatPowerOf(data, e, tick) * 20000);
      ids.push(e.id);
    }
    w.prisons[placeId] = { tick, ids };
  }
  if (loc.features.includes('underworld') && refresh(w.auctions[placeId], tick, 6)) {
    dissolve(state, w.auctions[placeId]?.ids ?? [], placeId);
    const ids: string[] = [];
    for (let i = 0; i < rules.auctions.size; i++) {
      const e = makeCandidate(env, placeId, 'auction', rng.fork('block', i));
      if (!e) continue;
      e.flags['captive'] = true;
      ids.push(e.id);
    }
    w.auctions[placeId] = { tick, ids };
  }
}

// ---- Prisons and auctions ------------------------------------------------------------------------

export function bailOf(data: GameData, other: Entity, tick: number): number {
  return (
    Math.round((combatPowerOf(data, other, tick) * data.crew.recruit.prisons.bailPerCp) / 1000) *
    1000
  );
}

export function priceOf(data: GameData, other: Entity, tick: number): number {
  return (
    Math.round((combatPowerOf(data, other, tick) * data.crew.recruit.auctions.pricePerCp) / 1000) *
    1000
  );
}

function listed(
  state: WorldState,
  data: GameData,
  player: Entity,
  id: string,
  which: 'prisons' | 'auctions',
): boolean {
  const place = hereOf(data, player);
  return place !== null && (state.crews?.[which][place]?.ids.includes(id) ?? false);
}

/** Out of the cells and owing the player for it: they join, unless they name something first. */
function freed(env: LifeEnv, other: Entity, how: string, debt: number): void {
  const { state, data, tick, p } = env;
  delete other.flags['status'];
  delete other.flags['captive'];
  meet(env, other);
  const pair = pairOf(p.entity, other);
  const record = appendLog(state, tick, {
    kind: 'event',
    summary: `${other.name} is free, thanks to you.`,
    tags: ['personal', 'crew', `freed:${how}`],
    actorIds: [p.entity.id],
    targetIds: [other.id],
    place: hereOf(data, p.entity),
    cause: env.cause,
    knownBy: [p.entity.id],
  });
  if (pair) {
    moveAxis(data, pair.theirs, 'debt', debt, 'You freed them', record.seq, tick);
    moveAxis(data, pair.theirs, 'affection', 20, 'You freed them', record.seq, tick);
  }
  const r = recruitOf(other);
  r.listening = true;
  other.flags['recruit.source'] = how;
  conclude(env, other, how);
}

/** Buy out a sentence (bail at a Marine base). */
export function buyOut(env: LifeEnv, id: string): void {
  const { state, data, tick, p } = env;
  const other = state.entities[id];
  if (
    !other?.character?.alive ||
    !listed(state, data, p.entity, id, 'prisons') ||
    other.flags['status'] !== 'imprisoned'
  )
    throw new CrewError('Nobody of that name is held here');
  const bail = bailOf(data, other, tick);
  if (p.c.berries < bail)
    throw new CrewError(`The bail is ${bail.toLocaleString('en-GB')} Berries`);
  pay(env, -bail);
  freed(env, other, 'prison', 40);
}

/** Break someone out (or cut down the condemned): the player and the crew against the guards. */
export function breakOut(env: LifeEnv, id: string): boolean {
  const { state, data, tick, p } = env;
  const other = state.entities[id];
  if (
    !other?.character?.alive ||
    !listed(state, data, p.entity, id, 'prisons') ||
    other.flags['status'] !== 'imprisoned'
  )
    throw new CrewError('Nobody of that name is held here');
  const crew = crewLedBy(state, p.entity)?.crew;
  const ours =
    combatPowerOf(data, p.entity, tick) +
    (crew
      ? onHand(state, crew, tick).reduce((n, m) => n + combatPowerOf(data, m.entity, tick) * 0.5, 0)
      : 0);
  const guard = data.battle.foes.find((f) => f.id === 'foe_marine');
  const theirs = guard ? foePower(data, guard, env.rng.fork('guards')) * 3 : 600;
  const won = env.rng.fork('break-out', id, tick).chance(winChance(data, ours, theirs));
  reputation(p.entity, 'infamy').base += 2;
  const bounty =
    typeof p.entity.flags['bounty'] === 'number' ? (p.entity.flags['bounty'] as number) : 0;
  p.entity.flags['bounty'] = bounty + 5000000;
  if (!won) {
    injure(env, { severity: 'serious', area: 'roll', cause: 'violence' });
    crewSay(env, crewLedBy(state, p.entity), other, 'refused', {}, 'bad', ['breakout', 'failed']);
    return false;
  }
  freed(env, other, 'prison', 60);
  return true;
}

/** Free a captive from the auction block (some choose to stay with the player). */
export function freeCaptive(env: LifeEnv, id: string): boolean {
  const { state, data, tick, p } = env;
  const other = state.entities[id];
  if (
    !other?.character?.alive ||
    !listed(state, data, p.entity, id, 'auctions') ||
    other.flags['captive'] !== true
  )
    throw new CrewError('Nobody of that name is on the block here');
  const price = priceOf(data, other, tick);
  if (p.c.berries < price)
    throw new CrewError(`They are going for ${price.toLocaleString('en-GB')} Berries`);
  pay(env, -price);
  const w = crewWorld(state);
  const place = hereOf(data, p.entity);
  if (place && w.auctions[place])
    w.auctions[place].ids = w.auctions[place].ids.filter((x) => x !== id);
  if (env.rng.fork('stay', id).chance(0.55)) {
    freed(env, other, 'auction', 50);
    return true;
  }
  delete other.flags['captive'];
  meet(env, other, 25);
  const pair = pairOf(p.entity, other);
  if (pair)
    moveAxis(data, pair.theirs, 'affection', 25, 'You bought their freedom', undefined, tick);
  crewSay(env, crewLedBy(state, p.entity), other, 'left', {}, 'plain', ['freed']);
  return false;
}

// ---- Legends by rumour -----------------------------------------------------------------------------

/** Seed the world's hidden legends, once (from the world's seed: the same world, the same legends). */
export function seedLegends(state: WorldState, data: GameData, tick: number): void {
  const w = crewWorld(state);
  if (w.legends.length > 0 || state.flags['crew.legends'] === true) return;
  state.flags['crew.legends'] = true;
  const rules = data.crew.recruit.legends;
  const rng = Rng.root(state.seed).fork('legends');
  const places = locations(data).filter(
    (l) => !isDev(l) && l.region !== 'red_line' && l.region !== 'calm_belt',
  );
  for (let i = 0; i < rules.count && places.length > 0; i++) {
    const r = rng.fork(i);
    const kind = r.fork('kind').pick(rules.kinds);
    const loc = r.fork('place').pick(places);
    const e = makeNpc(state, data, loc, r, tick, r.fork('age').int(kind.ages.min, kind.ages.max));
    if (!e?.character) continue;
    e.knownBy = [];
    e.flags['legend'] = kind.id;
    for (const id of Object.keys(e.stats))
      if (id !== 'luck' && e.stats[id])
        e.stats[id].base = Math.round(Math.min(150, e.stats[id].base * kind.power) * 10) / 10;
    const tier = data.character.talentTiers.find((t) => t.id === kind.talent);
    if (tier) e.character.hidden = { talent: tier.id, potential: {} };
    if (kind.track) {
      const ctx = powerCtxFor(state, data, e, tick, r.fork('track'));
      if (ctx) {
        openTrack(ctx, kind.track, { source: kind.name, quiet: true });
        if (kind.stage > 0)
          setStage(
            ctx,
            kind.track,
            Math.min(kind.stage, (data.tracks[kind.track]?.stages.length ?? 1) - 1),
          );
      }
    }
    w.legends.push(e.id);
  }
  // Their potential (the talent's) is filled in when they join, like anyone's.
  for (const id of w.legends) {
    const c = state.entities[id]?.character;
    if (c?.hidden && Object.keys(c.hidden.potential).length === 0) delete c.hidden;
  }
}

/** Lanes between two places (a breadth-first walk of the sea lanes), up to `max`. */
function lanesApart(data: GameData, from: string, to: string, max: number): number | null {
  if (from === to) return 0;
  let frontier = [from];
  const seen = new Set(frontier);
  for (let d = 1; d <= max; d++) {
    const next: string[] = [];
    for (const at of frontier)
      for (const edge of lanesFrom(data, at)) {
        if (edge.to === to) return d;
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
    frontier = next;
  }
  return null;
}

/** Rumours of a legend reach a port nearby; standing where one lives finds them. */
export function legendsMonth(env: LifeEnv, explored: boolean): void {
  const { state, data, tick, p } = env;
  const here = hereOf(data, p.entity);
  if (!here) return;
  const w = crewWorld(state);
  const reach = data.crew.recruit.legends.rumourReach;
  for (const id of w.legends) {
    const e = state.entities[id];
    const at = e?.character?.place;
    if (!e?.character?.alive || !at || e.flags['legend.found'] === true) continue;
    const kind = data.crew.recruit.legends.kinds.find((k) => k.id === e.flags['legend']);
    if (!kind) continue;
    if (at === here && (e.flags['legend.heard'] === true || explored)) {
      e.flags['legend.found'] = true;
      e.knownBy = [...new Set([...e.knownBy, p.entity.id])];
      meet(env, e);
      crewSay(env, crewLedBy(state, p.entity), e, 'legendFound', { report: kind.text }, 'alert', [
        'legend',
        'found',
      ]);
      continue;
    }
    if (e.flags['legend.heard'] === true) continue;
    const apart = lanesApart(data, here, at, reach);
    if (apart === null) continue;
    const chance = 0.08 + crewEffect(state, data, 'port.rumours') * 0.3 + (explored ? 0.08 : 0);
    if (env.rng.fork('legend-rumour', id, tick).chance(chance)) {
      e.flags['legend.heard'] = true;
      crewSay(
        env,
        crewLedBy(state, p.entity),
        null,
        'legendRumour',
        {
          report: kind.text,
          target: data.locations[at]?.name ?? 'somewhere',
          place: data.locations[here]?.name ?? 'here',
        },
        'alert',
        ['legend', 'rumour'],
      );
    }
  }
}

/** The living people on the lists at a place (for the Recruit tab). */
export function listingsAt(
  state: WorldState,
  placeId: string,
): { board: string[]; prison: string[]; auction: string[] } {
  const w = state.crews;
  const alive = (ids: readonly string[] | undefined) =>
    (ids ?? []).filter((id) => state.entities[id]?.character?.alive);
  return {
    board: alive(w?.boards[placeId]?.ids).filter(
      (id) => state.entities[id]?.flags['crew.of'] === undefined,
    ),
    prison: alive(w?.prisons[placeId]?.ids).filter(
      (id) => state.entities[id]?.flags['status'] === 'imprisoned',
    ),
    auction: alive(w?.auctions[placeId]?.ids).filter(
      (id) => state.entities[id]?.flags['captive'] === true,
    ),
  };
}

export { entityIds };
