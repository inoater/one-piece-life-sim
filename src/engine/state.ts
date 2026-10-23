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
});
export type Entity = z.infer<typeof EntitySchema>;

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
