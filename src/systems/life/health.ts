import type { GameData, LifeRules, Risk } from '../../engine/data/schemas';
import { dpow } from '../../engine/dmath';
import type { Rng } from '../../engine/rng';
import { SCAR_AREAS, type Entity, type Injury, type WorldState } from '../../engine/state';
import { addMod, removeModsBySource } from '../../engine/stats';
import { giveTraitTo } from './traits';
import { capitalize } from '../genesis/text';
import { maxHealthOf, stageOf, ageYears, type Person } from './body';
import { lifeLog, renderLife, reportLine, type LifeEnv } from './env';
import { breakthrough } from './training';

/**
 * Health (Phase 2): injuries by place and severity, illnesses, exhaustion, healing on schedule,
 * Health 0 (death or collapse, by cause), and the yearly mortality roll.
 *
 * Every effect on stats is a modifier with a source and an expiry ("Broken arm (injury)" -20%
 * until it heals), so the sheet explains it and it lifts by itself on the right month (rule 3).
 */

type Area = (typeof SCAR_AREAS)[number];
type Severity = LifeRules['injuries']['severities'][number];

export const EXHAUSTED_SOURCE = 'Exhausted';

export function injurySource(injury: Pick<Injury, 'name'>): string {
  return `${capitalize(injury.name)} (injury)`;
}

export function illnessSource(name: string): string {
  return `${capitalize(name)} (illness)`;
}

function severityOf(data: GameData, id: string): Severity {
  const found = data.life.injuries.severities.find((s) => s.id === id);
  if (!found) throw new Error(`life.json has no injury severity "${id}"`);
  return found;
}

function rollSeverity(
  data: GameData,
  rng: Rng,
  weights: Readonly<Record<string, number>>,
): Severity {
  const list = data.life.injuries.severities;
  const custom = Object.keys(weights).length > 0;
  return (
    rng.weightedPick(list, (s) => (custom ? (weights[s.id] ?? 0) : s.weight)) ??
    (list[0] as Severity)
  );
}

function rollArea(data: GameData, rng: Rng, weights: Risk['areas']): Area {
  const list = data.life.injuries.areas;
  const custom = Object.keys(weights).length > 0;
  return (rng.weightedPick(list, (a) => (custom ? (weights[a.id] ?? 0) : a.weight)) ?? list[0])
    ?.id as Area;
}

const CAUSE_WORDS: Record<string, string> = {
  accident: 'an accident',
  violence: 'wounds from a fight',
  illness: 'illness',
  exhaustion: 'exhaustion',
  starvation: 'hunger',
  execution: 'the executioner',
};

/** Lose a share of Max Health. At 0, the death-or-collapse roll for this cause. */
export function hurt(env: LifeEnv, fraction: number, cause: string, what: string): void {
  const max = maxHealthOf(env.data, env.p.entity, env.tick);
  env.life.health = Math.max(0, env.life.health - fraction * max);
  if (env.life.health <= 0) collapseOrDie(env, cause, what);
}

/** Restore a share of Max Health (never above it). */
export function restore(env: LifeEnv, fraction: number): void {
  const max = maxHealthOf(env.data, env.p.entity, env.tick);
  env.life.health = Math.min(max, env.life.health + fraction * max);
}

export interface InjurySpec {
  severity: string;
  area: Area | 'roll';
  cause: string;
  /** Weights from the activity's risk, for "roll". */
  risk?: Pick<Risk, 'areas' | 'severities'>;
}

export function injure(env: LifeEnv, spec: InjurySpec): Injury | null {
  const { data, tick, p, life } = env;
  if (!p.c.alive) return null;
  const rng = env.rng.fork('injury');
  const severity =
    spec.severity === 'roll'
      ? rollSeverity(data, rng.fork('severity'), spec.risk?.severities ?? {})
      : severityOf(data, spec.severity);
  const area =
    spec.area === 'roll' ? rollArea(data, rng.fork('area'), spec.risk?.areas ?? {}) : spec.area;
  const areaDef = data.life.injuries.areas.find((a) => a.id === area);
  if (!areaDef) return null;
  const name = rng.fork('name').pick(areaDef.names[severity.id]);
  const injury: Injury = {
    area,
    severity: severity.id,
    name,
    cause: spec.cause,
    tick,
    healTick: tick + severity.months,
  };
  life.injuries.push(injury);
  for (const stat of areaDef.stats) {
    const s = p.entity.stats[stat];
    if (s)
      addMod(s, {
        source: injurySource(injury),
        value: severity.statPct,
        kind: 'pct',
        expiresTick: injury.healTick,
      });
  }
  const text = renderLife(env, data.life.lines.injured, { injury: name });
  lifeLog(env, text, {
    kind: 'event',
    tags: ['personal', 'injury', ...(spec.cause === 'violence' ? ['combat'] : [])],
  });
  reportLine(env, text, 'bad');
  hurt(env, severity.damage, spec.cause, name);
  return injury;
}

export function fallIll(env: LifeEnv, illnessId: string): boolean {
  const { data, tick, p, life } = env;
  const def = data.life.illnesses.find((i) => i.id === illnessId);
  if (!def || !p.c.alive) return false;
  if (life.illnesses.some((i) => i.id === illnessId && i.healTick > tick)) return false;
  const healTick = tick + env.rng.fork('illness', illnessId).int(def.months.min, def.months.max);
  life.illnesses.push({ id: def.id, name: def.name, tick, healTick });
  for (const stat of data.character.physical) {
    const s = p.entity.stats[stat];
    if (s)
      addMod(s, {
        source: illnessSource(def.name),
        value: def.statPct,
        kind: 'pct',
        expiresTick: healTick,
      });
  }
  const text = renderLife(env, data.life.lines.ill, { illness: def.name });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'illness'] });
  reportLine(env, text, 'bad');
  return true;
}

/** Take `months` off every injury and illness still healing (bed rest, a good doctor). */
export function speedHealing(env: LifeEnv, months: number): void {
  if (months <= 0) return;
  const { p, life, tick } = env;
  const retime = (source: string, healTick: number) => {
    for (const stat of Object.values(p.entity.stats)) {
      for (const mod of stat.mods) if (mod.source === source) mod.expiresTick = healTick;
    }
  };
  for (const injury of life.injuries) {
    if (injury.healTick <= tick + 1) continue;
    injury.healTick = Math.max(tick + 1, injury.healTick - months);
    retime(injurySource(injury), injury.healTick);
  }
  for (const illness of life.illnesses) {
    if (illness.healTick <= tick + 1) continue;
    illness.healTick = Math.max(tick + 1, illness.healTick - months);
    retime(illnessSource(illness.name), illness.healTick);
  }
}

export function setExhausted(env: LifeEnv, on: boolean): void {
  const { p, life, data } = env;
  if (life.exhausted === on) return;
  life.exhausted = on;
  for (const id of [...data.character.physical, ...data.character.mental]) {
    const stat = p.entity.stats[id];
    if (!stat) continue;
    removeModsBySource(stat, EXHAUSTED_SOURCE);
    if (on)
      addMod(stat, { source: EXHAUSTED_SOURCE, value: data.life.exhaustion.statPct, kind: 'pct' });
  }
  const text = renderLife(env, on ? data.life.lines.exhausted : data.life.lines.rested);
  lifeLog(env, text, { tags: ['personal', 'health'] });
  reportLine(env, text, on ? 'bad' : 'good');
}

// ---- Death and collapse -------------------------------------------------------------------------

/** The character dies. Time stops for the player until they choose who to continue as. */
export function die(env: LifeEnv, cause: string): void {
  const { p, tick, data } = env;
  if (!p.c.alive) return;
  p.c.alive = false;
  p.c.death = { tick, cause };
  const text = renderLife(env, data.life.lines.death, {
    cause,
    age: String(ageYears(p.c, tick)),
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'death'], knownBy: ['*'] });
  reportLine(env, text, 'alert');
}

/**
 * Health has reached 0. Death or collapse, by what caused it (life.json `collapse`, times the
 * difficulty's mortality). Surviving it can be a breakthrough.
 */
export function collapseOrDie(env: LifeEnv, cause: string, what: string): void {
  const { data, state, p, life } = env;
  if (!p.c.alive) return;
  const difficulty = data.creation.difficulties.find((d) => d.id === state.config.difficulty);
  const base = data.life.collapse[cause as keyof LifeRules['collapse']] ?? 0.3;
  const chance = Math.min(1, base * (difficulty?.mortalityMult ?? 1));
  const rng = env.rng.fork('collapse', cause);
  if (rng.chance(chance)) {
    die(env, what || CAUSE_WORDS[cause] || cause);
    return;
  }
  life.health = Math.max(1, Math.round(maxHealthOf(data, p.entity, env.tick) * 0.05));
  const text = renderLife(env, data.life.lines.collapse);
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'health'] });
  reportLine(env, text, 'alert');
  if (rng.fork('breakthrough?').chance(data.life.training.nearDeathBreakthrough)) {
    const stats = [...data.character.physical, ...data.character.mental];
    breakthrough(env, rng.fork('stat').pick(stats), 'Breakthrough (near death)');
  }
}

// ---- Month by month -----------------------------------------------------------------------------

/** Illnesses that might be caught at home this month (not those that need the sea). */
export function catchIllnesses(env: LifeEnv): void {
  const { data, state, tick, p } = env;
  const season = env.data.calendar.seasons.find((s) =>
    s.months.includes((((tick % 12) + 12) % 12) + 1),
  )?.id;
  const stage = stageOf(data, p, tick).id;
  const epidemic =
    typeof state.flags['epidemic.until'] === 'number' &&
    (state.flags['epidemic.until'] as number) > tick &&
    state.flags['epidemic.place'] === p.home.id;
  for (const def of data.life.illnesses) {
    if (def.atSea || def.chance <= 0) continue;
    let chance = def.chance * (def.seasons[season ?? ''] ?? 1) * (def.stages[stage] ?? 1);
    if (epidemic && def.id === data.life.epidemic.illness) chance *= data.life.epidemic.mult;
    for (const trait of p.c.traits) chance *= data.traits[trait]?.eventWeights['illness'] ?? 1;
    chance = paced(Math.min(1, chance), lifePace(data, p.race));
    if (env.rng.fork('catch', def.id).chance(chance)) fallIll(env, def.id);
  }
}

/** Healing on schedule, regeneration, and what an illness costs each month. */
export function healMonth(env: LifeEnv): void {
  const { data, tick, p, life } = env;
  const next = tick + 1;
  const unwell =
    life.illnesses.some((i) => i.healTick > tick) ||
    life.injuries.some((i) => i.healTick > tick && severityOf(data, i.severity).bedRest);
  restore(env, data.life.health.regen * (unwell ? data.life.health.unwellRegenMult : 1));

  for (const illness of life.illnesses) {
    if (illness.healTick <= next) continue;
    const def = data.life.illnesses.find((i) => i.id === illness.id);
    if (def && def.damage > 0) hurt(env, def.damage, 'illness', illness.name);
    if (!p.c.alive) return;
  }

  const healed = life.injuries.filter((i) => i.healTick <= next);
  life.injuries = life.injuries.filter((i) => i.healTick > next);
  for (const injury of healed) {
    const severity = severityOf(data, injury.severity);
    const area = data.life.injuries.areas.find((a) => a.id === injury.area);
    const rng = env.rng.fork('healed', injury.tick, injury.area);
    let line = data.life.lines.healed;
    let title = '';
    if (area?.lossTrait && rng.fork('loss').chance(severity.lossChance)) {
      if (giveTraitTo(data, p.entity, area.lossTrait)) {
        line = data.life.lines.lost;
        title = data.traits[area.lossTrait]?.name ?? '';
      }
    } else if (area && rng.fork('scar').chance(severity.scarChance)) {
      giveTraitTo(data, p.entity, area.scarTrait);
      p.c.scars.push({ area: injury.area, text: rng.fork('text').pick(area.scarText), tick });
      line = data.life.lines.scarred;
      title = data.traits[area.scarTrait]?.name ?? '';
    }
    const text = renderLife(env, line, { injury: injury.name, title });
    lifeLog(env, text, { kind: title ? 'event' : 'life', tags: ['personal', 'injury'] });
    reportLine(env, text, title ? 'plain' : 'good');
  }

  const recovered = life.illnesses.filter((i) => i.healTick <= next);
  life.illnesses = life.illnesses.filter((i) => i.healTick > next);
  for (const illness of recovered) {
    const text = renderLife(env, data.life.lines.recovered, { illness: illness.name });
    lifeLog(env, text, { tags: ['personal', 'illness'] });
    reportLine(env, text, 'good');
  }
}

// ---- The yearly mortality roll ------------------------------------------------------------------

function interpolate(rows: readonly { at: number; value: number }[], x: number): number {
  const first = rows[0];
  if (!first) return 0;
  if (x <= first.at) return first.value;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1] as { at: number; value: number };
    const b = rows[i] as { at: number; value: number };
    if (x <= b.at) return a.value + ((x - a.at) * (b.value - a.value)) / (b.at - a.at);
  }
  return (rows[rows.length - 1] as { value: number }).value;
}

/** Age as a share of the race's expected lifespan (the middle of its range). */
export function lifeFraction(p: Pick<Person, 'race' | 'c'>, tick: number): number {
  const mid = (p.race.lifespan.min + p.race.lifespan.max) / 2;
  return Math.max(0, (tick - p.c.birthTick) / 12) / mid;
}

/**
 * How fast a race lives through the mortality table: 1 for a life of the reference length, a
 * third for a race that lives three times as long. A chance per year becomes the chance for that
 * share of a year, 1 - (1 - chance)^pace, so the shape of a life is the same for every race.
 */
export function lifePace(data: GameData, race: Person['race']): number {
  const mid = (race.lifespan.min + race.lifespan.max) / 2;
  return data.life.mortality.referenceLifespan / mid;
}

export function paced(chance: number, pace: number): number {
  if (chance <= 0) return 0;
  if (chance >= 1) return 1;
  return pace === 1 ? chance : 1 - dpow(1 - chance, pace);
}

export interface MortalityInput {
  data: GameData;
  state: WorldState;
  p: Pick<Person, 'race' | 'c' | 'home'>;
  tick: number;
  /** Health as a share of Max Health; 1 for people the life loop does not track. */
  healthRatio: number;
}

/** The chance of dying this year, and what it would be written down as. */
export function mortalityChance(input: MortalityInput): number {
  const { data, state, p, tick, healthRatio } = input;
  const m = data.life.mortality;
  const x = lifeFraction(p, tick);
  let chance = interpolate(
    m.table.map((r) => ({ at: r.at, value: r.chance })),
    x,
  );
  chance *= m.safety[p.home.safety];
  if (healthRatio < m.lowHealth.below) chance *= m.lowHealth.mult;
  for (const trait of p.c.traits) chance *= m.traits[trait] ?? 1;
  const difficulty = data.creation.difficulties.find((d) => d.id === state.config.difficulty);
  chance *= difficulty?.mortalityMult ?? 1;
  return paced(Math.min(1, chance), lifePace(data, p.race));
}

export function mortalityCause(input: MortalityInput, rng: Rng): string {
  const { data, p, tick } = input;
  const m = data.life.mortality;
  const x = lifeFraction(p, tick);
  const pick = rng.weightedPick(m.causes, (cause) => {
    const w = interpolate(
      cause.weights.map((r) => ({ at: r.at, value: r.weight })),
      x,
    );
    return w * (cause.bySafety ? m.safety[p.home.safety] : 1);
  });
  return pick?.label ?? 'old age';
}

/** True if this entity is the one being played. */
export function isPlayer(state: WorldState, entity: Entity): boolean {
  return state.playerId === entity.id;
}
