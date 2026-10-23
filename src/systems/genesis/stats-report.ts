import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import { potentialRoll, potentialValue } from './generate';
import { birthplacesFor } from './options';

/**
 * "1,000 rolls per race match the cap table in a debug histogram."
 *
 * Rolls the hidden potential of many characters of one race (each in a random birthplace the
 * race can be born in, on normal difficulty) with the generator's own formula, and compares the
 * result with the race table:
 *
 *  - for Ordinary-talent characters, the mean potential per stat should equal the race cap
 *    (base cap x race modifier, after taking the birthplace modifier out);
 *  - over everyone, it should equal the race cap times the expected talent multiplier;
 *  - talent tiers should turn up at their listed chances.
 *
 * The histogram is of potential divided by (race cap x birthplace modifier): talent x random, the
 * same shape for every race. Pure and deterministic for a given seed.
 */

export interface GenesisStatRow {
  stat: string;
  capMod: number;
  /** Base cap x race modifier: the number the race table promises. */
  raceCap: number;
  /** Mean of Ordinary characters' potential with the birthplace modifier taken out. */
  ordinaryMean: number;
  /** Expected mean over all talents (race cap x expected talent multiplier). */
  expectedMean: number;
  observedMean: number;
  min: number;
  max: number;
  /** (observed - expected) / expected, in percent. */
  deviationPct: number;
  /** (ordinary mean - race cap) / race cap, in percent. */
  capDeviationPct: number;
  /** Counts per bin of potential / (race cap x birthplace modifier). */
  histogram: number[];
}

export interface GenesisStats {
  raceId: string;
  raceName: string;
  rolls: number;
  seed: string;
  tolerancePct: number;
  bins: { from: number; width: number; count: number };
  talent: { id: string; name: string; expectedPct: number; observedPct: number }[];
  stats: GenesisStatRow[];
  ok: boolean;
  problems: string[];
}

const BINS = { from: 0.8, width: 0.05, count: 28 };

export function genesisStats(
  data: GameData,
  raceId: string,
  rolls = 1000,
  seed = 'histogram',
  tolerancePct = 3,
): GenesisStats {
  const race = data.races[raceId];
  if (!race) throw new Error(`There is no race "${raceId}"`);
  const places = birthplacesFor(data, raceId);
  const rules = data.character;
  const statIds = [...rules.physical, ...rules.mental];
  const tiers = rules.talentTiers;
  const expectedTalent = tiers.reduce((sum, t) => sum + (t.chance / 100) * t.potentialMult, 0);
  const rollMid = (rules.potentialRoll.min + rules.potentialRoll.max) / 2;

  const tierCount = new Map<string, number>();
  const sum: Record<string, number> = {};
  const sumOrdinary: Record<string, number> = {};
  const min: Record<string, number> = {};
  const max: Record<string, number> = {};
  const hist: Record<string, number[]> = {};
  let ordinary = 0;
  const ordinaryId = tiers[0]?.id;
  for (const stat of statIds) {
    sum[stat] = 0;
    sumOrdinary[stat] = 0;
    min[stat] = Infinity;
    max[stat] = -Infinity;
    hist[stat] = Array.from({ length: BINS.count }, () => 0);
  }

  const root = Rng.root(seed).fork('genesis-stats', raceId);
  for (let i = 0; i < rolls; i++) {
    const rng = root.fork(i);
    const place = rng.fork('birthplace').pick(places);
    const talent = rng.fork('talent').weightedPick(tiers, (t) => t.chance) ?? tiers[0];
    if (!talent) break;
    tierCount.set(talent.id, (tierCount.get(talent.id) ?? 0) + 1);
    if (talent.id === ordinaryId) ordinary += 1;
    for (const stat of statIds) {
      const value = potentialValue(
        data,
        {
          race,
          birthplace: place,
          potentialMult: talent.potentialMult,
          difficultyMult: 1,
          roll: potentialRoll(data, rng, stat),
        },
        stat,
      );
      const placeMult =
        1 + (place.potentialMods[stat as keyof typeof place.potentialMods] ?? 0) / 100;
      const raceCap =
        rules.baseCap * (1 + (race.capMods[stat as keyof typeof race.capMods] ?? 0) / 100);
      const ratio = value / (raceCap * placeMult);
      sum[stat] = (sum[stat] ?? 0) + value / placeMult;
      if (talent.id === ordinaryId)
        sumOrdinary[stat] = (sumOrdinary[stat] ?? 0) + value / placeMult;
      min[stat] = Math.min(min[stat] ?? Infinity, value);
      max[stat] = Math.max(max[stat] ?? -Infinity, value);
      const bin = Math.min(
        BINS.count - 1,
        Math.max(0, Math.floor((ratio - BINS.from) / BINS.width)),
      );
      (hist[stat] as number[])[bin] = ((hist[stat] as number[])[bin] ?? 0) + 1;
    }
  }

  const problems: string[] = [];
  const rows: GenesisStatRow[] = statIds.map((stat) => {
    const capMod = race.capMods[stat as keyof typeof race.capMods] ?? 0;
    const raceCap = rules.baseCap * (1 + capMod / 100);
    const expectedMean = raceCap * expectedTalent * rollMid;
    const observedMean = (sum[stat] ?? 0) / rolls;
    const ordinaryMean = ordinary > 0 ? (sumOrdinary[stat] ?? 0) / ordinary : 0;
    const deviationPct = ((observedMean - expectedMean) / expectedMean) * 100;
    const capDeviationPct = ((ordinaryMean - raceCap * rollMid) / (raceCap * rollMid)) * 100;
    if (Math.abs(deviationPct) > tolerancePct) {
      problems.push(
        `${stat}: mean ${observedMean.toFixed(1)} is ${deviationPct.toFixed(1)}% from the expected ${expectedMean.toFixed(1)}`,
      );
    }
    if (Math.abs(capDeviationPct) > tolerancePct) {
      problems.push(
        `${stat}: Ordinary mean ${ordinaryMean.toFixed(1)} is ${capDeviationPct.toFixed(1)}% from the race cap ${raceCap.toFixed(1)}`,
      );
    }
    return {
      stat,
      capMod,
      raceCap,
      ordinaryMean,
      expectedMean,
      observedMean,
      min: min[stat] ?? 0,
      max: max[stat] ?? 0,
      deviationPct,
      capDeviationPct,
      histogram: hist[stat] ?? [],
    };
  });

  const talent = tiers.map((t) => {
    const observedPct = ((tierCount.get(t.id) ?? 0) / rolls) * 100;
    // Allow about three standard errors of a proportion, plus a floor for rare tiers.
    const sd = Math.sqrt(((t.chance / 100) * (1 - t.chance / 100)) / rolls) * 100;
    if (Math.abs(observedPct - t.chance) > Math.max(1, 3.5 * sd)) {
      problems.push(`talent ${t.id}: ${observedPct.toFixed(1)}% observed, ${t.chance}% expected`);
    }
    return { id: t.id, name: t.name, expectedPct: t.chance, observedPct };
  });

  return {
    raceId,
    raceName: race.name,
    rolls,
    seed,
    tolerancePct,
    bins: { ...BINS },
    talent,
    stats: rows,
    ok: problems.length === 0,
    problems,
  };
}
