import type { GameData, Moveset, TechForm, TechniqueDef } from '../../engine/data/schemas';
import { tickOfWhen } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { Entity, Move, WorldState } from '../../engine/state';
import { fruitDefOf, techniqueName } from './catalogue';
import { eatenFruit } from './fruits';
import { ensurePowers, HAKI_TRACKS, stageIndexOf } from './state';
import { refreshPowerMods, setStage, type PowerCtx } from './tracks';
import { pricedTechnique, techniqueIndex } from './techniques';

/**
 * Movesets of the canon cast by era, and of generated fighters (Phase 4).
 *
 * A canon character's techniques are keyed to the years they had them (data/movesets), so someone
 * met in 1516 SC does not yet know what they show in 1524 SC; the era also sets their power
 * tracks (haki, styles, swords) and their fruit's mastery. A generated fighter's moveset is built
 * from their style, fruit, weapon, haki and temperament (an aggressive brawler leans to offence, a
 * cautious swordsman to counters), named with a grammar per culture.
 */

type Era = Moveset['eras'][number];

const movesetByChar = new WeakMap<GameData, Map<string, Moveset>>();

export function movesetOfCast(data: GameData, charId: string): Moveset | undefined {
  let index = movesetByChar.get(data);
  if (!index) {
    index = new Map(Object.values(data.movesets).map((m) => [m.char, m]));
    movesetByChar.set(data, index);
  }
  return index.get(charId);
}

/** The era in force at a tick (null before the first). */
export function eraAt(moveset: Moveset, tick: number): Era | null {
  let found: Era | null = null;
  for (const era of moveset.eras) {
    if (tickOfWhen(era.from) > tick) break;
    if (era.to && tickOfWhen(era.to) < tick) {
      found = null;
      continue;
    }
    found = era;
  }
  return found;
}

/**
 * Bring a canon character's powers to their era: stages, fruit mastery and the techniques they
 * know then. Called monthly while they follow the story (and when they are made).
 */
export function applyCanonEra(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
): void {
  const moveset = movesetOfCast(data, entity.id);
  const c = entity.character;
  if (!moveset || !c) return;
  const era = eraAt(moveset, tick);
  if (!era) return;
  const key = `${tickOfWhen(era.from)}`;
  if (entity.flags['moveset.era'] === key) return;
  entity.flags['moveset.era'] = key;
  const ctx: PowerCtx = {
    state,
    data,
    tick,
    rng: Rng.root(`canon:${entity.id}`),
    entity,
    c,
    placeId: c.place ?? null,
  };
  for (const [trackId, stageId] of Object.entries(era.tracks)) {
    const track = data.tracks[trackId];
    if (!track) continue;
    setStage(ctx, trackId, Math.max(0, stageIndexOf(track, stageId)));
  }
  if (era.mastery !== undefined && c.powers?.fruit) {
    for (const [id, ts] of Object.entries(c.powers.tracks)) {
      if (data.tracks[id]?.family !== 'fruit') continue;
      ts.progress = era.mastery;
      const track = data.tracks[id];
      if (track)
        ts.stage = Math.max(0, track.stages.filter((s) => s.at <= era.mastery!).length - 1);
    }
  }
  const powers = ensurePowers(c);
  const index = techniqueIndex(data);
  // A canon character knows exactly their era's moves (rule 4's canon: not next decade's).
  const keep = powers.moves.filter((m) => m.source !== 'canon' && m.source !== 'fruit');
  for (const id of era.techniques) {
    if (keep.some((m) => m.id === id)) continue;
    const entry = index.get(id);
    if (!entry) continue;
    keep.push({
      id,
      source: entry.source.startsWith('fruit:') ? 'fruit' : 'canon',
      mastery: 70,
      uses: id === era.signature ? 60 : id === era.finisher ? 20 : 10,
      learnedTick: tickOfWhen(era.from),
      lastUsed: tick,
      faded: false,
    });
  }
  powers.moves = keep;
  refreshPowerMods(data, entity, tick, state);
}

// ---- Generated fighters -------------------------------------------------------------------

export type Temperament = 'aggressive' | 'cautious' | 'balanced';

export function temperamentOf(data: GameData, entity: Entity): Temperament {
  const traits = entity.character?.traits ?? [];
  for (const [temper, ids] of Object.entries(data.powers.moveset.temperamentTraits)) {
    if (ids.some((id) => traits.includes(id))) return temper as Temperament;
  }
  return 'balanced';
}

const OFFENCE = new Set<TechForm>(['strike', 'barrage', 'projectile', 'area', 'grapple']);
export function isOffence(form: TechForm): boolean {
  return OFFENCE.has(form);
}

/**
 * Give a generated fighter their powers at creation: tracks by occupation (only those their people
 * and body can learn), stages by age and luck, haki by sea, gear. Their moveset follows.
 */
export function arm(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
  rng: Rng,
): void {
  const c = entity.character;
  if (!c?.occupation) return;
  const plan = data.powers.fighters[c.occupation];
  if (!plan) return;
  const ctx: PowerCtx = { state, data, tick, rng, entity, c, placeId: c.place ?? null };
  const age = Math.max(0, (tick - c.birthTick) / 12);
  const seasoning = Math.max(0, Math.min(1, (age - 14) / 25));
  const options = Object.entries(plan.tracks).filter(([id]) => {
    const track = data.tracks[id];
    if (!track) return false;
    const rate = track.learn.raceRates[c.race] ?? track.learn.defaultRate;
    if (rate <= 0) return false;
    const races = track.learn.requires.races;
    return races.length === 0 || races.includes(c.race);
  });
  const chosen = rng
    .fork('tracks')
    .shuffle([...options])
    .slice(0, plan.count);
  for (const [id, maxStage] of chosen) {
    const top = Math.round(maxStage * seasoning * rng.fork('stage', id).float(0.4, 1.1));
    setStage(ctx, id, Math.max(0, Math.min(maxStage, top)));
  }
  const loc = c.place ? data.locations[c.place] : undefined;
  const hakiChance = loc ? (data.powers.hakiByRegion[loc.region] ?? 0) : 0;
  for (const colour of ['observation', 'armament'] as const) {
    if (rng.fork('haki', colour).chance(hakiChance * seasoning)) {
      const track = data.tracks[HAKI_TRACKS[colour]];
      if (track)
        setStage(
          ctx,
          track.id,
          Math.floor(
            rng
              .fork('hakiStage', colour)
              .float(0, Math.min(3, track.stages.length - 1) * seasoning + 0.99),
          ),
        );
    }
  }
  const powers = ensurePowers(c);
  for (const [kind, n] of Object.entries(plan.gear)) powers.gear[kind] = n ?? 1;
  refreshPowerMods(data, entity, tick, state);
}

/** A generated fighter's moveset, built the same way every time from who they are (rule 6). */
export function generatedMoves(
  state: WorldState,
  data: GameData,
  entity: Entity,
  seed: string,
): Move[] {
  const c = entity.character;
  if (!c?.powers) return [];
  const rng = Rng.root(seed).fork('moveset', entity.id);
  const temper = temperamentOf(data, entity);
  const weights = data.powers.moveset.temperaments[temper] ?? {};
  const culture = c.birthplace;
  const used = new Set<string>();
  const moves: Move[] = [];
  const index = techniqueIndex(data);
  const add = (id: string, source: string, def?: TechniqueDef) => {
    if (moves.some((m) => m.id === id)) return;
    moves.push({
      id,
      source,
      mastery: 30,
      uses: 0,
      learnedTick: entity.createdTick,
      lastUsed: null,
      faded: false,
      ...(def ? { def } : {}),
    });
  };
  // What their tracks teach, up to their stage.
  for (const [trackId, ts] of Object.entries(c.powers.tracks).sort()) {
    const track = data.tracks[trackId];
    if (!track) continue;
    for (let i = 0; i <= ts.stage; i++) {
      for (const tech of track.stages[i]?.techniques ?? [])
        if (index.has(tech)) add(tech, `track:${trackId}`);
    }
  }
  // What their fruit teaches, up to their mastery.
  const fruit = eatenFruit(state, entity);
  const fdef = fruitDefOf(data, fruit);
  if (fdef) {
    let mastery = 0;
    for (const [id, ts] of Object.entries(c.powers.tracks))
      if (data.tracks[id]?.family === 'fruit') mastery = ts.progress;
    for (const tech of fdef.techniques)
      if (tech.mastery <= mastery)
        add(tech.id, 'fruit', fdef.origin === 'generated' ? tech : undefined);
  }
  // Moves of their own, named in their people's way and shaped by their temperament.
  const sources = Object.keys(c.powers.tracks)
    .filter((id) => data.tracks[id] && data.tracks[id]?.family !== 'fruit')
    .sort();
  const own = 2 + rng.fork('own').int(0, 2);
  for (let i = 0; i < own && sources.length > 0; i++) {
    const r = rng.fork('own', i);
    const trackId = r.fork('source').pick(sources);
    const track = data.tracks[trackId];
    if (!track) continue;
    const forms = (Object.keys(weights) as TechForm[]).filter((f) => (weights[f] ?? 0) > 0);
    const form = r.fork('form').weightedPick(forms, (f) => weights[f] ?? 0) ?? 'strike';
    const tags = trackTags(data, trackId);
    const def: TechniqueDef = {
      id: `tech_gen_${entity.id.replace(/[^a-z0-9]/g, '')}_${i + 1}`,
      name: techniqueName(
        data,
        r,
        culture,
        track.word ?? track.name.split(' ')[0] ?? 'Iron',
        form,
        used,
      ),
      form,
      tags: tags.length > 0 ? tags.slice(0, 2) : ['blunt'],
      mastery: 0,
      stats: {},
      effects: [],
      finisher: i === own - 1 && temper !== 'cautious',
      named: false,
    };
    add(def.id, `track:${trackId}`, pricedTechnique(data, def));
  }
  return moves;
}

function trackTags(data: GameData, trackId: string): TechniqueDef['tags'] {
  const index = techniqueIndex(data);
  const tags = new Set<TechniqueDef['tags'][number]>();
  for (const stage of data.tracks[trackId]?.stages ?? []) {
    for (const id of stage.techniques)
      for (const tag of index.get(id)?.def.tags ?? []) tags.add(tag);
  }
  return [...tags].sort();
}

/** Anyone's moveset now: the player's own, a canon character's era, or a generated fighter's. */
export function movesetFor(state: WorldState, data: GameData, entity: Entity): Move[] {
  const c = entity.character;
  if (!c) return [];
  if (state.playerId === entity.id || entity.id in data.cast || entity.tier === 1)
    return c.powers?.moves ?? [];
  return generatedMoves(state, data, entity, state.seed);
}
