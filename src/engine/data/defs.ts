import { z } from 'zod';
import { STAT_IDS } from '../stats';

/**
 * Definitions shared by the content files and the world state (Phase 4): Devil Fruits and
 * techniques. They live apart from schemas.ts because the state needs them too: a generated fruit
 * (one the game invents in Random mode, or for a stranger) and a player's invented technique are
 * stored inside the save with exactly the shape a data file would give them, and state.ts cannot
 * import schemas.ts (schemas.ts imports the state's pieces).
 *
 * Numbers are design values to tune, not canon facts. Technique names follow the manga; their
 * descriptions are the game's own words. A technique the manga shows but never names carries
 * `"named": false` and a name of the game's own.
 */

const slug = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9]+(?:_[a-z0-9]+)*$`), {
    message: `must look like "${prefix}_snake_case_name" (lowercase letters, digits and underscores)`,
  });
const nonEmptyText = z.string().min(1);

/** "Year 14, month 3" in data: a tick written the way people read dates. */
export const WhenSchema = z.strictObject({
  year: z.number().int().min(-1000).max(1000),
  month: z.number().int().min(1).max(12).default(1),
});
export type When = z.infer<typeof WhenSchema>;
/** The first tick of a date. */
export const tickOfWhen = (w: When): number => w.year * 12 + (w.month - 1);

// ---- Power tracks (the vocabulary; the schemas are in schemas.ts) --------------------------

/** The plan's six levels of mastery, in order. */
export const POWER_LEVELS = [
  'novice',
  'trained',
  'adept',
  'expert',
  'master',
  'grandmaster',
] as const;
export type PowerLevel = (typeof POWER_LEVELS)[number];

/** What a track is a power of. */
export const TRACK_FAMILIES = ['haki', 'fruit', 'style', 'sword', 'six_powers', 'weapon'] as const;

/**
 * Moments that move powers: a fight against someone clearly stronger, a near-death escape, a
 * crisis that protects someone, a shattering defeat, a mentor's push, a clash of Conquerors,
 * blindfold drills, time in the water. Events record them; stages and haki waking read them.
 */
export const POWER_EVENTS = [
  'stronger_foe',
  'near_death',
  'crisis',
  'defeat',
  'mentor_push',
  'clash',
  'blindfold',
  'water_time',
  'trust',
  'scroll',
  'moon',
  'invitation',
  'starvation',
] as const;
export type PowerEvent = (typeof POWER_EVENTS)[number];

/** How practice is counted: drills, sparring, real fights, teaching others (the plan's x1, x1.5, x3, x0.5). */
export const PRACTICE_KINDS = ['drill', 'spar', 'fight', 'teach'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

// ---- Techniques -----------------------------------------------------------------------------

/** What shape a technique takes: the technique creator's "form", and the battle engine's verb. */
export const TECH_FORMS = [
  'strike',
  'barrage',
  'projectile',
  'area',
  'counter',
  'movement',
  'boost',
  'grapple',
  'guard',
  'support',
] as const;
export type TechForm = (typeof TECH_FORMS)[number];

export const TECH_RANGES = ['melee', 'near', 'far', 'area'] as const;
export type TechRange = (typeof TECH_RANGES)[number];

/** What a technique is made of: how it hurts, its element, and what powers it. */
export const TECH_TAGS = [
  'blunt',
  'slash',
  'pierce',
  'kick',
  'grip',
  'fire',
  'ice',
  'lightning',
  'light',
  'dark',
  'magma',
  'sand',
  'smoke',
  'gas',
  'poison',
  'water',
  'sound',
  'wind',
  'earth',
  'gravity',
  'explosive',
  'rubber',
  'string',
  'wax',
  'plant',
  'metal',
  'bind',
  'heal',
  'illusion',
  'spatial',
  'mind',
  'soul',
  'time',
  'beast',
  'body',
  'weapon',
  'sword',
  'gun',
  'bow',
  'haki',
  'armament',
  'observation',
  'conqueror',
  'sea',
  'sky',
  'cooking',
  'dance',
] as const;
export type TechTag = (typeof TECH_TAGS)[number];

/** What a technique does beyond damage: read by the battle engine (Phase 5). */
export const TECH_EFFECTS = [
  'knockback',
  'burn',
  'freeze',
  'shock',
  'bind',
  'stun',
  'bleed',
  'poison',
  'pierce_guard',
  'ignore_logia',
  'internal',
  'heal',
  'reflect',
  'intangible',
  'drain',
  'slow',
  'blind',
  'fear',
  'knockout',
  'flight',
  'transform',
  'absorb',
  'disarm',
  'swap',
  'shrink',
  'grow',
  'terrain',
  'summon',
  'buff',
  'debuff',
] as const;
export type TechEffect = (typeof TECH_EFFECTS)[number];

/**
 * One technique, from a fruit, a style, a weapon or haki: one schema for all of them. `cost`,
 * `power` and `accuracy` may be left out; the technique pricer then works them out from the form,
 * the tags and the mastery needed (the same pricer the technique creator uses).
 */
export const TechniqueDefSchema = z.strictObject({
  id: slug('tech'),
  name: nonEmptyText,
  form: z.enum(TECH_FORMS),
  tags: z.array(z.enum(TECH_TAGS)).min(1),
  range: z.enum(TECH_RANGES).optional(),
  /** Vigor (and haki stamina for haki techniques) it costs in a fight. */
  cost: z.number().min(0).optional(),
  /** 0 to 200: how hard it hits, before the user's stats. */
  power: z.number().min(0).max(400).optional(),
  /** 0 to 100: how often it lands, before the user's stats. */
  accuracy: z.number().min(0).max(100).optional(),
  /** Devil Fruit techniques: the fruit mastery (0 to 100) at which it can be used. */
  mastery: z.number().min(0).max(100).default(0),
  /** Style techniques: the track and stage that teach it (also listed in the track's stage). */
  stage: z
    .strictObject({ track: slug('track'), stage: z.string().regex(/^[a-z0-9_]+$/) })
    .optional(),
  /** Stats it needs on top (a jaw strong enough for a third sword). */
  stats: z.partialRecord(z.enum(STAT_IDS), z.number().min(0)).default({}),
  effects: z.array(z.enum(TECH_EFFECTS)).default([]),
  /** A heavy-cost closing blow. */
  finisher: z.boolean().default(false),
  description: z.string().optional(),
  /** False: the manga shows the power but names no move; the name is the game's own. */
  named: z.boolean().default(true),
});
export type TechniqueDef = z.infer<typeof TechniqueDefSchema>;

// ---- Devil Fruits ---------------------------------------------------------------------------

export const FRUIT_TYPES = ['paramecia', 'zoan', 'logia'] as const;
export type FruitType = (typeof FRUIT_TYPES)[number];
export const ZOAN_KINDS = ['regular', 'ancient', 'mythical', 'artificial'] as const;
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Where an uneaten fruit can be. */
export const FRUIT_CONTAINERS = [
  /** Grown again in an ordinary fruit, on a tree or a market stall nobody has looked at twice. */
  'tree',
  'chest',
  'market',
  'auction',
  'vault',
  'sea',
  'unknown',
  /** In someone's hands, uneaten. */
  'held',
  /** Eaten: it has a user. */
  'eaten',
] as const;
export type FruitContainer = (typeof FRUIT_CONTAINERS)[number];

/** What a fruit is weak against, beyond the sea and seastone every fruit fears. */
export const WEAKNESS_KINDS = [
  'haki',
  'water',
  'cold',
  'heat',
  'fire',
  'lightning',
  'blunt',
  'slash',
  'poison',
  'sound',
  'light',
  'magma',
  'wind',
  'salt',
  'fatigue',
  'distance',
  'concentration',
] as const;

/** A canon user of a fruit, over a range of months (dates the manga only implies: `approx`). */
export const FruitHolderSchema = z.strictObject({
  /** A canon cast member (data/cast), when the user is one. Otherwise only the name is known. */
  char: slug('char').optional(),
  /** An object or animal with a body that ate it (data/powers.json `bodies`). */
  body: slug('item').optional(),
  name: nonEmptyText,
  from: WhenSchema,
  /** Inclusive: the month the user died (the fruit returns to the world the month after). */
  to: WhenSchema.optional(),
  approx: z.boolean().default(false),
  /** How they came by it: "won it as a tournament prize". */
  how: z.string().optional(),
});
export type FruitHolder = z.infer<typeof FruitHolderSchema>;

export const FruitDefSchema = z
  .strictObject({
    id: slug('fruit'),
    /** "Gum-Gum Fruit" */
    name: nonEmptyText,
    /** "Gomu Gomu no Mi" */
    japanese: z.string().optional(),
    type: z.enum(FRUIT_TYPES),
    /** Zoans only: regular, ancient, mythical or artificial (a SMILE). */
    zoan: z.enum(ZOAN_KINDS).optional(),
    /** "Model: Phoenix" */
    model: z.string().optional(),
    rarity: z.enum(RARITIES),
    /**
     * The one power it grants, as a key ("rubber", "fire", "zoan:bird:phoenix"). No two fruits
     * share one, and a generated fruit never takes a canon one.
     */
    power: z.string().regex(/^[a-z0-9_:]+$/),
    /** The power primitives it is built from (data/powers.json `primitives`). */
    primitives: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
    description: nonEmptyText,
    /** What the swirled fruit looks like, before anyone knows which it is. */
    look: z.string().optional(),
    weaknesses: z
      .array(z.strictObject({ against: z.enum(WEAKNESS_KINDS), text: nonEmptyText }))
      .default([]),
    /** Modifiers while the user lives with it: a Zoan's body, a Logia's lightness (percent). */
    boosts: z.array(z.strictObject({ stat: z.enum(STAT_IDS), pct: z.number() })).default([]),
    /** Logia: attacks pass through the user unless they carry haki, seastone or a weakness. */
    intangible: z.boolean().default(false),
    techniques: z.array(TechniqueDefSchema).default([]),
    /** A deeper truth found through an event chain: another name, another branch. */
    secret: z
      .strictObject({
        name: nonEmptyText,
        text: nonEmptyText,
        /** Fruit mastery needed before the chain can begin. */
        mastery: z.number().min(0).max(100).default(60),
        techniques: z.array(TechniqueDefSchema).default([]),
      })
      .optional(),
    /** What awakening does for this fruit, in a sentence (the type's rule does the numbers). */
    awakening: z.string().optional(),
    /** A Mythical Zoan's will of its own: its nature pulls at the user's personality. */
    will: z.strictObject({ axis: z.string(), toward: z.number().int() }).optional(),
    holders: z.array(FruitHolderSchema).default([]),
    /** Where it lies before its first user (or at the start of a world with no holder yet). */
    start: z
      .strictObject({
        place: slug('loc').optional(),
        container: z.enum(FRUIT_CONTAINERS).default('unknown'),
        note: z.string().optional(),
      })
      .optional(),
    origin: z.enum(['canon', 'generated']).default('canon'),
    approx: z.boolean().default(false),
  })
  .superRefine((fruit, ctx) => {
    if (fruit.type === 'zoan' && !fruit.zoan) {
      ctx.addIssue({ code: 'custom', path: ['zoan'], message: 'a Zoan names its kind' });
    }
    if (fruit.type !== 'zoan' && fruit.zoan) {
      ctx.addIssue({ code: 'custom', path: ['zoan'], message: 'only Zoans have a kind' });
    }
    if (fruit.type === 'logia' && !fruit.intangible) {
      ctx.addIssue({ code: 'custom', path: ['intangible'], message: 'a Logia is intangible' });
    }
    const ids = new Set<string>();
    [...fruit.techniques, ...(fruit.secret?.techniques ?? [])].forEach((t, i) => {
      if (ids.has(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['techniques', i, 'id'],
          message: `duplicate "${t.id}"`,
        });
      ids.add(t.id);
      if (t.stage)
        ctx.addIssue({
          code: 'custom',
          path: ['techniques', i, 'stage'],
          message: 'a fruit technique unlocks by mastery, not by a style stage',
        });
    });
    let last = -Infinity;
    fruit.holders.forEach((h, i) => {
      const from = tickOfWhen(h.from);
      if (from < last)
        ctx.addIssue({
          code: 'custom',
          path: ['holders', i, 'from'],
          message: 'holders in date order',
        });
      if (h.to && tickOfWhen(h.to) < from)
        ctx.addIssue({
          code: 'custom',
          path: ['holders', i, 'to'],
          message: '"to" is before "from"',
        });
      last = h.to ? tickOfWhen(h.to) : from;
      if (h.char && h.body)
        ctx.addIssue({
          code: 'custom',
          path: ['holders', i],
          message: 'a person or a body, not both',
        });
    });
  });
export type FruitDef = z.infer<typeof FruitDefSchema>;

// ---- Phase 6: weapons, gear, ships ---------------------------------------------------------

/** The plan's weapon families. */
export const WEAPON_FAMILIES = ['blade', 'heavy', 'polearm', 'firearm', 'bow', 'unusual'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

/** Sword grades, best first. Graded and better swords are each one tracked entity. */
export const SWORD_GRADES = ['supreme', 'great', 'skillful', 'graded', 'ungraded'] as const;
export type SwordGrade = (typeof SWORD_GRADES)[number];

/** The four curses a blade can carry. */
export const CURSES = ['misfortune', 'haki_hunger', 'bloodthirst', 'haunting'] as const;
export type CurseId = (typeof CURSES)[number];

/** Crafts that share the one crafting schema. */
export const CRAFTS = [
  'smithing',
  'gunsmithing',
  'shipbuilding',
  'medicine',
  'cooking',
  'invention',
] as const;
export type Craft = (typeof CRAFTS)[number];

/** Kinds of item that are not weapons. */
export const ITEM_KINDS = [
  'dial',
  'seastone',
  'den_den',
  'vivre',
  'navigation',
  'medicine',
  'prosthetic',
  'armour',
  'clothing',
  'meal',
  'blueprint',
  'map',
  'material',
  'tool',
  'document',
  'story',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Where an item is when nobody carries it, or that it is gone. */
export const ITEM_CONTAINERS = [
  'held',
  'lying',
  'market',
  'collection',
  'buried',
  'sunken',
  'ruins',
  'destroyed',
] as const;
export type ItemContainer = (typeof ITEM_CONTAINERS)[number];

/**
 * A ship's design (the ship creator): hull, length, material, rig, extra drives, rooms, weapons,
 * figurehead and look. Ids name entries in data/ships.json. Stored in saves (a ship's design, a
 * saved blueprint) with exactly the shape a data file gives it, so it lives here with the state.
 */
export const ShipDesignSchema = z.strictObject({
  name: z.string().min(1).max(60).optional(),
  hull: z.string().regex(/^[a-z_]+$/),
  /** Length against the hull's usual: 0.8 is a short build, 1.25 a long one (skill permitting). */
  length: z.number().min(0.5).max(2).default(1),
  material: z.string().regex(/^[a-z_]+$/),
  rig: z.string().regex(/^[a-z_]+$/),
  drives: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  rooms: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  /** Weapon id -> how many (cannons by the gun, one ram). */
  weapons: z.record(z.string().regex(/^[a-z_]+$/), z.number().int().min(0)).default({}),
  figurehead: z
    .string()
    .regex(/^[a-z_]+$/)
    .default('none'),
  hullColour: z.string().min(1).max(30).default('black'),
  sailColour: z.string().min(1).max(30).default('white'),
  /** The Jolly Roger in words, until Phase 14 draws it. */
  jollyRoger: z.string().max(120).optional(),
});
export type ShipDesign = z.infer<typeof ShipDesignSchema>;
