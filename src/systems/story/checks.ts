import type { Check, CheckBand } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import { checkBonus } from '../life/traits';
import { statForCheck } from './conditions';
import type { StoryCtx } from './context';

/**
 * Skill checks (Phase 3): a choice can test a stat, Combat Power or seamanship against a
 * difficulty. The chance of success is even at the difficulty and moves by half for every 20
 * points above or below it (between 5% and 95%); the best and worst 15% of each side are critical.
 * Four result bands, each with its own text and effects; a missing critical band falls back to
 * the plain one.
 */

export const BANDS = ['criticalSuccess', 'success', 'failure', 'criticalFailure'] as const;
export type Band = (typeof BANDS)[number];

export function successChance(value: number, difficulty: number): number {
  return Math.max(0.05, Math.min(0.95, 0.5 + (value - difficulty) / 40));
}

export function bandFor(roll: number, chance: number): Band {
  if (roll < chance * 0.15) return 'criticalSuccess';
  if (roll < chance) return 'success';
  if (roll >= 1 - (1 - chance) * 0.15) return 'criticalFailure';
  return 'failure';
}

export interface CheckResult {
  band: Band;
  result: CheckBand;
  value: number;
  difficulty: number;
  chance: number;
}

export function rollCheck(ctx: StoryCtx, check: Check, rng: Rng): CheckResult {
  // Phase 4: traits add to the value tested ("Silver-Tongued: +10 on Charisma checks").
  const value = statForCheck(ctx, check.stat) + checkBonus(ctx.data, ctx.p?.c, check.stat);
  const danger = ctx.lane?.danger ?? ctx.place?.danger ?? 0;
  const difficulty = check.difficulty + check.perDanger * danger;
  const chance = successChance(value, difficulty);
  const band = bandFor(rng.next(), chance);
  const result =
    band === 'criticalSuccess'
      ? (check.criticalSuccess ?? check.success)
      : band === 'criticalFailure'
        ? (check.criticalFailure ?? check.failure)
        : check[band];
  return { band, result, value, difficulty, chance };
}
