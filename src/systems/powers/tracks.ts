import { weaponCombat } from '../battle/fighters';
import { calibrateCast } from '../battle/ladder';
import type { GameData, PracticeKind, Teacher, Track, TrackStage } from '../../engine/data/schemas';
import { POWER_LEVELS } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { CharacterData, Entity, TrackState, WorldState } from '../../engine/state';
import { addMod, statValue } from '../../engine/stats';
import { roundTo } from '../genesis/context';
import { formatBerries } from '../genesis/text';
import { flagOf, livingRelations, requirementReason, statTotal, type Person } from '../life/body';
import { lifeLog, renderLife, reportLine, type LifeEnv } from '../life/env';
import { placeFromLocation } from '../places/place';
import { applyFruitMods } from './fruits';
import {
  bonusStat,
  clearPowerMods,
  ensurePowers,
  eventSince,
  levelIndex,
  nextStageOf,
  powerSource,
  stageIndexOf,
  stageOf,
  trackStateOf,
} from './state';

/**
 * Power tracks (Phase 4): one engine for every power. A track is a tree of named stages; each
 * stage needs progress plus stat minimums and sometimes a teacher, a place, gear or an event ("a
 * fight against someone clearly stronger"). Progress comes from practice points: drills x1,
 * sparring x1.5, real fights x3, teaching others x0.5, and breakthroughs. At a plateau (a stage
 * marked `breakthrough`) a track stalls until a breakthrough; a track left unused for years rusts
 * inside its stage, never below it; race, talent and body set how far someone can go.
 *
 * Fruit tracks count mastery (0 to 100) instead of points, grown by the Phase 2 training formula
 * (diminishing returns toward 100), with Intellect speeding Paramecia insight and Endurance Zoan
 * control (each track's `speedStats`).
 */

/** Who the track engine is working on: the player (with a life to write into) or anyone else. */
export interface PowerCtx {
  state: WorldState;
  data: GameData;
  tick: number;
  rng: Rng;
  entity: Entity;
  c: CharacterData;
  /** Where they are: a location id, or null at sea. */
  placeId: string | null;
  /** The player's month, when it is the player: lines go into the chronicle. */
  env?: LifeEnv;
}

export function powerCtxOf(env: LifeEnv): PowerCtx {
  return {
    state: env.state,
    data: env.data,
    tick: env.tick,
    rng: env.rng,
    entity: env.p.entity,
    c: env.p.c,
    placeId: env.p.place.atSea ? null : env.p.place.id,
    env,
  };
}

/** Anyone's power context (no chronicle). */
export function powerCtxFor(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
  rng: Rng,
): PowerCtx | null {
  const c = entity.character;
  if (!c) return null;
  return { state, data, tick, rng, entity, c, placeId: c.place ?? null };
}

/** Write a power's line into the player's chronicle and month card (nothing for anyone else). */
export function tell(
  ctx: PowerCtx,
  template: string,
  vars: Record<string, string>,
  tags: string[],
  tone: 'good' | 'bad' | 'plain' | 'alert' = 'good',
  event = true,
): void {
  if (!ctx.env) return;
  const text = renderLife(ctx.env, template, vars);
  lifeLog(ctx.env, text, { kind: event ? 'event' : 'life', tags: ['personal', 'power', ...tags] });
  reportLine(ctx.env, text, tone);
}

export function line(data: GameData, id: string): string {
  const text = data.powers.lines[id];
  if (text === undefined) throw new Error(`data/powers.json has no line "${id}"`);
  return text;
}

// ---- Teachers -------------------------------------------------------------------------------

function teacherMatches(data: GameData, teacher: Teacher, placeId: string | null): boolean {
  if (placeId === null) return false;
  const loc = data.locations[placeId];
  if (!loc) return false;
  if (teacher.places.length > 0 && !teacher.places.includes(placeId)) return false;
  if (teacher.features.length > 0 && !teacher.features.some((f) => loc.features.includes(f)))
    return false;
  if (teacher.regions.length > 0 && !teacher.regions.includes(loc.region)) return false;
  return true;
}

/** A teacher of this track at the place someone is (and willing to teach them), or null. */
export function teacherAt(
  state: WorldState,
  data: GameData,
  p: Person,
  track: Track,
  tick: number,
): Teacher | null {
  const placeId = p.place.atSea ? null : p.place.id;
  // The best teacher willing to take them on here (a Wano master over a village dojo).
  let best: Teacher | null = null;
  for (const teacher of track.learn.teachers) {
    if (!teacherMatches(data, teacher, placeId)) continue;
    if (requirementReason(state, data, p, teacher.requires, tick) !== null) continue;
    if (!best || teacher.mult > best.mult) best = teacher;
  }
  return best;
}

/** "Fish-Man Island", "any place with a dojo", for the Powers page. */
export function whereTaught(data: GameData, track: Track): string[] {
  return track.learn.teachers.map((t) => {
    const where: string[] = [];
    if (t.places.length > 0)
      where.push(t.places.map((id) => data.locations[id]?.name ?? id).join(', '));
    if (t.features.length > 0)
      where.push(`anywhere with ${t.features.join(' or ').replace(/_/g, ' ')}`);
    if (t.regions.length > 0) where.push(`in ${t.regions.join(' or ').replace(/_/g, ' ')}`);
    const fee = t.fee > 0 ? `, ${formatBerries(t.fee)} Berries` : '';
    return `${t.name}: ${where.join(', ') || 'anywhere'}${fee}`;
  });
}

export function raceRate(track: Track, race: string): number {
  return track.learn.raceRates[race] ?? track.learn.defaultRate;
}

/** Why this person cannot be taken on in a track here and now, or null when they can. */
export function learnLock(
  state: WorldState,
  data: GameData,
  p: Person,
  track: Track,
  tick: number,
): string | null {
  if (trackStateOf(p.c, track.id)) return 'Already learning this';
  switch (track.learn.how) {
    case 'wake':
      return 'Haki is not taught; it wakes';
    case 'fruit':
      return 'Comes only with a Devil Fruit';
    case 'event':
      return 'Only an invitation or a find opens this';
    case 'innate':
    case 'teacher':
      break;
  }
  const req = requirementReason(state, data, p, track.learn.requires, tick);
  if (req) return req;
  const rate = raceRate(track, p.race.id);
  if (rate <= 0) return `Not open to a ${p.race.name}`;
  const outsider = track.learn.outsiderFlag;
  if (rate < 1 && outsider && flagOf(state, p.entity, outsider) === undefined) {
    return 'Its masters do not yet trust an outsider';
  }
  if (track.learn.how === 'innate') return null;
  if (p.place.atSea) return 'No teacher at sea';
  const teacher = teacherAt(state, data, p, track, tick);
  if (!teacher) return 'No teacher here';
  if (p.c.berries < teacher.fee) return `The teacher wants ${formatBerries(teacher.fee)} Berries`;
  return null;
}

// ---- Opening a track ------------------------------------------------------------------------

function applyStage(ctx: PowerCtx, track: Track, stage: TrackStage): void {
  Object.assign(ctx.entity.flags, stage.flags);
  const powers = ensurePowers(ctx.c);
  for (const tech of stage.techniques) {
    if (powers.moves.some((m) => m.id === tech)) continue;
    powers.moves.push({
      id: tech,
      source: `track:${track.id}`,
      mastery: 10,
      uses: 0,
      learnedTick: ctx.tick,
      lastUsed: null,
      faded: false,
    });
  }
}

export interface OpenOptions {
  source: string;
  teacherMult?: number;
  taughtAt?: string;
  /** Write the "you began" line (false when a stage line follows anyway, or nobody is told). */
  quiet?: boolean;
}

/** Open a track at its first stage (and the tracks it opens). False if it was open already. */
export function openTrack(ctx: PowerCtx, trackId: string, options: OpenOptions): boolean {
  const { data, tick } = ctx;
  const track = data.tracks[trackId];
  if (!track) throw new Error(`no power track "${trackId}"`);
  const powers = ensurePowers(ctx.c);
  if (powers.tracks[trackId]) return false;
  const ts: TrackState = {
    stage: 0,
    progress: 0,
    breakthrough: false,
    since: tick,
    lastUsed: tick,
    months: 0,
  };
  if (options.teacherMult !== undefined) ts.teacherMult = options.teacherMult;
  if (options.taughtAt !== undefined) ts.taughtAt = options.taughtAt;
  powers.tracks[trackId] = ts;
  applyStage(ctx, track, track.stages[0] as TrackStage);
  if (
    powers.focus === null &&
    (track.family === 'style' || track.family === 'sword' || track.family === 'six_powers')
  ) {
    powers.focus = trackId;
  }
  if (!options.quiet) {
    tell(ctx, (track.stages[0] as TrackStage).text, { title: track.name }, ['learn']);
  }
  for (const other of track.learn.opens) openTrack(ctx, other, { ...options, quiet: true });
  refreshPowerMods(ctx.data, ctx.entity, tick, ctx.state);
  return true;
}

/** Be taken on by a teacher here: pays the fee and opens the track (the player's action). */
export function learnFromTeacher(env: LifeEnv, trackId: string): void {
  const { state, data, p, tick } = env;
  const track = data.tracks[trackId];
  if (!track) throw new Error(`There is no power track "${trackId}"`);
  const why = learnLock(state, data, p, track, tick);
  if (why) throw new Error(why);
  const teacher = track.learn.how === 'teacher' ? teacherAt(state, data, p, track, tick) : null;
  if (teacher && teacher.fee > 0) p.c.berries -= teacher.fee;
  const ctx = powerCtxOf(env);
  openTrack(ctx, trackId, {
    source: teacher ? teacher.name : 'self-taught',
    ...(teacher ? { teacherMult: teacher.mult, taughtAt: p.place.id } : {}),
    quiet: true,
  });
  tell(
    ctx,
    line(data, teacher ? 'takenOn' : 'beganAlone'),
    { title: track.name, other: teacher?.name ?? 'nobody' },
    ['learn'],
  );
}

/** Put someone straight onto a stage (canon characters by era, generated fighters at creation). */
export function setStage(ctx: PowerCtx, trackId: string, stageIndex: number): void {
  const track = ctx.data.tracks[trackId];
  if (!track) return;
  const powers = ensurePowers(ctx.c);
  let ts = powers.tracks[trackId];
  if (!ts) {
    ts = {
      stage: 0,
      progress: 0,
      breakthrough: false,
      since: ctx.tick,
      lastUsed: ctx.tick,
      months: 0,
    };
    powers.tracks[trackId] = ts;
  }
  const index = Math.max(0, Math.min(track.stages.length - 1, stageIndex));
  for (let i = 0; i <= index; i++) applyStage(ctx, track, track.stages[i] as TrackStage);
  if (index > ts.stage || ts.progress < (track.stages[index] as TrackStage).at) {
    ts.stage = index;
    ts.progress = Math.max(ts.progress, (track.stages[index] as TrackStage).at);
    ts.since = ctx.tick;
  }
}

// ---- How fast, and how far ------------------------------------------------------------------

/** Practice speed: race, the stats that speed this track, talent, traits. */
export function practiceRate(
  data: GameData,
  entity: Entity,
  c: CharacterData,
  track: Track,
  tick: number,
): number {
  let rate = raceRate(track, c.race);
  for (const [stat, factor] of Object.entries(track.speedStats)) {
    rate *= Math.max(0.2, 1 + (factor ?? 0) * ((statTotal(entity, stat, tick) - 50) / 100));
  }
  const talent = data.character.talentTiers.find((t) => t.id === c.hidden?.talent);
  rate *= talent?.growthMult ?? 1;
  let pct = 0;
  for (const id of c.traits) {
    const trait = data.traits[id];
    if (!trait) continue;
    pct += trait.trainingGainPct;
    pct += trait.powerMods[track.id] ?? 0;
    pct += trait.powerMods[`family:${track.family}`] ?? 0;
  }
  return Math.max(0, rate * (1 + pct / 100));
}

/** The furthest stage index this person can ever reach in a track (race, body, talent). */
export function ceilingOf(
  data: GameData,
  c: CharacterData,
  track: Track,
): { index: number; reason: string | null } {
  let index = track.stages.length - 1;
  let reason: string | null = null;
  for (const ceiling of track.ceilings) {
    const raceHits = ceiling.races.length === 0 || ceiling.races.includes(c.race);
    const excused = ceiling.traits.some((t) => c.traits.includes(t));
    if (!raceHits || excused) continue;
    const at = stageIndexOf(track, ceiling.stage);
    if (at >= 0 && at < index) {
      index = at;
      reason = ceiling.reason;
    }
  }
  const talent = c.hidden?.talent ?? 'ordinary';
  const maxLevel = data.powers.talentCeilings[talent];
  if (maxLevel) {
    const limit = levelIndex(maxLevel);
    for (let i = 1; i <= index; i++) {
      const stage = track.stages[i] as TrackStage;
      if (levelIndex(stage.level) > limit && !stage.requires.hidden) {
        index = i - 1;
        reason = reason ?? 'You cannot find the way any further';
        break;
      }
    }
  }
  return { index, reason };
}

function hasTeacher(ctx: PowerCtx, track: Track, ts: TrackState): boolean {
  const { state, data, placeId } = ctx;
  if (placeId === null) return false;
  if (ts.taughtAt === placeId) return true;
  if (track.learn.teachers.some((t) => teacherMatches(data, t, placeId))) return true;
  return livingRelations(state, ctx.c, 'mentor').some(
    (m) => m.flags[`teaches.${track.id}`] === true && m.character?.place === placeId,
  );
}

/** Why the next stage cannot be entered yet, beyond the progress (null: nothing in the way). */
export function stageLock(
  ctx: PowerCtx,
  track: Track,
  ts: TrackState,
  stage: TrackStage,
): string | null {
  const { data, entity, c, tick } = ctx;
  const target = stageIndexOf(track, stage.id);
  const ceiling = ceilingOf(data, c, track);
  if (target > ceiling.index) return ceiling.reason ?? 'As far as you can go';
  const r = stage.requires;
  for (const [stat, min] of Object.entries(r.stats)) {
    const have = statTotal(entity, stat, tick);
    if (have < (min ?? 0)) return `Needs ${stat.charAt(0).toUpperCase()}${stat.slice(1)} ${min}`;
  }
  for (const [other, stageId] of Object.entries(r.tracks)) {
    const ots = trackStateOf(c, other);
    const otrack = data.tracks[other];
    const want = otrack ? stageIndexOf(otrack, stageId) : -1;
    if (!ots || !otrack || ots.stage < want) {
      return `Needs ${otrack?.name ?? other} at ${otrack?.stages[want]?.name ?? stageId}`;
    }
  }
  if (r.races.length > 0 && !r.races.includes(c.race)) return 'Not for your people';
  if (r.anyTraits.length > 0 && !r.anyTraits.some((t) => c.traits.includes(t))) {
    return r.hidden
      ? 'Something is missing'
      : `Needs ${r.anyTraits.map((t) => data.traits[t]?.name ?? t).join(' or ')}`;
  }
  const blocked = r.notTraits.find((t) => c.traits.includes(t));
  if (blocked) return `Not with ${data.traits[blocked]?.name ?? blocked}`;
  for (const [flag, wanted] of Object.entries(r.flags)) {
    const actual = flagOf(ctx.state, entity, flag);
    const ok =
      typeof wanted === 'number'
        ? typeof actual === 'number' && actual >= wanted
        : actual === wanted;
    if (!ok) return r.hidden ? 'Something is missing' : 'Not unlocked yet';
  }
  for (const [kind, count] of Object.entries(r.gear)) {
    if ((c.powers?.gear[kind] ?? 0) < (count ?? 1)) {
      return kind === 'swords'
        ? `Needs ${count === 1 ? 'a sword' : `${count} swords`}`
        : `Needs a ${kind}`;
    }
  }
  if (r.places.length > 0 && (ctx.placeId === null || !r.places.includes(ctx.placeId))) {
    return `Only at ${r.places.map((id) => data.locations[id]?.name ?? id).join(' or ')}`;
  }
  if (r.features.length > 0) {
    const loc = ctx.placeId ? data.locations[ctx.placeId] : undefined;
    const place = loc ? placeFromLocation(data, loc) : null;
    if (!place || !r.features.some((f) => place.features.includes(f))) return 'Not here';
  }
  if (r.teacher && !hasTeacher(ctx, track, ts)) return 'Needs a teacher';
  if (r.event && !eventSince(c, r.event, ts.since)) return eventText(r.event);
  if (r.breakthrough && !ts.breakthrough) return 'A plateau: only a breakthrough opens it';
  return null;
}

const EVENT_TEXT: Record<string, string> = {
  stronger_foe: 'Needs a fight against someone clearly stronger',
  near_death: 'Needs a brush with death',
  crisis: 'Needs a crisis, someone to protect',
  defeat: 'Needs a shattering defeat',
  mentor_push: "Needs a mentor's push",
  clash: 'Needs a clash with another of the same power',
  blindfold: 'Needs a month of blindfold drills',
  water_time: 'Needs time in the water',
  trust: 'Needs the trust of its masters',
  scroll: 'Needs a scroll of the style',
  moon: 'Needs a full moon',
  invitation: 'Needs an invitation',
  starvation: 'Needs a hard hunger',
};

export function eventText(event: string): string {
  return EVENT_TEXT[event] ?? 'Needs something to happen';
}

// ---- Progress -------------------------------------------------------------------------------

/** How far progress may go before a stage that cannot be entered yet holds it back. */
function capFor(ctx: PowerCtx, track: Track, ts: TrackState): number {
  let cap = track.mode === 'mastery' ? 100 : Infinity;
  for (let i = ts.stage + 1; i < track.stages.length; i++) {
    const stage = track.stages[i] as TrackStage;
    if (stageLock(ctx, track, ts, stage) !== null) {
      cap = Math.min(cap, stage.at);
      break;
    }
  }
  return cap;
}

export interface Advance {
  track: Track;
  gained: number;
  stages: TrackStage[];
}

/** Enter every stage whose progress and requirements are met. */
export function tryAdvance(ctx: PowerCtx, trackId: string): TrackStage[] {
  const track = ctx.data.tracks[trackId];
  const ts = trackStateOf(ctx.c, trackId);
  if (!track || !ts) return [];
  const reachedStages: TrackStage[] = [];
  for (;;) {
    const next = nextStageOf(track, ts);
    if (!next || ts.progress < next.at || stageLock(ctx, track, ts, next) !== null) break;
    ts.stage += 1;
    ts.since = ctx.tick;
    if (next.requires.breakthrough) ts.breakthrough = false;
    applyStage(ctx, track, next);
    reachedStages.push(next);
    tell(ctx, next.text, { title: next.name }, ['stage', track.family]);
  }
  if (reachedStages.length > 0) refreshPowerMods(ctx.data, ctx.entity, ctx.tick, ctx.state);
  return reachedStages;
}

/**
 * Add practice to a track. `points` is the base already scaled by effort and the stage of life;
 * this applies the kind of practice, the practice rate, the teacher, and (fruit tracks) the
 * training formula's diminishing returns. Returns the progress gained.
 */
export function addProgress(
  ctx: PowerCtx,
  trackId: string,
  points: number,
  kind: PracticeKind,
): number {
  const { data, tick } = ctx;
  const track = data.tracks[trackId];
  const ts = trackStateOf(ctx.c, trackId);
  if (!track || !ts || points <= 0) return 0;
  ts.lastUsed = tick;
  const teacher = ts.teacherMult !== undefined && hasTeacher(ctx, track, ts) ? ts.teacherMult : 1;
  let gain =
    points *
    data.powers.practice[kind] *
    practiceRate(data, ctx.entity, ctx.c, track, tick) *
    teacher;
  if (track.mode === 'mastery') {
    gain *= data.powers.fruit.masteryPoints * Math.max(0, 1 - ts.progress / 100);
    const soft = data.character.softCap;
    if (ts.progress / 100 >= soft.above) gain *= soft.factor;
  }
  const cap = capFor(ctx, track, ts);
  const before = ts.progress;
  ts.progress = roundTo(Math.min(cap, ts.progress + gain), 4);
  tryAdvance(ctx, trackId);
  return ts.progress - before;
}

/** Choose which of these tracks a practice goes to: the focus if listed, else the least advanced. */
export function practiceTarget(
  c: CharacterData,
  data: GameData,
  tracks: readonly string[],
): string | null {
  const open = tracks.filter((id) => trackStateOf(c, id) !== undefined && data.tracks[id]);
  if (open.length === 0) return null;
  const focus = c.powers?.focus;
  if (focus && open.includes(focus)) return focus;
  return [...open].sort((a, b) => {
    const pa = trackStateOf(c, a)?.progress ?? 0;
    const pb = trackStateOf(c, b)?.progress ?? 0;
    return pa - pb || (a < b ? -1 : 1);
  })[0] as string;
}

const COMBAT_FAMILIES = new Set(['style', 'sword', 'six_powers', 'weapon']);

/** The tracks sparring and real fights train when no track is named: the focus, or the fighting styles. */
export function fightingTracks(c: CharacterData, data: GameData): string[] {
  const tracks = Object.keys(c.powers?.tracks ?? {}).sort();
  const focus = c.powers?.focus;
  if (focus && tracks.includes(focus)) return [focus];
  return tracks.filter((id) => COMBAT_FAMILIES.has(data.tracks[id]?.family ?? ''));
}

/** A breakthrough: a plateau opens, and the track jumps ahead. */
export function breakthroughTrack(ctx: PowerCtx, trackId?: string): string | null {
  const { data } = ctx;
  const tracks = Object.keys(ctx.c.powers?.tracks ?? {}).sort();
  const stalled = tracks.find((id) => {
    const track = data.tracks[id];
    const ts = trackStateOf(ctx.c, id);
    const next = track && ts ? nextStageOf(track, ts) : null;
    return next?.requires.breakthrough === true && ts !== undefined && !ts.breakthrough;
  });
  const target = trackId ?? stalled ?? ctx.c.powers?.focus ?? tracks[0];
  if (!target) return null;
  const ts = trackStateOf(ctx.c, target);
  const track = data.tracks[target];
  if (!ts || !track) return null;
  ts.breakthrough = true;
  ts.lastUsed = ctx.tick;
  // A leap of practice on top (points tracks; a fruit's mastery grows only by use).
  if (track.mode === 'points') {
    ts.progress = roundTo(
      Math.min(capFor(ctx, track, ts), ts.progress + data.powers.breakthroughPoints),
      4,
    );
  }
  tell(ctx, line(data, 'breakthrough'), { title: track.name }, ['breakthrough']);
  tryAdvance(ctx, target);
  return target;
}

/** A month without practice: tracks unused for years lose progress inside their stage. */
export function rustMonth(ctx: PowerCtx): void {
  const { data, tick } = ctx;
  for (const [id, ts] of Object.entries(ctx.c.powers?.tracks ?? {})) {
    const track = data.tracks[id];
    if (!track) continue;
    const rust = track.rust ?? data.powers.rust;
    if (tick - ts.lastUsed <= rust.afterMonths) continue;
    const floor = stageOf(track, ts).at;
    const inside = ts.progress - floor;
    if (inside <= 0) continue;
    ts.progress = roundTo(Math.max(floor, ts.progress - (inside * rust.perYear) / 12), 4);
  }
}

// ---- Modifiers (rule 3) ---------------------------------------------------------------------

/**
 * Rebuild every modifier powers put on an entity: each open track's stage (Combat Power on the
 * bonus stat, and its stat modifiers), and the fruit (see fruits.ts `fruitMods`, added here too).
 */
export function refreshPowerMods(
  data: GameData,
  entity: Entity,
  tick: number,
  state?: WorldState,
): void {
  const c = entity.character;
  if (!c?.powers) return;
  clearPowerMods(entity);
  for (const id of Object.keys(c.powers.tracks).sort()) {
    const track = data.tracks[id];
    const ts = c.powers.tracks[id];
    if (!track || !ts) continue;
    const stage = stageOf(track, ts);
    const source = powerSource(`${track.name}: ${stage.name}`);
    if (stage.combat > 0) {
      addMod(bonusStat(entity, data.powers.combatBonusStat), {
        source,
        value: stage.combat,
        kind: 'flat',
      });
    }
    for (const mod of stage.statMods) {
      const stat = entity.stats[mod.stat];
      if (stat) addMod(stat, { source, value: mod.value, kind: mod.kind });
    }
  }
  applyFruitMods(state, data, entity);
  // Phase 5: the weapon term of Combat Power (the best weapon they carry).
  const weapon = weaponCombat(data, entity);
  if (weapon) {
    addMod(bonusStat(entity, data.powers.combatBonusStat), {
      source: powerSource(weapon.name),
      value: weapon.value,
      kind: 'flat',
    });
  }
  // A canon character's powers changed: put them back on their rung for the era.
  if (entity.id in data.cast) calibrateCast(data, entity, tick);
}

/** The level a track's stage belongs to, as a word ("Adept"). */
export function stageLevel(data: GameData, stage: TrackStage): string {
  return data.powers.levels.find((l) => l.id === stage.level)?.name ?? stage.level;
}

/** Progress toward the next stage, 0 to 1 (1 when at the last). */
export function progressToNext(track: Track, ts: TrackState): number {
  const here = stageOf(track, ts);
  const next = nextStageOf(track, ts);
  if (!next) return 1;
  const span = next.at - here.at;
  return span <= 0 ? 1 : Math.max(0, Math.min(1, (ts.progress - here.at) / span));
}

export { POWER_LEVELS, statValue };
