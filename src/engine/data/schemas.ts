import { z } from 'zod';
import { FlagValueSchema, PRONOUNS, SCAR_AREAS } from '../state';
import { STAT_IDS } from '../stats';
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

// ---------------------------------------------------------------------------------------------
// calendar.json
// ---------------------------------------------------------------------------------------------

export const CalendarSchema = z
  .strictObject({
    /** In-universe calendar year that game Year 0 corresponds to. Display only. */
    canonYearOffset: z.number().int(),
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
] as const;

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
  /** Backstory event tag -> weight multiplier ("hardship": 1.5 makes hard years likelier). */
  eventWeights: multipliers,
  /** Relative chance of being drawn from a pool. */
  weight: z.number().min(0).default(1),
  tags,
});
export type Trait = z.infer<typeof TraitSchema>;

export const WeaponSchema = z.strictObject({
  id: slug('weapon'),
  name: z.string().min(1),
  description: z.string().optional(),
  statMods: z.array(StatModDefSchema).default([]),
  tags,
});
export type Weapon = z.infer<typeof WeaponSchema>;

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

/** "Year 14, month 3" in data: a tick written the way people read dates. */
export const WhenSchema = z.strictObject({
  year: z.number().int().min(-1000).max(1000),
  month: monthIndex.default(1),
});
export type When = z.infer<typeof WhenSchema>;
/** The first tick of a date. */
export const tickOfWhen = (w: When): number => w.year * 12 + (w.month - 1);

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

/** What a check measures: a stat, Combat Power, or seamanship (navigation at sea). */
export const CHECK_STATS = [...STAT_IDS, 'combatPower', 'navigation'] as const;

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

export const ChoiceSchema = z.strictObject({
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
} as const;
export type CollectionKind = keyof typeof COLLECTIONS;
export const COLLECTION_KINDS = Object.keys(COLLECTIONS) as CollectionKind[];

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
} as const;
export type SingletonPath = keyof typeof SINGLETONS;

/** Directories that exist in the layout but have no schema yet; files placed there are rejected. */
export const RESERVED_DIRS = ['fruits', 'news'] as const;

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
}
