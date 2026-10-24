import type { GameData } from '../../engine/data/schemas';
import type { CharacterData, Entity } from '../../engine/state';
import { addMod, statLabel, statValue } from '../../engine/stats';
import { namedMod, roundTo, TRAINING_SOURCE } from '../genesis/context';
import { lifeLog, renderLife, reportLine, type LifeEnv } from './env';
import { trainingModPct } from './traits';

/**
 * Training (Phase 2):
 *
 *   gain = base gain x effort x stage efficiency x (1 - current / potential)
 *          x trait multiplier x teacher multiplier x talent
 *
 * Above the soft cap (90% of potential) gains fall to a tenth. Hard effort at the cap can set off a
 * breakthrough, which raises that stat's potential by a few percent: the way past a limit. Gains go
 * into the stat's "training" modifier, the same one character genesis fills, so a tooltip shows
 * the past and the present as one line.
 */

/** Traits' training bonus and the hidden talent, multiplied together. */
export function growthMultiplier(data: GameData, c: CharacterData): number {
  let pct = 0;
  for (const id of c.traits) pct += data.traits[id]?.trainingGainPct ?? 0;
  const talent = data.character.talentTiers.find((t) => t.id === c.hidden?.talent);
  return Math.max(0, 1 + pct / 100) * (talent?.growthMult ?? 1);
}

export interface Gain {
  gain: number;
  /** Current / potential before the gain. */
  ratio: number;
}

/** The formula alone, for one month: also drives the debug chart of diminishing returns. */
export function gainFor(
  data: GameData,
  points: number,
  current: number,
  potential: number,
  multiplier: number,
): Gain {
  if (potential <= 0 || points <= 0) return { gain: 0, ratio: 1 };
  const ratio = current / potential;
  let gain = points * Math.max(0, 1 - ratio);
  if (ratio >= data.character.softCap.above) gain *= data.character.softCap.factor;
  return { gain: gain * multiplier, ratio };
}

/** Train one stat of a character by `points` (already scaled by effort, stage and teacher). */
export function trainStat(
  data: GameData,
  entity: Entity,
  c: CharacterData,
  stat: string,
  points: number,
  tick: number,
): Gain {
  const s = entity.stats[stat];
  const potential = c.hidden?.potential[stat];
  if (!s || !potential) return { gain: 0, ratio: 1 };
  const result = gainFor(
    data,
    points,
    statValue(s, tick),
    statValue(potential, tick),
    growthMultiplier(data, c) * Math.max(0, 1 + trainingModPct(data, c, stat) / 100),
  );
  if (result.gain > 0) {
    const mod = namedMod(s, TRAINING_SOURCE);
    mod.value = roundTo(mod.value + result.gain, 4);
  }
  return result;
}

/** Raise one stat's potential by `pct` percent, and say so. */
export function raisePotential(env: LifeEnv, stat: string, pct: number, source: string): void {
  const potential = env.p.c.hidden?.potential[stat];
  const value = roundTo(pct, 1);
  if (!potential || value <= 0) return;
  addMod(potential, { source, value, kind: 'pct' });
  const text = renderLife(env, env.data.life.lines.breakthrough, {
    stat: statLabel(stat).toLowerCase(),
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'breakthrough'] });
  reportLine(env, text, 'good');
}

/** A breakthrough: a near-death escape, a legendary teacher, a limit broken by Hard training. */
export function breakthrough(env: LifeEnv, stat: string, source: string): void {
  const { min, max } = env.data.life.training.breakthroughPct;
  raisePotential(env, stat, env.rng.fork('breakthrough', stat).float(min, max), source);
}

export interface CurvePoint {
  month: number;
  value: number;
  gain: number;
  /** Value as a share of potential. */
  ratio: number;
}

/**
 * A stat trained every month from `start` toward `potential`, with nothing else happening: the
 * debug chart's proof that returns diminish near potential and nearly stop above the soft cap.
 */
export function trainingCurve(
  data: GameData,
  input: {
    potential: number;
    start: number;
    months: number;
    /** Base gain of the activity, effort, stage efficiency and teacher, multiplied. */
    points: number;
    multiplier?: number;
  },
): CurvePoint[] {
  const out: CurvePoint[] = [];
  let value = input.start;
  for (let month = 0; month <= input.months; month++) {
    const { gain, ratio } = gainFor(
      data,
      input.points,
      value,
      input.potential,
      input.multiplier ?? 1,
    );
    out.push({ month, value, gain, ratio });
    value += gain;
  }
  return out;
}
