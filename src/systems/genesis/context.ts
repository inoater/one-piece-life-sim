import type {
  Birthplace,
  Creation,
  Focus,
  GameData,
  Legacy,
  Race,
} from '../../engine/data/schemas';
import type { LogInput } from '../../engine/log';
import type { Rng } from '../../engine/rng';
import type { CharacterData, Entity, Stat, WorldState } from '../../engine/state';
import { addMod, statValue } from '../../engine/stats';
import type { GenesisOptions } from './options';

/**
 * Everything the generator knows while it builds one life. The modules that fill in a character
 * (family, traits, backfill, appearance, backstory) all work on this one object.
 */

export interface StoryItem {
  tick: number;
  /** Real age in years when it happened. */
  age: number;
  /** The sentence as rendered for the log. */
  text: string;
  /** The template it came from (decides capitalisation when continued mid-sentence). */
  template: string;
  notability: number;
  kind: 'birth' | 'backstory' | 'family' | 'legacy';
  tags: string[];
  others: string[];
}

export interface GenesisCtx {
  data: GameData;
  options: GenesisOptions;
  state: WorldState;
  rng: Rng;
  race: Race;
  birthplace: Birthplace;
  legacy: Legacy;
  focus: Focus | null;
  difficulty: Creation['difficulties'][number];
  talent: GameData['character']['talentTiers'][number];
  player: Entity;
  /** The player's character block (same object as `player.character`). */
  pc: CharacterData;
  birthTick: number;
  entryTick: number;
  /** Index into creation.wealthTiers. Events can move it. */
  wealthRank: number;
  birthOrder: 'only' | 'eldest' | 'middle' | 'youngest';
  /** Sum of trainingGainPct from traits held. */
  trainingPct: number;
  /** Ids of parents and siblings (entities), in birth order for siblings. */
  parentIds: string[];
  siblingIds: string[];
  legacyParentId: string | null;
  /** Non-family relationships made so far (capped by creation.maxRelationships). */
  relationshipsMade: number;
  story: StoryItem[];
  /** Records for the log, appended in time order once the life is built. */
  records: { tick: number; input: LogInput }[];
  /** Backstory event id -> real age it last happened. */
  happened: Map<string, number>;
  berries: number;
  notes: string[];
}

export function roundTo(value: number, decimals: number): number {
  const scale = [1, 10, 100, 1000, 10000][decimals] ?? 1;
  return Math.round(value * scale) / scale;
}

export function entityOf(ctx: GenesisCtx, id: string): Entity {
  const entity = ctx.state.entities[id];
  if (!entity) throw new Error(`genesis lost track of entity ${id}`);
  return entity;
}

export function characterOf(entity: Entity): CharacterData {
  if (!entity.character) throw new Error(`${entity.id} is not a character`);
  return entity.character;
}

export function potentialOf(ctx: GenesisCtx, stat: string): Stat {
  const found = ctx.pc.hidden?.potential[stat];
  if (!found) throw new Error(`no potential for ${stat}`);
  return found;
}

/** Current value of a stat at the tick being generated. */
export function current(ctx: GenesisCtx, stat: string, tick: number): number {
  const s = ctx.player.stats[stat];
  return s ? statValue(s, tick) : 0;
}

/** The single modifier with this source on a stat, created at 0 if missing. */
export function namedMod(stat: Stat, source: string): { value: number } {
  let mod = stat.mods.find((m) => m.source === source && m.kind === 'flat');
  if (!mod) {
    mod = { source, value: 0, kind: 'flat' };
    stat.mods.push(mod);
  }
  return mod;
}

export const TRAINING_SOURCE = 'training';
export const AGE_SOURCE = 'Age';

/**
 * Add training to a stat with diminishing returns: the closer to potential, the smaller the gain,
 * and above the soft cap (90% by default) gains fall to a tenth. Returns the gain.
 */
export function train(ctx: GenesisCtx, stat: string, points: number, tick: number): number {
  const s = ctx.player.stats[stat];
  if (!s || points <= 0) return 0;
  const potential = statValue(potentialOf(ctx, stat), tick);
  if (potential <= 0) return 0;
  const ratio = statValue(s, tick) / potential;
  const { softCap } = ctx.data.character;
  let gain = points * Math.max(0, 1 - ratio);
  if (ratio >= softCap.above) gain *= softCap.factor;
  const multiplier = Math.max(0, 1 + ctx.trainingPct / 100) * ctx.talent.growthMult;
  gain *= multiplier;
  if (gain <= 0) return 0;
  namedMod(s, TRAINING_SOURCE).value += gain;
  return gain;
}

/** Trait ids this character cannot take because of the ones they hold (exclusions go both ways). */
export function blockedTraits(data: GameData, held: readonly string[]): Set<string> {
  const blocked = new Set<string>(held);
  for (const id of held) for (const other of data.traits[id]?.excludes ?? []) blocked.add(other);
  for (const trait of Object.values(data.traits)) {
    if (trait.excludes.some((id) => held.includes(id))) blocked.add(trait.id);
  }
  return blocked;
}

/**
 * Give a trait to the player: its stat modifiers, potential modifiers, flags and training bonus.
 * Returns false (and changes nothing) if the trait is held already or excluded by one held.
 */
export function giveTrait(ctx: GenesisCtx, traitId: string): boolean {
  const trait = ctx.data.traits[traitId];
  if (!trait) throw new Error(`unknown trait ${traitId}`);
  if (blockedTraits(ctx.data, ctx.pc.traits).has(traitId)) return false;
  ctx.pc.traits.push(traitId);
  const source = `${trait.name} (trait)`;
  for (const mod of trait.statMods) {
    const stat = ctx.player.stats[mod.stat];
    if (stat) addMod(stat, { source, value: mod.value, kind: mod.kind });
  }
  for (const mod of trait.potentialMods) {
    const potential = ctx.pc.hidden?.potential[mod.stat];
    if (potential) addMod(potential, { source, value: mod.pct, kind: 'pct' });
  }
  Object.assign(ctx.player.flags, trait.flags);
  ctx.trainingPct += trait.trainingGainPct;
  return true;
}

export function wealthTier(ctx: GenesisCtx): Creation['wealthTiers'][number] {
  const tiers = ctx.data.creation.wealthTiers;
  return tiers[
    Math.min(tiers.length - 1, Math.max(0, ctx.wealthRank))
  ] as Creation['wealthTiers'][number];
}

export function wealthRankOf(data: GameData, tierId: string): number {
  return data.creation.wealthTiers.findIndex((t) => t.id === tierId);
}
