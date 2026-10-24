import { templateVarsFor, dateOf } from '../../engine/calendar';
import {
  tickOfWhen,
  type CastMember,
  type GameData,
  type Keyframe,
} from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import { PUBLIC_KNOWLEDGE, type Entity, type WorldState } from '../../engine/state';
import { makeStat, STAT_IDS } from '../../engine/stats';
import { renderTemplate } from '../../engine/template';
import { humanAgeFor } from '../genesis/stages';
import { reapplyTraits } from '../life/traits';
import { withDevFixtures } from '../places/graph';
import { releaseFruitOf } from '../powers/fruits';
import { applyCanonEra } from '../powers/movesets';
import { calibrateCast } from '../battle/ladder';
import { Rng } from '../../engine/rng';
import { entityIds } from '../../engine/entities';

/**
 * The canon cast (Phase 3): about forty famous people from data/cast, each spawned on their birth
 * month and then following keyframes (where they are, as what, with what bounty) until the cutoff,
 * their death, or the moment they leave the story (origin "canon-diverged").
 *
 * Every death of someone who is not the player goes through `killCharacter`, so an early canon
 * death is always noticed: their fruit returns to the world, their crew picks a successor, the
 * news hears of it, and the people whose stories were bound to theirs leave the story too.
 */

export function castOf(data: GameData, id: string): CastMember | undefined {
  return data.cast[id];
}

export function isCast(data: GameData, entity: Entity): boolean {
  return entity.id in data.cast && entity.type === 'character';
}

export function cutoffTick(data: GameData): number {
  const c = data.canonRules.cutoff;
  return c.year * 12 + (c.month - 1);
}

/** The keyframe in force at a tick, or null before the first. */
export function keyframeAt(cast: CastMember, tick: number): Keyframe | null {
  let found: Keyframe | null = null;
  for (const k of cast.keyframes) {
    if (tickOfWhen(k.from) > tick) break;
    if (k.to && tickOfWhen(k.to) < tick) {
      found = null;
      continue;
    }
    found = k;
  }
  return found;
}

/** How much of their prime a canon character's body has at an age: growing up, then old age. */
function ageFactor(data: GameData, cast: CastMember, tick: number): number {
  const race = data.races[cast.race];
  const years = Math.max(0, (tick - tickOfWhen(cast.born)) / 12);
  const human = race ? humanAgeFor(data.character, race, years) : years;
  if (human < 22) return Math.max(0.1, Math.min(1, (human - 2) / 20));
  if (human > 60) return Math.max(0.55, 1 - (human - 60) * 0.012);
  return 1;
}

function setStats(data: GameData, entity: Entity, cast: CastMember, tick: number): void {
  const factor = ageFactor(data, cast, tick);
  for (const id of STAT_IDS) {
    const prime = cast.stats[id] ?? data.canonRules.defaultStats[id] ?? 40;
    const base = Math.round(prime * (id === 'luck' ? 1 : factor) * 10) / 10;
    const stat = entity.stats[id];
    if (stat) stat.base = base;
    else entity.stats[id] = makeStat(base);
  }
}

/** Apply a keyframe's facts to a character entity. */
export function applyKeyframe(entity: Entity, k: Keyframe | null, fallbackPlace: string): void {
  const c = entity.character;
  if (!c) return;
  c.place = k?.place ?? fallbackPlace;
  const set = (flag: string, value: string | number | undefined) => {
    if (value === undefined) delete entity.flags[flag];
    else entity.flags[flag] = value;
  };
  set('affiliation', k?.affiliation);
  set('title', k?.title);
  set('bounty', k?.bounty);
  set('status', k?.status ?? 'active');
  set('haki', k?.haki?.join(','));
  // Phase 4: a fruit is the fruit entity's record (data/fruits holders), not a keyframe's name.
  set('approx', k?.approx ? 1 : undefined);
}

function makeCastEntity(
  state: WorldState,
  data: GameData,
  cast: CastMember,
  tick: number,
): Entity | null {
  const race = data.races[cast.race];
  const birthplace = data.locations[cast.birthplace];
  if (!race || !birthplace) return null;
  const entity: Entity = {
    id: cast.id,
    type: 'character',
    origin: 'canon',
    name: cast.name,
    createdTick: tick,
    tier: 1,
    flags: { 'canon.cast': true },
    stats: {},
    knownBy: [PUBLIC_KNOWLEDGE],
    character: {
      givenName: cast.givenName,
      familyName: cast.familyName,
      pronouns: cast.pronouns,
      race: cast.race,
      birthTick: tickOfWhen(cast.born),
      birthplace: birthplace.culture,
      alive: true,
      traits: [...race.innateTraits, ...cast.traits.filter((t) => !race.innateTraits.includes(t))],
      appearance: {},
      scars: [],
      relationships: [],
      berries: 0,
      place: cast.birthplace,
    },
  };
  if (cast.epithet) entity.flags['epithet'] = cast.epithet;
  setStats(data, entity, cast, tick);
  applyKeyframe(entity, keyframeAt(cast, tick), cast.birthplace);
  state.entities[entity.id] = entity;
  // Phase 4: traits' modifiers (King's Qualities is hidden), and their powers by era.
  reapplyTraits(data, entity);
  applyCanonEra(state, data, entity, tick);
  // Phase 5: their rung on the power ladder for this era.
  calibrateCast(data, entity, tick);
  return entity;
}

/** Spawn every canon character born by `tick` who does not exist yet (dev fixtures only in dev worlds). */
export function spawnDueCast(state: WorldState, data: GameData, tick: number): Entity[] {
  const dev = withDevFixtures(state);
  const born: Entity[] = [];
  for (const id of Object.keys(data.cast).sort()) {
    const cast = data.cast[id] as CastMember;
    if (cast.dev && !dev) continue;
    if (id in state.entities) continue;
    if (tickOfWhen(cast.born) > tick) continue;
    const entity = makeCastEntity(state, data, cast, tick);
    if (entity) born.push(entity);
  }
  return born;
}

/**
 * The Tier 1 behaviour of a canon character, every month: follow the keyframes while still on the
 * story's path (and before the cutoff); on each birthday, grow into (or out of) their prime.
 */
export function followCanon(
  data: GameData,
  entity: Entity,
  tick: number,
  state?: WorldState,
): void {
  const cast = data.cast[entity.id];
  const c = entity.character;
  if (!cast || !c?.alive) return;
  if (tick > c.birthTick && (tick - c.birthTick) % 12 === 0) setStats(data, entity, cast, tick);
  if (entity.origin === 'canon' && tick <= cutoffTick(data)) {
    applyKeyframe(entity, keyframeAt(cast, tick), c.place ?? cast.birthplace);
    if (state) applyCanonEra(state, data, entity, tick);
  }
  // Phase 5: their rung on the power ladder for this era (off the story's path too).
  calibrateCast(data, entity, tick);
}

// ---- Deaths -------------------------------------------------------------------------------------

export interface DeathContext {
  tick: number;
  /** A death the story itself calls for (a beat's outcome). Anything else of a canon character is early. */
  canon: boolean;
  cause: string;
  causeSeq?: number;
  newsDrafts?: NewsDraft[];
}

function canonVars(
  data: GameData,
  tick: number,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    ...templateVarsFor(dateOf(data.calendar, tick)),
    'player.name': 'someone',
    'player.givenName': 'someone',
    'player.familyName': 'someone',
    'player.race': 'person',
    'player.home': 'home',
    'legacy.parent': 'a parent',
    'legacy.parentName': 'a parent',
    place: 'somewhere',
    destination: 'somewhere',
    ship: 'the ship',
    name: 'someone',
    title: '',
    beat: 'something',
    cause: 'unknown causes',
    successor: 'someone',
    crew: 'crew',
    fruit: 'fruit',
    ...extra,
  };
}

/** Render one of canon.json's lines. */
export function canonLine(
  data: GameData,
  template: string,
  tick: number,
  extra: Record<string, string>,
): string {
  const text = renderTemplate(template, canonVars(data, tick, extra));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Mark a canon character as having left the story: they stop following keyframes. */
export function divergeCharacter(state: WorldState, id: string): boolean {
  const entity = state.entities[id];
  if (!entity || entity.origin !== 'canon') return false;
  entity.origin = 'canon-diverged';
  return true;
}

/** A crew's captain is gone: the next in line takes over, or the crew breaks up. */
export function crewSuccession(
  state: WorldState,
  data: GameData,
  deadId: string,
  ctx: DeathContext,
): void {
  for (const id of entityIds(state)) {
    const org = state.entities[id];
    if (!org?.org || org.org.leaderId !== deadId || !org.org.active) continue;
    const order = [...(data.factions[id]?.succession ?? []), ...org.org.members];
    const next = order.find((cid) => cid !== deadId && state.entities[cid]?.character?.alive);
    if (next) {
      org.org.leaderId = next;
      const successor = state.entities[next];
      appendLog(state, ctx.tick, {
        kind: 'world',
        summary: canonLine(data, data.canonRules.lines.successor, ctx.tick, {
          successor: successor?.name ?? next,
          crew: org.name.replace(/^The /, ''),
        }),
        tags: ['world', 'canon', 'crew'],
        actorIds: [next],
        targetIds: [id],
        cause: 'sys:succession',
        ...(ctx.causeSeq !== undefined ? { causeSeq: ctx.causeSeq } : {}),
        knownBy: [],
      });
    } else {
      org.org.active = false;
      org.org.endedTick = ctx.tick;
      appendLog(state, ctx.tick, {
        kind: 'world',
        summary: canonLine(data, data.canonRules.lines.crewEnds, ctx.tick, {
          crew: org.name.replace(/^The /, ''),
        }),
        tags: ['world', 'canon', 'crew'],
        targetIds: [id],
        cause: 'sys:succession',
        ...(ctx.causeSeq !== undefined ? { causeSeq: ctx.causeSeq } : {}),
        knownBy: [],
      });
    }
  }
}

/**
 * Someone who is not the player dies. A canon character who dies when the story did not call for
 * it dies early: their fruit returns to the world, the news fires, and the people tied to them
 * leave the story (canon-diverged). Either way, a captain's crew picks a successor.
 */
export function killCharacter(
  state: WorldState,
  data: GameData,
  entity: Entity,
  ctx: DeathContext,
): void {
  const c = entity.character;
  if (!c?.alive) return;
  c.alive = false;
  c.death = { tick: ctx.tick, cause: ctx.cause };
  const cast = data.cast[entity.id];
  const record = appendLog(state, ctx.tick, {
    kind: cast ? 'world' : 'life',
    summary: `${entity.name} died: ${ctx.cause}.`,
    tags: ['world', 'death', ...(cast ? ['canon'] : [])],
    actorIds: [entity.id],
    place: c.place ?? null,
    cause: ctx.canon ? 'canon:death' : 'sys:death',
    ...(ctx.causeSeq !== undefined ? { causeSeq: ctx.causeSeq } : {}),
    knownBy: [],
  });
  crewSuccession(state, data, entity.id, { ...ctx, causeSeq: record.seq });
  // Phase 4: whoever dies, their fruit grows again somewhere (canon deaths included).
  releaseFruitOf(
    state,
    data,
    entity,
    ctx.tick,
    Rng.root(state.seed).fork('fruit-death', entity.id, ctx.tick),
    record.seq,
  );
  if (!cast || ctx.canon || entity.origin === 'canon-diverged') return;

  // An early death: the story has lost someone it was counting on.
  const lines = data.canonRules.lines;
  state.canon.divergences.push({
    tick: ctx.tick,
    kind: 'early-death',
    entity: entity.id,
    text: canonLine(data, lines.earlyDeath, ctx.tick, { name: entity.name, cause: ctx.cause }),
    causeSeq: record.seq,
  });
  ctx.newsDrafts?.push({
    text: canonLine(data, lines.earlyDeathNews, ctx.tick, { name: entity.name }),
    tags: ['news', 'canon', 'death'],
    sourceSeq: record.seq,
    place: c.place ?? null,
  });
  for (const tie of cast.ties) divergeCharacter(state, tie);
  divergeCharacter(state, entity.id);
}
