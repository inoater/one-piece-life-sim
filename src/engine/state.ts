import { z } from 'zod';
import { FRUIT_CONTAINERS, FruitDefSchema, TechniqueDefSchema } from './data/defs';
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
 *  - `character.life` (save version 3): health, injuries, routine, job, debt and the recap's
 *    memory, for the person being played.
 *  - Save version 4 (Phase 3, the world): `character.place` and `character.travel` (where people
 *    are, and the player's voyage), `character.npc` (a Tier 2 person's goal), the `place`, `org`
 *    and `ship` blocks of location, organization and ship entities, `canon` (each beat's fate and
 *    the divergence log), `eventState` (cooldowns), news with a place and a delivery month, and
 *    decisions that remember the people an event cast.
 *  - Save version 5 (Phase 4, powers): `character.powers` (power tracks, the Devil Fruit eaten,
 *    haki stamina, the moveset, technique drafts, fruits and gear carried, fruit knowledge),
 *    `character.personality` (hidden counters), `character.traitInfo` (when and how each trait
 *    was gained), and the `fruit` block of fruit entities (one entity per fruit in the world).
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

export const SEVERITIES = ['minor', 'serious', 'severe'] as const;
export const EFFORTS = ['light', 'normal', 'hard'] as const;
export type Effort = (typeof EFFORTS)[number];

export const InjurySchema = z.strictObject({
  area: z.enum(SCAR_AREAS),
  severity: z.enum(SEVERITIES),
  /** "a cracked rib" */
  name: z.string().min(1),
  /** What did it: accident, violence, ... (decides the roll at Health 0). */
  cause: z.string().min(1),
  tick: z.number().int(),
  /** Healed at the start of this month. */
  healTick: z.number().int(),
});
export type Injury = z.infer<typeof InjurySchema>;

export const IllnessSchema = z.strictObject({
  /** An illness id from data/life.json. */
  id: z.string().min(1),
  name: z.string().min(1),
  tick: z.number().int(),
  healTick: z.number().int(),
});
export type Illness = z.infer<typeof IllnessSchema>;

export const RoutineSlotSchema = z.strictObject({
  /** An activity id from data/activities. */
  activity: z.string().min(1),
  effort: z.enum(EFFORTS),
});
export type RoutineSlot = z.infer<typeof RoutineSlotSchema>;

/** One line of the month-end card. */
export const ReportLineSchema = z.strictObject({
  text: z.string(),
  tone: z.enum(['good', 'bad', 'plain', 'alert']),
});

/**
 * What the last month added up to, for the month-end card: what was done, Vigor used against the
 * pool, money in and out. Everything in it is also in the log; this is the summary of one month.
 */
export const MonthReportSchema = z.strictObject({
  tick: z.number().int(),
  done: z.array(
    z.strictObject({
      activity: z.string(),
      effort: z.enum(EFFORTS),
      outcome: z.string(),
      /** "act_spar#won": which outcome of what. */
      id: z.string(),
    }),
  ),
  vigor: z.strictObject({ pool: z.number(), spent: z.number() }),
  berries: z.strictObject({ income: z.number(), costs: z.number() }),
  lines: z.array(ReportLineSchema),
});
export type MonthReport = z.infer<typeof MonthReportSchema>;

/**
 * The life loop's state for the person being played (Phase 2, save version 3): body, routine,
 * work, money troubles, and what the death screen will want to remember.
 */
export const LifeSchema = z.strictObject({
  /** Current Health; Max Health is derived from Durability and Endurance. */
  health: z.number(),
  /** Set by spending past the Vigor pool; lifts after a restful month. */
  exhausted: z.boolean(),
  injuries: z.array(InjurySchema),
  illnesses: z.array(IllnessSchema),
  /** The activities planned for each month. Repeats until changed; one-off activities drop out. */
  routine: z.array(RoutineSlotSchema),
  job: z
    .strictObject({ id: z.string().min(1), sinceTick: z.number().int(), months: z.number().int() })
    .nullable(),
  /** Owed to a loan shark, in Berries. Cash (`berries`) that falls below zero becomes debt. */
  debt: z.number(),
  /** In a cell until this tick (exclusive): activities are locked. */
  jailedUntil: z.number().int().nullable(),
  /** The last month a debt collector called. */
  collectorTick: z.number().int().nullable(),
  /** The gang the character runs with, if any. */
  gang: z.string().nullable(),
  /** Children on the way: born at these ticks. */
  expecting: z.array(z.number().int()),
  /** The highest value each stat reached (for the life recap). */
  peak: z.record(z.string(), z.number()),
  /** Notable deeds, for the life recap. */
  deeds: z.array(z.strictObject({ tick: z.number().int(), text: z.string() })),
  /** Which life in a line of lives this is (1 for the first). */
  generation: z.number().int().min(1),
  /** The character played before this one, when the player continued as someone. */
  predecessorId: z.string().optional(),
  report: MonthReportSchema.nullable(),
});
export type LifeData = z.infer<typeof LifeSchema>;

export const TRAVEL_MODE_IDS = ['own', 'crew', 'passenger', 'stowaway', 'marine', 'foot'] as const;
export const ORDER_IDS = ['hold', 'push', 'resupply', 'detour', 'turn_back'] as const;

/** The state of a vessel at sea: a hired ship's, or a snapshot of the player's own (Phase 3). */
export const VesselStateSchema = z.strictObject({
  /** "the Gull's Rest" */
  name: z.string().min(1),
  /** A vessel id from data/vessels. */
  vessel: z.string().min(1),
  hull: z.number(),
  maxHull: z.number(),
  speed: z.number(),
  /** Hired hands aboard (not counting the player). */
  crew: z.number().int().min(0),
  morale: z.number(),
  /** Person-months of stores. */
  supplies: z.number(),
  /** Who commands her, when it is not the player. */
  captain: z.string().optional(),
});
export type VesselState = z.infer<typeof VesselStateSchema>;

/** A trip between two places along one lane (Phase 3). */
export const VoyageSchema = z.strictObject({
  lane: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(TRAVEL_MODE_IDS),
  /** Total sea miles, and how many are behind the ship. */
  miles: z.number().min(0),
  done: z.number().min(0),
  startTick: z.number().int(),
  /** Months the planner estimated at departure, and months sailed so far. */
  estimate: z.number().int().min(1),
  months: z.number().int().min(0),
  /** The captain's standing order (own ship); others follow their captain. */
  order: z.enum(ORDER_IDS),
  /** The ship carrying a passenger, hand, stowaway or recruit. Null on the player's own ship. */
  vessel: VesselStateSchema.nullable(),
  /** The player's own ship entity, when they captain it. */
  shipId: z.string().nullable(),
  /** Fare a month (passenger). */
  fare: z.number().min(0),
  /** A stowaway who has been found out. */
  discovered: z.boolean(),
});
export type Voyage = z.infer<typeof VoyageSchema>;

/** Where the person being played has been, and what they carry to find their way (Phase 3). */
export const TravelSchema = z.strictObject({
  /** The month they reached the place they are at (the Log Pose sets from then). */
  arrivedTick: z.number().int(),
  /** Places they have stood on, in order of first visit. */
  visited: z.array(z.string()),
  logPose: z.boolean(),
  /** Places an Eternal Pose of theirs points to. */
  eternalPoses: z.array(z.string()),
  voyage: VoyageSchema.nullable(),
  /** The name of the last ship they sailed in ({ship} in text after arriving). */
  lastShip: z.string().optional(),
});
export type TravelData = z.infer<typeof TravelSchema>;

/** A power track as one person stands on it (Phase 4): the stage reached and the progress made. */
export const TrackStateSchema = z.strictObject({
  /** Index of the stage reached (0: the first). */
  stage: z.number().int().min(0),
  /** Cumulative progress: practice points, or fruit mastery (0 to 100). */
  progress: z.number().min(0),
  /** A breakthrough is banked: the next plateau may open. */
  breakthrough: z.boolean(),
  since: z.number().int(),
  lastUsed: z.number().int(),
  /** Months practised, all told. */
  months: z.number().int().min(0),
  /** The teacher multiplier of whoever took them on (absent: self-taught). */
  teacherMult: z.number().min(1).optional(),
  /** Where they were taught (a location id): a stage that needs a teacher can be reached there. */
  taughtAt: z.string().optional(),
});
export type TrackState = z.infer<typeof TrackStateSchema>;

/** One technique a fighter knows, with its own mastery and use (Phase 4). */
export const MoveSchema = z.strictObject({
  /** A technique id from data, a fruit's, or an invented one's ("tech_custom_000003"). */
  id: z.string().min(1),
  /** The player's own name for it, when renamed. */
  name: z.string().min(1).max(60).optional(),
  /** "fruit", "track:track_swordsmanship", "custom", "combo". */
  source: z.string().min(1),
  /** 0 to 100: how sharp it is. */
  mastery: z.number().min(0).max(100),
  uses: z.number().int().min(0),
  learnedTick: z.number().int(),
  lastUsed: z.number().int().nullable(),
  /** Unused for years: forgotten until practised again. */
  faded: z.boolean(),
  /** Invented, combined and generated techniques carry their whole definition. */
  def: TechniqueDefSchema.optional(),
  /** A combination technique's partner. */
  partnerId: z.string().optional(),
});
export type Move = z.infer<typeof MoveSchema>;

/** Everything about a person's powers (Phase 4, save version 5). */
export const PowersSchema = z.strictObject({
  /** Open power tracks: haki colours, the fruit's type, styles, swords. */
  tracks: z.record(z.string(), TrackStateSchema),
  /** The track open practice and sparring go to. */
  focus: z.string().nullable(),
  /** The Devil Fruit eaten (a fruit entity id), and how well it is known. */
  fruit: z
    .strictObject({
      id: z.string().min(1),
      eatenTick: z.number().int(),
      /** They know which fruit it is (by name). */
      identified: z.boolean(),
      /** The month they finally understand what it does (an unknown fruit: 1 to 6 months). */
      knownAt: z.number().int().nullable(),
      awakened: z.boolean(),
      /** Its deeper truth found (another name, a new branch). */
      secret: z.boolean(),
      /** A SMILE that did not work: they can only smile. */
      dud: z.boolean(),
    })
    .nullable(),
  /** Haki stamina left this month (the pool is a derived value). */
  stamina: z.number().min(0),
  moves: z.array(MoveSchema),
  /** Techniques being invented: each month of practice rolls for success, like a breakthrough. */
  drafts: z.array(
    z.strictObject({
      def: TechniqueDefSchema,
      source: z.string().min(1),
      attempts: z.number().int().min(0),
      sinceTick: z.number().int(),
    }),
  ),
  /** Power events (POWER_EVENTS) and the month each last happened. */
  events: z.record(z.string(), z.number().int()),
  /** Entities carried: uneaten fruits, the fruit encyclopedia. */
  items: z.array(z.string()),
  /** Simple gear (swords, a gun, a bow): Phase 6 turns these into items. */
  gear: z.record(z.string(), z.number().int().min(0)),
  /** What they know of fruits: entity id -> what, where, whose (rule 4: knowledge, not truth). */
  known: z.record(
    z.string(),
    z.strictObject({
      tick: z.number().int(),
      place: z.string().nullable(),
      userId: z.string().nullable(),
      identified: z.boolean(),
    }),
  ),
  /** Rumours heard. `fruitId` is the truth behind it, or null for a false one (never shown). */
  rumours: z.array(
    z.strictObject({
      tick: z.number().int(),
      fruitId: z.string().nullable(),
      name: z.string().min(1),
      place: z.string().min(1),
    }),
  ),
});
export type PowersData = z.infer<typeof PowersSchema>;

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
  /** The life loop (save version 3): present on the person being played, and on past players. */
  life: LifeSchema.optional(),
  /** Where they are (save version 4): a location id. Absent: their birthplace's place on the map. */
  place: z.string().min(1).optional(),
  /** The player's travels (save version 4). */
  travel: TravelSchema.optional(),
  /** A Tier 2 person's goal in life, and what they last chose to do (save version 4). */
  npc: z
    .strictObject({
      goal: z.string().min(1),
      last: z.string().optional(),
      crewId: z.string().optional(),
    })
    .optional(),
  /** When and how each trait was gained (save version 5): "Born with it", "A brawl in 1497 SC". */
  traitInfo: z
    .record(z.string(), z.strictObject({ tick: z.number().int(), source: z.string().min(1) }))
    .optional(),
  /** Hidden personality counters and behaviour counters (save version 5; rule 4: never shown). */
  personality: z
    .strictObject({
      axes: z.record(z.string(), z.number()),
      counters: z.record(z.string(), z.number()),
    })
    .optional(),
  /** Haki, the Devil Fruit, styles and techniques (save version 5). */
  powers: PowersSchema.optional(),
});
export type CharacterData = z.infer<typeof CharacterSchema>;

/** A place on the map, as it stands in the world (save version 4): who holds it, who lives there. */
export const PlaceStateSchema = z.strictObject({
  /** The faction that holds it, or null. */
  controller: z.string().nullable(),
  /** 0 to 100: prices, wages and the mood of the place (rule 3: a Stat with its causes). */
  prosperity: StatSchema,
  /** Tier 3: everyone not individually simulated, as numbers. */
  residents: z.strictObject({
    children: z.number().min(0),
    adults: z.number().min(0),
    elders: z.number().min(0),
  }),
  /** Tier 3 adults by occupation id. */
  jobs: z.record(z.string(), z.number().min(0)),
});
export type PlaceState = z.infer<typeof PlaceStateSchema>;

/** A faction or crew as it stands (save version 4). Its strength is the entity's `strength` stat. */
export const OrgStateSchema = z.strictObject({
  kind: z.string().min(1),
  active: z.boolean(),
  /** The captain or leader (a character id), when it has one. */
  leaderId: z.string().nullable(),
  /** Named members (generated crews). */
  members: z.array(z.string()),
  /** Its opinion of other factions: base plus modifiers (rule 3). */
  opinions: z.record(z.string(), StatSchema),
  umbrella: z.string().nullable(),
  home: z.string().nullable(),
  foundedTick: z.number().int(),
  endedTick: z.number().int().nullable(),
});
export type OrgState = z.infer<typeof OrgStateSchema>;

/** A ship as it stands (save version 4). Speed, hull and cargo are the entity's stats. */
export const ShipStateSchema = z.strictObject({
  vessel: z.string().min(1),
  ownerId: z.string().nullable(),
  /** Where it is moored; null while at sea. */
  place: z.string().nullable(),
  hull: z.number(),
  crew: z.number().int().min(0),
  morale: z.number(),
  supplies: z.number(),
  coated: z.boolean(),
  sunk: z.boolean(),
});
export type ShipState = z.infer<typeof ShipStateSchema>;

/**
 * A Devil Fruit as it stands in the world (save version 5): one entity per fruit (rule 2), so only
 * one copy of a fruit can exist. Where it is and whose it is are truths; who knows them is the
 * entity's `knownBy` and each person's `powers.known` (rule 4).
 */
export const FruitStateSchema = z.strictObject({
  /** The catalogue fruit (data/fruits). A generated fruit carries its whole `def` instead. */
  defId: z.string().min(1),
  def: FruitDefSchema.optional(),
  container: z.enum(FRUIT_CONTAINERS),
  /** Who ate it: an entity (a person, or an object or animal with a body). */
  userId: z.string().nullable(),
  /** A canon user the world does not simulate, known only by name. */
  userName: z.string().nullable(),
  /** Who carries it uneaten. */
  holderId: z.string().nullable(),
  /** Where it lies (a location id) when nobody has it. */
  place: z.string().nullable(),
  /** On a black market: its price in Berries. */
  price: z.number().int().nullable(),
  /** Canon fruits: the next canon holder in data/fruits whose turn has not come. */
  canonNext: z.number().int().min(0),
  /** The month it last grew again in an ordinary fruit (rebirth), or was made. */
  bornTick: z.number().int(),
  /** An unnamed or off-screen user dies this month, and the fruit returns to the world. */
  userUntil: z.number().int().nullable(),
  /** A canon handover waiting for the fruit to come free, since this month. */
  waitingSince: z.number().int().nullable(),
  /** What it looks like, swirls and all. */
  look: z.string().min(1),
  history: z.array(z.strictObject({ tick: z.number().int(), text: z.string().min(1) })),
});
export type FruitState = z.infer<typeof FruitStateSchema>;

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
  /** Phase 3: present on locations, organizations and ships. */
  place: PlaceStateSchema.optional(),
  org: OrgStateSchema.optional(),
  ship: ShipStateSchema.optional(),
  /** Phase 4: present on fruit entities. */
  fruit: FruitStateSchema.optional(),
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
  /**
   * Phase 3: "full" fills the world with about 2,000 named Tier 2 people; "none" keeps only the
   * canon cast and the places' numbers (headless balancing runs, and tests of other systems).
   */
  population: z.enum(['full', 'none']),
});
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

/** The configuration of a world made without character creation (and of every save before version 2). */
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  canonMode: 'canon',
  difficulty: 'normal',
  rareRaces: false,
  population: 'full',
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
  /** Where it happened (save version 4). Absent: news without a place, heard at once. */
  place: z.string().nullable().optional(),
  /** The month the player hears it; null while they are at sea and it has not reached them. */
  reachTick: z.number().int().nullable().optional(),
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
  /** Who the event cast in its roles, and where it happened (save version 4). */
  roles: z.record(z.string(), z.string()).optional(),
  place: z.string().optional(),
  /** A canon beat waiting on the player's part in it (save version 4). */
  beat: z.boolean().optional(),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const BeatStateSchema = z.strictObject({
  status: z.enum(['pending', 'fired', 'diverged']),
  /** When it fired or diverged. */
  tick: z.number().int().optional(),
  /** A role-holder is on the way: the beat waits until this month. */
  delayedTo: z.number().int().optional(),
  /** Who stood in for whom: role -> character id. */
  cast: z.record(z.string(), z.string()).optional(),
  /** The log record of its firing or divergence. */
  seq: z.number().int().min(0).optional(),
});
export type BeatState = z.infer<typeof BeatStateSchema>;

/** One line of the Divergence Log: how and why the world left the story. */
export const DivergenceSchema = z.strictObject({
  tick: z.number().int(),
  kind: z.enum([
    'cancelled',
    'missed',
    'player',
    'substituted',
    'delayed',
    'early-death',
    'requirement',
    /** Phase 4: a canon user did not get their Devil Fruit (someone else ate it first). */
    'fruit',
  ]),
  beat: z.string().optional(),
  entity: z.string().optional(),
  text: z.string(),
  causeSeq: z.number().int().min(0).optional(),
});
export type Divergence = z.infer<typeof DivergenceSchema>;

export const CanonStateSchema = z.strictObject({
  beats: z.record(z.string(), BeatStateSchema),
  divergences: z.array(DivergenceSchema),
});
export type CanonState = z.infer<typeof CanonStateSchema>;

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
    /** The canon layer (save version 4). */
    canon: CanonStateSchema,
    /** Event id -> the month it last fired and how often (save version 4). */
    eventState: z.record(
      z.string(),
      z.strictObject({ last: z.number().int(), count: z.number().int().min(0) }),
    ),
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
