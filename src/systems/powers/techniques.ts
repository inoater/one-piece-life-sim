import type {
  GameData,
  TechEffect,
  TechForm,
  TechniqueDef,
  TechRange,
  TechTag,
} from '../../engine/data/schemas';
import { TECH_FORMS, TECH_TAGS } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, Move, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { reputationValue, statTotal } from '../life/body';
import { fruitDefOf } from './catalogue';
import { cursedNow, eatenFruit, fruitMastery } from './fruits';
import { ensurePowers, stageIndexOf, trackStateOf } from './state';
import { line, tell, type PowerCtx } from './tracks';

/**
 * Techniques and movesets (Phase 4). Techniques from fruits, styles, weapons and haki share one
 * schema (data/techniques, and each fruit's own list). A fighter's moveset is the techniques they
 * know, each with its own mastery and use: unused techniques fade, the most used is their
 * signature (stronger as their fame grows), and the battle log's use counts are what an enemy can
 * study in Phase 5.
 *
 * The pricer turns a technique's parts (form, tags, effects, the mastery it needs) into its cost,
 * power and accuracy; data may leave those out, and the technique creator uses the same pricer.
 */

export interface TechniqueEntry {
  def: TechniqueDef;
  /** "fruit:fruit_gomu_gomu", "track:track_swordsmanship", "technique". */
  source: string;
}

const indexes = new WeakMap<GameData, Map<string, TechniqueEntry>>();

/** Every technique in the data, by id: data/techniques and every fruit's (and fruit secret's). */
export function techniqueIndex(data: GameData): Map<string, TechniqueEntry> {
  const cached = indexes.get(data);
  if (cached) return cached;
  const index = new Map<string, TechniqueEntry>();
  const taughtBy = new Map<string, string>();
  for (const track of Object.values(data.tracks)) {
    for (const stage of track.stages) for (const t of stage.techniques) taughtBy.set(t, track.id);
  }
  for (const def of Object.values(data.techniques)) {
    const track = def.stage?.track ?? taughtBy.get(def.id);
    index.set(def.id, { def, source: track ? `track:${track}` : 'technique' });
  }
  for (const fruit of Object.values(data.fruits)) {
    for (const def of [...fruit.techniques, ...(fruit.secret?.techniques ?? [])]) {
      index.set(def.id, { def, source: `fruit:${fruit.id}` });
    }
  }
  indexes.set(data, index);
  return index;
}

// ---- Pricing --------------------------------------------------------------------------------

export interface Priced {
  power: number;
  accuracy: number;
  cost: number;
  range: TechRange;
}

export interface TechniqueParts {
  form: TechForm;
  tags: readonly TechTag[];
  effects?: readonly TechEffect[];
  /** 0 to 100: the mastery (or the stage, as a share of its track) it needs. */
  mastery: number;
  finisher?: boolean;
}

/** Cost, power and accuracy from a technique's parts (the same rule for data and inventions). */
export function priceTechnique(data: GameData, parts: TechniqueParts): Priced {
  const rules = data.powers.pricing;
  const base = rules.forms[parts.form];
  let power = base.power;
  let accuracy = base.accuracy;
  let cost = base.cost;
  for (const tag of new Set(parts.tags)) {
    const mod = rules.tags[tag];
    if (!mod) continue;
    power += mod.power;
    accuracy += mod.accuracy;
    cost += mod.cost;
  }
  for (const effect of new Set(parts.effects ?? [])) cost += rules.effects[effect] ?? 0;
  power *= 1 + parts.mastery * rules.masteryScale;
  cost *= 1 + parts.mastery * rules.masteryScale * 0.5;
  if (parts.finisher) {
    power *= rules.finisher.power;
    cost *= rules.finisher.cost;
  }
  return {
    power: Math.round(Math.max(0, power)),
    accuracy: Math.round(Math.max(5, Math.min(100, accuracy))),
    cost: Math.round(Math.max(0, cost) * 10) / 10,
    range: base.range,
  };
}

/** The mastery a technique needs, on the 0 to 100 scale (a style stage counts by its place in the track). */
export function requiredMastery(data: GameData, def: TechniqueDef): number {
  if (def.stage) {
    const track = data.tracks[def.stage.track];
    if (track) {
      const at = stageIndexOf(track, def.stage.stage);
      if (at >= 0) return Math.round((at / Math.max(1, track.stages.length - 1)) * 100);
    }
  }
  for (const track of Object.values(data.tracks)) {
    const i = track.stages.findIndex((s) => s.techniques.includes(def.id));
    if (i >= 0) return Math.round((i / Math.max(1, track.stages.length - 1)) * 100);
  }
  return def.mastery;
}

/** A technique with every number filled in: what the data gives, the pricer for the rest. */
export function pricedTechnique(data: GameData, def: TechniqueDef): TechniqueDef & Priced {
  const priced = priceTechnique(data, {
    form: def.form,
    tags: def.tags,
    effects: def.effects,
    mastery: requiredMastery(data, def),
    finisher: def.finisher,
  });
  return {
    ...def,
    power: def.power ?? priced.power,
    accuracy: def.accuracy ?? priced.accuracy,
    cost: def.cost ?? priced.cost,
    range: def.range ?? priced.range,
  };
}

// ---- Moves --------------------------------------------------------------------------------

export function moveDef(data: GameData, move: Move): TechniqueDef | undefined {
  return move.def ?? techniqueIndex(data).get(move.id)?.def;
}

export function moveName(data: GameData, move: Move): string {
  return move.name ?? moveDef(data, move)?.name ?? move.id;
}

/** Why a known move cannot be used right now (null: it can). */
export function moveLock(data: GameData, entity: Entity, move: Move, tick: number): string | null {
  const def = moveDef(data, move);
  if (!def) return 'Unknown technique';
  if (move.faded) return 'Forgotten: practise it again';
  const c = entity.character;
  if (move.source === 'fruit') {
    if (!c?.powers?.fruit || c.powers.fruit.dud) return 'No fruit';
    if (cursedNow(entity, tick)) return 'The sea has taken the fruit from you';
    if (fruitMastery(data, c) < def.mastery) return `Needs fruit mastery ${def.mastery}`;
    if (!c.powers.fruit.identified && def.mastery > 0)
      return 'You do not yet know what your fruit does';
  }
  for (const [stat, min] of Object.entries(def.stats)) {
    if (statTotal(entity, stat, tick) < (min ?? 0)) return `Needs ${stat} ${min}`;
  }
  return null;
}

/** A technique newly known (from a fruit, a stage, an invention, a combination). */
export function learnMove(
  entity: Entity,
  move: Omit<Move, 'uses' | 'lastUsed' | 'faded' | 'mastery'> & { mastery?: number },
): Move | null {
  const c = entity.character;
  if (!c) return null;
  const powers = ensurePowers(c);
  const existing = powers.moves.find((m) => m.id === move.id);
  if (existing) {
    existing.faded = false;
    return existing;
  }
  const full: Move = { mastery: 10, uses: 0, lastUsed: null, faded: false, ...move };
  powers.moves.push(full);
  return full;
}

/** A technique used (sparring, a real fight): its use counts and its own mastery grows. */
export function useMove(data: GameData, move: Move, tick: number): void {
  move.uses += 1;
  move.lastUsed = tick;
  move.faded = false;
  const gain = data.powers.moveset.usePoints * Math.max(0, 1 - move.mastery / 100);
  move.mastery = Math.min(100, Math.round((move.mastery + gain) * 100) / 100);
}

/** The signature: the most-used move (ties go to the stronger one). */
export function signatureOf(data: GameData, moves: readonly Move[]): Move | undefined {
  let best: Move | undefined;
  for (const move of moves) {
    if (move.faded || move.uses === 0) continue;
    if (
      !best ||
      move.uses > best.uses ||
      (move.uses === best.uses && power(data, move) > power(data, best))
    )
      best = move;
  }
  return best;
}

/** The finisher: the strongest move marked as one. */
export function finisherOf(data: GameData, moves: readonly Move[]): Move | undefined {
  return moves
    .filter((m) => !m.faded && moveDef(data, m)?.finisher)
    .sort((a, b) => power(data, b) - power(data, a))[0];
}

function power(data: GameData, move: Move): number {
  const def = moveDef(data, move);
  return def ? (pricedTechnique(data, def).power ?? 0) : 0;
}

/** Choose a move to use: weighted by how often it is used and how strong it is. */
export function chooseMove(
  data: GameData,
  entity: Entity,
  rng: Rng,
  tick: number,
  source?: string,
): Move | undefined {
  const moves = (entity.character?.powers?.moves ?? []).filter(
    (m) => moveLock(data, entity, m, tick) === null && (!source || m.source === source),
  );
  return rng.weightedPick(
    moves,
    (m) => (m.uses + 2) * (1 + power(data, m) / 100) * (0.5 + m.mastery / 100),
  );
}

/** Unused moves fade; too many at once, and the least used are forgotten. */
export function fadeMoves(data: GameData, entity: Entity, tick: number): void {
  const powers = entity.character?.powers;
  if (!powers) return;
  const rules = data.powers.moveset;
  for (const move of powers.moves) {
    if (move.faded) continue;
    const idle = tick - (move.lastUsed ?? move.learnedTick);
    if (idle <= rules.fadeAfterMonths) continue;
    move.mastery = Math.max(0, Math.round((move.mastery - rules.fadePerYear / 12) * 100) / 100);
    if (move.mastery <= 0) move.faded = true;
  }
  const active = powers.moves.filter((m) => !m.faded);
  if (active.length <= rules.max) return;
  const order = [...active].sort(
    (a, b) =>
      a.uses - b.uses ||
      (a.lastUsed ?? a.learnedTick) - (b.lastUsed ?? b.learnedTick) ||
      (a.id < b.id ? -1 : 1),
  );
  for (const move of order.slice(0, active.length - rules.max)) move.faded = true;
}

// ---- What the battle engine will read (Phase 5) -----------------------------------------------

export interface BattleAction {
  id: string;
  name: string;
  /** strike, guard, evade, feint, grapple, haki, item, talk, flee, or technique. */
  kind: string;
  form: TechForm | null;
  tags: string[];
  power: number;
  accuracy: number;
  cost: number;
  range: TechRange;
  source: string;
  signature: boolean;
  finisher: boolean;
}

const BASIC: {
  id: string;
  name: string;
  kind: string;
  power: number;
  accuracy: number;
  range: TechRange;
}[] = [
  { id: 'strike', name: 'Strike', kind: 'strike', power: 20, accuracy: 75, range: 'melee' },
  { id: 'guard', name: 'Guard', kind: 'guard', power: 0, accuracy: 100, range: 'melee' },
  { id: 'evade', name: 'Evade', kind: 'evade', power: 0, accuracy: 100, range: 'melee' },
  { id: 'feint', name: 'Feint', kind: 'feint', power: 5, accuracy: 70, range: 'melee' },
  { id: 'grapple', name: 'Grapple', kind: 'grapple', power: 10, accuracy: 60, range: 'melee' },
  { id: 'talk', name: 'Talk', kind: 'talk', power: 0, accuracy: 100, range: 'near' },
  { id: 'flee', name: 'Flee', kind: 'flee', power: 0, accuracy: 100, range: 'far' },
];

/** Every action someone has in a fight: the basic verbs and each usable technique, priced. */
export function battleActions(data: GameData, entity: Entity, tick: number): BattleAction[] {
  const out: BattleAction[] = BASIC.map((b) => ({
    ...b,
    form: null,
    tags: [],
    cost: 0,
    source: 'basic',
    signature: false,
    finisher: false,
  }));
  const c = entity.character;
  const moves = c?.powers?.moves ?? [];
  const sig = signatureOf(data, moves);
  const fin = finisherOf(data, moves);
  const fame = reputationValue(entity, 'fame', tick);
  const rules = data.powers.moveset;
  for (const move of moves) {
    if (moveLock(data, entity, move, tick) !== null) continue;
    const def = moveDef(data, move);
    if (!def) continue;
    const priced = pricedTechnique(data, def);
    let p = (priced.power ?? 0) * (0.6 + move.mastery / 250);
    if (move === sig) p *= Math.min(rules.signatureCap, 1 + fame * rules.signatureFame);
    out.push({
      id: move.id,
      name: moveName(data, move),
      kind: 'technique',
      form: def.form,
      tags: [...def.tags],
      power: Math.round(p),
      accuracy: priced.accuracy ?? 70,
      cost: priced.cost ?? 0,
      range: priced.range ?? 'melee',
      source: move.source,
      signature: move === sig,
      finisher: move === fin,
    });
  }
  return out;
}

// ---- The technique creator --------------------------------------------------------------------

export interface InventParts {
  /** "fruit", a track id, or "haki:armament". */
  source: string;
  form: TechForm;
  tag: TechTag;
  name: string;
}

/** The tags a source can make a technique of: its techniques' tags (a fruit's, a style's). */
export function sourceTags(
  state: WorldState,
  data: GameData,
  entity: Entity,
  source: string,
): Set<TechTag> {
  const tags = new Set<TechTag>();
  const c = entity.character;
  if (source === 'fruit') {
    const fruit = eatenFruit(state, entity);
    const def = fruitDefOf(data, fruit);
    for (const t of def?.techniques ?? []) for (const tag of t.tags) tags.add(tag);
    for (const prim of def?.primitives ?? []) {
      for (const tag of data.powers.primitives.find((p) => p.id === prim)?.tags ?? [])
        tags.add(tag);
    }
    return tags;
  }
  if (source.startsWith('haki:')) {
    tags.add('haki');
    tags.add(source.slice(5) as TechTag);
    return tags;
  }
  const track = data.tracks[source];
  if (!track || !c || !trackStateOf(c, source)) return tags;
  for (const stage of track.stages) {
    for (const id of stage.techniques)
      for (const tag of techniqueIndex(data).get(id)?.def.tags ?? []) tags.add(tag);
  }
  for (const tag of track.tags)
    if ((TECH_TAGS as readonly string[]).includes(tag)) tags.add(tag as TechTag);
  return tags;
}

/** The mastery a source stands at (0 to 100), which prices what is invented from it. */
export function sourceMastery(data: GameData, entity: Entity, source: string): number {
  const c = entity.character;
  if (!c) return 0;
  if (source === 'fruit') return fruitMastery(data, c);
  const trackId = source.startsWith('haki:') ? `track_${source.slice(5)}` : source;
  const track = data.tracks[trackId];
  const ts = trackStateOf(c, trackId);
  if (!track || !ts) return 0;
  return Math.round((ts.stage / Math.max(1, track.stages.length - 1)) * 100);
}

/** Why this invention cannot be begun, or null. */
export function inventLock(
  state: WorldState,
  data: GameData,
  entity: Entity,
  parts: InventParts,
): string | null {
  const c = entity.character;
  if (!c) return 'Nobody to invent it';
  const powers = ensurePowers(c);
  const name = parts.name.trim();
  if (name.length < 2 || name.length > 40) return 'Give it a name of 2 to 40 letters';
  if (!(TECH_FORMS as readonly string[]).includes(parts.form)) return 'Unknown form';
  if (powers.drafts.length >= data.powers.inventing.maxDrafts)
    return 'You are already working on as many as you can';
  if (powers.moves.some((m) => moveName(data, m).toLowerCase() === name.toLowerCase()))
    return 'You already know a technique by that name';
  if (parts.source === 'fruit') {
    if (!powers.fruit || powers.fruit.dud) return 'You have no Devil Fruit power to build on';
    if (!powers.fruit.identified) return 'You do not yet know what your fruit does';
  } else if (parts.source.startsWith('haki:')) {
    if (!trackStateOf(c, `track_${parts.source.slice(5)}`)) return 'That haki is not awake in you';
  } else if (!trackStateOf(c, parts.source)) {
    return 'You have not learned that style';
  }
  const tags = sourceTags(state, data, entity, parts.source);
  if (!tags.has(parts.tag) && !['body', 'blunt'].includes(parts.tag))
    return `That power has nothing of ${parts.tag} in it`;
  return null;
}

/** Begin an invention: priced from its parts now; each month of practice rolls for success. */
export function draftTechnique(
  state: WorldState,
  data: GameData,
  entity: Entity,
  parts: InventParts,
  tick: number,
): TechniqueDef {
  const why = inventLock(state, data, entity, parts);
  if (why) throw new Error(why);
  const c = entity.character;
  if (!c) throw new Error('Nobody to invent it');
  const powers = ensurePowers(c);
  const mastery = sourceMastery(data, entity, parts.source);
  const priced = priceTechnique(data, { form: parts.form, tags: [parts.tag], mastery });
  const n = powers.moves.filter((m) => m.source === 'custom').length + powers.drafts.length + 1;
  const def: TechniqueDef = {
    id: `tech_custom_${entity.id.replace(/[^a-z0-9]/g, '')}_${tick < 0 ? 'm' : ''}${Math.abs(tick)}_${n}`,
    name: parts.name.trim(),
    form: parts.form,
    tags: [parts.tag],
    range: priced.range,
    cost: priced.cost,
    power: priced.power,
    accuracy: priced.accuracy,
    mastery: 0,
    stats: {},
    effects: [],
    finisher: false,
    named: true,
    description: `Your own technique, built on ${parts.source === 'fruit' ? 'your fruit' : (data.tracks[parts.source]?.name ?? parts.source)}.`,
  };
  powers.drafts.push({ def, source: parts.source, attempts: 0, sinceTick: tick });
  return def;
}

/** The chance a month's practice turns a draft into a technique. */
export function inventChance(
  data: GameData,
  entity: Entity,
  source: string,
  attempts: number,
  tick: number,
): number {
  const r = data.powers.inventing;
  const mastery = sourceMastery(data, entity, source);
  const intellect = statValue(entity.stats['intellect'] ?? { base: 0, mods: [] }, tick);
  return Math.max(
    0.02,
    Math.min(
      0.95,
      r.base + r.perMastery * mastery + r.perIntellect * (intellect - 50) + r.perAttempt * attempts,
    ),
  );
}

/** A month's practice of a source: each draft built on it rolls for success, like a breakthrough. */
export function draftsMonth(ctx: PowerCtx, practised: string): void {
  const powers = ctx.c.powers;
  if (!powers) return;
  const keep: typeof powers.drafts = [];
  for (const draft of powers.drafts) {
    const matches =
      draft.source === practised ||
      (draft.source === 'fruit' && ctx.data.tracks[practised]?.family === 'fruit');
    if (!matches) {
      keep.push(draft);
      continue;
    }
    const chance = inventChance(ctx.data, ctx.entity, draft.source, draft.attempts, ctx.tick);
    if (ctx.rng.fork('invent', draft.def.id, ctx.tick).chance(chance)) {
      learnMove(ctx.entity, {
        id: draft.def.id,
        source: 'custom',
        learnedTick: ctx.tick,
        def: draft.def,
        mastery: 15,
      });
      tell(ctx, line(ctx.data, 'invented'), { title: draft.def.name }, ['technique']);
    } else {
      draft.attempts += 1;
      keep.push(draft);
      tell(
        ctx,
        line(ctx.data, 'inventFailed'),
        { title: draft.def.name },
        ['technique'],
        'plain',
        false,
      );
    }
  }
  powers.drafts = keep;
}

// ---- Combination techniques -------------------------------------------------------------------

/** People bonded enough (both ways, Phase 7 deepens bonds) to make a combination technique with. */
export function comboPartners(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
): Entity[] {
  const c = entity.character;
  if (!c) return [];
  const min = data.powers.moveset.combinationOpinion;
  const out: Entity[] = [];
  for (const rel of c.relationships) {
    const other = state.entities[rel.id];
    const back = other?.character?.relationships.find((r) => r.id === entity.id);
    if (!other?.character?.alive || !back) continue;
    if (statValue(rel.opinion, tick) < min || statValue(back.opinion, tick) < min) continue;
    if ((other.character.powers?.moves ?? []).some((m) => !m.faded)) out.push(other);
  }
  return out;
}

/** Two moves fit together when they share a tag or one sets up the other (a grapple and a strike). */
export function compatible(a: TechniqueDef, b: TechniqueDef): boolean {
  if (a.tags.some((t) => b.tags.includes(t))) return true;
  const pair = new Set([a.form, b.form]);
  return (
    (pair.has('grapple') && pair.has('strike')) ||
    (pair.has('boost') && pair.size === 2) ||
    (pair.has('area') && pair.has('projectile'))
  );
}

/** A combination technique, known to both partners. */
export function combine(
  state: WorldState,
  data: GameData,
  a: Entity,
  b: Entity,
  moveA: string,
  moveB: string,
  name: string,
  tick: number,
): TechniqueDef {
  if (!comboPartners(state, data, a, tick).some((e) => e.id === b.id)) {
    throw new Error(`${b.name} and you are not close enough yet`);
  }
  const ma = a.character?.powers?.moves.find((m) => m.id === moveA);
  const mb = b.character?.powers?.moves.find((m) => m.id === moveB);
  const da = ma ? moveDef(data, ma) : undefined;
  const db = mb ? moveDef(data, mb) : undefined;
  if (!da || !db) throw new Error('Both of you need a technique to put together');
  if (!compatible(da, db)) throw new Error('Those two techniques do not fit together');
  const pa = pricedTechnique(data, da);
  const pb = pricedTechnique(data, db);
  const tags = [...new Set([...da.tags, ...db.tags])].slice(0, 3) as TechTag[];
  const def: TechniqueDef = {
    id: `tech_combo_${a.id.replace(/[^a-z0-9]/g, '')}_${b.id.replace(/[^a-z0-9]/g, '')}_${Math.abs(tick)}`,
    name: name.trim().slice(0, 40) || `${da.name} and ${db.name}`,
    form: 'area',
    tags,
    range: 'area',
    power: Math.round(((pa.power ?? 0) + (pb.power ?? 0)) * 0.85),
    accuracy: Math.round(((pa.accuracy ?? 70) + (pb.accuracy ?? 70)) / 2),
    cost: Math.round(((pa.cost ?? 0) + (pb.cost ?? 0)) * 0.6 * 10) / 10,
    mastery: 0,
    stats: {},
    effects: [...new Set([...da.effects, ...db.effects])].slice(0, 2),
    finisher: false,
    named: true,
    description: `${a.name} and ${b.name} together.`,
  };
  learnMove(a, { id: def.id, source: 'combo', learnedTick: tick, def, partnerId: b.id });
  learnMove(b, { id: def.id, source: 'combo', learnedTick: tick, def, partnerId: a.id });
  return def;
}
