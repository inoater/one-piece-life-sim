import type { CharacterRules, Race, StageDef } from '../../engine/data/schemas';

/**
 * Life stages for every race, from the human table and three anchors per race.
 *
 * The plan gives a detailed human stage table (Infant 0-2 ... Elder 65+) and, for each race, three
 * anchors: when childhood ends, when the prime starts and when elder years start. Other races
 * "scale the remaining stage boundaries in proportion". That is done here with a piecewise-linear
 * map from human years to race years through the anchor points:
 *
 *     human  0 ---- 12 ---------- 20 ------------------ 60 ......
 *     giant  0 ---- 40 ---------- 60 ------------------ 200 .....
 *
 * Beyond the last anchor the map keeps the elder ratio (race elder start / human elder start). For
 * humans the map is the identity, so the human table is used exactly as written.
 *
 * The inverse map ("how old is this giant in human terms?") lets content be written once in human
 * years: a backstory event for ages 6-11 is a childhood event for every race.
 */

interface AnchorPair {
  human: number[];
  race: number[];
}

function anchorPairs(rules: CharacterRules, race: Race): AnchorPair {
  const h = rules.humanAnchors;
  const r = race.anchors;
  return {
    human: [0, h.childEnds, h.primeStarts, h.elderStarts],
    race: [0, r.childEnds, r.primeStarts, r.elderStarts],
  };
}

function mapThrough(from: number[], to: number[], value: number): number {
  for (let i = 1; i < from.length; i++) {
    const a = from[i - 1] as number;
    const b = from[i] as number;
    if (value <= b) {
      const ta = to[i - 1] as number;
      const tb = to[i] as number;
      return ta + ((value - a) * (tb - ta)) / (b - a);
    }
  }
  const lastFrom = from[from.length - 1] as number;
  const lastTo = to[to.length - 1] as number;
  return (value * lastTo) / lastFrom;
}

/** Human years -> the same point of life in this race's years. */
export function raceAgeFor(rules: CharacterRules, race: Race, humanAge: number): number {
  const { human, race: r } = anchorPairs(rules, race);
  return mapThrough(human, r, Math.max(0, humanAge));
}

/** This race's years -> human-equivalent years ("a giant of 40 is like a human of 12"). */
export function humanAgeFor(rules: CharacterRules, race: Race, raceAge: number): number {
  const { human, race: r } = anchorPairs(rules, race);
  return mapThrough(r, human, Math.max(0, raceAge));
}

export interface RaceStage {
  stage: StageDef;
  /** First year of this stage for this race. */
  fromAge: number;
}

const cache = new WeakMap<Race, WeakMap<CharacterRules, RaceStage[]>>();

/** The stage table for a race, with boundaries in the race's own years (rounded to whole years). */
export function stagesFor(rules: CharacterRules, race: Race): RaceStage[] {
  let byRules = cache.get(race);
  if (!byRules) {
    byRules = new WeakMap();
    cache.set(race, byRules);
  }
  const found = byRules.get(rules);
  if (found) return found;
  const stages: RaceStage[] = [];
  for (const stage of rules.stages) {
    const previous = stages[stages.length - 1];
    let fromAge = Math.round(raceAgeFor(rules, race, stage.fromAge));
    // Rounding must never merge two stages into one year.
    if (previous && fromAge <= previous.fromAge) fromAge = previous.fromAge + 1;
    stages.push({ stage, fromAge });
  }
  byRules.set(rules, stages);
  return stages;
}

export function stageAt(rules: CharacterRules, race: Race, age: number): RaceStage {
  const stages = stagesFor(rules, race);
  let current = stages[0] as RaceStage;
  for (const entry of stages) {
    if (age >= entry.fromAge) current = entry;
    else break;
  }
  return current;
}

/** Whole years between two ticks (a birthday counts on its month). */
export function ageAt(birthTick: number, tick: number): number {
  return Math.floor((tick - birthTick) / 12);
}
