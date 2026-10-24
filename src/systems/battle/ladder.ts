import type { CastMember, GameData, LadderRung, LadderTier } from '../../engine/data/schemas';
import { tickOfWhen } from '../../engine/data/defs';
import type { Entity } from '../../engine/state';
import { addMod, removeModsBySource } from '../../engine/stats';
import { combatPowerOf } from '../life/body';
import { bonusStat } from '../powers/state';

/**
 * The power ladder (Phase 5): Combat Power's rungs, from townsfolk to the strongest of an era, and
 * the canon cast's place on it by era.
 *
 * A canon character's stats and powers (Phase 4's stages, fruit mastery and gear by era) give
 * them a Combat Power; their `power` keyframes say which rung the story puts them on then. When the
 * two disagree, a modifier named for the era closes the gap (rule 3: it shows on their sheet as
 * "Strength of their era"), so a young Garp is a Captain and an old one still a Monster.
 */

export const ERA_SOURCE = 'Strength of their era';

export function ladder(data: GameData): readonly LadderRung[] {
  return data.battle.ladder;
}

/** The rung a Combat Power sits on. */
export function tierOf(data: GameData, cp: number): LadderRung {
  const rungs = ladder(data);
  let found = rungs[0] as LadderRung;
  for (const rung of rungs) if (cp >= rung.min) found = rung;
  return found;
}

/** A rung's span: its own minimum up to the next rung's (the top rung has no ceiling). */
export function tierSpan(data: GameData, tier: LadderTier): { min: number; max: number | null } {
  const rungs = ladder(data);
  const i = rungs.findIndex((r) => r.id === tier);
  const rung = rungs[i] as LadderRung;
  const next = rungs[i + 1];
  return { min: rung.min, max: next ? next.min - 1 : null };
}

/** The rung number (0 for civilians). */
export function tierIndex(data: GameData, tier: LadderTier): number {
  return ladder(data).findIndex((r) => r.id === tier);
}

/** A tier's name for text ("a Grand Line threat"). */
export function tierName(data: GameData, cp: number): string {
  return tierOf(data, cp).name;
}

/** The cast member's rung (and number, if the data gives one) at a month. */
export function castPowerAt(
  cast: CastMember,
  tick: number,
): { tier: LadderTier; cp?: number } | null {
  let found: CastMember['power'][number] | null = null;
  for (const key of cast.power) if (tickOfWhen(key.from) <= tick) found = key;
  if (!found) return null;
  return found.cp !== undefined ? { tier: found.tier, cp: found.cp } : { tier: found.tier };
}

/**
 * Where inside its rung a canon character's power is put when their own does not reach it (or
 * overshoots it): a fifth of the way up from the bottom, or a tenth down from the top.
 */
function targetFor(
  data: GameData,
  natural: number,
  key: { tier: LadderTier; cp?: number },
): number {
  if (key.cp !== undefined) return key.cp;
  const { min, max } = tierSpan(data, key.tier);
  if (max === null) return natural >= min ? natural : Math.round(min * 1.12);
  const span = max - min;
  if (natural < min) return Math.round(min + span * 0.2);
  if (natural > max) return Math.round(max - span * 0.1);
  return natural;
}

/**
 * Put a canon character on their rung for this month. Returns the modifier's value (0: their
 * own powers already put them there).
 */
export function calibrateCast(data: GameData, entity: Entity, tick: number): number {
  const cast = data.cast[entity.id];
  if (!cast || !entity.character) return 0;
  const key = castPowerAt(cast, tick);
  const bonus = bonusStat(entity, data.powers.combatBonusStat);
  removeModsBySource(bonus, ERA_SOURCE);
  if (!key) return 0;
  const natural = combatPowerOf(data, entity, tick);
  const delta = targetFor(data, natural, key) - natural;
  if (delta !== 0) addMod(bonus, { source: ERA_SOURCE, value: delta, kind: 'flat' });
  return delta;
}
