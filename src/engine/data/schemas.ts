import { z } from 'zod';
import { FlagValueSchema } from '../state';
import { STAT_IDS } from '../stats';
import { checkTemplate } from '../template';

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

/** A string that may contain {variables}; checked against the template registry. */
const template = z
  .string()
  .min(1)
  .superRefine((text, ctx) => {
    for (const problem of checkTemplate(text)) ctx.addIssue({ code: 'custom', message: problem });
  });

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

export const TraitSchema = z.strictObject({
  id: slug('trait'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['innate', 'birth', 'family', 'quirk']),
  /** In this phase traits only change stats; full trait mechanics come later. */
  statMods: z.array(StatModDefSchema).default([]),
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

export const LocationSchema = z.strictObject({
  id: slug('loc'),
  name: z.string().min(1),
  region: z.enum(REGIONS),
  description: z.string().optional(),
  tags,
});
export type Location = z.infer<typeof LocationSchema>;

// ---------------------------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------------------------

/** (inert) Validated and cross-referenced now; evaluated when the candidate engine arrives. */
export const ConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hasTrait'), trait: slug('trait') }),
  z.strictObject({ kind: z.literal('atLocation'), location: slug('loc') }),
  z.strictObject({ kind: z.literal('flag'), flag: z.string().min(1), equals: FlagValueSchema }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const EffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('log'), text: template, tags }),
  z.strictObject({
    kind: z.literal('setFlag'),
    flag: z
      .string()
      .regex(/^[a-z0-9_.]+$/, { message: 'flag names use lowercase letters, digits, "_" and "."' }),
    value: FlagValueSchema,
  }),
  z.strictObject({
    kind: z.literal('schedule'),
    eventId: slug('evt'),
    /** Counted from the month the effect is applied. At least 1, so chains cannot loop in one tick. */
    afterMonths: z.number().int().min(1).max(1200),
  }),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const ChoiceSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9_]+$/, { message: 'choice ids use lowercase letters, digits and "_"' }),
  label: z.string().min(1),
  text: z.string().optional(),
  effects: z.array(EffectSchema).default([]),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const EventSchema = z
  .strictObject({
    id: slug('evt'),
    type: z.enum(['personal', 'local', 'voyage', 'world', 'canon']),
    title: z.string().min(1),
    text: template,
    /** Only "manual" exists so far: the event fires when scheduled or forced. */
    trigger: z.enum(['manual']).default('manual'),
    conditions: z.array(ConditionSchema).default([]),
    /** (inert) Weighted random selection arrives with the event engine. */
    weight: z.number().min(0).default(1),
    /** (inert) Minimum months between firings. */
    cooldown: z.number().int().min(0).default(0),
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
    if (event.visibility === 'secret' && event.news !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['news'],
        message: 'a secret event cannot produce news (news is public by definition)',
      });
    }
  });
export type EventDef = z.infer<typeof EventSchema>;

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/** Directories under /data that hold one or more items per file. */
export const COLLECTIONS = {
  traits: { schema: TraitSchema, prefix: 'trait' },
  weapons: { schema: WeaponSchema, prefix: 'weapon' },
  locations: { schema: LocationSchema, prefix: 'loc' },
  events: { schema: EventSchema, prefix: 'evt' },
} as const;
export type CollectionKind = keyof typeof COLLECTIONS;

/** Directories that exist in the layout but have no schema yet; files placed there are rejected. */
export const RESERVED_DIRS = ['races', 'canon', 'fruits', 'news'] as const;

export interface GameData {
  calendar: Calendar;
  settings: Settings;
  traits: Readonly<Record<string, Trait>>;
  weapons: Readonly<Record<string, Weapon>>;
  locations: Readonly<Record<string, Location>>;
  events: Readonly<Record<string, EventDef>>;
}
