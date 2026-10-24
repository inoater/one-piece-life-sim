import { tickOf } from '../../engine/calendar';
import type { Birthplace, GameData, Race } from '../../engine/data/schemas';
import { dpow } from '../../engine/dmath';
import { createEntity } from '../../engine/entities';
import { appendLog } from '../../engine/log';
import type { Rng } from '../../engine/rng';
import {
  PUBLIC_KNOWLEDGE,
  type CharacterData,
  type Stat,
  type WorldState,
} from '../../engine/state';
import { makeStat, statValue, type StatId } from '../../engine/stats';
import { createWorld } from '../../engine/world';
import { scheduleEvent } from '../events';
import { freshLife } from '../life/body';
import { appearanceSentence, rollAdultHeight, rollAppearance } from './appearance';
import { applyEvent, pickEvent, renderBackstory, writeParagraph } from './backstory';
import {
  AGE_SOURCE,
  characterOf,
  current,
  entityOf,
  giveTrait,
  namedMod,
  potentialOf,
  roundTo,
  train,
  TRAINING_SOURCE,
  wealthRankOf,
  wealthTier,
  type GenesisCtx,
  type StoryItem,
} from './context';
import { buildFamily, fullName, givenNames, namePool, siblingTitle } from './family';
import {
  focusApplies,
  genesisRng,
  GenesisError,
  GenesisOptionsSchema,
  resolveChoices,
  sortedValues,
  type GenesisOptions,
  type GenesisOptionsInput,
  type Resolved,
} from './options';
import { ageAt, humanAgeFor, raceAgeFor, stageAt } from './stages';
import { capitalize } from './text';
import { blockingWarning, entryWarnings, type EntryWarning } from './warnings';

/**
 * Character genesis: New Life turned into a world with a person in it.
 *
 *   createLife(data, options) -> { state, ... }
 *
 * One pure function of the options and the data. It builds the world at the entry month, the
 * player with hidden potential and talent, their family, and their past: one compressed pass per
 * year lived before the story starts (natural growth by life stage, training shaped by
 * birthplace, family and focus, and 0-3 backstory events), then appearance, starting Berries and
 * the written backstory. The live preview on the New Life screens is this same function, so what
 * the player sees is exactly what they get.
 */

export interface GenesisResult {
  state: WorldState;
  playerId: string;
  options: GenesisOptions;
  resolved: Resolved;
  warnings: EntryWarning[];
  /** Things the player should know about how their choices were honoured. */
  notes: string[];
}

export function parseGenesisOptions(input: unknown): GenesisOptions {
  const parsed = GenesisOptionsSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new GenesisError(
    `Invalid New Life options: ${first ? `${first.path.join('.') || '(options)'}: ${first.message}` : 'unrecognised'}`,
  );
}

const STAT_ROUND = (data: GameData) => data.character.decimals;

/**
 * Potential = race cap x birthplace modifier x talent multiplier x random(0.85-1.15), and the
 * difficulty's multiplier. The one formula, shared with the debug statistics (stats-report.ts).
 */
export function potentialValue(
  data: GameData,
  parts: {
    race: Race;
    birthplace: Birthplace;
    potentialMult: number;
    difficultyMult: number;
    roll: number;
  },
  stat: string,
): number {
  const raceMult = 1 + (parts.race.capMods[stat as StatId] ?? 0) / 100;
  const placeMult = 1 + (parts.birthplace.potentialMods[stat as StatId] ?? 0) / 100;
  return (
    data.character.baseCap *
    raceMult *
    placeMult *
    parts.potentialMult *
    parts.difficultyMult *
    parts.roll
  );
}

export function potentialRoll(data: GameData, rng: Rng, stat: string): number {
  const { min, max } = data.character.potentialRoll;
  return rng.fork('potential', stat).float(min, max);
}

function rollPotential(ctx: GenesisCtx, stat: string): Stat {
  const value = potentialValue(
    ctx.data,
    {
      race: ctx.race,
      birthplace: ctx.birthplace,
      potentialMult: ctx.talent.potentialMult,
      difficultyMult: ctx.difficulty.potentialMult,
      roll: potentialRoll(ctx.data, ctx.rng, stat),
    },
    stat,
  );
  return makeStat(roundTo(value, STAT_ROUND(ctx.data)));
}

/** Childhood activities: the birthplace's and the family's, or the general default. */
function childhoodWeights(ctx: GenesisCtx): Partial<Record<string, number>> {
  const merged: Record<string, number> = {};
  for (const source of [ctx.birthplace.childhood, ctx.legacy.childhood]) {
    for (const [stat, w] of Object.entries(source)) merged[stat] = (merged[stat] ?? 0) + (w ?? 0);
  }
  return Object.keys(merged).length > 0 ? merged : ctx.data.creation.childhood;
}

function mortalityChance(data: GameData, humanAge: number): number {
  let chance = 0;
  for (const row of data.creation.parentMortality) if (humanAge >= row.fromAge) chance = row.chance;
  return chance;
}

function record(ctx: GenesisCtx, item: StoryItem): void {
  ctx.story.push(item);
  ctx.records.push({
    tick: item.tick,
    input: {
      kind: item.kind === 'family' ? 'family' : 'backstory',
      summary: item.age >= 0 ? `Age ${item.age}: ${item.text}` : item.text,
      tags: [
        ...(item.kind === 'family' ? ['family'] : ['personal']),
        'backstory',
        ...item.tags.filter((t) => t !== 'family' && t !== 'personal'),
      ],
      actorIds: [ctx.player.id],
      targetIds: item.others,
      place: ctx.birthplace.id,
      cause: 'sys:genesis',
      knownBy: [ctx.player.id],
    },
  });
}

/** One compressed pass for the year from birthday `age` to the next. */
function liveYear(ctx: GenesisCtx, age: number): void {
  const { data, race } = ctx;
  const rules = data.character;
  const yearTick = ctx.birthTick + age * 12;
  const humanAge = humanAgeFor(rules, race, age);
  const dh = humanAgeFor(rules, race, age + 1) - humanAge;
  const { stage } = stageAt(rules, race, age);
  const yearRng = ctx.rng.fork('backstory', ctx.options.rolls.backstory, 'year', age);

  // Births of younger brothers and sisters this year.
  for (const id of ctx.siblingIds) {
    const sibling = entityOf(ctx, id);
    const born = characterOf(sibling).birthTick;
    if (born > ctx.birthTick && born >= yearTick && born < yearTick + 12) {
      record(ctx, {
        tick: born,
        age,
        text: `${capitalize(siblingTitle(ctx, sibling))} was born.`,
        template: '{sibling} was born.',
        notability: 0,
        kind: 'family',
        tags: ['birth'],
        others: [sibling.id],
      });
    }
  }

  // Parents age, and may die of natural causes (a parent away at sea is out of sight).
  for (const id of ctx.parentIds) {
    const parent = entityOf(ctx, id);
    const pc = characterOf(parent);
    if (!pc.alive || parent.flags['absent'] === true) continue;
    const parentHuman = humanAgeFor(rules, race, (yearTick - pc.birthTick) / 12);
    const deathRng = yearRng.fork('mortality', id);
    if (!deathRng.chance(mortalityChance(data, parentHuman) * dh)) continue;
    const tick = yearTick + deathRng.int(0, 11);
    pc.alive = false;
    pc.death = { tick, cause: 'natural causes' };
    const template = deathRng.pick(data.creation.naturalDeath);
    record(ctx, {
      tick,
      age,
      text: renderBackstory(ctx, template, tick, age, { parent }),
      template,
      notability: 2,
      kind: 'family',
      tags: ['death'],
      others: [parent.id],
    });
  }

  // Natural growth toward the natural ceiling, and decline in later life.
  const intensity = ctx.birthplace.growthIntensity * wealthTier(ctx).growthIntensity;
  const growth =
    stage.growth > 0 ? 1 - dpow(Math.max(0, 1 - Math.min(0.99, stage.growth * intensity)), dh) : 0;
  for (const stat of [...rules.physical, ...rules.mental]) {
    const s = ctx.player.stats[stat];
    if (!s) continue;
    if (growth > 0) {
      const target = rules.naturalCeiling * statValue(potentialOf(ctx, stat), yearTick);
      if (target > s.base) s.base += growth * (target - s.base);
    }
    const decline = rules.physical.includes(stat) ? stage.physicalDecline : stage.mentalDecline;
    if (decline > 0) namedMod(s, AGE_SOURCE).value -= decline * dh * current(ctx, stat, yearTick);
  }

  // Training: childhood play and chores, then the backstory focus.
  if (stage.training > 0) {
    const focused = ctx.focus !== null && humanAge >= data.creation.entry.focusFromAge;
    const weights = focused && ctx.focus ? ctx.focus.training : childhoodWeights(ctx);
    const total = Object.values(weights).reduce<number>((sum, w) => sum + (w ?? 0), 0);
    const budget = data.creation.trainingPerYear * stage.training * dh;
    if (total > 0) {
      for (const [stat, w] of Object.entries(weights))
        train(ctx, stat, (budget * (w ?? 0)) / total, yearTick);
    }
    if (focused && ctx.focus && humanAge >= data.creation.savingsFromAge) {
      const { min, max } = ctx.focus.savingsPerYear;
      const saved = yearRng.fork('savings').int(min, max) * Math.min(1, dh);
      ctx.berries += Math.round(saved * ctx.difficulty.berriesMult);
    }
  }

  // 0-3 backstory events. A long-lived race's year is a fraction of a human year, so it has a
  // matching chance of passing without any.
  if (dh < 1 && !yearRng.fork('quiet').chance(dh)) return;
  const count =
    yearRng.fork('count').weightedPick([0, 1, 2, 3], (n) => stage.eventsPerYear[n] ?? 0) ?? 0;
  for (let k = 0; k < count; k++) {
    const pickRng = yearRng.fork('event', k);
    const tick = yearTick + pickRng.int(0, 11);
    const event = pickEvent(ctx, pickRng, age, humanAge, tick);
    if (!event) break;
    record(ctx, applyEvent(ctx, event, pickRng.fork('apply'), tick, age, humanAge));
  }
}

function drawTrait(ctx: GenesisCtx, rng: Rng, pool: readonly string[]): string | undefined {
  const usable = pool.filter((id) => ctx.data.traits[id] !== undefined);
  const order = rng.shuffle([...usable]);
  // The first that can be held (not already held, not excluded by one held) wins.
  for (const id of order) if (giveTrait(ctx, id)) return id;
  return undefined;
}

function weightedTraitPool(ctx: GenesisCtx, rng: Rng, category: string): string | undefined {
  const pool = sortedValues(ctx.data.traits).filter((t) => t.category === category && t.weight > 0);
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const pick = rng.fork('attempt', attempt).weightedPick(pool, (t) => t.weight);
    if (pick && giveTrait(ctx, pick.id)) return pick.id;
  }
  return undefined;
}

/** Write the generated numbers back as clean, rounded stats: base + training + traits - age. */
function finishStats(ctx: GenesisCtx): void {
  const decimals = STAT_ROUND(ctx.data);
  for (const stat of Object.values(ctx.player.stats)) {
    stat.base = roundTo(stat.base, decimals);
    for (const mod of stat.mods) mod.value = roundTo(mod.value, decimals);
    stat.mods = stat.mods.filter(
      (m) => !((m.source === TRAINING_SOURCE || m.source === AGE_SOURCE) && m.value === 0),
    );
    // Training first, then traits and events, then age: the order a tooltip reads best in.
    const rank = (source: string) =>
      source === TRAINING_SOURCE ? 0 : source === AGE_SOURCE ? 2 : 1;
    stat.mods.sort((a, b) => rank(a.source) - rank(b.source));
  }
}

export interface CreateLifeOptions {
  /** Generate even when an entry warning is an error (for the preview). Starting refuses. */
  allowBlocked?: boolean;
  /**
   * Phase 3: whether the world gets its ~2,000 named Tier 2 people ("full", the default) or only
   * the canon cast and the places' numbers ("none": balancing runs and tests of other systems).
   */
  population?: 'full' | 'none';
}

export function createLife(
  data: GameData,
  input: GenesisOptionsInput | GenesisOptions,
  settings: CreateLifeOptions = {},
): GenesisResult {
  const options = parseGenesisOptions(input);
  const rules = data.character;
  const { entry } = data.creation;

  const difficulty = data.creation.difficulties.find((d) => d.id === options.difficulty);
  if (!difficulty) throw new GenesisError(`There is no difficulty "${options.difficulty}"`);
  if (!data.creation.canonModes.some((m) => m.id === options.canonMode)) {
    throw new GenesisError(`There is no canon mode "${options.canonMode}"`);
  }
  if (options.entryYear < entry.minYear || options.entryYear > entry.maxYear) {
    throw new GenesisError(
      `The entry year must be between Year ${entry.minYear} and Year ${entry.maxYear}`,
    );
  }
  if (options.entryAge < entry.minAge || options.entryAge > entry.maxAge) {
    throw new GenesisError(`The entry age must be between ${entry.minAge} and ${entry.maxAge}`);
  }

  const resolved = resolveChoices(data, options, (race) =>
    focusApplies(data, humanAgeFor(rules, race, options.entryAge)),
  );
  const { race, birthplace, legacy, focus } = resolved;
  const warnings = entryWarnings(data, race, options.entryYear, options.entryAge);
  const blocking = blockingWarning(warnings);
  if (blocking && !settings.allowBlocked) throw new GenesisError(blocking.text);

  const rng = genesisRng(options.seed);
  const birthMonth = rng.fork('birth').int(1, 12);
  const entryTick = tickOf(options.entryYear, birthMonth);
  const birthTick = tickOf(options.entryYear - options.entryAge, birthMonth);

  const state = createWorld({
    seed: options.seed,
    startTick: entryTick,
    config: {
      canonMode: options.canonMode,
      difficulty: options.difficulty,
      rareRaces: options.rareRaces,
      population: settings.population ?? 'full',
    },
    intro: false,
  });

  // ---- Name, talent, the player entity
  const pool = namePool(data, { race, birthplace });
  const familyRng = rng.fork('family', options.rolls.family);
  const familyName = options.familyName?.trim() || familyRng.fork('surname').pick(pool.family);
  const givenName =
    options.givenName?.trim() ||
    rng.fork('name', options.rolls.name).pick(givenNames(pool, options.pronouns));
  const talent =
    rng.fork('talent').weightedPick(rules.talentTiers, (t) => t.chance) ??
    (rules.talentTiers[0] as GameData['character']['talentTiers'][number]);

  const pc: CharacterData = {
    givenName,
    familyName,
    pronouns: options.pronouns,
    race: race.id,
    birthTick,
    birthplace: birthplace.id,
    alive: true,
    traits: [],
    appearance: {},
    scars: [],
    relationships: [],
    berries: 0,
    hidden: { talent: talent.id, potential: {} },
  };
  const player = createEntity(state, {
    type: 'character',
    origin: 'player',
    name: fullName(pool, givenName, familyName),
    tier: 1,
    flags: { ...birthplace.flags },
  });
  player.character = pc;
  state.playerId = player.id;

  const legacyWealth =
    legacy.wealthFixed !== undefined ? wealthRankOf(data, legacy.wealthFixed) : -1;
  const rolledWealth =
    familyRng
      .fork('wealth')
      .weightedPick(
        data.creation.wealthTiers,
        (t) => data.creation.wealthRolls[birthplace.wealth][t.id] ?? 0,
      )?.id ?? 'modest';
  const maxRank = data.creation.wealthTiers.length - 1;
  const wealthRank =
    legacyWealth >= 0
      ? legacyWealth
      : Math.min(maxRank, Math.max(0, wealthRankOf(data, rolledWealth) + legacy.wealthShift));

  const ctx: GenesisCtx = {
    data,
    options,
    state,
    rng,
    race,
    birthplace,
    legacy,
    focus,
    difficulty,
    talent,
    player,
    pc,
    birthTick,
    entryTick,
    wealthRank,
    birthOrder: 'only',
    trainingPct: 0,
    parentIds: [],
    siblingIds: [],
    legacyParentId: null,
    relationshipsMade: 0,
    story: [],
    records: [],
    happened: new Map(),
    berries: 0,
    notes: [],
  };

  // ---- Potential (hidden) and the newborn's stats
  const hidden = pc.hidden as NonNullable<CharacterData['hidden']>;
  for (const stat of [...rules.physical, ...rules.mental]) {
    hidden.potential[stat] = rollPotential(ctx, stat);
    const fraction = rng
      .fork('newborn', stat)
      .float(rules.birthFraction.min, rules.birthFraction.max);
    player.stats[stat] = makeStat(fraction * (hidden.potential[stat] as Stat).base);
  }
  const luck = rng.fork('luck').normal(rules.luck.mean, rules.luck.sd);
  player.stats['luck'] = makeStat(
    Math.round(Math.min(rules.luck.max, Math.max(rules.luck.min, luck))),
  );

  // ---- Traits: racial, then one innate, one from the birthplace, one from the family, a quirk
  for (const id of race.innateTraits) giveTrait(ctx, id);
  const natureRng = rng.fork('nature');
  weightedTraitPool(ctx, natureRng.fork('innate'), 'innate');
  drawTrait(
    ctx,
    rng.fork('birthTrait', birthplace.id, options.rolls.birthplace),
    birthplace.traitPool,
  );
  drawTrait(ctx, familyRng.fork('trait'), legacy.traitPool);
  if (natureRng.fork('quirk?').chance(data.creation.quirkChance)) {
    weightedTraitPool(ctx, natureRng.fork('quirk'), 'quirk');
  }

  // ---- Family
  buildFamily(ctx, familyRng);
  Object.assign(player.flags, data.creation.birthOrder[ctx.birthOrder]?.flags ?? {});
  record(ctx, {
    tick: birthTick,
    age: 0,
    text: `You were born ${birthplace.bornIn}.`,
    template: 'You were born.',
    notability: 0,
    kind: 'birth',
    tags: ['birth'],
    others: [],
  });

  // ---- The years before the story
  for (let age = 0; age < options.entryAge; age++) liveYear(ctx, age);

  // ---- The family legacy's event chain: scheduled ahead, or already part of the past
  const chain = legacy.chain;
  let chainScheduled: { eventId: string; tick: number } | null = null;
  if (chain) {
    const atTick = birthTick + Math.round(raceAgeFor(rules, race, chain.atAge)) * 12;
    const carrierAlive =
      ctx.legacyParentId !== null && characterOf(entityOf(ctx, ctx.legacyParentId)).alive;
    if (chain.requiresParent && !carrierAlive) {
      // Their boat, their workshop: with the parent gone, the chain never starts.
    } else if (atTick >= entryTick) {
      chainScheduled = { eventId: chain.eventId, tick: atTick };
    } else {
      const age = ageAt(birthTick, atTick);
      const carrier = ctx.legacyParentId ? entityOf(ctx, ctx.legacyParentId) : undefined;
      record(ctx, {
        tick: atTick,
        age,
        text: renderBackstory(ctx, chain.pastText, atTick, age, carrier ? { parent: carrier } : {}),
        template: chain.pastText,
        notability: 3,
        kind: 'legacy',
        tags: ['legacy'],
        others: carrier ? [carrier.id] : [],
      });
    }
  }

  // ---- Appearance at the moment the story starts
  const appearanceCtx = {
    data,
    race,
    birthplace,
    legacy,
    focus,
    age: options.entryAge,
    pronouns: options.pronouns,
  };
  const looks = rollAppearance(
    appearanceCtx,
    rng.fork('appearance'),
    options.locks,
    options.rolls.appearance,
  );
  pc.appearance = { ...looks.values };
  pc.adultHeightCm = rollAdultHeight(
    race,
    looks.values.height,
    rng.fork('appearance', 'heightCm', options.rolls.appearance.height ?? 0),
  );
  for (const field of looks.dropped) {
    const label = data.appearance.fields.find((f) => f.id === field)?.label ?? field;
    ctx.notes.push(
      `Your locked ${label.toLowerCase()} does not suit this character, so it was rolled again.`,
    );
  }

  // ---- Money, stats, family wealth, the written backstory
  const tier = wealthTier(ctx);
  const order = data.creation.birthOrder[ctx.birthOrder];
  const familyMoney = familyRng.fork('berries').int(tier.berries.min, tier.berries.max);
  const legacyMoney = familyRng.fork('legacyBerries').int(legacy.berries.min, legacy.berries.max);
  pc.berries = Math.round(
    familyMoney * difficulty.berriesMult * (order?.berriesMult ?? 1) + legacyMoney + ctx.berries,
  );
  if (pc.family) pc.family.wealth = tier.id;
  if (focus) pc.focus = focus.id;
  finishStats(ctx);
  pc.backstory = writeParagraph(ctx, data);
  // The life loop starts here (Phase 2): full Health, an empty routine.
  pc.life = freshLife(data, player, entryTick);

  // ---- The chronicle: the past in order, then the first line of the story
  ctx.records.sort((a, b) => a.tick - b.tick);
  for (const { tick, input: line } of ctx.records) appendLog(state, tick, line);
  const opening = appendLog(state, entryTick, {
    kind: 'life',
    summary: `${player.name}'s story begins: ${options.entryAge === 0 ? 'a newborn' : `${options.entryAge} years old`}, ${birthplace.bornIn}.`,
    tags: ['personal', 'genesis'],
    actorIds: [player.id],
    place: birthplace.id,
    cause: 'sys:genesis',
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  if (chainScheduled) {
    scheduleEvent(
      state,
      chainScheduled.eventId,
      chainScheduled.tick,
      `legacy:${legacy.id}`,
      opening.seq,
    );
  }

  return { state, playerId: player.id, options, resolved, warnings, notes: ctx.notes };
}

/** The sentence describing the player as they are at `tick`. */
export function describeAppearance(
  data: GameData,
  state: WorldState,
  entityId: string,
  tick = state.tick,
): string {
  const entity = state.entities[entityId];
  const c = entity?.character;
  if (!c) return '';
  const race = data.races[c.race];
  if (!race) return '';
  return appearanceSentence(
    { data, race, age: Math.max(0, ageAt(c.birthTick, tick)), pronouns: c.pronouns },
    c.appearance,
    c.scars,
  );
}
