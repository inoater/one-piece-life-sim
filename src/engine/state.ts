import { z } from 'zod';
import { ID_FORMAT_HINT, isEntityId } from './ids';

/**
 * The world state: everything that is true about the simulated world at one tick.
 *
 * It is plain JSON by design (no Map, Set, Date or class instances) so it serialises, hashes and
 * clones without special cases. The Zod schema is the single source of truth: types are inferred
 * from it, and saves are validated against it on load.
 *
 * Ground rules the shape encodes:
 *  - Every entity carries `id`, `type`, `origin`, `name`, `createdTick` and `flags` (rule 2).
 *  - Every number that can be modified is a Stat: `{ base, mods[] }` (rule 3).
 *  - Facts carry `knownBy` so truth and knowledge stay separate (rule 4).
 *  - The event log records every change with its cause (rule 6).
 *
 * Fields added beyond the plan's list, and why:
 *  - `tier` on entities: rule 5 needs to know which update cadence an entity is on.
 *  - `counters`: stable ids for generated entities, log records, decisions and news.
 *  - `openEnded`: set when the player continues past the present (Phase 2 epilogue).
 *  - `scheduled`, `pending`, `queue`: the event scheduler, decisions waiting on the player, and the
 *    player's chosen actions awaiting step 1 of the next tick.
 *  - `config` (save version 2): canon mode and difficulty, chosen once at world setup.
 *  - `character` on entities (save version 2): race, birth, family, appearance, hidden potential.
 */

export const ENTITY_TYPES = [
  'character',
  'organization',
  'ship',
  'item',
  'fruit',
  'location',
] as const;
export const ORIGINS = ['canon', 'generated', 'canon-diverged', 'player'] as const;

export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const OriginSchema = z.enum(ORIGINS);
export type EntityType = z.infer<typeof EntityTypeSchema>;
export type Origin = z.infer<typeof OriginSchema>;

export const FlagValueSchema = z.union([z.boolean(), z.number(), z.string()]);
export type FlagValue = z.infer<typeof FlagValueSchema>;

/** `'*'` in a knownBy list means everyone knows. Otherwise it lists the entity ids who know. */
export const PUBLIC_KNOWLEDGE = '*';
const KnownBySchema = z.array(z.string());

const EntityIdSchema = z.string().refine(isEntityId, { message: `must be ${ID_FORMAT_HINT}` });

export const ModifierSchema = z.strictObject({
  /** Where the modifier came from. Shown in tooltips, so it must be human readable. */
  source: z.string().min(1),
  value: z.number(),
  /** flat adds to the base; pct is a percentage (25 means +25%) applied after flats. */
  kind: z.enum(['flat', 'pct']),
  /** First tick at which the modifier no longer applies. Omit for permanent. */
  expiresTick: z.number().int().optional(),
});
export type Modifier = z.infer<typeof ModifierSchema>;

export const StatSchema = z.strictObject({
  base: z.number(),
  mods: z.array(ModifierSchema),
});
export type Stat = z.infer<typeof StatSchema>;

export const PRONOUNS = ['he', 'she', 'they'] as const;
export const PronounsSchema = z.enum(PRONOUNS);
export type Pronouns = z.infer<typeof PronounsSchema>;

export const RELATION_KINDS = [
  'parent',
  'child',
  'sibling',
  'guardian',
  'mentor',
  'friend',
  'rival',
  'sweetheart',
  'benefactor',
  'protege',
  'ward',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RelationshipSchema = z.strictObject({
  /** The other character's entity id. */
  id: EntityIdSchema,
  kind: z.enum(RELATION_KINDS),
  /** How this character feels about the other: a Stat, so later systems can explain it (rule 3). */
  opinion: StatSchema,
  sinceTick: z.number().int(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const SCAR_AREAS = ['head', 'torso', 'arms', 'legs', 'eyes'] as const;
export const ScarSchema = z.strictObject({
  area: z.enum(SCAR_AREAS),
  text: z.string().min(1),
  tick: z.number().int(),
});
export type Scar = z.infer<typeof ScarSchema>;

/**
 * Family facts that only make sense for the character they were generated around (the player).
 * Parents and siblings are ordinary entities; this records how they relate.
 */
export const FamilySchema = z.strictObject({
  legacy: z.string().min(1),
  /** A wealth tier id from creation.json. */
  wealth: z.string().min(1),
  birthOrder: z.enum(['only', 'eldest', 'middle', 'youngest']),
  parentIds: z.array(EntityIdSchema),
  siblingIds: z.array(EntityIdSchema),
  /** Brothers and sisters not yet born when the story starts (Phase 2 brings births). */
  expected: z.array(z.strictObject({ birthTick: z.number().int(), pronouns: PronounsSchema })),
});
export type Family = z.infer<typeof FamilySchema>;

/**
 * What makes an entity a person. Present on every `character` entity created from Phase 1 on.
 *
 * `hidden` holds facts that are true but known to nobody, the player included (rule 4): the talent
 * tier and each stat's potential. Views show them only in omniscient mode; the player gets hints.
 */
export const CharacterSchema = z.strictObject({
  givenName: z.string().min(1),
  familyName: z.string(),
  pronouns: PronounsSchema,
  race: z.string().min(1),
  /** The month of birth. Negative ticks are births before Year 0 (before God Valley). */
  birthTick: z.number().int(),
  birthplace: z.string().min(1),
  /** Occupation id from data/occupations, if any. */
  occupation: z.string().optional(),
  alive: z.boolean(),
  death: z.strictObject({ tick: z.number().int(), cause: z.string().min(1) }).optional(),
  /** Trait ids in the order they were gained. */
  traits: z.array(z.string().min(1)),
  /** Appearance field id -> option id (see data/appearance.json). Text is written from these. */
  appearance: z.record(z.string(), z.string()),
  /** Grown height in centimetres, within the height class. A child's height is a fraction of it. */
  adultHeightCm: z.number().int().min(1).optional(),
  scars: z.array(ScarSchema),
  relationships: z.array(RelationshipSchema),
  /** Negative means debt. */
  berries: z.number().int(),
  family: FamilySchema.optional(),
  /** Backstory focus id (data/foci), when the character had one. */
  focus: z.string().optional(),
  /** The written backstory paragraph. */
  backstory: z.string().optional(),
  hidden: z
    .strictObject({
      talent: z.string().min(1),
      potential: z.record(z.string(), StatSchema),
    })
    .optional(),
});
export type CharacterData = z.infer<typeof CharacterSchema>;

export const EntitySchema = z.strictObject({
  id: EntityIdSchema,
  type: EntityTypeSchema,
  origin: OriginSchema,
  name: z.string().min(1),
  createdTick: z.number().int(),
  /** Update cadence: tier 1 monthly, tier 2 quarterly (see settings.json). */
  tier: z.union([z.literal(1), z.literal(2)]),
  flags: z.record(z.string(), FlagValueSchema),
  stats: z.record(z.string(), StatSchema),
  knownBy: KnownBySchema,
  /** Present on characters made by character genesis (Phase 1 on). */
  character: CharacterSchema.optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

/**
 * Choices made once, at world setup. Canon mode is acted on from Phase 3; difficulty changes
 * starting money and how hard a backstory is now, and more later. Ids refer to data/creation.json.
 */
export const WorldConfigSchema = z.strictObject({
  canonMode: z.string().min(1),
  difficulty: z.string().min(1),
  /** Whether rare races (Lunarians) could be chosen when this world was made. */
  rareRaces: z.boolean(),
});
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

/** The configuration of a world made without character creation (and of every save before version 2). */
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  canonMode: 'canon',
  difficulty: 'normal',
  rareRaces: false,
};

export const EventRecordSchema = z.strictObject({
  /** Position in the world's history; stable even if old records are ever archived. */
  seq: z.number().int().min(0),
  tick: z.number().int(),
  kind: z.string().min(1),
  actorIds: z.array(z.string()),
  targetIds: z.array(z.string()),
  place: z.string().nullable(),
  summary: z.string(),
  tags: z.array(z.string()),
  /** What caused this: an event id, a system id ("sys:create") or an action ("action:debug"). */
  cause: z.string().optional(),
  /** The record that caused this one, so "why did this happen?" can be walked back. */
  causeSeq: z.number().int().min(0).optional(),
  knownBy: KnownBySchema,
});
export type EventRecord = z.infer<typeof EventRecordSchema>;

export const NewsItemSchema = z.strictObject({
  id: z.number().int().min(1),
  tick: z.number().int(),
  text: z.string(),
  tags: z.array(z.string()),
  sourceSeq: z.number().int().min(0).optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const ScheduledEventSchema = z.strictObject({
  eventId: z.string().min(1),
  /** Fires during the tick whose number is >= this. */
  tick: z.number().int(),
  /** Who scheduled it: "debug", "chain:evt_x", ... */
  source: z.string(),
  /** The log record behind the scheduling (a decision, an event, a debug action). */
  causeSeq: z.number().int().min(0).optional(),
});
export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;

export const PendingDecisionSchema = z.strictObject({
  id: z.number().int().min(1),
  eventId: z.string().min(1),
  firedTick: z.number().int(),
  /** The log record the event produced, so the decision can point back at its cause. */
  recordSeq: z.number().int().min(0),
  title: z.string(),
  text: z.string(),
  choices: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        text: z.string().optional(),
      }),
    )
    .min(1),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const QueuedActionSchema = z.strictObject({
  kind: z.string().min(1),
  payload: z.record(z.string(), FlagValueSchema),
});
export type QueuedAction = z.infer<typeof QueuedActionSchema>;

export const CountersSchema = z.strictObject({
  genId: z.number().int().min(0),
  logSeq: z.number().int().min(0),
  decisionId: z.number().int().min(0),
  newsSeq: z.number().int().min(0),
});
export type Counters = z.infer<typeof CountersSchema>;

export const WorldStateSchema = z
  .strictObject({
    seed: z.string().min(1),
    /** The month about to be (or being) processed. Tick 0 is Year 0, month 1. */
    tick: z.number().int(),
    openEnded: z.boolean(),
    config: WorldConfigSchema,
    playerId: EntityIdSchema.nullable(),
    counters: CountersSchema,
    entities: z.record(z.string(), EntitySchema),
    log: z.array(EventRecordSchema),
    news: z.array(NewsItemSchema),
    scheduled: z.array(ScheduledEventSchema),
    pending: z.array(PendingDecisionSchema),
    queue: z.array(QueuedActionSchema),
    flags: z.record(z.string(), FlagValueSchema),
  })
  .superRefine((state, ctx) => {
    for (const [key, entity] of Object.entries(state.entities)) {
      if (entity.id !== key) {
        ctx.addIssue({
          code: 'custom',
          path: ['entities', key, 'id'],
          message: `entity is stored under "${key}" but its id is "${entity.id}"`,
        });
      }
    }
    if (state.playerId !== null && !(state.playerId in state.entities)) {
      ctx.addIssue({
        code: 'custom',
        path: ['playerId'],
        message: `playerId "${state.playerId}" does not exist in entities`,
      });
    }
  });
export type WorldState = z.infer<typeof WorldStateSchema>;
