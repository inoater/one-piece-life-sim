import { z } from 'zod';
import { EFFORTS, FlagValueSchema, PRONOUNS, SCAR_AREAS } from '../state';
import { STAT_IDS } from '../stats';
import {
  FRUIT_TYPES,
  FruitDefSchema,
  POWER_EVENTS,
  POWER_LEVELS,
  PRACTICE_KINDS,
  RARITIES,
  TECH_EFFECTS,
  TECH_FORMS,
  TECH_RANGES,
  TECH_TAGS,
  TechniqueDefSchema,
  TRACK_FAMILIES,
  WEAKNESS_KINDS,
  WhenSchema,
  ZOAN_KINDS,
  CRAFTS,
  CURSES,
  ITEM_KINDS,
  ShipDesignSchema,
  SWORD_GRADES,
  WEAPON_FAMILIES,
  tickOfWhen,
  type FruitContainer,
  type FruitDef,
  type FruitHolder,
  type FruitType,
  type PowerEvent,
  type PowerLevel,
  type PracticeKind,
  type Rarity,
  type TechEffect,
  type TechForm,
  type TechniqueDef,
  type TechRange,
  type TechTag,
  type When,
} from './defs';
import {
  APPEARANCE_VARS,
  BACKSTORY_VARS,
  CANON_VARS,
  checkTemplate,
  LIFE_VARS,
  roleOfVar,
  templateVarsUsed,
} from '../template';

/**
 * Schemas for the content files in /data (rule 1: data, not code).
 *
 * Every object is strict: an unknown or misspelled field is an error that names the file and the
 * field, not a value that is silently ignored. When a later phase needs a new field, it is added
 * here first, and content may use it from that point on.
 *
 * Fields marked (inert) are accepted and validated now but not acted on until the phase that owns
 * them. They exist so content authors can start writing against the final shape.
 */

const slug = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9]+(?:_[a-z0-9]+)*$`), {
    message: `must look like "${prefix}_snake_case_name" (lowercase letters, digits and underscores)`,
  });

/** A string that may contain {variables}; checked against a template registry. */
const templateOf = (known?: readonly string[]) =>
  z
    .string()
    .min(1)
    .superRefine((text, ctx) => {
      for (const problem of checkTemplate(text, known))
        ctx.addIssue({ code: 'custom', message: problem });
    });

/** Event, log and news text (rendered while the world runs). */
const template = templateOf();
/** Backstory text (rendered while a character's past is generated). */
const backstoryTemplate = templateOf(BACKSTORY_VARS);
/** Life-loop text: what happened this month, with the people and places involved (Phase 2). */
const lifeTemplate = templateOf(LIFE_VARS);
/** The canon layer's own lines (Phase 3): who, which beat, why. */
const canonTemplate = templateOf(CANON_VARS);

/** A lowercase flag name such as "haki.observation". */
const flagName = z
  .string()
  .regex(/^[a-z0-9_.]+$/, { message: 'flag names use lowercase letters, digits, "_" and "."' });

const statId = z.enum(STAT_IDS);
/** stat -> number, for only the stats that are mentioned. */
const statNumbers = z.partialRecord(statId, z.number()).default({});
/** stat -> weight (0 or more), for only the stats that are mentioned. */
const statWeights = z.partialRecord(statId, z.number().min(0)).default({});
/** Anything -> multiplier: "how much more (or less) likely". */
const multipliers = z.record(z.string().min(1), z.number().min(0)).default({});
const range = (min = -Infinity) =>
  z
    .strictObject({ min: z.number().min(min), max: z.number().min(min) })
    .refine((r) => r.min <= r.max, { message: 'min must not be greater than max' });
const intRange = (min = -Infinity) =>
  z
    .strictObject({ min: z.number().int().min(min), max: z.number().int().min(min) })
    .refine((r) => r.min <= r.max, { message: 'min must not be greater than max' });
const nonEmptyText = z.string().min(1);

const tags = z.array(z.string().min(1)).default([]);
const monthIndex = z.number().int().min(1).max(12);

/** What a check measures: a stat, Combat Power, or seamanship (navigation at sea). */
export const CHECK_STATS = [...STAT_IDS, 'combatPower', 'navigation'] as const;

// ---------------------------------------------------------------------------------------------
// calendar.json
// ---------------------------------------------------------------------------------------------

export const CalendarSchema = z
  .strictObject({
    /** In-universe calendar year that game Year 0 corresponds to (1486 SC). Display only. */
    canonYearOffset: z.number().int(),
    /** The calendar's name, written after the year: "March 1497 SC" (Sea Circle). */
    era: z.string().min(1).default('SC'),
    /** The tick at which "the present" begins. Move it when the manga advances. */
    presentTick: z.number().int().min(1),
    months: z.array(z.string().min(1)).length(12),
    seasons: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          name: z.string().min(1),
          months: z.array(monthIndex).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((cal, ctx) => {
    const seen = new Map<number, string>();
    cal.seasons.forEach((season, i) => {
      season.months.forEach((m, j) => {
        const earlier = seen.get(m);
        if (earlier !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['seasons', i, 'months', j],
            message: `month ${m} already belongs to season "${earlier}"; each month needs exactly one season`,
          });
        }
        seen.set(m, season.id);
      });
    });
    for (let m = 1; m <= 12; m++) {
      if (!seen.has(m)) {
        ctx.addIssue({
          code: 'custom',
          path: ['seasons'],
          message: `month ${m} is not assigned to any season`,
        });
      }
    }
  });
export type Calendar = z.infer<typeof CalendarSchema>;

// ---------------------------------------------------------------------------------------------
// settings.json
// ---------------------------------------------------------------------------------------------

export const SettingsSchema = z.strictObject({
  tiers: z.strictObject({
    /** Tier 1 (canon and notable entities) acts when tick % tier1Every === 0. */
    tier1Every: z.number().int().min(1),
    /** Tier 2 (generated NPCs) acts when tick % tier2Every === 0. Three means quarterly. */
    tier2Every: z.number().int().min(1),
  }),
  saves: z.strictObject({
    autosaveSlots: z.number().int().min(1).max(10),
    manualSlots: z.number().int().min(1).max(50),
    /** The autosave step requests a save when (tick + 1) % this === 0. */
    autosaveEveryTicks: z.number().int().min(1),
    /** Largest .opsim file accepted on import. */
    maxImportBytes: z.number().int().min(1024),
    /** Largest JSON size a save may expand to (guards against decompression bombs). */
    maxDecompressedBytes: z.number().int().min(1024),
  }),
  time: z.strictObject({
    shortSkipMonths: z.number().int().min(2).max(120),
    /** Safety cap on "Skip to Next Event" so an eventless world cannot loop forever. */
    untilEventCap: z.number().int().min(1).max(5000),
  }),
  host: z.strictObject({
    /** How many recent log lines a snapshot carries to the UI. */
    feedTail: z.number().int().min(10).max(5000),
    newsTail: z.number().int().min(10).max(2000),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

export const StatModDefSchema = z.strictObject({
  stat: z.enum(STAT_IDS),
  value: z.number(),
  kind: z.enum(['flat', 'pct']),
});
export type StatModDef = z.infer<typeof StatModDefSchema>;

export const REGIONS = [
  'east_blue',
  'west_blue',
  'north_blue',
  'south_blue',
  'paradise',
  'new_world',
  'sky',
  'fishman_island',
  'wano',
  'red_line',
  'calm_belt',
] as const;

// ---------------------------------------------------------------------------------------------
// traits, weapons, locations
// ---------------------------------------------------------------------------------------------

/**
 * Where a trait comes from. `racial` traits come with a race and do not use a trait slot; a new
 * character draws one `innate` (their nature), one `birth` (from the birthplace's pool), one
 * `family` (from the family legacy) and up to one `quirk`. `backstory` traits are earned.
 */
export const TRAIT_CATEGORIES = [
  'racial',
  'innate',
  'birth',
  'family',
  'quirk',
  'backstory',
  /** Left behind by a severe injury once it heals (Phase 2): a scar, a lost eye or limb. */
  'scar',
  // Phase 4
  /** Brave, Greedy, Honest...: a starting roll, then drift from the choices made. */
  'personality',
  /** Earned by repeating a behaviour (12 months of Hard training gives Iron Will). */
  'earned',
  /** Earned by deeds and the news (Phase 9 fills more). */
  'reputation',
  /** Never shown, only hinted: King's Qualities, the Will of D. */
  'hidden',
  /** Comes with a power: the curse of a Devil Fruit. */
  'power',
] as const;

/** The plan's kinds of trait, which the sheet groups them by. Each category belongs to one. */
export const TRAIT_KINDS = [
  'innate',
  'upbringing',
  'personality',
  'earned',
  'scar',
  'reputation',
  'hidden',
] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];
export const KIND_OF_CATEGORY: Record<(typeof TRAIT_CATEGORIES)[number], TraitKind> = {
  racial: 'innate',
  innate: 'innate',
  birth: 'upbringing',
  family: 'upbringing',
  backstory: 'upbringing',
  quirk: 'personality',
  personality: 'personality',
  earned: 'earned',
  scar: 'scar',
  reputation: 'reputation',
  hidden: 'hidden',
  power: 'innate',
};

/** Derived values a trait can add to (each has a bonus stat in character.json). */
export const DERIVED_BONUSES = ['maxHealth', 'vigor', 'hakiStamina', 'combatPower'] as const;
export type DerivedBonus = (typeof DERIVED_BONUSES)[number];

/** When an earned trait is gained, or a trait evolves: behaviour counters, stats, time held. */
export const TraitGateSchema = z.strictObject({
  /** Behaviour counters (data/personality.json) at least these. */
  counters: z.record(z.string().regex(/^[a-z_]+$/), z.number().min(0)).default({}),
  stats: statNumbers,
  /** Months the trait has been held (for an evolution). */
  months: z.number().int().min(0).default(0),
});
export type TraitGate = z.infer<typeof TraitGateSchema>;

export const TraitSchema = z.strictObject({
  id: slug('trait'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(TRAIT_CATEGORIES),
  /** Modifiers on current stats. Full trait mechanics arrive in Phase 4. */
  statMods: z.array(StatModDefSchema).default([]),
  /** Percentage changes to a stat's hidden potential (its ceiling). */
  potentialMods: z.array(z.strictObject({ stat: statId, pct: z.number() })).default([]),
  /** Percentage added to every training gain ("Adaptable: +10% training gain"). */
  trainingGainPct: z.number().default(0),
  /** Flags set on the character: abilities later phases unlock ("haki.observation": 1). */
  flags: z.record(flagName, FlagValueSchema).default({}),
  /** Traits that cannot be held together with this one (Sturdy and Frail). Checked both ways. */
  excludes: z.array(slug('trait')).default([]),
  /**
   * Event tag -> weight multiplier, for backstory events, random events and activity outcomes
   * ("misfortune": 2 doubles misfortune events).
   */
  eventWeights: multipliers,
  /** Relative chance of being drawn from a pool. */
  weight: z.number().min(0).default(1),
  // ---- Phase 4: full trait mechanics
  /** The plan's kind; by default the category's (KIND_OF_CATEGORY). */
  kind: z.enum(TRAIT_KINDS).optional(),
  /** Percent on training gains for one stat ("Bookworm: +15% Intellect training"). */
  trainingMods: z.partialRecord(statId, z.number()).default({}),
  /** Flat changes to derived values: Max Health, Vigor, haki stamina, Combat Power. */
  derivedMods: z.partialRecord(z.enum(DERIVED_BONUSES), z.number()).default({}),
  /** Added to the value tested by a check ("Silver-Tongued: +10 on Charisma checks"). */
  checkBonuses: z.partialRecord(z.enum(CHECK_STATS), z.number()).default({}),
  /** Things that never happen to them: "seasickness", or an illness id. */
  immunities: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  /** Activities closed to them, for good or for some months after gaining the trait. */
  locks: z
    .array(z.strictObject({ activity: slug('act'), months: z.number().int().min(1).optional() }))
    .default([]),
  /**
   * What others feel: an opinion modifier in people of a group (data/personality.json `groups`;
   * "everyone" means all), or only on first meeting.
   */
  opinion: z
    .array(
      z.strictObject({
        group: z.string().regex(/^[a-z]+$/),
        value: z.number().min(-50).max(50),
        firstImpression: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Percent on practice of a track, or of a family of tracks ("family:sword"). */
  powerMods: z
    .record(z.string().regex(/^(track_[a-z0-9_]+|family:[a-z_]+)$/), z.number())
    .default({}),
  /** Gained by itself once a behaviour has been repeated enough (an earned trait). */
  earn: TraitGateSchema.optional(),
  /** Grows into another trait: Brawler -> Street Fighter -> Iron Fist. */
  evolves: z.strictObject({ to: slug('trait'), when: TraitGateSchema }).optional(),
  /**
   * A personality trait held while its hidden counter is past `gainAt`, and lost when it falls
   * back past `loseAt` (negative values: the counter's other side).
   */
  drift: z
    .strictObject({ axis: z.string().regex(/^[a-z]+$/), gainAt: z.number(), loseAt: z.number() })
    .refine((d) => d.gainAt !== 0 && Math.sign(d.gainAt) === Math.sign(d.loseAt || d.gainAt), {
      message: 'gainAt and loseAt sit on the same side of zero',
    })
    .refine((d) => Math.abs(d.loseAt) < Math.abs(d.gainAt), {
      message: 'loseAt is nearer zero than gainAt, so the trait does not flicker',
    })
    .optional(),
  /** Never shown to the player; `hint` is what they are told instead. */
  hidden: z.boolean().default(false),
  hint: z.string().optional(),
  /** The chronicle's line when the trait is gained or lost ("You no longer flinch at a raised fist."). */
  gainText: lifeTemplate.optional(),
  loseText: lifeTemplate.optional(),
  tags,
});
export type Trait = z.infer<typeof TraitSchema>;

/** The plan's kind of a trait. */
export function traitKind(trait: Pick<Trait, 'kind' | 'category'>): TraitKind {
  return trait.kind ?? KIND_OF_CATEGORY[trait.category];
}

// Weapons are defined with the rest of Phase 6 (gear, ships, crafting), near the end of the file.

// Locations (map nodes) are defined with the world map, in the Phase 3 section below.

// ---------------------------------------------------------------------------------------------
// life effects
// ---------------------------------------------------------------------------------------------

/** How a body got hurt. Decides the death-or-collapse roll at Health 0 (data/life.json `collapse`). */
export const HARM_CAUSES = [
  'accident',
  'violence',
  'illness',
  'exhaustion',
  'starvation',
  'execution',
] as const;

/** Who an opinion effect touches: one relationship role, or every member of the family. */
export const OPINION_TARGETS = [
  'family',
  'parent',
  'sibling',
  'mentor',
  'friend',
  'rival',
  'sweetheart',
  'protege',
  'child',
  'guardian',
] as const;

/**
 * What a month of life can do to the player (Phase 2). Shared by activity outcomes, job shifts and
 * event effects, so a debt collector's beating and a sparring accident use the same machinery.
 * Severity, area and illness ids are checked against data/life.json.
 */
const lifeEffectOptions = [
  /** Extra training on top of the activity's own, with the usual diminishing returns. */
  z.strictObject({ kind: z.literal('train'), stats: statNumbers }),
  /** Money in (or out, with negative numbers). Fills {amount}. */
  z.strictObject({ kind: z.literal('berries'), min: z.number().int(), max: z.number().int() }),
  z.strictObject({
    kind: z.literal('injury'),
    /** A severity id from life.json, or "roll" to draw one by weight. */
    severity: z.string().min(1).default('roll'),
    /** An injury area, or "roll" to draw one by weight. */
    area: z.union([z.enum(SCAR_AREAS), z.literal('roll')]).default('roll'),
    cause: z.enum(HARM_CAUSES),
  }),
  z.strictObject({ kind: z.literal('illness'), illness: z.string().min(1) }),
  /** Health up or down by this fraction of Max Health. */
  z.strictObject({ kind: z.literal('health'), fraction: z.number().min(-1).max(1) }),
  z.strictObject({ kind: z.literal('trait'), trait: slug('trait') }),
  z.strictObject({ kind: z.literal('flag'), flag: flagName, value: FlagValueSchema }),
  /** Adds to a numeric flag (counters such as "haki.seed.observation"). */
  z.strictObject({ kind: z.literal('count'), flag: flagName, by: z.number() }),
  z.strictObject({ kind: z.literal('fame'), value: z.number() }),
  z.strictObject({ kind: z.literal('infamy'), value: z.number() }),
  /** The player's opinion of someone they know changes. Fills {other} with that person. */
  z.strictObject({
    kind: z.literal('opinion'),
    target: z.enum(OPINION_TARGETS),
    value: z.number().min(-100).max(100),
  }),
  /** Someone new enters the character's life. Fills {other}. */
  z.strictObject({
    kind: z.literal('relationship'),
    role: z.enum(['mentor', 'friend', 'rival', 'sweetheart', 'protege', 'benefactor'] as const),
    occupation: slug('occ').optional(),
    opinion: z.number().min(-100).max(100),
    /** Their age relative to the character's, in years. */
    ageOffset: intRange(),
    /** Flags set on the new person ("mentor.legendary": true). */
    flags: z.record(flagName, FlagValueSchema).default({}),
  }),
  /** A breakthrough: one stat's potential rises by min..max percent. */
  z.strictObject({
    kind: z.literal('potential'),
    stat: z.union([statId, z.literal('random')]),
    min: z.number().min(0),
    max: z.number().min(0),
  }),
  /** Marry the sweetheart. */
  z.strictObject({ kind: z.literal('marry') }),
  /** A child is on the way (born after the gestation in life.json). */
  z.strictObject({ kind: z.literal('conceive') }),
  /** Join a gang: its name and a few members come with it. */
  z.strictObject({ kind: z.literal('joinGang'), members: intRange(1) }),
  /** A notable deed, kept for the life recap. The outcome's own sentence is the deed. */
  z.strictObject({ kind: z.literal('deed') }),
  /** Arrested: a fine if it can be paid, otherwise months in a cell (actions locked). */
  z.strictObject({ kind: z.literal('arrest'), fine: intRange(0), months: intRange(0) }),
  // Phase 3: what a month at sea can do to the vessel the character is aboard (their own ship,
  // or the one carrying them). Outside a voyage these do nothing.
  /** Hull points gained (repairs) or lost (a reef). Zero hull is a shipwreck. */
  z.strictObject({ kind: z.literal('hull'), value: z.number().int() }),
  /** Supplies, in person-months, found or lost. */
  z.strictObject({ kind: z.literal('supplies'), months: z.number() }),
  /** Hands gained (a castaway signs on) or lost (washed overboard, deserted). */
  z.strictObject({ kind: z.literal('crew'), value: z.number().int() }),
  /** The crew's morale (0 to 100). */
  z.strictObject({ kind: z.literal('morale'), value: z.number() }),
  /** Months added to the voyage (a storm) or taken off it (a fair wind): fractions allowed. */
  z.strictObject({ kind: z.literal('delay'), months: z.number().min(-3).max(3) }),
  /** The vessel puts in at the nearest port instead of where it was going. */
  z.strictObject({ kind: z.literal('redirect') }),
  /** Over the side: a swimming check decides between a cold rescue and something worse. */
  z.strictObject({ kind: z.literal('overboard') }),
  /** A bounty on the character's head rises (or a pardon lowers it). */
  z.strictObject({ kind: z.literal('bounty'), value: z.number().int() }),
  // Phase 4: personality, behaviour and powers.
  /** Nudges the hidden personality counters ("brave", "cruel": data/personality.json tags). */
  z.strictObject({
    kind: z.literal('drift'),
    tags: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  }),
  /** A behaviour counter for earned traits ("fights", "severe_injuries"). */
  z.strictObject({
    kind: z.literal('behaviour'),
    counter: z.string().regex(/^[a-z_]+$/),
    by: z.number(),
  }),
  z.strictObject({ kind: z.literal('loseTrait'), trait: slug('trait') }),
  /** Something that moves powers happened: may wake haki, and opens stages that need it. */
  z.strictObject({ kind: z.literal('powerEvent'), event: z.enum(POWER_EVENTS) }),
  /** Practice points for a track (absent: the focus track), counted by kind (a real fight is x3). */
  z.strictObject({
    kind: z.literal('powerPoints'),
    practice: z.enum(PRACTICE_KINDS),
    track: slug('track').optional(),
    points: z.number().min(0),
  }),
  /** A breakthrough for a track (absent: the focus track, or the one stalled on a plateau). */
  z.strictObject({ kind: z.literal('powerBreakthrough'), track: slug('track').optional() }),
  /** Taken on in a style by an event (an invitation to Kamabakka, a scroll found in a ruin). */
  z.strictObject({ kind: z.literal('learnTrack'), track: slug('track') }),
  /**
   * A Devil Fruit comes into their hands, uneaten: a named canon fruit if it is free, otherwise a
   * wild fruit near here, otherwise a new one of this rarity.
   */
  z.strictObject({
    kind: z.literal('findFruit'),
    fruit: slug('fruit').optional(),
    rarity: z.enum(RARITIES).optional(),
  }),
  /** In the sea or touching seastone: a fruit user loses the curse's share of every stat. */
  z.strictObject({
    kind: z.literal('immerse'),
    months: z.number().int().min(1).max(24).default(1),
  }),
  /** Their fruit's deeper truth comes out: another name, a new branch of techniques. */
  z.strictObject({ kind: z.literal('fruitSecret') }),
  /** A rumour of a Devil Fruit: about a real one out there, or about nothing at all. */
  z.strictObject({ kind: z.literal('fruitRumour') }),
  /** A haki colour wakes (an event's crisis already decided it). */
  z.strictObject({
    kind: z.literal('wakeHaki'),
    haki: z.enum(['observation', 'armament', 'conqueror']),
  }),
  /**
   * Phase 6: something comes into their hands: a weapon or an item from data (made new), or an
   * unheld graded sword lying near here ("graded").
   */
  z.strictObject({
    kind: z.literal('findItem'),
    item: z.union([slug('item'), slug('weapon')]).optional(),
    graded: z.boolean().default(false),
  }),
  /** A treasure map: true, partial or fake by data/hands.json's odds (or as given). */
  z.strictObject({
    kind: z.literal('treasureMap'),
    mapKind: z.enum(['true', 'partial', 'fake']).optional(),
  }),
  /** A share of the trade goods in the hold is lost (stolen, spoiled, thrown overboard). */
  z.strictObject({ kind: z.literal('cargo'), share: z.number().min(0).max(1) }),
] as const;

export const LifeEffectSchema = z.discriminatedUnion('kind', [
  ...lifeEffectOptions,
  z.strictObject({
    kind: z.literal('schedule'),
    eventId: slug('evt'),
    afterMonths: z.number().int().min(1).max(1200),
  }),
]);
export type LifeEffect = z.infer<typeof LifeEffectSchema>;

// ---------------------------------------------------------------------------------------------
// Character genesis (Phase 1): races, birthplaces, family legacies, occupations, names, backstory
// foci and backstory events. All numbers are design values to tune, not canon facts.
// ---------------------------------------------------------------------------------------------

const pronounNouns = z.strictObject({ he: nonEmptyText, she: nonEmptyText, they: nonEmptyText });

export const RaceSchema = z.strictObject({
  id: slug('race'),
  name: nonEmptyText,
  /** "fish-man" in "a fish-man boy". */
  adjective: nonEmptyText,
  /** The adult noun by pronoun: "merman", "mermaid", "merfolk". */
  noun: pronounNouns,
  description: nonEmptyText,
  /** Percentage change to each stat's cap ("Str +30%"). Missing stats are +0%. */
  capMods: statNumbers,
  /** Racial traits every member is born with (category "racial"). */
  innateTraits: z.array(slug('trait')).default([]),
  /**
   * Years at which childhood ends, prime starts and elder years start. Every other stage
   * boundary is scaled from the human table in proportion (see src/systems/genesis/stages.ts).
   */
  anchors: z
    .strictObject({
      childEnds: z.number().int().min(1),
      primeStarts: z.number().int().min(1),
      elderStarts: z.number().int().min(1),
    })
    .refine((a) => a.childEnds < a.primeStarts && a.primeStarts < a.elderStarts, {
      message: 'anchors must increase: childEnds < primeStarts < elderStarts',
    }),
  lifespan: intRange(1),
  /** Rare races are only offered when world setup allows them. */
  rare: z.boolean().default(false),
  /** Relative chance when the race is rolled at random. */
  weight: z.number().min(0).default(1),
  /** Height class id (from appearance.json) -> range in centimetres. */
  heights: z.record(z.string(), intRange(1)),
  /** What covers the body in the appearance sentence: "skin", "fur". */
  skinNoun: nonEmptyText.default('skin'),
  /** Overrides the birthplace's name pool (Fish-Man names wherever a Fish-Man is born). */
  namePool: slug('names').optional(),
  /** Appearance weight multipliers: "hairColor.white", or "tag:rare" for every option tagged rare. */
  appearanceWeights: multipliers,
  tags,
});
export type Race = z.infer<typeof RaceSchema>;

export const WEALTH_LEVELS = ['low', 'medium', 'high'] as const;

/** Places and services a home can have. Activities and jobs name the ones they need. */
export const PLACE_FEATURES = [
  'coast',
  'docks',
  'farmland',
  'forest',
  'jungle',
  'mountains',
  'cold',
  'ruins',
  'school',
  'library',
  'doctor',
  'dojo',
  'market',
  'smithy',
  'shipyard',
  'marine_base',
  'underworld',
  'clouds',
  'deep_sea',
  /** Phase 5: a colosseum or a fighting pit (tournaments, pit fights). */
  'arena',
] as const;
export const SAFETY_LEVELS = ['very_low', 'low', 'medium', 'high'] as const;

export const BirthplaceSchema = z.strictObject({
  id: slug('bp'),
  name: nonEmptyText,
  /** For the header: "East Blue". */
  shortName: nonEmptyText,
  /** How a story names it mid-sentence, filling {home}: "the village", "Wano". */
  home: nonEmptyText,
  /** Where someone is born, with its preposition: "on an island in the New World". */
  bornIn: nonEmptyText,
  region: z.enum(REGIONS),
  description: nonEmptyText,
  /** What a start here opens up ("Fishing and farm jobs, a quiet start"). */
  opens: nonEmptyText,
  wealth: z.enum(WEALTH_LEVELS),
  safety: z.enum(SAFETY_LEVELS),
  /** Which races can be born here. Every race must have at least one birthplace. */
  races: z.array(slug('race')).min(1),
  /** The "birth" trait is drawn from here. */
  traitPool: z.array(slug('trait')).min(1),
  namePool: slug('names'),
  /** Percentage change to potential ("the birthplace modifier"). */
  potentialMods: statNumbers,
  /** How fast children grow up here: hard places and good food both show. 1 is neutral. */
  growthIntensity: z.number().min(0.5).max(1.5).default(1),
  /** Which stats childhood play and chores train (weights). */
  childhood: statWeights,
  /** Family legacy id -> multiplier on its chance here. */
  legacyWeights: multipliers,
  /** Focus id -> multiplier, used when the backstory focus is Random. */
  focusWeights: multipliers,
  /** Backstory event tag -> multiplier ("sea": 2 near the sea). */
  eventTags: multipliers,
  appearanceWeights: multipliers,
  /**
   * Where it is on the world map (the Map page and the Birthplace screen): map units, x 0-2576
   * west to east, y 0-1288 north to south. Presentation only; Phase 3's travel graph is separate.
   */
  map: z
    .strictObject({ x: z.number().min(0).max(2576), y: z.number().min(0).max(1288) })
    .optional(),
  /** Flags every character born here starts with ("wano.closed": leaving needs an event chain). */
  flags: z.record(flagName, FlagValueSchema).default({}),
  /** What there is to do here (Phase 2): activities and jobs that need a coast, a school, a doctor. */
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  /** The map node a life born here starts on (Phase 3): where "home" is on the travel graph. */
  location: slug('loc'),
  tags,
});
export type Birthplace = z.infer<typeof BirthplaceSchema>;

export const LegacySchema = z
  .strictObject({
    id: slug('legacy'),
    name: nonEmptyText,
    description: nonEmptyText,
    weight: z.number().min(0).default(1),
    /** Starting Berries added on top of the wealth tier's. */
    berries: intRange(),
    /** Moves the family's wealth tier up or down from what the birthplace would give. */
    wealthShift: z.number().int().min(-6).max(6).default(0),
    /** Sets the wealth tier outright (an orphan starts with nothing, wherever they were born). */
    wealthFixed: z.string().min(1).optional(),
    traitPool: z.array(slug('trait')).min(1),
    /** The parent who carries the legacy. Absent for an orphan, whose parents are unknown. */
    parent: z
      .strictObject({
        role: z.enum(['mother', 'father', 'either']),
        occupation: slug('occ'),
        /** "present" at home, "absent" (away at sea, in hiding). */
        status: z.enum(['present', 'absent']).default('present'),
        /** Shown in the family list: "a retired Marine lieutenant". */
        title: nonEmptyText,
        flags: z.record(flagName, FlagValueSchema).default({}),
        /** A bounty in Berries, set as the "bounty" flag on that parent. */
        bounty: intRange(0).optional(),
      })
      .optional(),
    /** For an orphan: who raised them. */
    guardian: z.strictObject({ occupation: slug('occ'), title: nonEmptyText }).optional(),
    childhood: statWeights,
    focusWeights: multipliers,
    eventTags: multipliers,
    appearanceWeights: multipliers,
    /**
     * The event chain the legacy sets off. It is scheduled for the month the character reaches
     * `atAge`; if that month is already in the past when the story starts, `pastText` joins the
     * backstory instead.
     */
    chain: z
      .strictObject({
        eventId: slug('evt'),
        atAge: z.number().int().min(1).max(120),
        /** Written without an age: the backstory adds "At sixteen, " itself. */
        pastText: backstoryTemplate,
        /** The chain needs the legacy's parent alive (it is their boat, their workshop). */
        requiresParent: z.boolean().default(false),
      })
      .optional(),
    tags,
  })
  .superRefine((legacy, ctx) => {
    if (!legacy.parent && !legacy.guardian) {
      ctx.addIssue({
        code: 'custom',
        path: ['parent'],
        message: 'a legacy needs a parent who carries it, or a guardian (for an orphan)',
      });
    }
  });
export type Legacy = z.infer<typeof LegacySchema>;

export const OccupationSchema = z.strictObject({
  id: slug('occ'),
  name: nonEmptyText,
  /** Birthplaces where this work exists. Empty means anywhere. */
  places: z.array(slug('bp')).default([]),
  /** Races who do this work. Empty means anyone. */
  races: z.array(slug('race')).default([]),
  /** Wealth tier ids this work fits. Empty means any. */
  wealth: z.array(z.string().min(1)).default([]),
  /** Only legacies and backstory events give this occupation; it is never rolled for a parent. */
  special: z.boolean().default(false),
  weight: z.number().min(0).default(1),
  tags,
});
export type Occupation = z.infer<typeof OccupationSchema>;

export const NamePoolSchema = z.strictObject({
  id: slug('names'),
  given: z.strictObject({
    he: z.array(nonEmptyText).min(1),
    she: z.array(nonEmptyText).min(1),
    /** Names that suit anyone; drawn for every pronoun. */
    any: z.array(nonEmptyText).default([]),
  }),
  family: z.array(nonEmptyText).min(1),
  /** "family-first" writes Kurozumi Aki; "given-first" writes Aki Kurozumi. */
  order: z.enum(['given-first', 'family-first']).default('given-first'),
  tags,
});
export type NamePool = z.infer<typeof NamePoolSchema>;

export const FocusSchema = z.strictObject({
  id: slug('focus'),
  name: nonEmptyText,
  description: nonEmptyText,
  /** How a year of this life's training is shared between stats. */
  training: statWeights,
  /** Backstory event tag -> multiplier. */
  eventTags: multipliers,
  appearanceWeights: multipliers,
  /** What an adult with this focus puts aside each year, in Berries. */
  savingsPerYear: intRange(0),
  weight: z.number().min(0).default(1),
  /** Phase 4: power tracks this past teaches, and the highest stage reached by a grown entry. */
  tracks: z.record(slug('track'), z.number().int().min(0)).default({}),
  tags,
});
export type Focus = z.infer<typeof FocusSchema>;

export const BIRTH_ORDERS = ['only', 'eldest', 'middle', 'youngest'] as const;

export const RELATIONSHIP_ROLES = [
  'mentor',
  'friend',
  'rival',
  'sweetheart',
  'guardian',
  'benefactor',
  'protege',
] as const;

export const BackstoryEffectSchema = z.discriminatedUnion('kind', [
  /** Training on top of natural growth, with the usual diminishing returns. */
  z.strictObject({ kind: z.literal('train'), stats: statNumbers }),
  /** A permanent, named modifier ("Old knee injury": Speed -2). */
  z.strictObject({
    kind: z.literal('mod'),
    stat: statId,
    value: z.number(),
    mod: z.enum(['flat', 'pct']).default('flat'),
    source: nonEmptyText,
  }),
  z.strictObject({ kind: z.literal('trait'), trait: slug('trait') }),
  /** A scar: written into the appearance and kept on the sheet. */
  z.strictObject({ kind: z.literal('scar'), area: z.enum(SCAR_AREAS), text: nonEmptyText }),
  z.strictObject({ kind: z.literal('berries'), min: z.number().int(), max: z.number().int() }),
  /** Someone outside the family enters the character's life. Fills {other}. */
  z.strictObject({
    kind: z.literal('relationship'),
    role: z.enum(RELATIONSHIP_ROLES),
    occupation: slug('occ').optional(),
    opinion: z.number().min(-100).max(100),
    /** Their age relative to the character's, in years. */
    ageOffset: intRange(),
  }),
  /** A living parent dies. Fills {parent}. */
  z.strictObject({ kind: z.literal('parentDies'), cause: nonEmptyText }),
  /** The most recent living person of this relationship dies (a spouse, an old mentor). Fills {other}. */
  z.strictObject({
    kind: z.literal('relationDies'),
    role: z.enum(RELATIONSHIP_ROLES),
    cause: nonEmptyText,
  }),
  z.strictObject({ kind: z.literal('flag'), flag: flagName, value: FlagValueSchema }),
  /** The family's fortunes change by this many wealth tiers. */
  z.strictObject({ kind: z.literal('wealth'), shift: z.number().int().min(-3).max(3) }),
  /** A breakthrough: one stat's potential rises by min..max percent ("random" picks the stat). */
  z.strictObject({
    kind: z.literal('potential'),
    stat: z.union([statId, z.literal('random')]),
    min: z.number().min(0),
    max: z.number().min(0),
  }),
]);
export type BackstoryEffect = z.infer<typeof BackstoryEffectSchema>;

export const BackstoryEventSchema = z
  .strictObject({
    id: slug('bs'),
    /** A full sentence in the second person, past tense: "You won a footrace against the harbor kids." */
    text: backstoryTemplate,
    /**
     * Ages (in human-equivalent years) at which this can happen. A Giant's real age is converted
     * through the race's anchors, so "ages 6-11" means childhood for every race.
     */
    ages: intRange(0),
    weight: z.number().min(0).default(1),
    /** 0 = everyday, never in the paragraph; 3 = life-defining, always considered for it. */
    notability: z.number().int().min(0).max(3).default(1),
    /** Happens at most once per life. */
    once: z.boolean().default(true),
    /** For repeatable events: years before it can happen again. */
    cooldownYears: z.number().int().min(0).default(0),
    conditions: z
      .strictObject({
        races: z.array(slug('race')).default([]),
        notRaces: z.array(slug('race')).default([]),
        birthplaces: z.array(slug('bp')).default([]),
        regions: z.array(z.enum(REGIONS)).default([]),
        legacies: z.array(slug('legacy')).default([]),
        foci: z.array(slug('focus')).default([]),
        /** Wealth tier ids: at least / at most this well off. */
        wealthMin: z.string().min(1).optional(),
        wealthMax: z.string().min(1).optional(),
        traits: z.array(slug('trait')).default([]),
        notTraits: z.array(slug('trait')).default([]),
        flags: z.record(flagName, FlagValueSchema).default({}),
        notFlags: z.array(flagName).default([]),
        parentAlive: z.boolean().optional(),
        hasSibling: z.boolean().optional(),
        birthOrders: z.array(z.enum(BIRTH_ORDERS)).default([]),
        /** A living person of this relationship exists (for "relationDies"). */
        hasRelation: z.enum(RELATIONSHIP_ROLES).optional(),
      })
      .default({
        races: [],
        notRaces: [],
        birthplaces: [],
        regions: [],
        legacies: [],
        foci: [],
        traits: [],
        notTraits: [],
        flags: {},
        notFlags: [],
        birthOrders: [],
      }),
    effects: z.array(BackstoryEffectSchema).default([]),
    tags,
  })
  .superRefine((event, ctx) => {
    const used = templateVarsUsed(event.text);
    const has = (kind: BackstoryEffect['kind']) => event.effects.some((e) => e.kind === kind);
    if (used.includes('other') && !has('relationship') && !has('relationDies')) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message:
          '{other} names the person a "relationship" or "relationDies" effect involves; add one or drop it',
      });
    }
    for (const [i, effect] of event.effects.entries()) {
      if (effect.kind === 'relationDies' && event.conditions.hasRelation !== effect.role) {
        ctx.addIssue({
          code: 'custom',
          path: ['effects', i, 'role'],
          message: `a "relationDies" effect needs "hasRelation": "${effect.role}" in the conditions`,
        });
      }
    }
    if (used.includes('parent') || used.includes('parentName')) {
      if (!has('parentDies') && event.conditions.parentAlive !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['text'],
          message:
            '{parent} needs a living parent: add "parentAlive": true to the conditions, or a "parentDies" effect',
        });
      }
    }
    if (used.includes('sibling') && event.conditions.hasSibling !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: '{sibling} needs "hasSibling": true in the conditions',
      });
    }
    if (
      event.effects.filter((e) => e.kind === 'relationship' || e.kind === 'relationDies').length > 1
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['effects'],
        message: 'one relationship effect per backstory event (there is only one {other})',
      });
    }
    if (has('parentDies') && event.conditions.parentAlive !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['conditions', 'parentAlive'],
        message: 'a "parentDies" effect needs "parentAlive": true in the conditions',
      });
    }
  });
export type BackstoryEvent = z.infer<typeof BackstoryEventSchema>;

// ---------------------------------------------------------------------------------------------
// character.json: growth, potential, talent, life stages and derived values
// ---------------------------------------------------------------------------------------------

const DerivedSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z]+$/),
  name: nonEmptyText,
  constant: z.number(),
  terms: z
    .array(
      z.union([
        z.strictObject({ stat: statId, factor: z.number() }),
        z.strictObject({ stat: statId, divide: z.number().positive() }),
      ]),
    )
    .min(1),
  round: z.enum(['none', 'floor', 'round']).default('none'),
  /** Shown under the value: "plus weapon, haki and fruit bonuses (later phases)". */
  note: z.string().optional(),
  /**
   * Phase 4: an entity stat added to the formula (rule 3: its modifiers name each bonus, such as
   * "Armament Haki: Harden" or "Sturdy (trait)"). Absent on an entity: nothing is added.
   */
  bonusStat: z
    .string()
    .regex(/^[a-zA-Z]+$/)
    .optional(),
});
export type DerivedDef = z.infer<typeof DerivedSchema>;

export const StageSchema = z.strictObject({
  id: z.string().regex(/^[a-z_]+$/),
  name: nonEmptyText,
  /** First year of this stage for a human. Other races are scaled through their anchors. */
  fromAge: z.number().int().min(0),
  /** Natural growth per year, as a fraction of the gap between current and the natural ceiling. */
  growth: z.number().min(0).max(1),
  /** Physical stats lose this fraction of their current value per year. */
  physicalDecline: z.number().min(0).max(1).default(0),
  mentalDecline: z.number().min(0).max(1).default(0),
  /** Training efficiency (0 = cannot train). */
  training: z.number().min(0),
  /** Chance weights for 0, 1, 2 and 3 backstory events in a year of this stage. */
  eventsPerYear: z.array(z.number().min(0)).length(4),
});
export type StageDef = z.infer<typeof StageSchema>;

export const CharacterRulesSchema = z
  .strictObject({
    /** Every race cap is this, plus or minus the race's percentage. */
    baseCap: z.number().positive(),
    /** Natural growth alone lifts a stat toward this fraction of potential; training fills the rest. */
    naturalCeiling: z.number().min(0.05).max(1),
    /** A newborn starts at this fraction of potential. */
    birthFraction: range(0),
    /** The random(0.85-1.15) factor in Potential = race cap x birthplace x talent x random. */
    potentialRoll: range(0),
    /** Above this fraction of potential, training gains are multiplied by `factor`. */
    softCap: z.strictObject({ above: z.number().min(0).max(1), factor: z.number().min(0).max(1) }),
    /** Decimal places kept on generated stats. */
    decimals: z.number().int().min(0).max(4),
    physical: z.array(statId).min(1),
    mental: z.array(statId).min(1),
    /** Luck is rolled once and never trained. Hidden from the player. */
    luck: z.strictObject({
      mean: z.number(),
      sd: z.number().min(0),
      min: z.number(),
      max: z.number(),
    }),
    talentTiers: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z_]+$/),
          name: nonEmptyText,
          /** Percent chance; all tiers add up to 100. */
          chance: z.number().min(0),
          potentialMult: z.number().positive(),
          /** Multiplies every training gain. */
          growthMult: z.number().positive(),
          /** What the player is told instead of the tier, before and after age 6. */
          hints: z.strictObject({
            young: z.array(nonEmptyText).min(1),
            older: z.array(nonEmptyText).min(1),
          }),
        }),
      )
      .min(1),
    /** The human ages the race anchors correspond to. */
    humanAnchors: z.strictObject({
      childEnds: z.number().int().min(1),
      primeStarts: z.number().int().min(1),
      elderStarts: z.number().int().min(1),
    }),
    stages: z.array(StageSchema).min(1),
    derived: z.array(DerivedSchema).min(1),
  })
  .superRefine((rules, ctx) => {
    const total = rules.talentTiers.reduce((sum, t) => sum + t.chance, 0);
    if (Math.abs(total - 100) > 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['talentTiers'],
        message: `talent tier chances add up to ${total}, not 100`,
      });
    }
    rules.stages.forEach((stage, i) => {
      const previous = rules.stages[i - 1];
      if (i === 0 && stage.fromAge !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['stages', 0, 'fromAge'],
          message: 'the first stage must start at age 0',
        });
      }
      if (previous && stage.fromAge <= previous.fromAge) {
        ctx.addIssue({
          code: 'custom',
          path: ['stages', i, 'fromAge'],
          message: 'stages must be in order of age',
        });
      }
    });
    for (const stat of rules.physical) {
      if (rules.mental.includes(stat)) {
        ctx.addIssue({
          code: 'custom',
          path: ['mental'],
          message: `${stat} cannot be both physical and mental`,
        });
      }
    }
  });
export type CharacterRules = z.infer<typeof CharacterRulesSchema>;

// ---------------------------------------------------------------------------------------------
// creation.json: world setup, entry limits, wealth, families and the backfill pass
// ---------------------------------------------------------------------------------------------

const choiceList = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z_]+$/),
      name: nonEmptyText,
      summary: nonEmptyText,
    }),
  )
  .min(1);

export const CreationSchema = z.strictObject({
  entry: z.strictObject({
    minYear: z.number().int().min(0),
    maxYear: z.number().int().min(0),
    minAge: z.number().int().min(0),
    maxAge: z.number().int().min(0),
    /** A backstory focus is chosen when entering older than this. */
    focusAboveAge: z.number().int().min(0),
    /** The focus shapes training from this (human-equivalent) age. */
    focusFromAge: z.number().int().min(0),
  }),
  /** Canon, Probable or Random. Stored now; acted on by the canon layer in Phase 3. */
  canonModes: choiceList,
  difficulties: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        summary: nonEmptyText,
        berriesMult: z.number().min(0),
        /** Multiplies the chance of backstory events tagged "hardship". */
        hardshipMult: z.number().min(0),
        potentialMult: z.number().positive(),
        /** (inert) Phase 2 mortality and Phase 3 danger. */
        mortalityMult: z.number().min(0).default(1),
        dangerMult: z.number().min(0).default(1),
      }),
    )
    .min(1),
  defaults: z.strictObject({
    canonMode: z.string().min(1),
    difficulty: z.string().min(1),
    entryYear: z.number().int(),
    entryAge: z.number().int(),
    pronouns: z.enum(PRONOUNS),
  }),
  /** Poorest first. Their order is their rank. */
  wealthTiers: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        berries: intRange(),
        /** Multiplies natural growth: hunger stunts, plenty helps a little. */
        growthIntensity: z.number().min(0.5).max(1.5),
      }),
    )
    .min(2),
  /** Wealth tier weights for a family born somewhere of low, medium or high wealth. */
  wealthRolls: z.strictObject({
    low: z.record(z.string(), z.number().min(0)),
    medium: z.record(z.string(), z.number().min(0)),
    high: z.record(z.string(), z.number().min(0)),
  }),
  /** Multiplier on "hardship" backstory events by birthplace safety. */
  safetyHardship: z.strictObject({
    very_low: z.number().min(0),
    low: z.number().min(0),
    medium: z.number().min(0),
    high: z.number().min(0),
  }),
  siblings: z.strictObject({
    /** Weights for 0, 1, 2, 3 and 4 siblings. */
    count: z.array(z.number().min(0)).length(5),
    /** Months between one child and the next. */
    spacingMonths: intRange(9),
  }),
  /** A parent's age (human-equivalent years) when the character is born. */
  parentAge: intRange(10),
  birthOrder: z.record(
    z.enum(BIRTH_ORDERS),
    z.strictObject({
      label: nonEmptyText,
      berriesMult: z.number().min(0),
      flags: z.record(flagName, FlagValueSchema).default({}),
      /** Backstory event tag -> multiplier (an eldest child carries responsibility). */
      eventTags: multipliers,
    }),
  ),
  /** Training points a year of focused life is worth, before efficiency and diminishing returns. */
  trainingPerYear: z.number().min(0),
  /** Childhood play when neither birthplace nor legacy says otherwise. */
  childhood: statWeights,
  /** Chance per year that a parent dies of natural causes, from a human-equivalent age. */
  parentMortality: z
    .array(z.strictObject({ fromAge: z.number().int().min(0), chance: z.number().min(0).max(1) }))
    .min(1),
  /** How a parent's natural death is written; {parent} is "your mother" and so on. */
  naturalDeath: z.array(backstoryTemplate).min(1),
  /** Non-family relationships a new character can start with. */
  maxRelationships: z.number().int().min(0),
  /** How many backstory events the written paragraph may mention. */
  paragraphEvents: z.number().int().min(0),
  /** Adults start saving from this (human-equivalent) age. */
  savingsFromAge: z.number().int().min(0),
  /** A quirk is drawn with this chance (0 to 1). */
  quirkChance: z.number().min(0).max(1),
});
export type Creation = z.infer<typeof CreationSchema>;

// ---------------------------------------------------------------------------------------------
// appearance.json: appearance fields, their options, and the sentence
// ---------------------------------------------------------------------------------------------

/** The fields the sentence is written from, in sheet order. Each must be defined exactly once. */
export const APPEARANCE_FIELDS = [
  'height',
  'build',
  'skin',
  'complexion',
  'hairColor',
  'hairStyle',
  'eyeColor',
  'eyeShape',
  'face',
  'marks',
  'feature',
] as const;
export type AppearanceField = (typeof APPEARANCE_FIELDS)[number];

export const AppearanceOptionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** Written into the sentence. May be empty for "none" options. */
  text: z.string(),
  /** Shown in the reroll list when `text` reads oddly alone. */
  label: z.string().optional(),
  weight: z.number().min(0).default(1),
  /** Only these races may have it (empty: any race). */
  races: z.array(slug('race')).default([]),
  notRaces: z.array(slug('race')).default([]),
  /** Not before this age, nor after `maxAge` (human-equivalent years). */
  minAge: z.number().int().min(0).default(0),
  maxAge: z.number().int().min(0).optional(),
  /** From this age, the weight is multiplied (grey hair in later life). */
  ageMult: z.strictObject({ from: z.number().int().min(0), mult: z.number().min(0) }).optional(),
  tags,
});
export type AppearanceOption = z.infer<typeof AppearanceOptionSchema>;

export const AppearanceSchema = z
  .strictObject({
    fields: z
      .array(
        z.strictObject({
          id: z.enum(APPEARANCE_FIELDS),
          label: nonEmptyText,
          options: z.array(AppearanceOptionSchema).min(1),
        }),
      )
      .length(APPEARANCE_FIELDS.length),
    /**
     * The sentence. Variables: {a} (a or an), {adjectives} ("wiry, tall"), {noun}, {face},
     * {skin}, {hair}, {eyes}, {extras} (", with ..." or nothing).
     */
    sentence: templateOf(APPEARANCE_VARS),
    /** Stage id -> nouns by pronoun ("baby girl"), used instead of the race's adult noun. */
    ageNouns: z.record(z.string(), pronounNouns),
    /**
     * How tall a child is as a fraction of their adult height, by human-equivalent age. Values
     * between the listed ages are interpolated; from the last age on, the fraction is 1.
     */
    childHeight: z
      .array(z.strictObject({ age: z.number().min(0), fraction: z.number().min(0).max(1) }))
      .min(1),
  })
  .superRefine((appearance, ctx) => {
    const seen = new Set<string>();
    appearance.fields.forEach((field, i) => {
      if (seen.has(field.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'id'],
          message: `field "${field.id}" is defined twice`,
        });
      }
      seen.add(field.id);
      const ids = new Set<string>();
      field.options.forEach((option, j) => {
        if (ids.has(option.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['fields', i, 'options', j, 'id'],
            message: `option "${option.id}" appears twice in ${field.id}`,
          });
        }
        ids.add(option.id);
      });
    });
  });
export type Appearance = z.infer<typeof AppearanceSchema>;

// ---------------------------------------------------------------------------------------------
// The life loop (Phase 2): activities, jobs, and life.json (slots, effort, health, money, death)
// ---------------------------------------------------------------------------------------------

export const ACTIVITY_CATEGORIES = [
  'train_body',
  'train_mind',
  'train_spirit',
  'work',
  'social',
  'explore',
  'rest',
  'crime',
  'special',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

const LIVING_ROLES = [
  'parent',
  'sibling',
  'guardian',
  'mentor',
  'friend',
  'rival',
  'sweetheart',
  'protege',
  'child',
] as const;

const requiresShape = {
  /** Every one of these must be at the character's home. */
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  /** At least one of these must be at home. */
  anyFeatures: z.array(z.enum(PLACE_FEATURES)).default([]),
  races: z.array(slug('race')).default([]),
  notRaces: z.array(slug('race')).default([]),
  /** Flags that must hold these values. A number flag passes when it is at least the value. */
  flags: z.record(flagName, FlagValueSchema).default({}),
  notFlags: z.array(flagName).default([]),
  /** At least one of these traits. */
  anyTraits: z.array(slug('trait')).default([]),
  notTraits: z.array(slug('trait')).default([]),
  /** Current stat values (totals, modifiers included) at least these. */
  stats: statNumbers,
  combatPower: z.number().min(0).optional(),
  /** Holding a job (true), or not holding one (false). */
  employed: z.boolean().optional(),
  /** A living person of this relationship exists. */
  relation: z.enum(LIVING_ROLES).optional(),
  /** No living person of this relationship. */
  noRelation: z.enum(LIVING_ROLES).optional(),
  married: z.boolean().optional(),
  /** Hurt or ill (true), or neither (false). */
  unwell: z.boolean().optional(),
  /** Berries in hand at least this. */
  berries: z.number().optional(),
  /** Only on a voyage (true), or only ashore (false) (Phase 3). */
  atSea: z.boolean().optional(),
  /** Phase 4: power tracks open, at least at a stage ("open": just begun). */
  tracks: z.record(slug('track'), z.string().regex(/^[a-z0-9_]+$/)).default({}),
  /** A Devil Fruit user (true), or not one (false). */
  fruitUser: z.boolean().optional(),
  /** Gear in hand: swords (count), a gun, a bow. */
  gear: z.partialRecord(z.enum(['swords', 'gun', 'bow']), z.number().int().min(1)).default({}),
} as const;

/** Conditions on the character, their home, body, purse and people. All listed must hold. */
export const RequiresSchema = z.strictObject({
  ...requiresShape,
  /** Alternatives: at least one of these must hold as well ("Sea Legs, or Endurance 20"). */
  anyOf: z.array(z.strictObject(requiresShape)).default([]),
});
export type Requires = z.infer<typeof RequiresSchema>;
const noRequirements = (): Requires => RequiresSchema.parse({});

/** The chance of getting hurt (or arrested) doing something. Multiplied by the effort's risk. */
export const RiskSchema = z.strictObject({
  injury: z.number().min(0).max(1).default(0),
  cause: z.enum(HARM_CAUSES).default('accident'),
  /** Area -> weight. Missing areas are never hurt; empty means any area by life.json's weights. */
  areas: z.partialRecord(z.enum(SCAR_AREAS), z.number().min(0)).default({}),
  /** Severity id -> weight; empty means life.json's default weights. */
  severities: multipliers,
  arrest: z.number().min(0).max(1).default(0),
  fine: intRange(0).optional(),
  jailMonths: intRange(0).optional(),
});
export type Risk = z.infer<typeof RiskSchema>;

/** Conditions on a single outcome, mostly about who is around to be written into it. */
const OutcomeRequiresSchema = z.strictObject({
  parentAlive: z.boolean().optional(),
  hasSibling: z.boolean().optional(),
  relation: z.enum(LIVING_ROLES).optional(),
  noRelation: z.enum(LIVING_ROLES).optional(),
  married: z.boolean().optional(),
  /** Real-age bounds in human-equivalent years. */
  minAge: z.number().int().min(0).optional(),
  maxAge: z.number().int().min(0).optional(),
  flags: z.record(flagName, FlagValueSchema).default({}),
  notFlags: z.array(flagName).default([]),
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
});

/** A variable in outcome text and the condition that guarantees it names somebody. */
const OUTCOME_PERSON_VARS: Record<string, (o: z.infer<typeof OutcomeRequiresSchema>) => boolean> = {
  parent: (r) => r.parentAlive === true || r.relation === 'parent',
  sibling: (r) => r.hasSibling === true || r.relation === 'sibling',
  spouse: (r) => r.married === true,
  friend: (r) => r.relation === 'friend',
  mentor: (r) => r.relation === 'mentor',
  child: (r) => r.relation === 'child',
  sweetheart: (r) => r.relation === 'sweetheart',
  protege: (r) => r.relation === 'protege',
};

export const OutcomeSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9_]+$/),
    /** A full sentence in the second person, past tense: "You won a footrace against the harbor kids." */
    text: lifeTemplate,
    weight: z.number().min(0).default(1),
    /** Stat -> how strongly a high value makes this outcome likelier (negative: less likely). */
    statWeights: statNumbers,
    requires: OutcomeRequiresSchema.default({ flags: {}, notFlags: [], features: [] }),
    effects: z.array(LifeEffectSchema).default([]),
    /** An everyday outcome: on the month-end card, but not written into the chronicle. */
    quiet: z.boolean().default(false),
    tags,
  })
  .superRefine((outcome, ctx) => {
    const used = templateVarsUsed(outcome.text);
    for (const [name, guaranteed] of Object.entries(OUTCOME_PERSON_VARS)) {
      if (used.includes(name) && !guaranteed(outcome.requires)) {
        ctx.addIssue({
          code: 'custom',
          path: ['text'],
          message: `{${name}} needs a condition that guarantees that person exists (for example "requires": { "relation": "${name === 'spouse' ? 'sweetheart' : name}"${name === 'spouse' ? ', "married": true' : ''} })`,
        });
      }
    }
    const meets = outcome.effects.filter(
      (e) => e.kind === 'relationship' || e.kind === 'opinion',
    ).length;
    if (used.includes('other') && meets === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: '{other} names the person a "relationship" or "opinion" effect involves; add one',
      });
    }
    if (meets > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['effects'],
        message: 'one relationship or opinion effect per outcome (there is only one {other})',
      });
    }
  });
export type Outcome = z.infer<typeof OutcomeSchema>;

function uniqueOutcomeIds(
  outcomes: readonly { id: string }[],
  ctx: z.RefinementCtx,
  path: string,
): void {
  const seen = new Set<string>();
  outcomes.forEach((o, i) => {
    if (seen.has(o.id))
      ctx.addIssue({
        code: 'custom',
        path: [path, i, 'id'],
        message: `duplicate outcome id "${o.id}"`,
      });
    seen.add(o.id);
  });
}

// ---------------------------------------------------------------------------------------------
// Phase 5: battles (the vocabulary; data/battle.json's schema is at the end)
// ---------------------------------------------------------------------------------------------

/** The Combat Power ladder's tiers, weakest first. */
export const LADDER_TIERS = [
  'civilian',
  'thug',
  'officer',
  'captain',
  'grand_line',
  'commander',
  'monster',
  'peak',
] as const;
export type LadderTier = (typeof LADDER_TIERS)[number];

/** What each side means to do to the other. Deaths come only from Kill, or from the field. */
export const INTENTS = ['spare', 'capture', 'kill'] as const;
export type Intent = (typeof INTENTS)[number];

/** The verbs of an exchange (the plan's ten, techniques included). */
export const BATTLE_VERBS = [
  'strike',
  'technique',
  'guard',
  'evade',
  'feint',
  'grapple',
  'haki',
  'item',
  'talk',
  'flee',
] as const;
export type BattleVerb = (typeof BATTLE_VERBS)[number];

export const BATTLE_ROLES = [
  'vanguard',
  'striker',
  'guard',
  'support',
  'ranged',
  'commander',
] as const;
export type BattleRole = (typeof BATTLE_ROLES)[number];
export const BATTLE_ZONES = ['front', 'middle', 'rear', 'high', 'rigging', 'water'] as const;
export type BattleZone = (typeof BATTLE_ZONES)[number];
export const TEAM_ORDERS = [
  'none',
  'focus',
  'protect',
  'fall_back',
  'swap',
  'combo',
  'rally',
  'retreat',
] as const;
export type TeamOrder = (typeof TEAM_ORDERS)[number];
/** How a spar stops. */
export const STOP_RULES = ['first_hit', 'first_knockdown', 'time_limit', 'yield'] as const;
export type StopRule = (typeof STOP_RULES)[number];
export const BATTLE_SCALES = ['duel', 'skirmish', 'crew', 'naval', 'war'] as const;
export type BattleScale = (typeof BATTLE_SCALES)[number];
export const BATTLE_MODES = ['tactical', 'quick', 'narrated'] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];
/** What the winner does with the loser. */
export const FATES = ['let_go', 'hand_over', 'recruit', 'rob', 'kill'] as const;
export type Fate = (typeof FATES)[number];

export const ActivitySchema = z
  .strictObject({
    id: slug('act'),
    name: nonEmptyText,
    category: z.enum(ACTIVITY_CATEGORIES),
    description: nonEmptyText,
    /** Human-equivalent ages (a giant's real age is converted). */
    minAge: z.number().int().min(0).default(0),
    maxAge: z.number().int().min(0).optional(),
    requires: RequiresSchema.default(noRequirements),
    /** Done once and then dropped from the routine (seeing a doctor), instead of every month. */
    oneOff: z.boolean().default(false),
    /** Happens by itself to those who have no activity slots yet (an infant's first months). */
    automatic: z.boolean().default(false),
    /** Rest restores Vigor instead of spending it, and clears exhaustion. */
    restful: z.boolean().default(false),
    /** Physical work: locked while on bed rest, in a cell or exhausted past the point of collapse. */
    physical: z.boolean().default(false),
    /** Vigor on top of what the effort costs. */
    extraVigor: z.number().int().min(0).max(3).default(0),
    /** Base training per month at Normal effort, before stage, potential, traits and teacher. */
    gains: statNumbers,
    /** A fixed teacher multiplier (a school is 1.2). */
    teacher: z.number().min(0.5).max(2).default(1),
    /** A living mentor multiplies the gains by life.json's mentor value. */
    usesMentor: z.boolean().default(false),
    /** Berries it costs each time. */
    cost: intRange(0).optional(),
    /** Berries it earns, scaled by the effort's pay. */
    earn: intRange(0).optional(),
    /** Pays the wage of the job held (the "Work a shift" activity). */
    worksJob: z.boolean().default(false),
    /** Medical care: Berries for a chance to heal faster, set by the local doctor's skill. */
    doctor: z.boolean().default(false),
    /** Extra fraction of Max Health recovered this month. */
    regen: z.number().min(0).max(1).default(0),
    /** Months taken off every injury's healing time (and an illness's). */
    speedsHealing: z.number().int().min(0).max(6).default(0),
    risk: RiskSchema.default(() => RiskSchema.parse({})),
    fame: z.number().default(0),
    infamy: z.number().default(0),
    /**
     * Phase 4: practice for power tracks. `tracks` empty means the focus track (or, sparring, the
     * fighting styles in use); several tracks share one practice by focus, else the least advanced.
     */
    practice: z
      .strictObject({
        kind: z.enum(PRACTICE_KINDS),
        tracks: z.array(slug('track')).default([]),
        /** Base points a month at Normal effort. */
        points: z.number().min(0).default(1),
        /** Spends haki stamina (haki training). */
        stamina: z.boolean().default(false),
      })
      .optional(),
    /**
     * Phase 5: the month's activity is a fight the battle engine plays: a spar (Spare, a stop rule,
     * training by how strong the partner is), a brawl, or a contest (data/battle.json). Its outcome
     * is the one named for the result ("won", "lost", "draw") when there is one.
     */
    fight: z
      .strictObject({
        kind: z.enum(['spar', 'brawl', 'contest', 'group']),
        partner: z.enum(['mentor', 'rival', 'friend', 'local', 'crew', 'any']).default('any'),
        stop: z.enum(STOP_RULES).optional(),
        contest: z
          .string()
          .regex(/^[a-z_]+$/)
          .optional(),
        /** A nameless foe when nobody suitable is at hand (data/battle.json `foes`). */
        foe: slug('foe').optional(),
      })
      .optional(),
    /** Phase 6: a month of work on the project at the bench, the forge or the slipway. */
    craft: z.boolean().default(false),
    /**
     * Phase 6: what else the month does with the hands: weapon drills (skill with the weapon in
     * hand), a treasure hunt, caring for the ship, cooking (the cook's craft).
     */
    hand: z.enum(['drill', 'treasure', 'ship', 'cook']).optional(),
    outcomes: z.array(OutcomeSchema).min(1),
    tags,
  })
  .superRefine((act, ctx) => {
    uniqueOutcomeIds(act.outcomes, ctx, 'outcomes');
    if (act.maxAge !== undefined && act.maxAge < act.minAge) {
      ctx.addIssue({ code: 'custom', path: ['maxAge'], message: 'maxAge is below minAge' });
    }
    if (act.worksJob && act.requires.employed !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires', 'employed'],
        message: 'an activity that works a job needs "employed": true in its requirements',
      });
    }
  });
export type Activity = z.infer<typeof ActivitySchema>;

export const JobSchema = z
  .strictObject({
    id: slug('job'),
    name: nonEmptyText,
    description: nonEmptyText,
    /** Human-equivalent age. */
    minAge: z.number().int().min(0),
    requires: RequiresSchema.default(noRequirements),
    /** Shown beside the job: "Strength 20". Written by hand so it reads well. */
    requirementText: z.string().default(''),
    /** Berries per month of Normal shifts. */
    income: intRange(0),
    /** Training each shift gives on the side. */
    gains: statNumbers,
    risk: RiskSchema.default(() => RiskSchema.parse({})),
    /** Bodily work: impossible on bed rest. A shop counter is not. */
    physical: z.boolean().default(true),
    fame: z.number().default(0),
    infamy: z.number().default(0),
    /** Flags set while the job is held (and kept: "path.smith" opens the smith's path). */
    grants: z.record(flagName, FlagValueSchema).default({}),
    /**
     * Work that goes where the worker goes (a ship's hand, a Marine). Any other job is left behind
     * when the character sails away (Phase 3).
     */
    travels: z.boolean().default(false),
    /** A rank track: every `everyMonths` of service, the next title (Marine recruit to Seaman ...). */
    ranks: z
      .strictObject({
        flag: flagName,
        everyMonths: z.number().int().min(1),
        titles: z.array(nonEmptyText).min(1),
      })
      .optional(),
    /** What a shift can bring. One is drawn each month the job is worked. */
    outcomes: z.array(OutcomeSchema).min(1),
    tags,
  })
  .superRefine((job, ctx) => uniqueOutcomeIds(job.outcomes, ctx, 'outcomes'));
export type Job = z.infer<typeof JobSchema>;

const effortSchema = z.strictObject({
  name: nonEmptyText,
  /** Vigor this effort costs per activity. */
  vigor: z.number().int().min(0).max(5),
  /** Multiplies training gains. */
  gain: z.number().min(0),
  /** Multiplies earnings. */
  pay: z.number().min(0),
  /** Multiplies the chance of injury. */
  risk: z.number().min(0),
});

const injuryNames = z.strictObject({
  minor: z.array(nonEmptyText).min(1),
  serious: z.array(nonEmptyText).min(1),
  severe: z.array(nonEmptyText).min(1),
});

export const LifeRulesSchema = z
  .strictObject({
    /** Activity slots a month, by life stage id. */
    slots: z.record(z.string(), z.number().int().min(0).max(6)),
    /** A number flag that adds slots (set by traits or roles). */
    extraSlotFlag: flagName,
    efforts: z.strictObject({ light: effortSchema, normal: effortSchema, hard: effortSchema }),
    /**
     * Phase 6: a month scaled by Vigor. A deep pool opens overtime slots beyond the stage's own,
     * and lets a Hard slot be pushed further: each point committed past Hard costs one more Vigor
     * and multiplies what the slot gives (training, practice, pay, crafting), with diminishing
     * returns and more risk.
     */
    drive: z.strictObject({
      overtime: z.strictObject({
        /** One overtime slot for every this much Vigor in the pool. */
        perSlot: z.number().int().min(1),
        max: z.number().int().min(0).max(4),
        /** Vigor an overtime slot costs on top of its effort. */
        surcharge: z.number().int().min(0),
        /** Only from a stage with at least this many slots of its own (adolescents and up). */
        fromSlots: z.number().int().min(1),
      }),
      commit: z.strictObject({
        /** One point of commitment past Hard for every this much Vigor in the pool. */
        per: z.number().int().min(1),
        /** What each point adds to the slot's gains, in order (so its length is the most). */
        gain: z.array(z.number().min(0)).min(1).max(8),
        /** Pay added per point (a share: 0.12 is +12%). */
        pay: z.number().min(0),
        /** Risk added per point (a share). */
        risk: z.number().min(0),
      }),
    }),
    exhaustion: z.strictObject({
      /** Percentage applied to every stat while exhausted. */
      statPct: z.number().max(0),
      /** Chance per month of an injury while exhausted. */
      injuryChance: z.number().min(0).max(1),
      /** Exhaustion lifts after a month that spends at most this share of the Vigor pool. */
      restBelow: z.number().min(0).max(1),
    }),
    training: z.strictObject({
      /** Multiplier with a living mentor, and with a legendary one. */
      mentor: z.number().min(1),
      legendaryMentor: z.number().min(1),
      /** Training at Hard effort while above the soft cap: chance of a breakthrough per stat. */
      breakthroughChance: z.number().min(0).max(1),
      /** A breakthrough raises one stat's potential by this many percent. */
      breakthroughPct: range(0),
      /** Chance that surviving Health 0 is a breakthrough. */
      nearDeathBreakthrough: z.number().min(0).max(1),
    }),
    health: z.strictObject({
      /** Share of Max Health recovered a month. */
      regen: z.number().min(0).max(1),
      /** Regeneration is multiplied by this while ill or on bed rest. */
      unwellRegenMult: z.number().min(0).max(1),
    }),
    injuries: z.strictObject({
      severities: z
        .array(
          z.strictObject({
            id: z.enum(['minor', 'serious', 'severe']),
            name: nonEmptyText,
            months: z.number().int().min(1),
            /** Percentage on the hurt area's stats while it heals. */
            statPct: z.number().max(0),
            /** Share of Max Health lost when it happens. */
            damage: z.number().min(0).max(1),
            /** Physical activities are locked while it heals. */
            bedRest: z.boolean(),
            weight: z.number().min(0),
            /** Chance it leaves a scar trait, and a lost limb or eye, when it heals. */
            scarChance: z.number().min(0).max(1).default(0),
            lossChance: z.number().min(0).max(1).default(0),
          }),
        )
        .length(3),
      areas: z
        .array(
          z.strictObject({
            id: z.enum(SCAR_AREAS),
            weight: z.number().min(0),
            /** Stats that suffer while it heals. */
            stats: z.array(statId).min(1),
            names: injuryNames,
            scarTrait: slug('trait'),
            /** The trait for losing it (an eye, an arm, a leg); none for head and torso. */
            lossTrait: slug('trait').optional(),
            /** How the scar is written on the appearance. */
            scarText: z.array(nonEmptyText).min(1),
          }),
        )
        .length(SCAR_AREAS.length),
    }),
    illnesses: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z_]+$/),
          name: nonEmptyText,
          months: intRange(1),
          /** Chance per month of catching it at home (0 for illnesses that need a cause). */
          chance: z.number().min(0).max(1),
          /** Season id -> multiplier. */
          seasons: multipliers,
          /** Life stage id -> multiplier (the very young and very old catch more). */
          stages: multipliers,
          /** Percentage on every physical stat while ill. */
          statPct: z.number().max(0),
          /** Share of Max Health lost each month while ill. */
          damage: z.number().min(0).max(1),
          /** Only caught at sea (Phase 3). */
          atSea: z.boolean().default(false),
        }),
      )
      .min(1),
    epidemic: z.strictObject({
      /** Chance per month that an epidemic reaches the character's home. */
      chance: z.number().min(0).max(1),
      months: intRange(1),
      illness: z.string().min(1),
      /** Multiplies that illness's chance while the epidemic lasts. */
      mult: z.number().min(1),
      /** Chance per month that an outbreak spreads along a sea lane to a neighbouring island (Phase 3). */
      spread: z.number().min(0).max(1).default(0),
      news: z.array(template).min(1),
    }),
    /** At Health 0: chance of death (otherwise a collapse), by what caused it. */
    collapse: z.strictObject({
      accident: z.number().min(0).max(1),
      violence: z.number().min(0).max(1),
      illness: z.number().min(0).max(1),
      exhaustion: z.number().min(0).max(1),
      starvation: z.number().min(0).max(1),
      execution: z.number().min(0).max(1),
    }),
    mortality: z.strictObject({
      /**
       * The life the table's years belong to. A race whose expected lifespan is three times this
       * lives through each row three times as slowly: its yearly chance is the table's chance for
       * a third of a year. Illness is paced the same way.
       */
      referenceLifespan: z.number().positive(),
      /**
       * Yearly chance of death by age as a share of the race's expected lifespan (the middle of its
       * range): 1.0 is the expected lifespan. Interpolated between rows.
       */
      table: z
        .array(z.strictObject({ at: z.number().min(0), chance: z.number().min(0).max(1) }))
        .min(2),
      /** By the home's safety. */
      safety: z.strictObject({
        very_low: z.number().min(0),
        low: z.number().min(0),
        medium: z.number().min(0),
        high: z.number().min(0),
      }),
      /** Below this share of Max Health the chance is multiplied. */
      lowHealth: z.strictObject({ below: z.number().min(0).max(1), mult: z.number().min(1) }),
      /** Trait -> multiplier (Frail dies younger, Hardy older). */
      traits: multipliers,
      /** What the yearly roll says killed them, weighted by the same share of lifespan. */
      causes: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z_]+$/),
            /** "old age", written into "died of old age". */
            label: nonEmptyText,
            weights: z
              .array(z.strictObject({ at: z.number().min(0), weight: z.number().min(0) }))
              .min(1),
            /** Multiplied by the home's safety multiplier (violence is likelier where it is unsafe). */
            bySafety: z.boolean().default(false),
          }),
        )
        .min(1),
    }),
    money: z.strictObject({
      /** Monthly cost of living for an adult, by the home's wealth level. */
      livingCost: z.strictObject({
        low: z.number().min(0),
        medium: z.number().min(0),
        high: z.number().min(0),
      }),
      /** Human-equivalent age from which the character pays their own way. */
      independentAge: z.number().int().min(0),
      /** Monthly interest on a negative balance, in percent. */
      interestPct: z.number().min(0),
      interestFromAge: z.number().int().min(0),
      /** A collector calls when the debt is beyond this, at most every `everyMonths`. */
      collector: z.strictObject({
        above: z.number().min(0),
        everyMonths: z.number().int().min(1),
        eventId: slug('evt'),
      }),
      /** Loan sizes a loan shark offers. */
      loans: z.array(z.number().int().min(1)).min(1),
      loanFromAge: z.number().int().min(0),
      /** A loan shark lends while the debt stays under this. */
      maxDebt: z.number().min(0),
    }),
    doctor: z.strictObject({
      /** Berries per visit, by the worst thing being treated. */
      cost: z.strictObject({
        none: z.number().int().min(0),
        minor: z.number().int().min(0),
        serious: z.number().int().min(0),
        severe: z.number().int().min(0),
      }),
      /** The local doctor's Intellect, by the home's wealth level. */
      intellect: z.strictObject({ low: z.number(), medium: z.number(), high: z.number() }),
      /** Months off every injury's healing on success. */
      months: z.number().int().min(1),
    }),
    family: z.strictObject({
      /** Chance per month of time together, for a married couple, that a child is on the way. */
      conceiveChance: z.number().min(0).max(1),
      /** Human-equivalent ages. */
      fertile: intRange(0),
      gestationMonths: z.number().int().min(1),
      maxChildren: z.number().int().min(0),
    }),
    fame: z.strictObject({
      /** Share of fame that passes to an heir as Legacy, in percent. */
      legacyPct: z.number().min(0).max(100),
    }),
    gangNames: z.array(nonEmptyText).min(1),
    /** Shown on the death screen. */
    continuation: z
      .array(
        z.strictObject({
          id: z.enum(['heir', 'protege', 'crewmate', 'sibling', 'newborn', 'new']),
          label: nonEmptyText,
          description: nonEmptyText,
        }),
      )
      .length(6),
    epilogue: z.strictObject({ title: nonEmptyText, text: nonEmptyText }),
    /** Log lines the life loop writes, by occasion. */
    lines: z.strictObject({
      birthday: lifeTemplate,
      stage: lifeTemplate,
      injured: lifeTemplate,
      healed: lifeTemplate,
      scarred: lifeTemplate,
      lost: lifeTemplate,
      ill: lifeTemplate,
      recovered: lifeTemplate,
      exhausted: lifeTemplate,
      rested: lifeTemplate,
      collapse: lifeTemplate,
      breakthrough: lifeTemplate,
      livingCost: lifeTemplate,
      interest: lifeTemplate,
      broke: lifeTemplate,
      hired: lifeTemplate,
      quit: lifeTemplate,
      promoted: lifeTemplate,
      jailed: lifeTemplate,
      released: lifeTemplate,
      childBorn: lifeTemplate,
      siblingBorn: lifeTemplate,
      relativeDied: lifeTemplate,
      married: lifeTemplate,
      death: lifeTemplate,
    }),
  })
  .superRefine((rules, ctx) => {
    const ids = rules.illnesses.map((i) => i.id);
    if (!ids.includes(rules.epidemic.illness)) {
      ctx.addIssue({
        code: 'custom',
        path: ['epidemic', 'illness'],
        message: `unknown illness "${rules.epidemic.illness}" (known: ${ids.join(', ')})`,
      });
    }
    const sev = rules.injuries.severities.map((s) => s.id);
    if (new Set(sev).size !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['injuries', 'severities'],
        message: 'list minor, serious and severe once each',
      });
    }
    const areas = rules.injuries.areas.map((a) => a.id);
    if (new Set(areas).size !== SCAR_AREAS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['injuries', 'areas'],
        message: `list each area once: ${SCAR_AREAS.join(', ')}`,
      });
    }
    rules.mortality.table.forEach((row, i) => {
      const prev = rules.mortality.table[i - 1];
      if (prev && row.at <= prev.at) {
        ctx.addIssue({
          code: 'custom',
          path: ['mortality', 'table', i, 'at'],
          message: 'rows must be in increasing order of "at"',
        });
      }
    });
  });
export type LifeRules = z.infer<typeof LifeRulesSchema>;

// ---------------------------------------------------------------------------------------------
// The world (Phase 3): the map graph, ships and travel, factions, the event engine and the canon
// layer. All numbers are design values to tune, not canon facts.
// ---------------------------------------------------------------------------------------------

// "Year 14, month 3" in data (WhenSchema) lives in defs.ts with the other shared definitions.
export { WhenSchema, tickOfWhen, type When };
export {
  FRUIT_TYPES,
  FruitDefSchema,
  POWER_EVENTS,
  POWER_LEVELS,
  PRACTICE_KINDS,
  RARITIES,
  TECH_EFFECTS,
  TECH_FORMS,
  TECH_RANGES,
  TECH_TAGS,
  TechniqueDefSchema,
  TRACK_FAMILIES,
  WEAKNESS_KINDS,
  ZOAN_KINDS,
  type FruitContainer,
  type FruitDef,
  type FruitHolder,
  type FruitType,
  type PowerEvent,
  type PowerLevel,
  type PracticeKind,
  type Rarity,
  type TechEffect,
  type TechForm,
  type TechniqueDef,
  type TechRange,
  type TechTag,
};

export const NODE_KINDS = [
  'island',
  'port',
  'kingdom',
  'sky_island',
  'undersea',
  'landmark',
  'stronghold',
  'ruin',
] as const;
export const CLIMATES = [
  'temperate',
  'tropical',
  'arid',
  'cold',
  'volatile',
  'sky',
  'undersea',
] as const;
export const POPULATION_TIERS = ['none', 'hamlet', 'village', 'town', 'city', 'capital'] as const;
export type PopulationTier = (typeof POPULATION_TIERS)[number];

/**
 * A node of the world map: an island, a port, a sky island or a landmark (Phase 3). Where people
 * live, work, train and meet each other; sea lanes join nodes into the travel graph.
 */
export const LocationSchema = z.strictObject({
  id: slug('loc'),
  name: nonEmptyText,
  /** For the header and the map: "Loguetown". Defaults to the name. */
  shortName: nonEmptyText.optional(),
  /** How a story names it mid-sentence, filling {place} and {home}: "Loguetown", "the village". */
  home: nonEmptyText.optional(),
  kind: z.enum(NODE_KINDS).default('island'),
  region: z.enum(REGIONS),
  climate: z.enum(CLIMATES).default('temperate'),
  /** Canon places, or places the game invents (the generic villages of the four seas). */
  origin: z.enum(['canon', 'generated']).default('canon'),
  description: nonEmptyText,
  population: z.enum(POPULATION_TIERS),
  wealth: z.enum(WEALTH_LEVELS),
  /** 0 (a sleepy harbour) to 5 (nobody sane lives here). Sets the safety of living there. */
  danger: z.number().int().min(0).max(5),
  /** The faction that holds it at the start of the world; null for nobody in particular. */
  controller: slug('org').nullable().default(null),
  /** What there is to do and buy: docks, a shipyard, a doctor, a Marine base, a black market... */
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  /** Only these jobs are offered here (empty: every job the place's features allow). */
  jobs: z.array(slug('job')).default([]),
  /** Event tag -> weight multiplier: what tends to happen here (the local event pool). */
  eventTags: multipliers,
  /** Whose ways the people here share: names, races and occupations (a birthplace id). */
  culture: slug('bp'),
  /** Grand Line islands: months before the Log Pose sets on the next island (0 to 12). */
  logPose: z.number().int().min(0).max(12).optional(),
  /** Eternal Poses to these islands are sold here. */
  eternalPoses: z.array(slug('loc')).default([]),
  /** Where it is drawn on the map (map units, as for birthplaces). */
  map: z.strictObject({ x: z.number().min(0).max(2576), y: z.number().min(0).max(1288) }),
  tags,
});
export type Location = z.infer<typeof LocationSchema>;

export const CURRENTS = ['calm', 'gentle', 'steady', 'strong', 'wild', 'none'] as const;
export const LANE_REQUIREMENTS = [
  'none',
  'log_pose',
  'eternal_pose',
  'coated_ship',
  'sky_route',
] as const;
export type LaneRequirement = (typeof LANE_REQUIREMENTS)[number];

/** A sea lane (an edge of the travel graph). Lanes run both ways unless `oneWay`. */
export const LaneSchema = z
  .strictObject({
    id: slug('lane'),
    from: slug('loc'),
    to: slug('loc'),
    /** Sea miles. A voyage takes ceil(miles / (speed x wind and current x navigator)) months. */
    miles: z.number().int().min(10).max(5000),
    /** 0 to 5: how many hazards and encounters a month on it rolls. */
    danger: z.number().int().min(0).max(5),
    current: z.enum(CURRENTS).default('steady'),
    requires: z.enum(LANE_REQUIREMENTS).default('none'),
    /** The sea whose dangers it crosses (its region modifier). Defaults to the start's region. */
    zone: z.enum(REGIONS).optional(),
    /** Only from -> to (Reverse Mountain's currents run uphill one way). */
    oneWay: z.boolean().default(false),
    /** Walked, not sailed: only on foot. */
    land: z.boolean().default(false),
    /** How many ships run it, 0 to 3. Zero: no captain takes passengers, crew or stowaways. */
    traffic: z.number().int().min(0).max(3).default(2),
    /** A flag on the traveller (or the world) that closes it, and what the planner says. */
    closedBy: flagName.optional(),
    closedText: nonEmptyText.optional(),
    /** A flag that must be set to use it, and what the planner says when it is not. */
    needsFlag: flagName.optional(),
    needsText: nonEmptyText.optional(),
    description: z.string().optional(),
    tags,
  })
  .superRefine((lane, ctx) => {
    if (lane.from === lane.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'a lane must join two places' });
    }
    if (lane.closedBy && !lane.closedText) {
      ctx.addIssue({
        code: 'custom',
        path: ['closedText'],
        message: 'say why the lane is closed (shown in the planner)',
      });
    }
    if (lane.needsFlag && !lane.needsText) {
      ctx.addIssue({
        code: 'custom',
        path: ['needsText'],
        message: 'say what the lane needs (shown in the planner)',
      });
    }
  });
export type Lane = z.infer<typeof LaneSchema>;

/** A class of ship: a dinghy, a merchant sloop, a galleon. */
export const VesselSchema = z
  .strictObject({
    id: slug('vessel'),
    name: nonEmptyText,
    description: nonEmptyText,
    /** Sea miles a month. */
    speed: z.number().int().min(1),
    hull: z.number().int().min(1),
    minCrew: z.number().int().min(1),
    maxCrew: z.number().int().min(1),
    /** Cargo space; supplies take it up (travel.json `provisions.perCargo`). */
    cargo: z.number().int().min(0),
    /** Berries; null when it cannot be bought (Marine-issued or captured). */
    cost: z.number().int().min(0).nullable(),
    /** A place must have this to sell it ("docks" for small boats, "shipyard" for the rest). */
    soldAt: z.enum(PLACE_FEATURES).default('shipyard'),
    tags,
  })
  .refine((v) => v.minCrew <= v.maxCrew, {
    message: 'minCrew must not be above maxCrew',
    path: ['maxCrew'],
  });
export type Vessel = z.infer<typeof VesselSchema>;

export const FACTION_KINDS = [
  'government',
  'marines',
  'pirates',
  'revolutionary',
  'kingdom',
  'underworld',
  'merchants',
  'crew',
] as const;
export type FactionKind = (typeof FACTION_KINDS)[number];

/** A faction (or a canon pirate crew, kind "crew"): an organization entity in the world. */
export const FactionSchema = z.strictObject({
  id: slug('org'),
  name: nonEmptyText,
  shortName: nonEmptyText,
  kind: z.enum(FACTION_KINDS),
  description: nonEmptyText,
  goal: nonEmptyText,
  /** 0 to 100 at the start of the world (Year 0). */
  strength: z.number().min(0).max(100),
  /** Change in strength per year ("low, rising"). */
  trend: z.number().default(0),
  /** The faction this one answers to (the Marines answer to the World Government). */
  parent: slug('org').optional(),
  /** A crew counts toward this faction's strength (every crew: the pirates). */
  umbrella: slug('org').optional(),
  /** Base opinion of other factions, -100 to 100. Events add modifiers (rule 3). */
  opinions: z.record(slug('org'), z.number().min(-100).max(100)).default({}),
  /** Kingdoms: a member of the World Government (or not). */
  wgMember: z.boolean().optional(),
  /** When it comes into being (a crew's founding). Absent: it exists from the start. */
  founded: WhenSchema.optional(),
  /** Active when it comes into being. A crew a canon beat founds starts inactive. */
  active: z.boolean().default(true),
  /** Crews: the captain, and who takes over if the captain falls, in order. */
  captain: slug('char').optional(),
  succession: z.array(slug('char')).default([]),
  /** Its base of operations. */
  home: slug('loc').optional(),
  /** A fixture for the tests: only exists in worlds made with the dev canon fixtures. */
  dev: z.boolean().default(false),
  tags,
});
export type Faction = z.infer<typeof FactionSchema>;

// ---- The event engine (Phase 3) ---------------------------------------------------------------

export const TRAVEL_MODES = ['own', 'crew', 'passenger', 'stowaway', 'marine', 'foot'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const EVENT_TRIGGERS = ['manual', 'random', 'voyage', 'world', 'arrival'] as const;
export const BEAT_STATUSES = ['pending', 'fired', 'diverged'] as const;

/**
 * When an event can happen. An event is a candidate only if every condition holds. Conditions
 * about the player are about where they are now: at sea, the voyage's lane and vessel.
 */
export const ConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hasTrait'), trait: slug('trait') }),
  z.strictObject({ kind: z.literal('notTrait'), trait: slug('trait') }),
  z.strictObject({ kind: z.literal('atLocation'), location: slug('loc') }),
  z.strictObject({ kind: z.literal('flag'), flag: z.string().min(1), equals: FlagValueSchema }),
  z.strictObject({ kind: z.literal('notFlag'), flag: flagName }),
  /** A number flag (on the player, or the world) at least this ("bounty" at least 1). */
  z.strictObject({ kind: z.literal('flagAtLeast'), flag: flagName, value: z.number() }),
  /** Sailing one of these lanes. */
  z.strictObject({ kind: z.literal('lane'), lanes: z.array(slug('lane')).min(1) }),
  /** At (or sailing through) one of these seas. */
  z.strictObject({ kind: z.literal('region'), regions: z.array(z.enum(REGIONS)).min(1) }),
  z.strictObject({ kind: z.literal('atSea'), value: z.boolean().default(true) }),
  z.strictObject({ kind: z.literal('travelMode'), modes: z.array(z.enum(TRAVEL_MODES)).min(1) }),
  /** Owns a ship (true), or does not (false). */
  z.strictObject({ kind: z.literal('ownShip'), value: z.boolean().default(true) }),
  /** Human-equivalent age. */
  z.strictObject({
    kind: z.literal('age'),
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    kind: z.literal('stat'),
    stat: z.union([statId, z.literal('combatPower')]),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({ kind: z.literal('canonMode'), modes: z.array(z.string().min(1)).min(1) }),
  z.strictObject({
    kind: z.literal('year'),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  /** The place has at least one of these. */
  z.strictObject({ kind: z.literal('feature'), features: z.array(z.enum(PLACE_FEATURES)).min(1) }),
  /** The danger of the place, or of the lane when at sea. */
  z.strictObject({
    kind: z.literal('danger'),
    min: z.number().int().min(0).optional(),
    max: z.number().int().max(5).optional(),
  }),
  z.strictObject({ kind: z.literal('berries'), min: z.number() }),
  z.strictObject({ kind: z.literal('relation'), relation: z.enum(LIVING_ROLES) }),
  z.strictObject({ kind: z.literal('noRelation'), relation: z.enum(LIVING_ROLES) }),
  /** The vessel's crew morale, 0 to 100 (at sea). */
  z.strictObject({
    kind: z.literal('morale'),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  /** Supplies aboard, in months for everyone aboard (at sea, own ship). */
  z.strictObject({ kind: z.literal('supplies'), max: z.number() }),
  z.strictObject({ kind: z.literal('climate'), climates: z.array(z.enum(CLIMATES)).min(1) }),
  z.strictObject({ kind: z.literal('season'), seasons: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ kind: z.literal('job'), jobs: z.array(slug('job')).min(1) }),
  z.strictObject({
    kind: z.literal('beat'),
    beat: slug('beat'),
    status: z.enum(BEAT_STATUSES),
  }),
  /** A canon character is at the same place (for a "canon" role). */
  z.strictObject({ kind: z.literal('canonHere') }),
  // Phase 4
  /** A power track is open, at least at this stage. */
  z.strictObject({
    kind: z.literal('track'),
    track: slug('track'),
    stage: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .optional(),
  }),
  z.strictObject({ kind: z.literal('notTrack'), track: slug('track') }),
  /** A Devil Fruit user (of this type), or not one. */
  z.strictObject({
    kind: z.literal('fruitUser'),
    value: z.boolean().default(true),
    type: z.enum(FRUIT_TYPES).optional(),
    zoan: z.enum(ZOAN_KINDS).optional(),
  }),
  /** Their fruit's mastery (0 to 100). */
  z.strictObject({
    kind: z.literal('mastery'),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  /** They ate a fruit and do not yet know what it does. */
  z.strictObject({ kind: z.literal('fruitUnknown') }),
  /** Their fruit hides a deeper truth they have not found yet. */
  z.strictObject({ kind: z.literal('fruitHasSecret') }),
  /** An uneaten Devil Fruit lies somewhere here, unnoticed. */
  z.strictObject({ kind: z.literal('wildFruitHere') }),
  /** A hidden personality counter (data/personality.json axes). */
  z.strictObject({
    kind: z.literal('personality'),
    axis: z.string().regex(/^[a-z]+$/),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  /** A behaviour counter at least this. */
  z.strictObject({
    kind: z.literal('counter'),
    counter: z.string().regex(/^[a-z_]+$/),
    min: z.number(),
  }),
  /** A haki colour awake (or not). */
  z.strictObject({
    kind: z.literal('haki'),
    haki: z.enum(['observation', 'armament', 'conqueror']),
    value: z.boolean().default(true),
  }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

const STRENGTH_SOURCE = nonEmptyText;

/** Effects on the world rather than a life: factions, territory, islands, the news. */
const worldEffectOptions = [
  /** A faction grows or weakens, or changes its mind about another (a modifier, rule 3). */
  z.strictObject({
    kind: z.literal('faction'),
    org: slug('org'),
    strength: z.number().optional(),
    opinion: z
      .strictObject({ toward: slug('org'), value: z.number().min(-100).max(100) })
      .optional(),
    /** How long the change lasts; absent means for good. */
    months: z.number().int().min(1).optional(),
    source: STRENGTH_SOURCE,
  }),
  /** Who holds a place changes (the event's place when `location` is absent). */
  z.strictObject({
    kind: z.literal('control'),
    org: slug('org').nullable(),
    location: slug('loc').optional(),
  }),
  /** A place does better or worse for a while (prosperity, which sets prices and wages). */
  z.strictObject({
    kind: z.literal('prosperity'),
    value: z.number(),
    months: z.number().int().min(1).optional(),
    location: slug('loc').optional(),
    source: STRENGTH_SOURCE,
  }),
  /** A place's people grow or shrink by this percentage (a raid, a famine, a boom). */
  z.strictObject({ kind: z.literal('population'), pct: z.number().min(-90).max(100) }),
  /** A flag on the place, for a while ("epidemic": true for 4 months). */
  z.strictObject({
    kind: z.literal('localFlag'),
    flag: flagName,
    value: FlagValueSchema,
    months: z.number().int().min(1).optional(),
  }),
  /** A headline of its own, beside the event's `news`. */
  z.strictObject({ kind: z.literal('news'), text: template }),
  /** The person cast in a role enters the player's life. */
  z.strictObject({
    kind: z.literal('meet'),
    role: z.string().regex(/^[a-z][a-z0-9_]*$/),
    as: z.enum(['mentor', 'friend', 'rival', 'sweetheart', 'protege', 'benefactor'] as const),
    opinion: z.number().min(-100).max(100),
  }),
] as const;

export const EffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('log'), text: template, tags }),
  z.strictObject({
    kind: z.literal('setFlag'),
    flag: flagName,
    value: FlagValueSchema,
  }),
  z.strictObject({
    kind: z.literal('schedule'),
    eventId: slug('evt'),
    /** Counted from the month the effect is applied. At least 1, so chains cannot loop in one tick. */
    afterMonths: z.number().int().min(1).max(1200),
  }),
  // Phase 2: an event or a choice can also change the player's life directly.
  ...lifeEffectOptions,
  // Phase 3: and the world.
  ...worldEffectOptions,
]);
export type Effect = z.infer<typeof EffectSchema>;

export const CheckBandSchema = z.strictObject({
  text: template,
  effects: z.array(EffectSchema).default([]),
});
export type CheckBand = z.infer<typeof CheckBandSchema>;

export const CheckSchema = z.strictObject({
  stat: z.enum(CHECK_STATS),
  /** The value that gives an even chance. Each 20 points above or below moves it by half. */
  difficulty: z.number().min(0),
  /** Added to the difficulty for each point of danger where it happens. */
  perDanger: z.number().default(0),
  criticalSuccess: CheckBandSchema.optional(),
  success: CheckBandSchema,
  failure: CheckBandSchema,
  criticalFailure: CheckBandSchema.optional(),
});
export type Check = z.infer<typeof CheckSchema>;

/** Who stands on the other side of an event's fight. */
export const FoeRefSchema = z.discriminatedUnion('kind', [
  /** Nameless foes from data/battle.json (a thug, a crew's gunners): `count` of them. */
  z.strictObject({
    kind: z.literal('foe'),
    foe: slug('foe'),
    count: z.number().int().min(1).max(100).default(1),
  }),
  /** Someone the event cast in a role. */
  z.strictObject({ kind: z.literal('role'), role: z.string().regex(/^[a-z][a-z0-9_]*$/) }),
  /** A canon character, wherever they are. */
  z.strictObject({ kind: z.literal('cast'), char: slug('char') }),
]);
export type FoeRef = z.infer<typeof FoeRefSchema>;

/** One front of a war: each side's strength (a number of fighters) and who commands it. */
export const FrontSpecSchema = z.strictObject({
  name: nonEmptyText,
  mine: z.strictObject({ strength: z.number().int().min(1), commander: slug('char').optional() }),
  theirs: z.strictObject({ strength: z.number().int().min(1), commander: slug('char').optional() }),
});
export type FrontSpec = z.infer<typeof FrontSpecSchema>;

/**
 * A fight in an event (Phase 5): who is on the other side, what each side means to do, how it is
 * played, and the result bands, as a check has (a decisive win, a win, a loss, a heavy loss, and
 * getting away).
 */
export const FightSpecSchema = z.strictObject({
  scale: z.enum(BATTLE_SCALES).default('duel'),
  foes: z.array(FoeRefSchema).min(1),
  /** The other side's intent (absent: each foe's own). */
  intent: z.enum(INTENTS).optional(),
  /** The player's side's intent. */
  mine: z.enum(INTENTS).default('spare'),
  /** Who fights beside the player: nobody, the ship's hands, friends at the same place. */
  allies: z.enum(['none', 'crew', 'friends']).default('none'),
  /** tactical: every exchange is chosen; quick: a stance; prefer: the player's setting. */
  mode: z.enum(['tactical', 'quick', 'prefer']).default('prefer'),
  stop: z.enum(STOP_RULES).optional(),
  /** Ship against ship: the enemy's vessel and hands (a boarding opens a crew battle). */
  ship: z.strictObject({ vessel: slug('vessel'), crew: z.number().int().min(1) }).optional(),
  /** War fronts (scale "war"). */
  fronts: z.array(FrontSpecSchema).default([]),
  /** Fought in or over the water (fruit users who fall do not get up without a rescuer). */
  water: z.boolean().default(false),
  /** The contest it is part of (data/battle.json `contests`): its rules apply. */
  contest: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  criticalSuccess: CheckBandSchema.optional(),
  success: CheckBandSchema,
  failure: CheckBandSchema,
  criticalFailure: CheckBandSchema.optional(),
  fled: CheckBandSchema.optional(),
});
export type FightSpec = z.infer<typeof FightSpecSchema>;

export const ChoiceSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9_]+$/, { message: 'choice ids use lowercase letters, digits and "_"' }),
    /** May name the event's roles: "Try to speak to {role.famous.name}". */
    label: template,
    text: z.string().optional(),
    /** Only offered when these hold (paying a toll needs the Berries). */
    requires: z.array(ConditionSchema).default([]),
    /** Applied whatever the result. */
    effects: z.array(EffectSchema).default([]),
    /** A skill check with four result bands, each with its own text and effects. */
    check: CheckSchema.optional(),
    /** Phase 5: a fight, played out by the battle engine, with result bands like a check's. */
    fight: FightSpecSchema.optional(),
  })
  .refine((c) => !(c.check && c.fight), {
    message: 'a choice has a check or a fight, not both',
    path: ['fight'],
  });
export type Choice = z.infer<typeof ChoiceSchema>;

/** Someone an event casts, named in its text as {role.<name>.name}. */
export const RoleSpecSchema = z.discriminatedUnion('kind', [
  /** A living person the player knows (the event cannot happen without one). */
  z.strictObject({ kind: z.literal('relation'), relation: z.enum(LIVING_ROLES) }),
  /** Someone met for the first time, from the place's people. */
  z.strictObject({
    kind: z.literal('stranger'),
    occupation: slug('occ').optional(),
    /** Their age relative to the player's, in human years. */
    ageOffset: intRange().default({ min: -10, max: 15 }),
  }),
  /** A canon character at the same place (the event needs one there). */
  z.strictObject({ kind: z.literal('canon') }),
  /** Whoever commands the vessel: the player on their own ship, otherwise its captain. */
  z.strictObject({ kind: z.literal('captain') }),
]);
export type RoleSpec = z.infer<typeof RoleSpecSchema>;

/** Where a world event happens: a place picked from those that match. */
export const WhereSchema = z.strictObject({
  regions: z.array(z.enum(REGIONS)).default([]),
  /** At least one of these. */
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  kinds: z.array(z.enum(NODE_KINDS)).default([]),
  /** Held by one of these factions (or by any member of their kind's tree). */
  controllers: z.array(slug('org')).default([]),
  /** Not held by these. */
  notControllers: z.array(slug('org')).default([]),
  minDanger: z.number().int().min(0).max(5).default(0),
  maxDanger: z.number().int().min(0).max(5).default(5),
  /** Only where there are people. */
  inhabited: z.boolean().default(true),
});
export type Where = z.infer<typeof WhereSchema>;

const ROLE_NAME = /^[a-z][a-z0-9_]*$/;

/** Every template in an event (text, news, choice results, log effects), for the role check. */
function eventTemplates(event: {
  text: string;
  news?: string | undefined;
  effects: readonly Effect[];
  choices: readonly Choice[];
}): { path: (string | number)[]; text: string }[] {
  const out: { path: (string | number)[]; text: string }[] = [{ path: ['text'], text: event.text }];
  if (event.news !== undefined) out.push({ path: ['news'], text: event.news });
  const fromEffects = (effects: readonly Effect[], path: (string | number)[]) =>
    effects.forEach((e, i) => {
      if (e.kind === 'log' || e.kind === 'news')
        out.push({ path: [...path, i, 'text'], text: e.text });
    });
  fromEffects(event.effects, ['effects']);
  event.choices.forEach((choice, i) => {
    out.push({ path: ['choices', i, 'label'], text: choice.label });
    fromEffects(choice.effects, ['choices', i, 'effects']);
    const check = choice.check;
    if (!check) return;
    for (const band of ['criticalSuccess', 'success', 'failure', 'criticalFailure'] as const) {
      const b = check[band];
      if (!b) continue;
      out.push({ path: ['choices', i, 'check', band, 'text'], text: b.text });
      fromEffects(b.effects, ['choices', i, 'check', band, 'effects']);
    }
  });
  return out;
}

export const EventSchema = z
  .strictObject({
    id: slug('evt'),
    type: z.enum(['personal', 'local', 'voyage', 'world', 'canon']),
    title: z.string().min(1),
    text: template,
    /**
     * When it is considered: "manual" (only when scheduled or forced), "random" (each month, for
     * the player ashore), "voyage" (each month at sea), "world" (each month, somewhere in the
     * world), "arrival" (when the player reaches a place).
     */
    trigger: z.enum(EVENT_TRIGGERS).default('manual'),
    conditions: z.array(ConditionSchema).default([]),
    /** Relative chance among the candidates of the month. */
    weight: z.number().min(0).default(1),
    /** Multiplies the weight when every condition in `when` holds. */
    weightMods: z
      .array(z.strictObject({ when: z.array(ConditionSchema).min(1), mult: z.number().min(0) }))
      .default([]),
    /** Minimum months between firings. */
    cooldown: z.number().int().min(0).default(0),
    /** Fires at most once per world. */
    once: z.boolean().default(false),
    /** People cast in the event: {role.<name>.name} in its text. */
    roles: z.record(z.string().regex(ROLE_NAME), RoleSpecSchema).default({}),
    /** World events: where in the world it can happen. */
    where: WhereSchema.optional(),
    /** "secret" events are true in the world but not known to anyone by default (rule 4). */
    visibility: z.enum(['public', 'secret']).default('public'),
    choices: z.array(ChoiceSchema).default([]),
    effects: z.array(EffectSchema).default([]),
    news: template.optional(),
    tags,
  })
  .superRefine((event, ctx) => {
    const seen = new Set<string>();
    event.choices.forEach((choice, i) => {
      if (seen.has(choice.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['choices', i, 'id'],
          message: `duplicate choice id "${choice.id}"`,
        });
      }
      seen.add(choice.id);
    });
    if (event.choices.length > 0 && event.choices.every((c) => c.requires.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'at least one choice must have no requirements, so there is always a way out',
      });
    }
    if (event.visibility === 'secret' && event.news !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['news'],
        message: 'a secret event cannot produce news (news is public by definition)',
      });
    }
    for (const { path, text } of eventTemplates(event)) {
      for (const name of templateVarsUsed(text)) {
        const role = roleOfVar(name);
        if (role !== null && !(role in event.roles)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `{${name}} names the role "${role}", which the event does not declare in "roles"`,
          });
        }
      }
    }
    const allEffects = [
      ...event.effects,
      ...event.choices.flatMap((c) => [
        ...c.effects,
        ...(c.check
          ? [c.check.success, c.check.failure, c.check.criticalSuccess, c.check.criticalFailure]
              .filter((b) => b !== undefined)
              .flatMap((b) => b.effects)
          : []),
      ]),
    ];
    for (const effect of allEffects) {
      if (effect.kind === 'meet' && !(effect.role in event.roles)) {
        ctx.addIssue({
          code: 'custom',
          path: ['roles'],
          message: `a "meet" effect names the role "${effect.role}", which is not declared`,
        });
      }
    }
    if (event.trigger === 'world' && !event.where) {
      ctx.addIssue({
        code: 'custom',
        path: ['where'],
        message: 'a world event needs "where": the kind of place it can happen',
      });
    }
    if (event.trigger === 'world' && Object.keys(event.roles).length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['roles'],
        message: 'world events happen far from the player and cannot cast roles',
      });
    }
  });
export type EventDef = z.infer<typeof EventSchema>;

// ---- The canon layer (Phase 3) ----------------------------------------------------------------

export const HAKI = ['observation', 'armament', 'conqueror'] as const;

/** Where a canon character is, and as what, over a range of months. */
export const KeyframeSchema = z.strictObject({
  from: WhenSchema,
  /** Inclusive. Absent: until the next keyframe (or for good). */
  to: WhenSchema.optional(),
  place: slug('loc'),
  affiliation: slug('org').optional(),
  title: nonEmptyText.optional(),
  bounty: z.number().int().min(0).optional(),
  haki: z.array(z.enum(HAKI)).optional(),
  /** The Devil Fruit they hold (a name for now; fruits arrive in Phase 4). */
  fruit: nonEmptyText.optional(),
  status: z.enum(['active', 'imprisoned', 'retired', 'hidden']).default('active'),
  /** The source is vague about this one. */
  approx: z.boolean().default(false),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/** A canon character: spawned on their birth month, then follows keyframes until they diverge. */
export const CastSchema = z
  .strictObject({
    id: slug('char'),
    name: nonEmptyText,
    givenName: nonEmptyText,
    familyName: z.string().default(''),
    /** "Whitebeard": used as their title in text. */
    epithet: nonEmptyText.optional(),
    pronouns: z.enum(PRONOUNS),
    race: slug('race'),
    born: WhenSchema,
    /** The birth date is a guess. */
    approx: z.boolean().default(false),
    birthplace: slug('loc'),
    description: nonEmptyText,
    /** Their stats (missing ones take canon.json's default). Design values, not canon facts. */
    stats: statNumbers,
    keyframes: z.array(KeyframeSchema).min(1),
    /** People whose story is bound to theirs: tagged canon-diverged if this one dies early. */
    ties: z.array(slug('char')).default([]),
    /** Phase 4: traits beyond their race's (hidden ones too: King's Qualities, the Will of D.). */
    traits: z.array(slug('trait')).default([]),
    /**
     * Phase 5: Combat Power by era, as a rung of the ladder (and, if known, a number). Their powers
     * are calibrated to land there, so someone young in 1496 SC is weaker than in 1524 SC.
     */
    power: z
      .array(
        z.strictObject({
          from: WhenSchema,
          tier: z.enum(LADDER_TIERS),
          cp: z.number().int().min(0).optional(),
        }),
      )
      .default([]),
    dev: z.boolean().default(false),
    tags,
  })
  .superRefine((cast, ctx) => {
    let previous = -Infinity;
    cast.keyframes.forEach((k, i) => {
      const from = tickOfWhen(k.from);
      if (from < previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['keyframes', i, 'from'],
          message: 'keyframes must be in date order',
        });
      }
      if (k.to && tickOfWhen(k.to) < from) {
        ctx.addIssue({
          code: 'custom',
          path: ['keyframes', i, 'to'],
          message: '"to" is before "from"',
        });
      }
      previous = from;
    });
    if (cast.keyframes[0] && tickOfWhen(cast.keyframes[0].from) < tickOfWhen(cast.born)) {
      ctx.addIssue({
        code: 'custom',
        path: ['keyframes', 0, 'from'],
        message: 'the first keyframe is before the character is born',
      });
    }
  });
export type CastMember = z.infer<typeof CastSchema>;

export const ANCHORS = ['hard', 'soft', 'seed'] as const;
export type Anchor = (typeof ANCHORS)[number];

const roleKey = z.string().regex(ROLE_NAME);

/** What a beat does to the world when it happens (or, in `onDiverge`, when it does not). */
export const BeatEffectSchema = z.discriminatedUnion('kind', [
  /** The role-holder dies: a canon death, not a divergence. */
  z.strictObject({ kind: z.literal('death'), role: roleKey, cause: nonEmptyText }),
  z.strictObject({ kind: z.literal('imprison'), role: roleKey, place: slug('loc') }),
  z.strictObject({ kind: z.literal('move'), role: roleKey, place: slug('loc') }),
  z.strictObject({ kind: z.literal('affiliation'), role: roleKey, org: slug('org') }),
  z.strictObject({ kind: z.literal('bounty'), role: roleKey, value: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal('control'), place: slug('loc'), org: slug('org').nullable() }),
  z.strictObject({
    kind: z.literal('faction'),
    org: slug('org'),
    strength: z.number().optional(),
    opinion: z
      .strictObject({ toward: slug('org'), value: z.number().min(-100).max(100) })
      .optional(),
    months: z.number().int().min(1).optional(),
    source: nonEmptyText,
  }),
  /** A crew is founded (active) or breaks up. */
  z.strictObject({ kind: z.literal('crew'), org: slug('org'), active: z.boolean() }),
  z.strictObject({ kind: z.literal('flag'), flag: flagName, value: FlagValueSchema }),
  z.strictObject({
    kind: z.literal('prosperity'),
    place: slug('loc'),
    value: z.number(),
    months: z.number().int().min(1).optional(),
    source: nonEmptyText,
  }),
]);
export type BeatEffect = z.infer<typeof BeatEffectSchema>;

export const BeatChoiceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: nonEmptyText,
  text: template.optional(),
  /** What it does to the player's life. */
  effects: z.array(EffectSchema).default([]),
  /** This choice stops the beat: it diverges, caused by the player. */
  diverge: z.boolean().default(false),
  /** Only offered to an instigator (who meets the beat's `instigate` bar). */
  instigator: z.boolean().default(false),
  /**
   * Phase 5: the choice is a fight (a war at Marineford). With `diverge`, the beat diverges only
   * if the player's side wins it.
   */
  fight: FightSpecSchema.optional(),
});
export type BeatChoice = z.infer<typeof BeatChoiceSchema>;

/** A canon beat: something the story says happens, which the canon mode pushes toward. */
export const BeatSchema = z
  .strictObject({
    id: slug('beat'),
    name: nonEmptyText,
    /** What happened, written for the chronicle and the timeline. */
    text: template,
    news: template.optional(),
    /** Written when it does not happen. */
    divergeText: template.optional(),
    divergeNews: template.optional(),
    window: z.strictObject({ from: WhenSchema, to: WhenSchema }),
    /** hard: fixed points of the story; soft: likely; seed: small things that may or may not be. */
    anchor: z.enum(ANCHORS),
    /** The chance it happens at all across its window by ordinary chance (Random mode). */
    chance: z.number().min(0).max(1).optional(),
    place: slug('loc'),
    roles: z
      .record(
        roleKey,
        z.strictObject({
          char: slug('char'),
          /** Who can take their place if they are dead, in order. */
          substitutes: z.array(slug('char')).default([]),
          /** Must be at the place (true), or can be anywhere (false). */
          present: z.boolean().default(true),
        }),
      )
      .default({}),
    /** Beats that must have happened first. If one diverged, so does this one. */
    requires: z.array(slug('beat')).default([]),
    outcomes: z.array(BeatEffectSchema).default([]),
    onDiverge: z.array(BeatEffectSchema).default([]),
    /** Beats that depend on this one (documentation; checked to name this one in "requires"). */
    dependents: z.array(slug('beat')).default([]),
    /** The player present can take part (gets the non-instigator choices) from this Combat Power. */
    participate: z.strictObject({ combatPower: z.number().min(0) }).optional(),
    /** And can start, stop or hijack it from this Combat Power. */
    instigate: z.strictObject({ combatPower: z.number().min(0) }).optional(),
    choices: z.array(BeatChoiceSchema).default([]),
    dev: z.boolean().default(false),
    tags,
  })
  .superRefine((beat, ctx) => {
    if (tickOfWhen(beat.window.to) < tickOfWhen(beat.window.from)) {
      ctx.addIssue({
        code: 'custom',
        path: ['window', 'to'],
        message: 'the window ends before it starts',
      });
    }
    const roles = Object.keys(beat.roles);
    const check = (effects: readonly BeatEffect[], key: string) =>
      effects.forEach((e, i) => {
        if ('role' in e && !roles.includes(e.role)) {
          ctx.addIssue({
            code: 'custom',
            path: [key, i, 'role'],
            message: `unknown role "${e.role}" (roles: ${roles.join(', ') || 'none'})`,
          });
        }
      });
    check(beat.outcomes, 'outcomes');
    check(beat.onDiverge, 'onDiverge');
    const texts: { path: (string | number)[]; text: string }[] = [
      { path: ['text'], text: beat.text },
    ];
    for (const key of ['news', 'divergeText', 'divergeNews'] as const) {
      const t = beat[key];
      if (t !== undefined) texts.push({ path: [key], text: t });
    }
    beat.choices.forEach((c, i) => {
      if (c.text !== undefined) texts.push({ path: ['choices', i, 'text'], text: c.text });
    });
    for (const { path, text } of texts) {
      for (const name of templateVarsUsed(text)) {
        const role = roleOfVar(name);
        if (role !== null && !roles.includes(role)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `{${name}} names the role "${role}", which the beat does not declare`,
          });
        }
      }
    }
    if (beat.choices.length > 0 && !beat.participate) {
      ctx.addIssue({
        code: 'custom',
        path: ['participate'],
        message: 'a beat with choices needs "participate": who may take part',
      });
    }
    if (beat.choices.length > 0 && beat.choices.every((c) => c.instigator)) {
      ctx.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'at least one choice must be open to every participant',
      });
    }
    if (beat.choices.some((c) => c.instigator) && !beat.instigate) {
      ctx.addIssue({
        code: 'custom',
        path: ['instigate'],
        message: 'instigator choices need "instigate": who counts as an instigator',
      });
    }
  });
export type Beat = z.infer<typeof BeatSchema>;

// ---- travel.json ------------------------------------------------------------------------------

export const CAPTAIN_ORDERS = ['hold', 'push', 'resupply', 'detour', 'turn_back'] as const;
export type CaptainOrder = (typeof CAPTAIN_ORDERS)[number];

const orderText = z.strictObject({ name: nonEmptyText, description: nonEmptyText });

export const TravelRulesSchema = z.strictObject({
  provisions: z.strictObject({
    /** Berries for one person's supplies for a month. */
    costPerMonth: z.number().int().min(0),
    /** Person-months of supplies one point of cargo holds. */
    perCargo: z.number().min(0),
  }),
  /** Berries a captain pays to dock, by the port's wealth. */
  portFee: z.strictObject({ low: z.number(), medium: z.number(), high: z.number() }),
  /** A passenger's fare per month at sea. */
  fare: z.number().int().min(0),
  /** A hired hand's wages per month, and what signing one on costs. */
  crewWage: z.number().int().min(0),
  hireCost: z.number().int().min(0),
  repair: z.strictObject({
    /** Berries per hull point at a shipyard. */
    perHull: z.number().min(0),
    /** Docks without a shipyard charge this much more (and only patch half the damage). */
    docksMult: z.number().min(1),
  }),
  /** A ship's resin coating for the dive to Fish-Man Island. */
  coating: z.strictObject({ cost: z.number().int().min(0), at: z.array(slug('loc')).min(1) }),
  logPose: z.strictObject({ cost: z.number().int().min(0), at: z.array(slug('loc')).min(1) }),
  eternalPose: z.strictObject({ cost: z.number().int().min(0) }),
  /** Speed multiplier by the lane's current. */
  currents: z.strictObject({
    calm: z.number().min(0),
    gentle: z.number().min(0),
    steady: z.number().min(0),
    strong: z.number().min(0),
    wild: z.number().min(0),
    none: z.number().min(0),
  }),
  /** Speed multiplier by season (the wind). */
  wind: multipliers,
  /** A navigator's bonus: 1 + (stat - from) x per, at most +max. */
  navigator: z.strictObject({
    stat: statId,
    from: z.number(),
    per: z.number().min(0),
    max: z.number().min(0),
    /** An NPC captain's navigator. */
    npc: z.number().min(0),
  }),
  /** Which class of ship carries a traveller who does not captain their own. */
  carriers: z.strictObject({
    crew: slug('vessel'),
    passenger: slug('vessel'),
    stowaway: slug('vessel'),
    marine: slug('vessel'),
  }),
  /** On foot: miles a month. */
  walkSpeed: z.number().int().min(1),
  orders: z.strictObject({
    hold: orderText,
    push: orderText.extend({ speed: z.number().min(1), hull: z.number().int().min(0) }),
    resupply: orderText.extend({ progress: z.number().min(0).max(1), supplies: range(0) }),
    detour: orderText,
    turn_back: orderText,
  }),
  modes: z
    .array(
      z.strictObject({
        id: z.enum(TRAVEL_MODES),
        name: nonEmptyText,
        description: nonEmptyText,
        /** Who sets the route, and the main risk (the planner's table). */
        route: nonEmptyText,
        risk: nonEmptyText,
      }),
    )
    .length(TRAVEL_MODES.length),
  /** Extra voyage events a month by the sea crossed: 0.5 is a 50% chance of a second roll. */
  regionDanger: z.partialRecord(z.enum(REGIONS), z.number().min(0)),
  /** Base voyage-event rolls a month. */
  baseEvents: z.number().int().min(0),
  /** Weight of "a quiet month" against the voyage events, per roll. */
  quietWeight: z.number().min(0),
  /** Hazard and encounter events are this much likelier per point of lane danger. */
  dangerWeight: z.number().min(0),
  stowaway: z.strictObject({ discovery: z.number().min(0).max(1), eventId: slug('evt') }),
  /** Crew-member mode: chance a month that the captain changes course. */
  divertChance: z.number().min(0).max(1),
  morale: z.strictObject({
    start: z.number().min(0).max(100),
    /** Morale lost a month when wages go unpaid, and when supplies run out. */
    unpaid: z.number().min(0),
    hungry: z.number().min(0),
    /** Morale drifts toward this a month at sea. */
    rest: z.number().min(0).max(100),
    drift: z.number().min(0),
    /** Below this a mutiny becomes possible (the mutiny event's weight rises). */
    mutinyBelow: z.number().min(0).max(100),
  }),
  /** Share of Max Health lost a month with no supplies. */
  starvation: z.number().min(0).max(1),
  /** Months at sea before scurvy can set in, and its chance a month after that. */
  scurvy: z.strictObject({
    afterMonths: z.number().int().min(0),
    chance: z.number().min(0).max(1),
  }),
  seasickness: z.strictObject({ chance: z.number().min(0).max(1), trait: slug('trait') }),
  wreck: z.strictObject({ crewLost: z.number().min(0).max(1) }),
  overboard: z.strictObject({ stat: statId, difficulty: z.number() }),
  /** The life loop's place while at sea. */
  atSea: z.strictObject({
    features: z.array(z.enum(PLACE_FEATURES)),
    /** Train Body works at this efficiency at sea. */
    trainBody: z.number().min(0).max(1),
    wealth: z.enum(WEALTH_LEVELS),
  }),
  /** Safety of living somewhere, by its danger 0 to 5. */
  safetyByDanger: z.array(z.enum(SAFETY_LEVELS)).length(6),
  shipNames: z.array(nonEmptyText).min(1),
  lines: z.strictObject({
    departed: lifeTemplate,
    arrived: lifeTemplate,
    missedNews: lifeTemplate,
    witnessedAtSea: lifeTemplate,
    progress: lifeTemplate,
    order: lifeTemplate,
    wrecked: lifeTemplate,
    castaway: lifeTemplate,
    starving: lifeTemplate,
    unpaid: lifeTemplate,
    diverted: lifeTemplate,
    redirected: lifeTemplate,
    turnedBack: lifeTemplate,
    resupplied: lifeTemplate,
    jobLeft: lifeTemplate,
    bought: lifeTemplate,
    hired: lifeTemplate,
    provisioned: lifeTemplate,
    repaired: lifeTemplate,
    coated: lifeTemplate,
    pose: lifeTemplate,
    portFee: lifeTemplate,
    fare: lifeTemplate,
    rescued: lifeTemplate,
    drowned: lifeTemplate,
  }),
});
export type TravelRules = z.infer<typeof TravelRulesSchema>;

// ---- world.json -------------------------------------------------------------------------------

export const NPC_ACTIONS = [
  'work',
  'train',
  'voyage',
  'piracy',
  'enlist',
  'settle',
  'scheme',
  'rest',
] as const;
export type NpcAction = (typeof NPC_ACTIONS)[number];

const byTier = z.strictObject({
  none: z.number().int().min(0),
  hamlet: z.number().int().min(0),
  village: z.number().int().min(0),
  town: z.number().int().min(0),
  city: z.number().int().min(0),
  capital: z.number().int().min(0),
});

export const WorldRulesSchema = z.strictObject({
  population: z.strictObject({
    /** Named (Tier 2) people per place, by its population tier. */
    named: byTier,
    /** Everyone else (Tier 3), kept as numbers. */
    residents: byTier,
    /** Shares of children, adults and elders among residents. */
    ages: z.strictObject({ children: z.number(), adults: z.number(), elders: z.number() }),
    /** Yearly births and deaths among residents, as fractions. */
    birthRate: z.number().min(0).max(1),
    deathRate: z.number().min(0).max(1),
    /** Named people are adults of these human ages when the world is populated. */
    namedAges: intRange(0),
    /** Chance a year that a named couple has a child, while young enough. */
    childChance: z.number().min(0).max(1),
    /** Named people of a place grow past this multiple of its share only as residents. */
    namedCap: z.number().min(1),
  }),
  npc: z.strictObject({
    goals: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z]+$/),
          name: nonEmptyText,
          weight: z.number().min(0),
          /** Occupation id -> multiplier on choosing this goal. */
          occupations: multipliers,
        }),
      )
      .min(1),
    actions: z
      .array(
        z.strictObject({
          id: z.enum(NPC_ACTIONS),
          name: nonEmptyText,
          /** Goal id -> how well this action serves it. */
          utility: z.record(z.string(), z.number()),
          /** Human ages it is open to. */
          ages: intRange(0),
        }),
      )
      .min(1),
    /** Random spread added to every utility. */
    noise: z.number().min(0),
    /** Below this many Berries, work counts double. */
    poorBelow: z.number().min(0),
    /** Combat Power at which piracy and enlisting become open. */
    fighterPower: z.number().min(0),
    /** Generated pirate crews: names, and the bounty a member's deeds add. */
    crewNames: z.array(nonEmptyText).min(1),
    bounty: intRange(0),
  }),
  factions: z.strictObject({
    /** Each active crew (or kingdom) adds this to its umbrella's strength... */
    crewStrength: z.number().min(0),
    /** ...plus this share of its own strength, the total at most `umbrellaCap`. */
    umbrellaShare: z.number().min(0),
    umbrellaCap: z.number().min(0),
    /** Each place held adds this. */
    territoryStrength: z.number().min(0),
    /** Chance a month that two hostile factions clash (a world event decides where). */
    hostileBelow: z.number().min(-100).max(100),
  }),
  economy: z.strictObject({
    /** Prosperity (0 to 100) a place settles toward, by its wealth. */
    prosperity: z.strictObject({ low: z.number(), medium: z.number(), high: z.number() }),
    /** Living costs and wages: 1 + (prosperity - 50) x this. */
    priceSlope: z.number().min(0),
  }),
  news: z.strictObject({
    /** Months news takes to reach someone: same place, same sea, a neighbouring sea, farther. */
    delay: z.strictObject({
      place: z.number().int().min(0),
      region: z.number().int().min(0),
      near: z.number().int().min(0),
      far: z.number().int().min(0),
    }),
  }),
  events: z.strictObject({
    /** Weights for 0, 1, 2 and 3 random events a month for the player ashore. */
    playerPerMonth: z.array(z.number().min(0)).length(4),
    /** Weights for 0 to 3 world events a month. */
    worldPerMonth: z.array(z.number().min(0)).length(4),
  }),
  /** By climate: a name, and illness id -> chance multiplier. */
  climates: z.record(
    z.enum(CLIMATES),
    z.strictObject({ name: nonEmptyText, illness: multipliers }),
  ),
});
export type WorldRules = z.infer<typeof WorldRulesSchema>;

// ---- canon.json -------------------------------------------------------------------------------

const modeRule = z.strictObject({
  /** Fires on its date when its roles are alive and present. */
  certain: z.boolean().default(false),
  /** Multiplies its chance a month. */
  mult: z.number().min(0).default(1),
});

export const CanonRulesSchema = z.strictObject({
  /** Canon mode id (creation.json) -> how each anchor strength is pushed. */
  modes: z.record(
    z.string(),
    z.strictObject({
      hard: modeRule,
      soft: modeRule,
      seed: modeRule,
      /** Canon characters only die in beats (or by the player's hand), not of ordinary causes. */
      protectCast: z.boolean(),
    }),
  ),
  /** The chance each anchor strength happens across its window by ordinary chance. */
  chance: z.strictObject({ hard: z.number(), soft: z.number(), seed: z.number() }),
  /** A role-holder who is elsewhere may delay a beat this long before it is cancelled. */
  delayMonths: z.number().int().min(0),
  /** How fast a role-holder travels to a beat (miles a month). */
  travelSpeed: z.number().min(1),
  /** The last arc the game knows. After it, the world runs on random events. */
  cutoff: z.strictObject({ year: z.number().int(), month: monthIndex, label: nonEmptyText }),
  /** Stats a canon character has unless their file says otherwise. */
  defaultStats: statNumbers,
  lines: z.strictObject({
    witnessed: canonTemplate,
    witnessedFar: canonTemplate,
    participant: canonTemplate,
    diverged: canonTemplate,
    missed: canonTemplate,
    substituted: canonTemplate,
    delayed: canonTemplate,
    roleDead: canonTemplate,
    roleAway: canonTemplate,
    requirement: canonTemplate,
    earlyDeath: canonTemplate,
    earlyDeathNews: canonTemplate,
    fruitReturns: canonTemplate,
    successor: canonTemplate,
    crewEnds: canonTemplate,
    playerDiverged: canonTemplate,
  }),
});
export type CanonRules = z.infer<typeof CanonRulesSchema>;

// ---------------------------------------------------------------------------------------------
// Phase 4 (Muscle): power tracks, haki, fighting styles, techniques, movesets, Devil Fruits, and
// the rules for personality drift and earned traits. Every number is a design value to tune.
// ---------------------------------------------------------------------------------------------

const stageId = z.string().regex(/^[a-z0-9_]+$/);

/** What it takes to enter a stage, beyond the progress. */
export const StageRequiresSchema = z.strictObject({
  stats: statNumbers,
  /** Other tracks at least at these stages (two swords need one sword at Trained). */
  tracks: z.record(slug('track'), stageId).default({}),
  /** A living mentor who teaches this track, or a teaching place (the track's `learn`). */
  teacher: z.boolean().default(false),
  /** Being at one of these places. */
  places: z.array(slug('loc')).default([]),
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  flags: z.record(flagName, FlagValueSchema).default({}),
  anyTraits: z.array(slug('trait')).default([]),
  notTraits: z.array(slug('trait')).default([]),
  races: z.array(slug('race')).default([]),
  /** Something must have happened since the last stage ("a fight against someone clearly stronger"). */
  event: z.enum(POWER_EVENTS).optional(),
  /** A plateau: only a breakthrough opens this stage (the Phase 2 rule). */
  breakthrough: z.boolean().default(false),
  /** The condition is never shown: the stage appears as "???" until reached. */
  hidden: z.boolean().default(false),
  /** Gear in hand: swords (count), a gun, a bow (Phase 6 makes these real items). */
  gear: z.partialRecord(z.enum(['swords', 'gun', 'bow']), z.number().int().min(1)).default({}),
});
export type StageRequires = z.infer<typeof StageRequiresSchema>;

export const StageSchema4 = z.strictObject({
  id: stageId,
  name: nonEmptyText,
  level: z.enum(POWER_LEVELS),
  /** Cumulative progress (practice points, or fruit mastery 0 to 100) at which it is reached. */
  at: z.number().min(0),
  description: nonEmptyText,
  requires: StageRequiresSchema.default(() => StageRequiresSchema.parse({})),
  /** Techniques this stage teaches (data/techniques). */
  techniques: z.array(slug('tech')).default([]),
  /** Added to Combat Power while held (rule 3: a modifier with the stage as its source). */
  combat: z.number().min(0).default(0),
  statMods: z.array(StatModDefSchema).default([]),
  flags: z.record(flagName, FlagValueSchema).default({}),
  /** Written into the chronicle on reaching it (second person, past tense). */
  text: lifeTemplate,
});
export type TrackStage = z.infer<typeof StageSchema4>;

/** Who teaches a track, and where. */
export const TeacherSchema = z.strictObject({
  /** "a Cipher Pol instructor" */
  name: nonEmptyText,
  /** At one of these places, or anywhere with one of these features (an empty list: no limit). */
  places: z.array(slug('loc')).default([]),
  features: z.array(z.enum(PLACE_FEATURES)).default([]),
  regions: z.array(z.enum(REGIONS)).default([]),
  /** Berries to be taken on. */
  fee: z.number().int().min(0).default(0),
  /** The teacher multiplier their lessons give (Rayleigh-tier mentors: 1.5). */
  mult: z.number().min(1).max(2).default(1.2),
  requires: RequiresSchema.default(noRequirements),
  /** The occupation the teacher has, when they become a mentor. */
  occupation: slug('occ').optional(),
});
export type Teacher = z.infer<typeof TeacherSchema>;

export const TrackSchema = z
  .strictObject({
    id: slug('track'),
    name: nonEmptyText,
    family: z.enum(TRACK_FAMILIES),
    description: nonEmptyText,
    /** Fruit tracks: which type of fruit they belong to. */
    fruitType: z.enum(FRUIT_TYPES).optional(),
    /** "points": practice points; "mastery": fruit mastery 0 to 100, grown by the training formula. */
    mode: z.enum(['points', 'mastery']).default('points'),
    stages: z.array(StageSchema4).min(2),
    learn: z.strictObject({
      /**
       * teacher: taken on by a teacher at their place; wake: haki wakes by itself; fruit: eating a
       * fruit of `fruitType` opens it; innate: open from birth to those who meet `requires`;
       * event: only an event opens it (an invitation, a scroll).
       */
      how: z.enum(['teacher', 'wake', 'fruit', 'innate', 'event']),
      teachers: z.array(TeacherSchema).default([]),
      /** Who may learn it at all. */
      requires: RequiresSchema.default(noRequirements),
      /** Learning speed by race (Fish-Men learn Karate at 1, outsiders at 0.5). */
      raceRates: z.record(slug('race'), z.number().min(0).max(3)).default({}),
      defaultRate: z.number().min(0).max(3).default(1),
      /** An outsider (rate below 1) may only begin after this flag (a trust event). */
      outsiderFlag: flagName.optional(),
      /** Learning opens these other tracks too (Rokushiki opens the six). */
      opens: z.array(slug('track')).default([]),
    }),
    /** Stats that speed practice: Intellect for Paramecia insight, Endurance for Zoan control. */
    speedStats: z.partialRecord(statId, z.number().min(0).max(2)).default({}),
    rust: z
      .strictObject({ afterMonths: z.number().int().min(1), perYear: z.number().min(0).max(1) })
      .optional(),
    /** How far some can go: a race, or anyone without these traits, stops at a stage. */
    ceilings: z
      .array(
        z.strictObject({
          races: z.array(slug('race')).default([]),
          traits: z.array(slug('trait')).default([]),
          stage: stageId,
          reason: nonEmptyText,
        }),
      )
      .default([]),
    /** The track is not shown to the player until it opens (Conqueror's Haki). */
    hidden: z.boolean().default(false),
    /** A group of tracks counted together ("six_powers": master four for elite ranks). */
    group: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
    /** The word generated techniques of this track are named with ("Karate", "Kick"). */
    word: z.string().optional(),
    tags,
  })
  .superRefine((track, ctx) => {
    const ids = new Set<string>();
    let last = -1;
    track.stages.forEach((stage, i) => {
      if (ids.has(stage.id))
        ctx.addIssue({
          code: 'custom',
          path: ['stages', i, 'id'],
          message: `duplicate stage "${stage.id}"`,
        });
      ids.add(stage.id);
      if (stage.at < last)
        ctx.addIssue({
          code: 'custom',
          path: ['stages', i, 'at'],
          message: 'stages must not go backwards',
        });
      last = stage.at;
    });
    if (track.stages[0] && track.stages[0].at !== 0)
      ctx.addIssue({
        code: 'custom',
        path: ['stages', 0, 'at'],
        message: 'the first stage starts at 0',
      });
    if (track.family === 'fruit' && (!track.fruitType || track.mode !== 'mastery'))
      ctx.addIssue({
        code: 'custom',
        path: ['fruitType'],
        message: 'a fruit track names its type and uses mastery',
      });
    if (track.learn.how === 'teacher' && track.learn.teachers.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['learn', 'teachers'],
        message: 'a taught track needs a teacher',
      });
    for (const ceiling of track.ceilings) {
      if (!ids.has(ceiling.stage))
        ctx.addIssue({
          code: 'custom',
          path: ['ceilings'],
          message: `no stage "${ceiling.stage}"`,
        });
    }
  });
export type Track = z.infer<typeof TrackSchema>;

/** Techniques that are not a fruit's: styles, swords, weapons, haki, brawling, signature moves. */
export const TechniqueSchema = TechniqueDefSchema;
export type Technique = TechniqueDef;

/** A canon fighter's moveset by era: someone met in 1516 SC does not yet know their 1524 SC moves. */
export const MovesetSchema = z.strictObject({
  id: slug('moveset'),
  char: slug('char'),
  eras: z
    .array(
      z.strictObject({
        from: WhenSchema,
        /** Inclusive; absent: for good. */
        to: WhenSchema.optional(),
        techniques: z.array(slug('tech')).min(1),
        signature: slug('tech').optional(),
        finisher: slug('tech').optional(),
        /** Power tracks and the stage reached in this era (haki, styles, swords). */
        tracks: z.record(slug('track'), stageId).default({}),
        /** Fruit mastery in this era (the fruit itself comes from data/fruits holders). */
        mastery: z.number().min(0).max(100).optional(),
        approx: z.boolean().default(false),
      }),
    )
    .min(1),
});
export type Moveset = z.infer<typeof MovesetSchema>;

const priceRow = z.strictObject({
  power: z.number().min(0),
  accuracy: z.number().min(0).max(100),
  cost: z.number().min(0),
  range: z.enum(TECH_RANGES),
});

/** A power primitive: the vocabulary canon fruits are described with (grow, coat, spring...). */
const primitiveWord = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: nonEmptyText,
  tags: z.array(z.enum(TECH_TAGS)).min(1),
});

/** A power concept for a generated fruit: "Chime" (a power), "Salt" (an element). */
const primitive = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** The doubled word of the name: "Chime" makes the Chime-Chime Fruit. */
  word: nonEmptyText,
  type: z.enum(FRUIT_TYPES),
  /** A sentence fragment: "rings like a bell, and makes others ring". */
  gist: nonEmptyText,
  tags: z.array(z.enum(TECH_TAGS)).min(1),
  forms: z.array(z.enum(TECH_FORMS)).min(1),
  weakness: z.enum(WEAKNESS_KINDS).optional(),
  effects: z.array(z.enum(TECH_EFFECTS)).default([]),
});

/** The lines the powers' code writes; data/powers.json must give every one. */
export const POWER_LINE_IDS = [
  'takenOn',
  'beganAlone',
  'breakthrough',
  'hakiWakes',
  'conquerorWakes',
  'conquerorSurge',
  'fruitReborn',
  'fruitDiverged',
  'secondFruit',
  'smileDud',
  'ateKnown',
  'ateUnknown',
  'identified',
  'discovered',
  'discovering',
  'sankAlone',
  'sankRescued',
  'bought',
  'foundFruit',
  'rumour',
  'searchFound',
  'searchMarket',
  'searchNothing',
  'invented',
  'inventFailed',
  'mishap',
  'secret',
  'rokuogan',
] as const;

/** Track ids the engine names (haki colours); data/tracks must define them. */
export const ENGINE_TRACKS = ['track_observation', 'track_armament', 'track_conqueror'] as const;

/** data/powers.json: how powers grow, are found, priced and named. */
export const PowerRulesSchema = z.strictObject({
  levels: z.array(z.strictObject({ id: z.enum(POWER_LEVELS), name: nonEmptyText })).length(6),
  /** Practice points by kind of practice (x1 drills, x1.5 sparring, x3 real fights, x0.5 teaching). */
  practice: z.strictObject({
    drill: z.number(),
    spar: z.number(),
    fight: z.number(),
    teach: z.number(),
  }),
  /** Points a breakthrough gives on top of opening a plateau. */
  breakthroughPoints: z.number().min(0),
  rust: z.strictObject({ afterMonths: z.number().int().min(1), perYear: z.number().min(0).max(1) }),
  /** The highest level each hidden talent tier can reach without a hidden condition. */
  talentCeilings: z.record(z.string(), z.enum(POWER_LEVELS)),
  /** A stage's mods on Combat Power go to this stat (rule 3: Combat Power's bonus stack). */
  combatBonusStat: z.string().regex(/^[a-zA-Z]+$/),
  haki: z.strictObject({
    /** Months of Train Spirit seeds before a seed can wake, and the chance each month after. */
    seedMonths: z.number().int().min(1),
    seedChance: z.number().min(0).max(1),
    /** Chance a trigger wakes a colour that is not awake yet. */
    nearDeathChance: z.number().min(0).max(1),
    crisisChance: z.number().min(0).max(1),
    teacherChance: z.number().min(0).max(1),
    /** Willpower needed before a colour can wake at all. */
    minWillpower: z.number().min(0),
    /** Haki stamina spent a month of Hard haki training; past the pool it costs Vigor. */
    trainingStamina: z.number().min(0),
    vigorPerOverspend: z.number().min(0),
    /** How rare King's Qualities are at birth (1 in a few million). */
    kingsQualitiesChance: z.number().min(0).max(1),
    kingsQualitiesTrait: slug('trait'),
    voiceTrait: slug('trait'),
    /** Conqueror's first surge knocks out everyone weaker than this Willpower. */
    surgeWillpower: z.number().min(0),
  }),
  fruit: z.strictObject({
    /** In the sea or touching seastone: every stat by this percent, and no fruit. */
    cursePct: z.number().min(-100).max(0),
    cursedTrait: slug('trait'),
    /** Rebirth weights: a place near where the user died, near trade, or anywhere (rare fruits). */
    rebirth: z.strictObject({
      nearbyMiles: z.number().min(0),
      nearby: z.number().min(0),
      trade: z.number().min(0),
      anywhere: z.number().min(0),
    }),
    /** Black market prices in Berries, by rarity (the plan: 100 million and up). */
    prices: z.record(z.enum(RARITIES), intRange(0)),
    /** Months of discovery events before an eaten unknown fruit is understood. */
    discoveryMonths: intRange(1),
    /** Each year: the chance a wild fruit is found by someone, and that a finder sells it. */
    wildFoundPerYear: z.number().min(0).max(1),
    sellChance: z.number().min(0).max(1),
    /** Each year: the chance a fruit on a black market is bought (and eaten, somewhere). */
    marketSoldPerYear: z.number().min(0).max(1),
    /** Generated fruits in a new world: in Canon and Probable worlds, and in Random ones. */
    generatedPerWorld: z.number().int().min(0),
    generatedRandomMode: z.number().int().min(0),
    /** Share of Tier 2 fighters who carry a generated fruit. */
    fighterChance: z.number().min(0).max(1),
    identifyFee: z.number().int().min(0),
    /** Combat Power a point of fruit mastery adds, by rarity. */
    combatPerMastery: z.record(z.enum(RARITIES), z.number().min(0)),
    /** A canon user takes their fruit on its date: always (Canon), often (Probable), rarely (Random). */
    handover: z.record(z.string(), z.number().min(0).max(1)),
    /** How long a canon handover waits for a fruit still in other hands, in months. */
    handoverWait: z.number().int().min(0),
    /** Years an unnamed user (a stranger, a buyer) lives with a fruit before it returns. */
    strangerYears: intRange(1),
    encyclopedia: z.strictObject({
      id: slug('item'),
      name: nonEmptyText,
      price: z.number().int().min(0),
    }),
    /** Mastery growth: the training formula's points per month of Normal practice. */
    masteryPoints: z.number().min(0),
    awakening: z.strictObject({ mastery: z.number(), willpower: z.number() }),
    /** Effects of awakening by type (design values). */
    awakened: z.record(
      z.enum(FRUIT_TYPES),
      z.array(z.strictObject({ stat: statId, pct: z.number() })),
    ),
    /** Mishaps: the chance a month at low mastery brings an accident, falling to zero by this mastery. */
    mishapChance: z.number().min(0).max(1),
    mishapUntil: z.number().min(0).max(100),
    /** SMILEs: share that work; the rest leave the eater only able to smile. */
    smileWorks: z.number().min(0).max(1),
    /** Objects and animals with a body that can hold a fruit (Lassoo, Funkfreed). */
    bodies: z
      .array(
        z.strictObject({
          id: slug('item'),
          name: nonEmptyText,
          description: nonEmptyText,
          place: slug('loc'),
        }),
      )
      .default([]),
  }),
  /** The power primitives fruits are built from (about 60): canon fruits name theirs. */
  primitives: z.array(primitiveWord).min(1),
  generator: z.strictObject({
    /** The powers a generated fruit can have: none of them a canon fruit's. */
    concepts: z.array(primitive).min(1),
    typeWeights: z.record(z.enum(FRUIT_TYPES), z.number().min(0)),
    zoanWeights: z.record(z.enum(ZOAN_KINDS), z.number().min(0)),
    /** Animals no canon fruit uses: [word, gist]. */
    animals: z
      .array(z.strictObject({ word: nonEmptyText, animal: nonEmptyText, kind: z.enum(ZOAN_KINDS) }))
      .min(1),
    rarityWeights: z.record(z.enum(RARITIES), z.number().min(0)),
    techniques: intRange(1),
    /** Technique name grammars by culture (a birthplace id), plus "default". */
    grammars: z.record(
      z.string(),
      z.strictObject({
        /** "{word} {noun}" style patterns; {word} is the power, {noun} from the form's list. */
        patterns: z.array(nonEmptyText).min(1),
        nouns: z.partialRecord(z.enum(TECH_FORMS), z.array(nonEmptyText).min(1)),
        adjectives: z.array(nonEmptyText).min(1),
      }),
    ),
    looks: z.strictObject({
      colours: z.array(nonEmptyText).min(1),
      shapes: z.array(nonEmptyText).min(1),
    }),
  }),
  /** The technique pricer: a form's base, what tags add, and how mastery scales it. */
  pricing: z.strictObject({
    forms: z.record(z.enum(TECH_FORMS), priceRow),
    tags: z.partialRecord(
      z.enum(TECH_TAGS),
      z.strictObject({ power: z.number(), accuracy: z.number(), cost: z.number() }),
    ),
    effects: z.partialRecord(z.enum(TECH_EFFECTS), z.number()),
    /** Power multiplier per point of the mastery or stage it needs: 1 + mastery x this. */
    masteryScale: z.number().min(0),
    finisher: z.strictObject({ power: z.number(), cost: z.number() }),
  }),
  inventing: z.strictObject({
    /** The chance a month of practice turns a draft into a technique: base + mastery and Intellect. */
    base: z.number().min(0).max(1),
    perMastery: z.number().min(0),
    perIntellect: z.number().min(0),
    perAttempt: z.number().min(0),
    maxDrafts: z.number().int().min(1),
  }),
  moveset: z.strictObject({
    /** Techniques kept sharp at once; beyond this the least used fade. */
    max: z.number().int().min(1),
    /** Months unused before a technique's mastery starts to fade, and how fast. */
    fadeAfterMonths: z.number().int().min(1),
    fadePerYear: z.number().min(0),
    /** A signature move grows stronger with fame: power x (1 + fame x this), capped. */
    signatureFame: z.number().min(0),
    signatureCap: z.number().min(1),
    /** Each use raises a technique's own mastery by this much (diminishing). */
    usePoints: z.number().min(0),
    /** Generated fighters: forms favoured by temperament. */
    temperaments: z.record(z.string(), z.partialRecord(z.enum(TECH_FORMS), z.number().min(0))),
    combinationOpinion: z.number().min(0).max(100),
    /** Which traits make a fighter aggressive or cautious (else "balanced"). */
    temperamentTraits: z.record(z.string(), z.array(slug('trait'))),
  }),
  /**
   * Generated fighters (Tier 2): by occupation, the tracks they may have and how far (the highest
   * stage index), and the chance a colour of haki is awake, by sea.
   */
  fighters: z.record(
    slug('occ'),
    z.strictObject({
      tracks: z.record(slug('track'), z.number().int().min(0)),
      /** Of these tracks, how many they know (the first that fit their people). */
      count: z.number().int().min(1).default(1),
      gear: z.partialRecord(z.enum(['swords', 'gun', 'bow']), z.number().int().min(1)).default({}),
    }),
  ),
  hakiByRegion: z.record(z.enum(REGIONS), z.number().min(0).max(1)),
  /** Lines the powers write. */
  lines: z.record(z.string().regex(/^[a-zA-Z]+$/), lifeTemplate),
});
export type PowerRules = z.infer<typeof PowerRulesSchema>;

const MATCH_SIDE = /^(power:[a-z0-9_:]+|tag:[a-z_]+|type:(paramecia|zoan|logia)|seastone|sea|any)$/;

/**
 * data/fruitMatchups.json: how powers fare against each other, in data not code (Phase 5 reads it).
 * A side is a fruit's power ("power:rubber"), a technique tag ("tag:lightning"), a fruit type
 * ("type:logia"), seastone, the sea, or any fruit.
 */
export const MatchupRulesSchema = z.strictObject({
  pairs: z
    .array(
      z.strictObject({
        attacker: z.string().regex(MATCH_SIDE),
        defender: z.string().regex(MATCH_SIDE),
        result: z.enum(['immune', 'wins', 'loses', 'weakened', 'solidifies', 'nullifies']),
        text: nonEmptyText,
      }),
    )
    .min(1),
});
export type MatchupRules = z.infer<typeof MatchupRulesSchema>;

/** data/personality.json: hidden personality counters, what nudges them, and earned behaviour. */
export const PersonalityRulesSchema = z.strictObject({
  /** Two-sided counters: "courage" runs from cowardly (negative) to brave (positive). */
  axes: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z]+$/),
        name: nonEmptyText,
        /** Each year the counter falls back toward zero by this share. */
        decayPerYear: z.number().min(0).max(1),
        max: z.number().min(1),
      }),
    )
    .min(1),
  /** Choice and outcome tags that nudge an axis ("brave": courage +1). */
  tags: z.record(
    z.string().regex(/^[a-z_]+$/),
    z.strictObject({ axis: z.string(), by: z.number() }),
  ),
  /** Behaviour counted month by month, for earned traits ("12 months of Hard training"). */
  counters: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        /** A month counts when an activity run that month matches. */
        categories: z.array(z.enum(ACTIVITY_CATEGORIES)).default([]),
        activities: z.array(slug('act')).default([]),
        tags: z.array(z.string()).default([]),
        effort: z.enum(EFFORTS).optional(),
        atSea: z.boolean().optional(),
        /** Counted by events and the body instead (fights, severe injuries, near-death). */
        manual: z.boolean().default(false),
      }),
    )
    .min(1),
  /** Who counts as what, for trait opinion modifiers ("Scarred: -5 with nobles"). */
  groups: z.record(
    z.string().regex(/^[a-z]+$/),
    z.strictObject({
      occupations: z.array(slug('occ')).default([]),
      flags: z.array(flagName).default([]),
      races: z.array(slug('race')).default([]),
    }),
  ),
  lines: z.strictObject({ gained: lifeTemplate, lost: lifeTemplate, evolved: lifeTemplate }),
});
export type PersonalityRules = z.infer<typeof PersonalityRulesSchema>;

// ---------------------------------------------------------------------------------------------
// Phase 6: weapons, gear, ships, crafting, treasure and the economy
// ---------------------------------------------------------------------------------------------

/** What a thing used in a fight does (data/battle.json `items`, and dials and seastone gear). */
export const BATTLE_ITEM_EFFECTS = [
  'heal',
  'smoke',
  'call',
  /** Dials: a stored blow released (Impact), a far stronger one that hurts its user (Reject). */
  'impact',
  'reject',
  /** A flame or heat dial: the target burns. */
  'flame',
  /** A lamp or flash dial: the target is blinded. */
  'flash',
  /** A breath or jet dial: a burst of speed (evasion, initiative). */
  'gust',
  /** A seastone net: pins, and a fruit user caught in it loses their power. */
  'net',
] as const;
export type BattleItemEffect = (typeof BATTLE_ITEM_EFFECTS)[number];

const designId = z.string().regex(/^[a-z_]+$/);

export const WeaponSchema = z.strictObject({
  id: slug('weapon'),
  name: z.string().min(1),
  description: z.string().optional(),
  statMods: z.array(StatModDefSchema).default([]),
  /** Phase 4: simple gear a style may need (a sword, a gun, a bow), bought in a market. */
  gear: z.enum(['swords', 'gun', 'bow']).optional(),
  price: z.number().int().min(0).optional(),
  /** Phase 5: what it adds to Combat Power, and to the attack of blows made with it. */
  combat: z.number().int().min(0).default(0),
  attack: z.number().min(0).default(0),
  /** Phase 6: the plan's family, and what it is ("katana", "flintlock"). */
  family: z.enum(WEAPON_FAMILIES).default('blade'),
  kind: nonEmptyText.optional(),
  grade: z.enum(SWORD_GRADES).default('ungraded'),
  material: nonEmptyText.default('steel'),
  /** How well an ordinary one is made, 0 to 100. */
  quality: z.number().int().min(0).max(100).default(50),
  /** Sold where a place has one of these (a smithy, a market, the black market). */
  soldAt: z.array(z.enum(PLACE_FEATURES)).default([]),
  /** Sold only in these regions (empty: anywhere it is sold). */
  regions: z.array(z.enum(REGIONS)).default([]),
  /** Seastone (an edge, bullets): it touches a Logia and weakens a fruit user. */
  seastone: z.boolean().default(false),
  /** Black since it was made, or since long before the story (a canon black blade). */
  black: z.boolean().default(false),
  curse: z.enum(CURSES).optional(),
  /** Canon: one tracked entity whose holders follow the story by date (approx where vague). */
  canon: z
    .strictObject({
      holders: z
        .array(
          z.strictObject({
            from: WhenSchema,
            holder: slug('char').optional(),
            /** A holder the world does not simulate ("Kuina", "a Loguetown sword dealer"). */
            holderName: nonEmptyText.optional(),
            place: slug('loc').optional(),
            /** Lying in a shop, a grave, a collection, rather than carried. */
            container: z.enum(['lying', 'market', 'collection', 'buried']).optional(),
            price: z.number().int().min(0).optional(),
            approx: z.boolean().default(false),
          }),
        )
        .min(1),
      /** Destroyed in the story (Yubashiri at Enies Lobby). */
      destroyed: WhenSchema.optional(),
      destroyedText: nonEmptyText.optional(),
    })
    .optional(),
  /** A template that generated swords of its grade are made from (never sold or held itself). */
  template: z.boolean().default(false),
  tags,
});
export type Weapon = z.infer<typeof WeaponSchema>;

const StatModsSchema = z.array(StatModDefSchema).default([]);

/** An item that is not a weapon: dials, seastone gear, snails, cards, armour, meals, documents. */
export const ItemDefSchema = z.strictObject({
  id: slug('item'),
  name: nonEmptyText,
  description: nonEmptyText,
  kind: z.enum(ITEM_KINDS),
  /** Berries; null when it is never sold (made, found or given). */
  price: z.number().int().min(0).nullable().default(null),
  soldAt: z.array(z.enum(PLACE_FEATURES)).default([]),
  /** Sold only at these places, or in these regions (empty: anywhere with the feature). */
  places: z.array(slug('loc')).default([]),
  regions: z.array(z.enum(REGIONS)).default([]),
  /** Uses when new (a dial's charges, a kit's doses). */
  charges: z.number().int().min(1).optional(),
  /** Charges that come back by themselves each month (sunlight, wind). */
  recharge: z.number().int().min(0).default(0),
  /** In a fight: what using it does. */
  battle: z
    .strictObject({ effect: z.enum(BATTLE_ITEM_EFFECTS), value: z.number().min(0) })
    .optional(),
  /** Carried (or worn): modifiers while it is had. */
  statMods: StatModsSchema,
  /** Armour: added to defence in a fight; a swimmer cannot wear it in the water. */
  armour: z.number().min(0).default(0),
  /** Eaten or taken: modifiers for some months, Health back, a cure, faster healing. */
  effect: z
    .strictObject({
      months: z.number().int().min(1).default(1),
      statMods: StatModsSchema,
      heal: z.number().min(0).max(1).default(0),
      cures: z.boolean().default(false),
      speedsHealing: z.number().int().min(0).max(6).default(0),
    })
    .optional(),
  /** Navigation: the voyage's navigator bonus is multiplied by this. */
  navigation: z.number().min(1).optional(),
  /** A prosthetic: the lost part it replaces (its scar trait stops counting). */
  restores: z.enum(SCAR_AREAS).optional(),
  /** A blueprint: the design it carries (data/ships.json ids). */
  design: ShipDesignSchema.optional(),
  /** Seastone gear on a ship: hidden from Sea Kings (a hull coating). */
  seaKingProof: z.boolean().default(false),
  /** Never sold or crafted: only the story gives it (a Pacifista, a raid suit). */
  storyLocked: z.boolean().default(false),
  tags,
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

/** One crafting schema for smithing, gunsmithing, shipbuilding, medicine, cooking and invention. */
export const RecipeSchema = z
  .strictObject({
    id: slug('recipe'),
    name: nonEmptyText,
    description: nonEmptyText,
    craft: z.enum(CRAFTS),
    makes: z.strictObject({
      weapon: slug('weapon').optional(),
      item: slug('item').optional(),
      count: z.number().int().min(1).default(1),
    }),
    /** Berries for materials, and trade goods used up (data/hands.json `goods`). */
    cost: z.number().int().min(0).default(0),
    goods: z.record(z.string().regex(/^[a-z_]+$/), z.number().int().min(1)).default({}),
    /** Tools: the place must have one of these features (a smithy for a blade). */
    features: z.array(z.enum(PLACE_FEATURES)).default([]),
    /** Or be one of these places (a sky island's dial workshop). */
    places: z.array(slug('loc')).default([]),
    /** Craft skill (0 to 100) needed to try it. */
    skill: z.number().int().min(0).max(100).default(0),
    /** Stats that help the quality: each point above 50 adds `quality.perStat`. */
    stats: z.array(statId).min(1),
    /** Months of work at Normal effort (Hard and commitment go faster). */
    months: z.number().min(0.25),
    quality: z.strictObject({
      base: z.number(),
      perSkill: z.number().min(0),
      perStat: z.number().min(0),
      spread: z.number().min(0),
    }),
    requires: RequiresSchema.default(noRequirements),
    storyLocked: z.boolean().default(false),
    tags,
  })
  .superRefine((r, ctx) => {
    if ((r.makes.weapon === undefined) === (r.makes.item === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['makes'],
        message: 'a recipe makes exactly one thing: a weapon or an item',
      });
  });
export type Recipe = z.infer<typeof RecipeSchema>;

const handsLine = lifeTemplate;
const priceRange = z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) });

/** data/hands.json: the rules of weapons, curses, gear, crafting, markets, gambling and treasure. */
export const HandsRulesSchema = z.strictObject({
  families: z.record(
    z.enum(WEAPON_FAMILIES),
    z.strictObject({
      name: nonEmptyText,
      /** The stats it fights with. */
      stats: z.array(statId).min(1),
      /** Attack a plain one adds to a blow (before grade, quality and edge). */
      attack: z.number().min(0),
      /** Reach: 0 a fist's length, 1 a polearm's, 2 a shot. */
      reach: z.number().int().min(0).max(2),
      /** The gear kind fighting styles ask for. */
      gear: z.enum(['swords', 'gun', 'bow']).optional(),
      /** Durability when new. */
      durability: z.number().int().min(1),
    }),
  ),
  grades: z.record(
    z.enum(SWORD_GRADES),
    z.strictObject({
      name: nonEmptyText,
      /** How many exist (canon's counts); null for countless. */
      count: z.number().int().min(0).nullable(),
      attackMult: z.number().min(0),
      /** Combat Power it adds. */
      combat: z.number().int().min(0),
      /** It never breaks, and never chips once black. */
      unbreakable: z.boolean(),
      /** What a market asks for one. */
      price: priceRange,
    }),
  ),
  /** Attack multiplier at quality 0 and at 100 (straight between). */
  quality: z.strictObject({ at0: z.number().min(0), at100: z.number().min(0) }),
  edge: z.strictObject({
    /** Sharpness lost in a fight (a blade only). */
    perFight: range(0),
    /** Below this the edge is dull: attack times `dullMult`. */
    dull: z.number().min(0).max(100),
    dullMult: z.number().min(0).max(1),
    /** Berries to have a blade sharpened, and per point of durability mended. */
    sharpenCost: z.number().int().min(0),
    repairPerPoint: z.number().int().min(0),
    /** Durability lost in a fight. */
    wear: range(0),
  }),
  skill: z.strictObject({
    /** Skill a fight with the weapon adds, and a month of drills at Normal effort. */
    perFight: z.number().min(0),
    perDrill: z.number().min(0),
    /** Each point of skill adds this much attack, and this much accuracy. */
    attack: z.number().min(0),
    accuracy: z.number().min(0),
  }),
  black: z.strictObject({
    /** The Armament stage (index on track_armament) that coats a weapon. */
    armamentStage: z.number().int().min(0),
    /** Months of coating needed at that stage; each stage above counts this much more. */
    months: z.number().int().min(1),
    perStage: z.number().min(0),
    /** Attack added once black (a share). */
    attack: z.number().min(0),
  }),
  temper: z.strictObject({
    /** Cutting a grade up: months of work by a master, at a master smith's forge. */
    months: z.number().int().min(1),
    /** The wielder's sword track level needed. */
    level: z.enum(POWER_LEVELS),
    places: z.array(slug('loc')).min(1),
    chance: z.number().min(0).max(1),
    cost: z.number().int().min(0),
  }),
  curses: z.record(
    z.enum(CURSES),
    z.strictObject({
      name: nonEmptyText,
      description: nonEmptyText,
      /** The player flag set while an untamed blade of this curse is carried (events read it). */
      flag: flagName,
      /** Attack added while untamed, and once tamed (shares). */
      attack: z.number(),
      tamedAttack: z.number(),
      /** Haki stamina drained each exchange it is used untamed (haki hunger). */
      drain: z.number().min(0).default(0),
      /** A month carrying it untamed: the chance something goes wrong. */
      monthly: z.number().min(0).max(1),
      tame: z.strictObject({
        kind: z.enum(['fate', 'will', 'checks', 'ritual']),
        /** Fate: the Luck needed on a d100 against it (most lose). */
        luck: z.number().min(0).default(0),
        /** Will: Willpower and Armament stage needed. */
        willpower: z.number().min(0).default(0),
        armament: z.number().int().min(0).default(0),
        /** Checks: Willpower checks to pass, each at this difficulty. */
        checks: z.number().int().min(0).default(0),
        difficulty: z.number().min(0).default(0),
        /** Ritual: where a priest can do it, and what it costs. */
        places: z.array(slug('loc')).default([]),
        cost: z.number().int().min(0).default(0),
        text: nonEmptyText,
      }),
    }),
  ),
  swords: z.strictObject({
    /** Name parts for generated graded swords ("Shiranui", "Kurogane Ichimonji"). */
    names: z.strictObject({
      first: z.array(nonEmptyText).min(1),
      second: z.array(nonEmptyText).min(1),
      single: z.array(nonEmptyText).min(1),
    }),
    /** Where unheld graded swords lie, by weight: shops, collections, ruins. */
    places: z.record(slug('loc'), z.number().min(0)),
    /** Who among Tier 2 people may carry one. */
    occupations: z.array(slug('occ')).default([]),
    curseChance: z.number().min(0).max(1),
    /** Lesser graded swords made with the world. */
    graded: z.number().int().min(0),
  }),
  vivre: z.strictObject({
    /** Below this share of Health (or this close to the end of a lifespan) the card burns low. */
    low: z.number().min(0).max(1),
    /** Opinion needed for someone to give you a scrap of their card. */
    opinion: z.number(),
    cost: z.number().int().min(0),
    places: z.array(slug('loc')).min(1),
  }),
  calls: z.strictObject({ opinion: z.number(), everyMonths: z.number().int().min(1) }),
  market: z.strictObject({
    /** The gap between buying and selling (a share each way), and how Charisma narrows it. */
    spread: z.number().min(0).max(0.5),
    charisma: z.number().min(0),
    /** A used item sells for this share of its price (times its quality and wear). */
    sellRatio: z.number().min(0).max(1),
    /** Each month a market's stock moves this share back toward its usual. */
    drift: z.number().min(0).max(1),
    /** Stock a unit bought or sold moves (a share of the usual, scaled by the place's size). */
    impact: z.number().min(0),
    /** Price change per unit of stock away from the usual (elasticity). */
    elasticity: z.number().min(0),
    /** The black market's markup on what it sells. */
    blackMarkup: z.number().min(1),
    /** A hold's cargo units per point of a ship's cargo. */
    cargoPerPoint: z.number().min(0),
    /** Carried without a ship. */
    onFoot: z.number().int().min(0),
  }),
  goods: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        /** Berries a unit, in an ordinary market. */
        base: z.number().int().min(1),
        /** Places with these features or in these regions make it (cheap there). */
        made: z.array(z.string().min(1)).default([]),
        /** Places with these features or in these regions want it (dear there). */
        wanted: z.array(z.string().min(1)).default([]),
        /** Sold only where it is made, or only through the black market. */
        black: z.boolean().default(false),
      }),
    )
    .min(1),
  gambling: z.strictObject({
    games: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z_]+$/),
          name: nonEmptyText,
          description: nonEmptyText,
          /** The chance to win a fair game, and what a win pays (times the stake, stake back). */
          odds: z.number().min(0).max(1),
          payout: z.number().min(0),
        }),
      )
      .min(1),
    /** The chance a den rigs its games, by the place's danger 0 to 5. */
    rigged: z.array(z.number().min(0).max(1)).length(6),
    /** A rigged game's odds are times this. */
    riggedOdds: z.number().min(0).max(1),
    /** Perception that sees through a rigged game (a d100 under Perception / this). */
    spot: z.number().min(1),
    /** Bets a month, and the most one can stake. */
    perMonth: z.number().int().min(1),
    maxStake: z.number().int().min(1),
  }),
  treasure: z.strictObject({
    /** Caches made with the world, by region: how many, how rich, and how hidden. */
    caches: z
      .array(
        z.strictObject({
          regions: z.array(z.enum(REGIONS)).min(1),
          count: z.number().int().min(0),
          value: priceRange,
          containers: z.partialRecord(z.enum(['buried', 'sunken', 'ruins']), z.number().min(0)),
          /** The chance it holds a weapon or gear as well. */
          item: z.number().min(0).max(1),
        }),
      )
      .min(1),
    /** Famous treasures, hand-placed (Shandora's gold). */
    canon: z
      .array(
        z.strictObject({
          name: nonEmptyText,
          place: slug('loc'),
          value: z.number().int().min(0),
          container: z.enum(['buried', 'sunken', 'ruins']),
          text: nonEmptyText,
        }),
      )
      .default([]),
    /** What a found map turns out to be. */
    maps: z.strictObject({
      true: z.number().min(0),
      partial: z.number().min(0),
      fake: z.number().min(0),
    }),
    /** The chance a month of searching finds it: with a true map, a partial one, or none. */
    find: z.strictObject({
      true: z.number().min(0).max(1),
      partial: z.number().min(0).max(1),
      none: z.number().min(0).max(1),
    }),
    /** A sunken cache needs a swimmer, a coated ship or diving gear. */
    divers: z.array(slug('race')).default([]),
    /** Each year, the chance someone else digs up a cache first. */
    othersPerYear: z.number().min(0).max(1),
    /** What a map sells for in a market, true or not. */
    mapPrice: z.number().int().min(0),
  }),
  /** Where crafts are taught: working there goes faster and teaches more. */
  schools: z
    .array(
      z.strictObject({
        place: slug('loc'),
        crafts: z.array(z.enum(CRAFTS)).min(1),
        name: nonEmptyText,
        teacher: z.number().min(1),
      }),
    )
    .default([]),
  craft: z.strictObject({
    /** Skill a month of work adds (more when the work is hard for you). */
    perMonth: z.number().min(0),
    /** Quality cap and floor. */
    min: z.number().min(0),
    max: z.number().max(100),
  }),
  /** A Tier 2 or canon fighter without items fights with their occupation's plain weapon. */
  npcWeapons: z.record(slug('occ'), slug('weapon')).default({}),
  lines: z.record(z.string().regex(/^[a-zA-Z]+$/), handsLine),
});
export type HandsRules = z.infer<typeof HandsRulesSchema>;

/** The words the hands write (data/hands.json `lines`); a loader check makes sure each exists. */
export const HANDS_LINE_IDS = [
  'bought',
  'sold',
  'wield',
  'sharpened',
  'repaired',
  'dulled',
  'broke',
  'black',
  'crafted',
  'craftStart',
  'craftWork',
  'tempered',
  'temperFailed',
  'tamed',
  'fateFailed',
  'traded',
  'gambleWon',
  'gambleLost',
  'gambleRigged',
  'treasureFound',
  'treasureNothing',
  'mapFound',
  'found',
  'called',
  'vivreGot',
  'meal',
  'launched',
  'buildStart',
  'buildWork',
  'refitted',
  'spiritSaved',
  'spiritWoke',
] as const;

const ROOM_EFFECTS = [
  'morale',
  'heal',
  'study',
  'train',
  'craft',
  'fish',
  'perception',
  'boarding',
  'prisoners',
  'treasury',
  'boats',
  'comfort',
  /** A seastone keel: Sea Kings cannot sense her. */
  'seastone',
] as const;
export type RoomEffect = (typeof ROOM_EFFECTS)[number];

/** data/ships.json: the parts of the ship creator, the yards, building, refits and spirits. */
export const ShipRulesSchema = z.strictObject({
  hulls: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        /** The vessel class it sails as (Phase 3's table). */
        vessel: slug('vessel'),
        /** 1 a dinghy, 6 a warship: the yard must be at least this big. */
        size: z.number().int().min(1).max(6),
        speed: z.number().int().min(1),
        hull: z.number().int().min(1),
        cargo: z.number().int().min(0),
        berths: z.number().int().min(1),
        minCrew: z.number().int().min(1),
        cost: z.number().int().min(0),
        months: z.number().min(0.5),
        /** Cannon decks, and room slots. */
        decks: z.number().int().min(0),
        rooms: z.number().int().min(0),
        /** The lengths a builder may stretch or shorten it to. */
        length: z.strictObject({ min: z.number().min(0.5), max: z.number().max(2) }),
        /** Shipwright skill (0 to 100) to build it as drawn. */
        skill: z.number().int().min(0).max(100),
        /** Only from a blueprint (a Marine warship plan). */
        blueprint: z.boolean().default(false),
      }),
    )
    .min(1),
  materials: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        hull: z.number().min(0),
        speed: z.number().min(0),
        cost: z.number().min(0),
        upkeep: z.number().min(0),
        /** Years before rot sets in; null: never rots. */
        rot: z.number().int().min(1).nullable(),
        skill: z.number().int().min(0).max(100),
        /** An item that must be had (a treasure tree's wood). */
        needs: slug('item').optional(),
      }),
    )
    .min(1),
  rigs: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        speed: z.number().min(0),
        hands: z.number().min(0),
        cost: z.number().min(0),
      }),
    )
    .min(1),
  drives: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        cost: z.number().int().min(0),
        /** Speed kept in a dead calm (a share), and help running from a fight. */
        calm: z.number().min(0).max(1),
        escape: z.number().min(0),
        /** It can cross a Calm Belt. */
        calmBelt: z.boolean().default(false),
        needs: slug('item').optional(),
        storyLocked: z.boolean().default(false),
      }),
    )
    .default([]),
  rooms: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        cost: z.number().int().min(0),
        /** Berths it takes from the crew's. */
        berths: z.number().int().min(0),
        comfort: z.number(),
        effect: z.enum(ROOM_EFFECTS),
        value: z.number(),
      }),
    )
    .default([]),
  weapons: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        cost: z.number().int().min(0),
        /** Cannon it counts as in a sea fight, ram damage, boarding strength. */
        cannons: z.number().min(0),
        ram: z.number().min(0).default(0),
        boarding: z.number().min(0).default(0),
        /** The most a ship carries, per cannon deck (0: one per ship). */
        perDeck: z.number().int().min(0),
        storyLocked: z.boolean().default(false),
      }),
    )
    .default([]),
  figureheads: z
    .array(
      z.strictObject({
        id: designId,
        name: nonEmptyText,
        description: nonEmptyText,
        cost: z.number().int().min(0),
        morale: z.number(),
        /** How well it is known at sea (stealth lost). */
        fame: z.number().min(0),
      }),
    )
    .min(1),
  colours: z.array(nonEmptyText).min(1),
  /** How big a ship a place can build and how skilled its shipwrights are. */
  yards: z.strictObject({
    docks: z.strictObject({ size: z.number().int().min(0), skill: z.number().int().min(0) }),
    shipyard: z.strictObject({ size: z.number().int().min(0), skill: z.number().int().min(0) }),
    places: z.record(
      slug('loc'),
      z.strictObject({ size: z.number().int(), skill: z.number().int(), name: nonEmptyText }),
    ),
  }),
  build: z.strictObject({
    /** Building it yourself saves this share of a yard's price (materials only). */
    selfDiscount: z.number().min(0).max(1),
    /** Each month a yard is paid to save costs this share of the price. */
    hasten: z.number().min(0),
    /** Shipwright skill short of a design: months and quality suffer. */
    shortfall: z.number().min(0),
    /** Refits: a share of the part's cost as labour, and months in the yard. */
    refitLabour: z.number().min(0),
    refitMonths: z.number().int().min(0),
    /** A ship sells for this share of what it cost, times her hull. */
    resale: z.number().min(0).max(1),
  }),
  /** Upkeep a month, as a share of what she cost. */
  upkeep: z.number().min(0),
  spirit: z.strictObject({
    /** Months of care before a spirit may wake, and the chance each month after. */
    care: z.number().int().min(1),
    chance: z.number().min(0).max(1),
    /** Hull below this share for a month counts as neglect. */
    neglect: z.number().min(0).max(1),
  }),
  /** The Marines' standard designs by rank (Phase 9 issues them). */
  standard: z.record(z.string().regex(/^[a-z_]+$/), ShipDesignSchema).default({}),
  lines: z.record(z.string().regex(/^[a-zA-Z]+$/), handsLine).default({}),
});
export type ShipRules = z.infer<typeof ShipRulesSchema>;

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/** Directories under /data that hold one or more items per file. */
export const COLLECTIONS = {
  traits: { schema: TraitSchema, prefix: 'trait', label: 'trait' },
  weapons: { schema: WeaponSchema, prefix: 'weapon', label: 'weapon' },
  locations: { schema: LocationSchema, prefix: 'loc', label: 'location' },
  events: { schema: EventSchema, prefix: 'evt', label: 'event' },
  races: { schema: RaceSchema, prefix: 'race', label: 'race' },
  birthplaces: { schema: BirthplaceSchema, prefix: 'bp', label: 'birthplace' },
  legacies: { schema: LegacySchema, prefix: 'legacy', label: 'family legacy' },
  occupations: { schema: OccupationSchema, prefix: 'occ', label: 'occupation' },
  names: { schema: NamePoolSchema, prefix: 'names', label: 'name pool' },
  foci: { schema: FocusSchema, prefix: 'focus', label: 'backstory focus' },
  backstory: { schema: BackstoryEventSchema, prefix: 'bs', label: 'backstory event' },
  activities: { schema: ActivitySchema, prefix: 'act', label: 'activity' },
  jobs: { schema: JobSchema, prefix: 'job', label: 'job' },
  lanes: { schema: LaneSchema, prefix: 'lane', label: 'sea lane' },
  vessels: { schema: VesselSchema, prefix: 'vessel', label: 'vessel' },
  factions: { schema: FactionSchema, prefix: 'org', label: 'faction' },
  cast: { schema: CastSchema, prefix: 'char', label: 'canon character' },
  canon: { schema: BeatSchema, prefix: 'beat', label: 'canon beat' },
  // Phase 4
  fruits: { schema: FruitDefSchema, prefix: 'fruit', label: 'Devil Fruit' },
  tracks: { schema: TrackSchema, prefix: 'track', label: 'power track' },
  techniques: { schema: TechniqueSchema, prefix: 'tech', label: 'technique' },
  movesets: { schema: MovesetSchema, prefix: 'moveset', label: 'canon moveset' },
  // Phase 6
  items: { schema: ItemDefSchema, prefix: 'item', label: 'item' },
  recipes: { schema: RecipeSchema, prefix: 'recipe', label: 'recipe' },
} as const;
export type CollectionKind = keyof typeof COLLECTIONS;
export const COLLECTION_KINDS = Object.keys(COLLECTIONS) as CollectionKind[];

// ---------------------------------------------------------------------------------------------
// Phase 5: data/battle.json
// ---------------------------------------------------------------------------------------------

const share = z.number().min(0).max(1);
const OverdriveSchema = z.strictObject({
  /** Exchanges it lasts. */
  exchanges: z.number().int().min(1),
  /** Percent added to attack, defence and speed while it lasts. */
  boost: z.number().min(0),
  /** What it costs afterwards: exhaustion, a shrunken body for some exchanges, months of Vigor. */
  after: z.strictObject({
    kind: z.enum(['exhausted', 'shrunk', 'vigor', 'none']),
    /** Exchanges shrunk, or months of lost Vigor. */
    value: z.number().min(0).default(0),
    text: nonEmptyText,
  }),
});
export type Overdrive = z.infer<typeof OverdriveSchema>;

export const BattleRulesSchema = z.strictObject({
  /**
   * The Combat Power ladder (the plan's design values). Each tier runs from its `min` up to the next
   * tier's; the cast's `power` keyframes name a tier for each era.
   */
  ladder: z
    .array(
      z.strictObject({
        id: z.enum(LADDER_TIERS),
        name: nonEmptyText,
        min: z.number().int().min(0),
        who: nonEmptyText,
        /** Bounties that usually go with it, for the calibration table. */
        bounty: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) }),
      }),
    )
    .length(LADDER_TIERS.length),
  /** Initiative = Speed + 0.5 x Perception + 10 x Observation stage + a d20. */
  initiative: z.strictObject({
    speed: z.number(),
    perception: z.number(),
    observationPerStage: z.number(),
    die: z.number().int().min(1),
  }),
  /**
   * Hit chance = clamp(base + slope x (accuracy - evasion) / max(accuracy, evasion), min, max).
   * The plan's "(accuracy - evasion) / 2" in a form that holds at every scale (the same near 100).
   */
  hit: z.strictObject({
    base: z.number(),
    slope: z.number(),
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
    observationPerStage: z.number().min(0),
  }),
  /**
   * Damage = attack x technique power / 100 x attack / (attack + defence) x scale. Attack and
   * defence are the fighter's stats times their power (Combat Power over what their stats alone
   * give), so a blow means the same at every rung of the ladder.
   */
  damage: z.strictObject({
    scale: z.number().min(0),
    /** attack / (attack + defence), to this power: lower makes a stronger fighter's edge gentler. */
    ratioExponent: z.number().min(0),
    /** A telling blow: this chance, this many times the damage (where upsets come from). */
    crit: z.strictObject({ chance: share, mult: z.number().min(1) }),
    variance: share,
    /** Guarding takes this share off; each Armament stage takes `armamentGuardPerStage` more. */
    guard: share,
    armamentGuardPerStage: share,
    /** A coat of Armament: more damage and more defence per stage. */
    coatDamagePerStage: z.number().min(0),
    coatDefencePerStage: z.number().min(0),
    /** "internal" techniques (emission, Ryuo) ignore this share of defence. */
    internalIgnores: share,
    /** Empty fight stamina: damage and evasion are multiplied by this. */
    emptyStamina: share,
    /** A hit worth this share of max Health rolls an injury (player only). */
    injuryShare: share,
    /** The roll: the hit's share of max Health times this; at most `maxInjuries` a fight. */
    injuryChance: z.number().min(0),
    maxInjuries: z.number().int().min(0),
    /** Knocked out (not killed): Health is left at this share of max at least. */
    knockedOutHealth: share,
    /** Which severity an injury is, by the hit's share of max Health. */
    severities: z
      .array(z.strictObject({ atLeast: share, severity: z.enum(['minor', 'serious', 'severe']) }))
      .min(1),
    /** How each technique form hits: power multiplier and number of hits. */
    forms: z.partialRecord(
      z.enum(TECH_FORMS),
      z.strictObject({ power: z.number().min(0), hits: z.number().int().min(1).default(1) }),
    ),
    /** An area technique's hits on each other enemy in reach. */
    areaSplash: share,
    /** A weapon's attack, added to Strength (Dexterity for guns and bows). */
    weaponAttack: z.partialRecord(z.enum(['swords', 'gun', 'bow']), z.number().min(0)),
  }),
  evade: z.strictObject({
    /** Evading adds this percent to evasion; each Observation stage adds more. */
    bonus: z.number().min(0),
    observationPerStage: z.number().min(0),
    /** Observation's read: this percent more evasion this exchange and the next. */
    read: z.number().min(0),
  }),
  /** Fight stamina: a pool from Endurance; every action costs some. */
  stamina: z.strictObject({
    constant: z.number().min(0),
    endurance: z.number().min(0),
    regen: z.number().min(0),
    costs: z.record(z.enum(BATTLE_VERBS), z.number().min(0)),
    /** A technique costs its own cost times this. */
    techniqueCostMult: z.number().min(0),
  }),
  haki: z.strictObject({
    read: z.strictObject({ cost: z.number().min(0) }),
    coat: z.strictObject({ cost: z.number().min(0), exchanges: z.number().int().min(1) }),
    /**
     * A Conqueror's burst knocks out everyone whose will (Willpower times power) is below this
     * share of the user's, and costs the rest of the side this much morale.
     */
    burst: z.strictObject({ cost: z.number().min(0), ratio: share, morale: z.number().min(0) }),
  }),
  /** What a matchup result does to damage (data/fruitMatchups.json). */
  matchups: z.record(
    z.enum(['immune', 'wins', 'loses', 'weakened', 'solidifies', 'nullifies']),
    z.number().min(0),
  ),
  /** The shonen rule: once a fight, at 0 Health, a Willpower roll to stand again. */
  secondWind: z.strictObject({
    restore: share,
    base: share,
    /** Each point of Willpower over 50 adds this much chance. */
    willpower: z.number().min(0),
    /** The share of max Health the blow took, times this, comes off the chance. */
    blow: z.number().min(0),
    max: share,
  }),
  /** At 0 Health from someone meaning to kill: the chance it is death (plus overkill). */
  death: z.strictObject({ killBlow: share, overkill: z.number().min(0) }),
  feint: z.strictObject({
    /** The opened guard: accuracy bonus for the next attack, and guard ignored. */
    accuracy: z.number().min(0),
    difficulty: z.number().min(0),
  }),
  grapple: z.strictObject({
    pinExchanges: z.number().int().min(1),
    throwPower: z.number().min(0),
    /** Pinned and below this share of Health: captured, by someone meaning to capture. */
    captureBelow: share,
  }),
  flee: z.strictObject({
    base: z.number(),
    slope: z.number(),
    smoke: z.number().min(0),
  }),
  talk: z.strictObject({
    tauntAccuracy: z.number().min(0),
    /** Demand surrender: below this share of Health, a Charisma roll against Willpower. */
    surrenderBelow: share,
    surrenderBase: share,
    /** Both sides meaning to spare: persuading them to stop. */
    persuadeBase: share,
    stallStamina: z.number().min(0),
  }),
  overdrive: z.strictObject({
    default: OverdriveSchema,
    techniques: z.record(slug('tech'), OverdriveSchema).default({}),
  }),
  /** Things to use in a fight, bought in markets. */
  items: z
    .array(
      z.strictObject({
        id: slug('kit'),
        name: nonEmptyText,
        description: nonEmptyText,
        price: z.number().int().min(0),
        effect: z.enum(BATTLE_ITEM_EFFECTS),
        value: z.number().min(0),
      }),
    )
    .min(1),
  /** How the computer fights, by temperament: weights for each verb. */
  ai: z.record(
    z.enum(['aggressive', 'cautious', 'balanced']),
    z.partialRecord(z.enum(BATTLE_VERBS), z.number().min(0)),
  ),
  /** Quick mode: a plan the player sets instead of choosing each exchange. */
  stances: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        description: nonEmptyText,
        weights: z.partialRecord(z.enum(BATTLE_VERBS), z.number().min(0)),
        /** Flee when Health falls below this share (0: never). */
        fleeAt: share,
        /** Stand in front of allies. */
        protect: z.boolean().default(false),
      }),
    )
    .min(1),
  roles: z
    .array(
      z.strictObject({
        id: z.enum(BATTLE_ROLES),
        name: nonEmptyText,
        zone: z.enum(BATTLE_ZONES),
        attack: z.number(),
        defence: z.number(),
        description: nonEmptyText,
      }),
    )
    .length(BATTLE_ROLES.length),
  zones: z
    .array(
      z.strictObject({
        id: z.enum(BATTLE_ZONES),
        name: nonEmptyText,
        /** How far a melee blow must reach to strike someone standing here. */
        depth: z.number().int().min(0),
        /** Ranged attacks from here: percent added to accuracy. */
        rangedAccuracy: z.number(),
      }),
    )
    .length(BATTLE_ZONES.length),
  orders: z
    .array(z.strictObject({ id: z.enum(TEAM_ORDERS), name: nonEmptyText, text: nonEmptyText }))
    .length(TEAM_ORDERS.length),
  morale: z.strictObject({
    start: z.number().min(1),
    memberDown: z.number().min(0),
    leaderDown: z.number().min(0),
    leaderWin: z.number().min(0),
    /** Rally restores Charisma times this. */
    rally: z.number().min(0),
    /** A side breaks and flees at this morale. */
    breakAt: z.number().min(0),
  }),
  /** Taking the blow: the chance a friend throws themselves in front. */
  protect: z.strictObject({
    base: share,
    /** Opinion of the one in danger, over 100, times this. */
    bond: z.number().min(0),
    /** A blow worth less than this share of the target's Health is not worth it. */
    minShare: share,
    traits: z.record(slug('trait'), z.number()),
    /** The guard role, protecting its charge. */
    guardRole: share,
  }),
  /** Combination attacks: the bond they need and how much stronger together. */
  combo: z.strictObject({ bond: z.number(), power: z.number().min(1) }),
  /** A fresh fighter swapping in for a hurt one, below this share of Health. */
  tagIn: z.strictObject({ below: share }),
  spar: z.strictObject({
    /** Injury chance times this (the plan: a tenth). */
    injuryMult: share,
    /** The share of a spar's damage that stays as lost Health afterwards (bruises, not blood). */
    healthCost: share,
    /** Exchanges before a time limit calls it. */
    timeLimit: z.number().int().min(1),
    /** "yield": the loser gives up below this share of Health. */
    yieldBelow: share,
    /** Training against a partner: x maxMult at `stronger` (20% stronger); a much weaker one floor. */
    partner: z.strictObject({
      stronger: z.number().min(0),
      maxMult: z.number().min(1),
      floor: share,
    }),
    /** Opinion moves: respect for the winner, a rivalry after a close match, a bad loser's grudge. */
    respect: z.number(),
    closeShare: share,
    grudge: z.number(),
    /** A crew training day: Vigor per spar. */
    groupVigor: z.number().min(0),
  }),
  crew: z.strictObject({
    maxSide: z.number().int().min(2),
    /** Fronts: the share of the weaker side's numbers lost a round, at even odds. */
    frontLoss: share,
    maxRounds: z.number().int().min(1),
    /** Exchanges each duel on the board plays per round. */
    exchangesPerRound: z.number().int().min(1),
    /** Rank and file: how strong one of them is, as a share of their side's average officer. */
    rankAndFile: share,
  }),
  naval: z.strictObject({
    ranges: z.array(z.enum(['far', 'near', 'adjacent'])).length(3),
    /** Cannon fire: hull damage per cannon at even skill, and how often a shot tells. */
    cannon: z.strictObject({ damage: z.number().min(0), accuracy: share }),
    ram: z.strictObject({ damage: z.number().min(0), self: share }),
    fire: z.strictObject({ chance: share, damage: z.number().min(0) }),
    /** Weather: multiplies accuracy (storms halve it) and the chance to close unseen (fog). */
    weather: z.record(
      z.string().regex(/^[a-z_]+$/),
      z.strictObject({ accuracy: z.number().min(0), ambush: z.number().min(0) }),
    ),
    /** A struck flag: below this share of hull and morale. */
    strikeBelow: share,
    maxRounds: z.number().int().min(1),
    /** Cannons on a vessel without its own number: per point of hull. */
    cannonsPerHull: z.number().min(0),
  }),
  war: z.strictObject({
    maxRounds: z.number().int().min(1),
    frontLoss: share,
    /** Morale a front loses when its commander falls. */
    commanderFalls: z.number().min(0),
    /** A Conqueror's burst breaks a front whose strength is below this share of the user's power. */
    burstBreaks: share,
    /** A front breaks at this morale. */
    breakAt: z.number().min(0),
  }),
  contests: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z_]+$/),
        name: nonEmptyText,
        description: nonEmptyText,
        kind: z.enum(['tournament', 'pit', 'davy_back', 'sumo']),
        rounds: z.number().int().min(1),
        noFruits: z.boolean().default(false),
        noWeapons: z.boolean().default(false),
        stop: z.enum(STOP_RULES).optional(),
        /** Entrants' Combat Power, as ladder tiers. */
        tiers: z.array(z.enum(LADDER_TIERS)).min(1),
        purse: z.number().int().min(0),
        entry: z.number().int().min(0).default(0),
        betting: z.boolean().default(false),
      }),
    )
    .min(1),
  /**
   * The abstract resolver for fights nobody plays: P(A wins) = a^g / (a^g + b^g), where a and b
   * are each side's effective power. `gamma` is fitted against the tactical engine (npm run battle).
   */
  abstract: z.strictObject({
    gamma: z.number().min(0),
    /** A side that cannot hurt the other (a Logia without haki to answer it) keeps this share. */
    blocked: share,
    /** Matchups shift power by this much per result step. */
    matchup: z.number().min(0),
    /** Team strength: the sum of each fighter's power to this exponent (Lanchester-ish). */
    teamExponent: z.number().min(0),
  }),
  /** What a fight teaches and earns. */
  rewards: z.strictObject({
    gains: statNumbers,
    /** Practice points for the fighting tracks (counted as "fight", x3). */
    trackPoints: z.number().min(0),
    /** Fame for beating someone, per their tier above civilian; infamy when they were not a criminal. */
    famePerTier: z.number().min(0),
    infamyForKill: z.number().min(0),
    /** A pirate who beats a Marine: bounty up by this share of the Marine's power x 1,000. */
    bountyPerPower: z.number().min(0),
    /** News when someone this famous (or canon, or with this bounty) fought. */
    newsFame: z.number().min(0),
    newsBounty: z.number().int().min(0),
  }),
  /** Foes events can name without making a person of them: a thug, a pirate crew's gunner. */
  foes: z
    .array(
      z.strictObject({
        id: slug('foe'),
        name: nonEmptyText,
        /** A plural for crowds: "thugs". */
        plural: nonEmptyText,
        tier: z.enum(LADDER_TIERS),
        /** Where in the tier: 0 its bottom, 1 its top. */
        within: z.strictObject({ min: share, max: share }),
        weapon: z.enum(['swords', 'gun', 'bow']).optional(),
        intent: z.enum(INTENTS).default('capture'),
        /** Techniques they may know (data/techniques ids). */
        techniques: z.array(slug('tech')).default([]),
        armament: z.number().int().min(0).default(0),
        observation: z.number().int().min(0).default(0),
        fruitChance: share.default(0),
        criminal: z.boolean().default(true),
      }),
    )
    .min(1),
  /** NPC fights in the world: how often Tier 2 people come to blows, and why. */
  npc: z.strictObject({
    /** A quarter's chance that a bounty hunter or Marine goes after a pirate at the same place. */
    hunt: share,
    /** A pirate crew raiding the place it is at (never a stronghold). */
    raid: share,
    /** A quarter spent going after a rival: the chance it comes to blows (else words, or nothing). */
    quarrel: share,
    /** At sea: a Tier 2 voyage meets pirates or a storm. */
    seaTrouble: share,
    /** Pirates' intent toward Marines and toward anyone else. */
    pirateKills: share,
  }),
  /** Every line battles write, by id (the loader checks the ones the engine needs). */
  lines: z.record(z.string().regex(/^[a-z_]+$/), z.string().min(1)),
});
export type BattleRules = z.infer<typeof BattleRulesSchema>;
export type LadderRung = BattleRules['ladder'][number];
export type FoeDef = BattleRules['foes'][number];
export type ContestDef = BattleRules['contests'][number];

/** The lines battles need (data/battle.json `lines`); the loader rejects a file missing one. */
export const BATTLE_LINE_IDS = [
  'begin',
  'strike_hit',
  'strike_miss',
  'technique_hit',
  'technique_miss',
  'guard',
  'evade',
  'feint_ok',
  'feint_fail',
  'grapple_pin',
  'grapple_miss',
  'grapple_throw',
  'captured',
  'read',
  'coat',
  'burst',
  'burst_out',
  'item_heal',
  'item_smoke',
  'item_call',
  // Phase 6: dials and seastone gear.
  'item_impact',
  'item_reject',
  'item_flame',
  'item_flash',
  'item_gust',
  'item_net',
  'call_arrives',
  'taunt',
  'surrender_yes',
  'surrender_no',
  'persuade_yes',
  'persuade_no',
  'stall',
  'flee_ok',
  'flee_fail',
  'logia',
  'matchup',
  'knocked_out',
  'killed',
  'second_wind',
  'drowned',
  'rescued',
  'overdrive',
  'overdrive_end',
  'protect',
  'combo',
  'tag_in',
  'rally',
  'morale_break',
  'stop_spar',
  'exhausted',
  'won',
  'lost',
  'fled',
  'draw',
  'naval_fire',
  'naval_ram',
  'naval_board',
  'naval_sunk',
  'naval_struck',
  'war_front',
  'war_broken',
  'npc_hunt',
  'npc_raid',
  'npc_quarrel',
  'npc_sea',
  'npc_killed',
  'news_fight',
] as const;

/** Single files at the top of /data. Every one is required. */
export const SINGLETONS = {
  'data/calendar.json': { key: 'calendar', schema: CalendarSchema },
  'data/settings.json': { key: 'settings', schema: SettingsSchema },
  'data/character.json': { key: 'character', schema: CharacterRulesSchema },
  'data/creation.json': { key: 'creation', schema: CreationSchema },
  'data/appearance.json': { key: 'appearance', schema: AppearanceSchema },
  'data/life.json': { key: 'life', schema: LifeRulesSchema },
  'data/travel.json': { key: 'travel', schema: TravelRulesSchema },
  'data/world.json': { key: 'world', schema: WorldRulesSchema },
  'data/canon.json': { key: 'canonRules', schema: CanonRulesSchema },
  'data/powers.json': { key: 'powers', schema: PowerRulesSchema },
  'data/personality.json': { key: 'personality', schema: PersonalityRulesSchema },
  'data/fruitMatchups.json': { key: 'matchups', schema: MatchupRulesSchema },
  'data/battle.json': { key: 'battle', schema: BattleRulesSchema },
  'data/hands.json': { key: 'hands', schema: HandsRulesSchema },
  'data/ships.json': { key: 'ships', schema: ShipRulesSchema },
} as const;
export type SingletonPath = keyof typeof SINGLETONS;

/** Directories that exist in the layout but have no schema yet; files placed there are rejected. */
export const RESERVED_DIRS = ['news'] as const;

export interface GameData {
  calendar: Calendar;
  settings: Settings;
  character: CharacterRules;
  creation: Creation;
  appearance: Appearance;
  life: LifeRules;
  travel: TravelRules;
  world: WorldRules;
  canonRules: CanonRules;
  powers: PowerRules;
  personality: PersonalityRules;
  matchups: MatchupRules;
  battle: BattleRules;
  hands: HandsRules;
  ships: ShipRules;
  traits: Readonly<Record<string, Trait>>;
  weapons: Readonly<Record<string, Weapon>>;
  locations: Readonly<Record<string, Location>>;
  events: Readonly<Record<string, EventDef>>;
  races: Readonly<Record<string, Race>>;
  birthplaces: Readonly<Record<string, Birthplace>>;
  legacies: Readonly<Record<string, Legacy>>;
  occupations: Readonly<Record<string, Occupation>>;
  names: Readonly<Record<string, NamePool>>;
  foci: Readonly<Record<string, Focus>>;
  backstory: Readonly<Record<string, BackstoryEvent>>;
  activities: Readonly<Record<string, Activity>>;
  jobs: Readonly<Record<string, Job>>;
  lanes: Readonly<Record<string, Lane>>;
  vessels: Readonly<Record<string, Vessel>>;
  factions: Readonly<Record<string, Faction>>;
  cast: Readonly<Record<string, CastMember>>;
  canon: Readonly<Record<string, Beat>>;
  fruits: Readonly<Record<string, FruitDef>>;
  tracks: Readonly<Record<string, Track>>;
  techniques: Readonly<Record<string, Technique>>;
  movesets: Readonly<Record<string, Moveset>>;
  items: Readonly<Record<string, ItemDef>>;
  recipes: Readonly<Record<string, Recipe>>;
}
