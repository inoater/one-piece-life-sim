import type { GameData, Location, NpcAction, Race } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { CharacterData, Entity, WorldState } from '../../engine/state';
import { makeStat, STAT_IDS } from '../../engine/stats';
import { cutoffTick, killCharacter } from '../canon/cast';
import { fullName, givenNames, namePool, npcTraits, rollPronouns } from '../genesis/family';
import { raceAgeFor } from '../genesis/stages';
import { combatPowerOf, humanAgeOf, personOf } from '../life/body';
import { mortalityCause, mortalityChance } from '../life/health';
import { relate } from '../life/people';
import { lanesFrom, locations, withDevFixtures } from './graph';
import { priceMult } from './place';
import { armFighter } from '../powers/month';
import { huntReason, npcFight, npcRaid, npcSeaTrouble, quarrelReason } from '../battle/world';
import { entityIds } from '../../engine/entities';

/**
 * Tier 2 (Phase 3): about two thousand named people, made once when the world is populated, who
 * live by goals (survive, wealth, glory, revenge, freedom) and choose one action a quarter by
 * simple utility scoring (world.json `npc`). They work, train, sail, turn pirate, join the
 * Marines, marry and have children, settle scores, and die. Their families are linked at birth.
 *
 * Named people come out of their place's Tier 3 numbers, so a town does not count them twice.
 */

export const POPULATED = 'world.populated';

const WEALTH_PAY = { low: 700, medium: 1000, high: 1400 } as const;

function racesOf(data: GameData, loc: Location): Race[] {
  const culture = data.birthplaces[loc.culture];
  return (culture?.races ?? [])
    .map((id) => data.races[id])
    .filter((r): r is Race => r !== undefined && !r.rare);
}

/** One named person of a place. */
export function makeNpc(
  state: WorldState,
  data: GameData,
  loc: Location,
  rng: Rng,
  tick: number,
  humanAge: number,
  familyName?: string,
): Entity | null {
  const culture = data.birthplaces[loc.culture];
  const race = rng.fork('race').weightedPick(racesOf(data, loc), (r) => r.weight);
  if (!culture || !race) return null;
  const pool = namePool(data, { race, birthplace: culture });
  const pronouns = rollPronouns(rng.fork('pronouns'));
  const given = rng.fork('given').pick(givenNames(pool, pronouns));
  const family = familyName ?? rng.fork('family').pick(pool.family);
  const years = raceAgeFor(data.character, race, humanAge);
  const birthTick = tick - Math.round(years * 12) - rng.fork('month').int(0, 11);

  // Their trade comes out of the place's numbers.
  const place = state.entities[loc.id]?.place;
  let occupation: string | undefined;
  if (place && humanAge >= 16) {
    const jobs = Object.keys(place.jobs)
      .sort()
      .filter((j) => (place.jobs[j] ?? 0) > 0);
    occupation = rng.fork('job').weightedPick(jobs, (j) => place.jobs[j] ?? 0);
    if (occupation) place.jobs[occupation] = Math.max(0, (place.jobs[occupation] ?? 0) - 1);
    place.residents.adults = Math.max(0, place.residents.adults - 1);
  }
  const goal =
    rng
      .fork('goal')
      .weightedPick(
        data.world.npc.goals,
        (g) => g.weight * (occupation ? (g.occupations[occupation] ?? 1) : 1),
      )?.id ?? 'survive';

  const stats: Record<string, ReturnType<typeof makeStat>> = {};
  const grown = Math.min(1, Math.max(0.15, humanAge / 20));
  const old = humanAge > 60 ? Math.max(0.6, 1 - (humanAge - 60) * 0.015) : 1;
  for (const id of STAT_IDS) {
    const mental = data.character.mental.includes(id);
    const base = rng.fork('stat', id).normal(38, 9) * grown * (mental ? 1 : old);
    stats[id] = makeStat(Math.round(Math.max(3, Math.min(95, base)) * 10) / 10);
  }
  const entity = createEntity(state, {
    type: 'character',
    origin: 'generated',
    name: fullName(pool, given, family),
    tier: 2,
    stats,
    knownBy: [],
  });
  const character: CharacterData = {
    givenName: given,
    familyName: family,
    pronouns,
    race: race.id,
    birthTick,
    birthplace: culture.id,
    alive: true,
    traits: [...race.innateTraits, ...npcTraits(data, rng.fork('traits'))],
    appearance: {},
    scars: [],
    relationships: [],
    berries:
      rng.fork('berries').int(500, 5000) *
      (loc.wealth === 'high' ? 3 : loc.wealth === 'medium' ? 2 : 1),
    place: loc.id,
    npc: { goal },
  };
  if (occupation) character.occupation = occupation;
  entity.character = character;
  // Phase 4: a fighter has a style, perhaps haki, now and then a fruit.
  armFighter(state, data, entity, tick, rng.fork('powers'));
  return entity;
}

/** Fill the world with its named people (once, and only in a world with population "full"). */
export function populate(state: WorldState, data: GameData, tick: number, rng: Rng): number {
  if (state.config.population !== 'full' || state.flags[POPULATED] === true) return 0;
  state.flags[POPULATED] = true;
  const ages = data.world.population.namedAges;
  let made = 0;
  for (const loc of locations(data, withDevFixtures(state))) {
    const count = data.world.population.named[loc.population];
    for (let i = 0; i < count; i++) {
      const r = rng.fork(loc.id, i);
      if (makeNpc(state, data, loc, r, tick, r.fork('age').int(ages.min, ages.max))) made += 1;
    }
  }
  return made;
}

// ---- The quarter's choice -----------------------------------------------------------------------

/** Living Tier 2 people at each place this tick (built once per tick). */
const indexes = new WeakMap<WorldState, { tick: number; byPlace: Map<string, string[]> }>();

function peopleAt(state: WorldState, tick: number): Map<string, string[]> {
  const cached = indexes.get(state);
  if (cached?.tick === tick) return cached.byPlace;
  const byPlace = new Map<string, string[]>();
  for (const id of entityIds(state)) {
    const c = state.entities[id]?.character;
    if (!c?.npc || !c.alive || !c.place) continue;
    const list = byPlace.get(c.place) ?? [];
    list.push(id);
    byPlace.set(c.place, list);
  }
  indexes.set(state, { tick, byPlace });
  return byPlace;
}

export interface NpcSite {
  state: WorldState;
  data: GameData;
  tick: number;
  rng: Rng;
  newsDrafts: NewsDraft[];
}

function available(site: NpcSite, entity: Entity, action: NpcAction): boolean {
  const { state, data, tick } = site;
  const c = entity.character as CharacterData;
  const loc = c.place ? data.locations[c.place] : undefined;
  const power = combatPowerOf(data, entity, tick);
  const marine = entity.flags['affiliation'] === 'org_marines';
  switch (action) {
    case 'voyage':
      return (
        !!loc &&
        (loc.features.includes('docks') || loc.features.includes('coast')) &&
        lanesFrom(data, loc.id).length > 0
      );
    case 'piracy':
      return (
        !c.npc?.crewId &&
        !marine &&
        power >= data.world.npc.fighterPower &&
        entity.flags['status'] !== 'imprisoned'
      );
    case 'enlist':
      return (
        !marine &&
        !c.npc?.crewId &&
        power >= data.world.npc.fighterPower * 0.6 &&
        !!loc?.features.includes('marine_base')
      );
    case 'settle':
      return entity.flags['married'] !== true;
    case 'scheme':
      return (peopleAt(state, tick).get(c.place ?? '')?.length ?? 0) > 1;
    default:
      return true;
  }
}

function situational(site: NpcSite, entity: Entity, action: NpcAction, humanAge: number): number {
  const c = entity.character as CharacterData;
  if (action === 'work' && c.berries < site.data.world.npc.poorBelow) return 2;
  if (action === 'rest' && humanAge >= 60) return 1.6;
  if (action === 'train' && humanAge >= 55) return 0.5;
  return 1;
}

function log(site: NpcSite, entity: Entity, summary: string, tags: string[], news = false): void {
  const record = appendLog(site.state, site.tick, {
    kind: 'world',
    summary,
    tags: ['world', 'npc', ...tags],
    actorIds: [entity.id],
    place: entity.character?.place ?? null,
    cause: 'sys:npc',
    knownBy: [],
  });
  if (news) {
    site.newsDrafts.push({
      text: summary,
      tags: ['news', ...tags],
      sourceSeq: record.seq,
      place: entity.character?.place ?? null,
    });
  }
}

/** Most crews are named for their captain; when that name is taken, a name from the list. */
function crewName(site: NpcSite, captain: Entity, rng: Rng): string {
  const taken = new Set(
    Object.values(site.state.entities)
      .filter((e) => e.org)
      .map((e) => e.name),
  );
  const c = captain.character;
  const own = `The ${c?.familyName || c?.givenName || captain.name} Pirates`;
  if (!taken.has(own)) return own;
  const names = site.data.world.npc.crewNames.map((n) => `The ${n}`);
  const free = names.filter((n) => !taken.has(n));
  if (free.length > 0) return rng.pick(free);
  return `The ${c?.givenName ?? captain.name} ${c?.familyName ?? ''} Pirates`.replace(/\s+/g, ' ');
}

function turnPirate(site: NpcSite, entity: Entity, rng: Rng): void {
  const { state, data, tick } = site;
  const c = entity.character as CharacterData;
  const region = c.place ? data.locations[c.place]?.region : undefined;
  const crews = entityIds(state)
    .map((id) => state.entities[id] as Entity)
    .filter(
      (e) =>
        e.org?.kind === 'crew' &&
        e.org.active &&
        e.origin === 'generated' &&
        e.org.members.length < 12 &&
        (e.org.home ? data.locations[e.org.home]?.region === region : false),
    );
  const bounty = rng.fork('bounty').int(data.world.npc.bounty.min, data.world.npc.bounty.max);
  entity.flags['bounty'] = Math.round(bounty / 10);
  let crew = crews.length > 0 ? rng.fork('join').pick(crews) : null;
  if (!crew) {
    crew = createEntity(state, {
      type: 'organization',
      origin: 'generated',
      name: crewName(site, entity, rng.fork('name')),
      tier: 2,
      stats: { strength: makeStat(1) },
      knownBy: [],
    });
    crew.org = {
      kind: 'crew',
      active: true,
      leaderId: entity.id,
      members: [],
      opinions: { org_marines: makeStat(-70), org_world_government: makeStat(-60) },
      umbrella: 'org_pirates',
      home: c.place ?? null,
      foundedTick: tick,
      endedTick: null,
    };
    entity.flags['title'] = `Captain of ${crew.name.replace(/^The /, 'the ')}`;
    log(
      site,
      entity,
      `${entity.name} raised a pirate flag: ${crew.name} sail from ${data.locations[c.place ?? '']?.home ?? 'the sea'}.`,
      ['pirate', 'crew'],
      true,
    );
  } else {
    entity.flags['title'] = `Pirate of ${crew.name.replace(/^The /, 'the ')}`;
  }
  crew.org?.members.push(entity.id);
  const strength = crew.stats['strength'];
  if (strength) strength.base += Math.round((combatPowerOf(data, entity, tick) / 200) * 10) / 10;
  entity.flags['affiliation'] = crew.id;
  if (c.npc) c.npc.crewId = crew.id;
  c.occupation = 'occ_pirate';
}

function scheme(site: NpcSite, entity: Entity, rng: Rng): void {
  const { state, tick } = site;
  const c = entity.character as CharacterData;
  const here = (peopleAt(state, tick).get(c.place ?? '') ?? []).filter(
    (id) => id !== entity.id && state.entities[id]?.character?.alive,
  );
  if (here.length === 0) return;
  const marine = entity.flags['affiliation'] === 'org_marines';
  const pirates = here.filter((id) => typeof state.entities[id]?.flags['bounty'] === 'number');
  const targetId =
    marine && pirates.length > 0 ? rng.fork('target').pick(pirates) : rng.fork('target').pick(here);
  const target = state.entities[targetId];
  if (!target?.character) return;
  // Phase 5: the same rules as anyone's fight, in one roll; a Marine takes a pirate alive. Most
  // grudges never come to blows.
  const hunting = marine && typeof target.flags['bounty'] === 'number';
  if (!hunting && !rng.fork('blows?').chance(site.data.battle.npc.quarrel)) return;
  npcFight(
    site,
    entity,
    target,
    hunting ? 'capture' : rng.fork('deadly').chance(0.1) ? 'kill' : 'spare',
    hunting
      ? () => `${entity.name}, ${huntReason(entity, target)}, went after ${target.name}.`
      : () => `${entity.name} and ${target.name} came to blows: ${quarrelReason(entity)}.`,
    hunting ? ['hunt', 'marine', 'pirate'] : ['quarrel'],
  );
}

function settle(site: NpcSite, entity: Entity, rng: Rng): void {
  const { state, data, tick } = site;
  const c = entity.character as CharacterData;
  const me = personOf(data, entity);
  if (!me || humanAgeOf(data, me, tick) < 18) return;
  const here = (peopleAt(state, tick).get(c.place ?? '') ?? []).filter((id) => {
    const other = state.entities[id];
    if (!other?.character || id === entity.id || other.flags['married'] === true) return false;
    const p = personOf(data, other);
    return p !== null && humanAgeOf(data, p, tick) >= 18;
  });
  if (here.length === 0) return;
  const spouse = state.entities[rng.fork('spouse').pick(here)];
  if (!spouse) return;
  relate(entity, spouse, 'sweetheart', 40 + rng.int(0, 30), tick, rng.fork('relate'));
  entity.flags['married'] = true;
  spouse.flags['married'] = true;
}

function act(site: NpcSite, entity: Entity, action: NpcAction, rng: Rng): void {
  const { state, data } = site;
  const c = entity.character as CharacterData;
  switch (action) {
    case 'work': {
      const loc = c.place ? data.locations[c.place] : undefined;
      const pay = WEALTH_PAY[loc?.wealth ?? 'medium'] * priceMult(state, data, c.place ?? '') * 3;
      c.berries += Math.round(pay * rng.float(0.7, 1.3));
      break;
    }
    case 'train': {
      const goal = c.npc?.goal;
      const pool =
        goal === 'glory' || goal === 'revenge'
          ? ['strength', 'speed', 'durability', 'dexterity']
          : ['intellect', 'charisma', 'perception', 'endurance'];
      const stat = entity.stats[rng.pick(pool)];
      if (stat && stat.base < 120)
        stat.base = Math.round((stat.base + rng.float(0.5, 1.5)) * 10) / 10;
      break;
    }
    case 'voyage': {
      const edges = lanesFrom(data, c.place ?? '');
      if (edges.length > 0) c.place = rng.pick(edges).to;
      // Phase 5: the sea is the sea for everyone (pirates, storms, fruit users who go over).
      if (rng.fork('sea?').chance(data.battle.npc.seaTrouble)) npcSeaTrouble(site, entity);
      break;
    }
    case 'piracy':
      turnPirate(site, entity, rng);
      break;
    case 'enlist':
      entity.flags['affiliation'] = 'org_marines';
      entity.flags['title'] = 'Marine';
      c.occupation = 'occ_marine';
      break;
    case 'settle':
      settle(site, entity, rng);
      break;
    case 'scheme':
      scheme(site, entity, rng);
      break;
    case 'rest':
      break;
  }
  if (c.npc) c.npc.last = action;
}

/**
 * Phase 5: fights people go looking for. A Marine or a bounty hunter goes after a pirate at the
 * same place; a pirate captain raids the town the crew is in. Returns true if the quarter went on it.
 */
function huntsOrRaids(site: NpcSite, entity: Entity, rng: Rng): boolean {
  const { state, data, tick } = site;
  const c = entity.character as CharacterData;
  const here = (peopleAt(state, tick).get(c.place ?? '') ?? []).filter((id) => {
    const e = state.entities[id];
    return id !== entity.id && e?.character?.alive && e.flags['status'] !== 'imprisoned';
  });
  if (here.length === 0) return false;
  const marine = entity.flags['affiliation'] === 'org_marines';
  const hunter = marine || c.occupation === 'occ_bounty_hunter';
  if (hunter && rng.fork('hunt?').chance(data.battle.npc.hunt)) {
    const pirates = here.filter((id) => typeof state.entities[id]?.flags['bounty'] === 'number');
    if (pirates.length === 0) return false;
    const target = state.entities[rng.fork('target').pick(pirates)] as Entity;
    npcFight(
      site,
      entity,
      target,
      'capture',
      () => `${entity.name}, ${huntReason(entity, target)}, went after ${target.name}.`,
      ['hunt', marine ? 'marine' : 'bounty_hunter', 'pirate'],
    );
    return true;
  }
  const crewId = c.npc?.crewId;
  const crew = crewId ? state.entities[crewId] : undefined;
  const loc = c.place ? data.locations[c.place] : undefined;
  if (
    crew?.org?.leaderId === entity.id &&
    loc?.kind !== 'stronghold' &&
    rng.fork('raid?').chance(data.battle.npc.raid)
  ) {
    const defenders = here
      .map((id) => state.entities[id] as Entity)
      .filter((e) => e.flags['affiliation'] === 'org_marines' || e.character?.npc?.goal === 'glory')
      .filter((e) => e.flags['affiliation'] !== crewId);
    npcRaid(site, entity, defenders);
    return true;
  }
  return false;
}

/** A Tier 2 person's quarter: score every open action by their goal, plus noise; do the best. */
export function npcQuarter(site: NpcSite, entity: Entity): void {
  const { data, tick } = site;
  const c = entity.character;
  if (!c?.npc || !c.alive || entity.flags['status'] === 'imprisoned') return;
  const p = personOf(data, entity);
  if (!p) return;
  const age = humanAgeOf(data, p, tick);
  if (age < 12) return;
  const rng = site.rng.fork(entity.id);
  if (age >= 16 && age < 65 && huntsOrRaids(site, entity, rng.fork('fight'))) {
    c.npc.last = 'fight';
    return;
  }
  let best: { action: NpcAction; score: number } | null = null;
  for (const option of data.world.npc.actions) {
    if (age < option.ages.min || age > option.ages.max) continue;
    if (!available(site, entity, option.id)) continue;
    const score =
      (option.utility[c.npc.goal] ?? 0) * situational(site, entity, option.id, age) +
      rng.fork('noise', option.id).float(0, data.world.npc.noise);
    if (!best || score > best.score) best = { action: option.id, score };
  }
  if (best) act(site, entity, best.action, rng.fork('act'));
}

// ---- The year -----------------------------------------------------------------------------------

/**
 * Every January: Tier 2 people die by the same yearly roll as anyone (Phase 2's mortality table,
 * at their place's safety), couples have children (named while the place has room for more, a
 * number in its Tier 3 count otherwise), and canon characters face the same roll in a world where
 * the canon mode does not protect them, or once they have left the story.
 */
export function peopleYear(site: NpcSite): void {
  const { state, data, tick, rng } = site;
  if (tick % 12 !== 0) return;
  const protect = data.canonRules.modes[state.config.canonMode]?.protectCast ?? true;
  const pastCutoff = tick > cutoffTick(data);
  const named = new Map<string, number>();
  for (const id of entityIds(state)) {
    const c = state.entities[id]?.character;
    if (c?.npc && c.alive && c.place) named.set(c.place, (named.get(c.place) ?? 0) + 1);
  }
  for (const id of entityIds(state)) {
    const entity = state.entities[id] as Entity;
    const c = entity.character;
    if (!c?.alive || id === state.playerId) continue;
    const cast = id in data.cast;
    if (!c.npc && !cast) continue;
    if (cast && protect && entity.origin === 'canon' && !pastCutoff) continue;
    const p = personOf(data, entity);
    if (!p) continue;
    const r = rng.fork('year', id);
    const input = { data, state, p, tick, healthRatio: 1 };
    if (r.chance(mortalityChance(input))) {
      killCharacter(state, data, entity, {
        tick,
        canon: false,
        cause: mortalityCause(input, r.fork('cause')),
        newsDrafts: site.newsDrafts,
      });
      continue;
    }
    if (!c.npc || entity.flags['married'] !== true) continue;
    const age = humanAgeOf(data, p, tick);
    if (age < 18 || age > 42 || !r.fork('child?').chance(data.world.population.childChance))
      continue;
    const loc = c.place ? data.locations[c.place] : undefined;
    if (!loc) continue;
    const cap = data.world.population.named[loc.population] * data.world.population.namedCap;
    const place = state.entities[loc.id]?.place;
    if ((named.get(loc.id) ?? 0) >= cap) {
      if (place) place.residents.children += 1;
      continue;
    }
    const child = makeNpc(state, data, loc, r.fork('child'), tick, 0, c.familyName);
    if (!child?.character) continue;
    child.character.birthTick = tick;
    relate(entity, child, 'child', 70, tick, r.fork('relate'));
    named.set(loc.id, (named.get(loc.id) ?? 0) + 1);
  }
}
