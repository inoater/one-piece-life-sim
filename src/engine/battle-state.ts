import { z } from 'zod';

/**
 * A battle as it stands (Phase 5, save version 6). Only the player's own tactical fight is ever
 * saved (it waits for their next action, the way a decision does); every other fight is resolved
 * within the month and leaves only its log lines and consequences.
 *
 * A fighter is a snapshot of a person for the length of a fight: their numbers are worked out once
 * when it starts (rule 3: from the stats and modifiers they had then) and change only by what
 * happens in it. `entityId` points back to the person; nameless foes (a thug, a gunner) have none.
 */

const VERBS = [
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
const INTENTS = ['spare', 'capture', 'kill'] as const;
const ROLES = ['vanguard', 'striker', 'guard', 'support', 'ranged', 'commander'] as const;
const ZONES = ['front', 'middle', 'rear', 'high', 'rigging', 'water'] as const;
const ORDERS = [
  'none',
  'focus',
  'protect',
  'fall_back',
  'swap',
  'combo',
  'rally',
  'retreat',
] as const;
const DOWN = ['ko', 'dead', 'fled', 'captured', 'surrendered', 'yielded'] as const;

export const FighterMoveSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  form: z.string().nullable(),
  tags: z.array(z.string()),
  effects: z.array(z.string()),
  power: z.number(),
  accuracy: z.number(),
  cost: z.number(),
  range: z.string(),
  source: z.string(),
  signature: z.boolean(),
  finisher: z.boolean(),
  /** A combination technique: the partner it needs standing. */
  partner: z.string().optional(),
});
export type FighterMove = z.infer<typeof FighterMoveSchema>;

export const FighterSchema = z.strictObject({
  id: z.string().min(1),
  entityId: z.string().nullable(),
  name: z.string().min(1),
  pronouns: z.enum(['he', 'she', 'they']),
  side: z.union([z.literal(0), z.literal(1)]),
  player: z.boolean(),
  intent: z.enum(INTENTS),
  role: z.enum(ROLES),
  zone: z.enum(ZONES),
  /** Combat Power, and power over what their stats alone give (every blow is scaled by it). */
  cp: z.number(),
  k: z.number(),
  /** Raw stats when the fight began. */
  stats: z.record(z.string(), z.number()),
  hp: z.number(),
  maxHp: z.number(),
  stamina: z.number(),
  maxStamina: z.number(),
  haki: z.number(),
  maxHaki: z.number(),
  /** Haki stages reached (0: asleep). */
  armament: z.number().int().min(0),
  observation: z.number().int().min(0),
  conqueror: z.number().int().min(0),
  fruit: z
    .strictObject({
      name: z.string(),
      power: z.string(),
      type: z.string(),
      logia: z.boolean(),
      /** Their fruit's primitives and its techniques' tags: what matchups read. */
      tags: z.array(z.string()),
      weaknesses: z.array(z.string()),
    })
    .nullable(),
  /** Sea water or seastone: the fruit is gone and every stat is down. */
  cursed: z.boolean(),
  /** Fish-Men and Merfolk: at home in the water. */
  swimmer: z.boolean(),
  weapon: z
    .strictObject({
      name: z.string(),
      kind: z.string(),
      attack: z.number(),
      /** Save version 7: accuracy from skill, haki an untamed hungry blade drinks, the items. */
      accuracy: z.number().optional(),
      drain: z.number().optional(),
      items: z.array(z.string()).optional(),
    })
    .nullable(),
  /** Save version 7: armour worn (added to defence; none in the water). */
  armour: z.number().optional(),
  seastone: z.boolean(),
  temperament: z.enum(['aggressive', 'cautious', 'balanced']),
  moves: z.array(FighterMoveSchema),
  status: z.strictObject({
    coated: z.number().int().min(0),
    read: z.number().int().min(0),
    guarding: z.boolean(),
    evading: z.boolean(),
    /** Opened by a feint: the next blow from this fighter id ignores the guard. */
    opened: z.string().nullable(),
    pinnedBy: z.string().nullable(),
    pinned: z.number().int().min(0),
    stunned: z.number().int().min(0),
    burning: z.number().int().min(0),
    bleeding: z.number().int().min(0),
    poisoned: z.number().int().min(0),
    blinded: z.number().int().min(0),
    taunted: z.number().int().min(0),
    shrunk: z.number().int().min(0),
    overdrive: z
      .strictObject({
        move: z.string(),
        name: z.string(),
        left: z.number().int().min(0),
        boost: z.number(),
      })
      .nullable(),
    secondWind: z.boolean(),
    /** The ally they stand in front of (the guard role, or a Protect order). */
    protects: z.string().nullable(),
    /** A counter readied: the next blow at them is answered. */
    countering: z.boolean(),
    /** Help called with a Den Den Mushi: arrives on this exchange. */
    callAt: z.number().int().nullable(),
  }),
  down: z.enum(DOWN).nullable(),
  /** Who downed them, and with what share of their Health. */
  downBy: z.string().nullable(),
  totals: z.strictObject({
    dealt: z.number(),
    taken: z.number(),
    hits: z.number().int(),
    /** Each blow worth an injury: its share of max Health (the player's are applied after). */
    wounds: z.array(z.number()),
    used: z.array(z.string()),
    kos: z.number().int(),
  }),
  /** Opinions they hold of allies in this fight (taking the blow, combinations). */
  bonds: z.record(z.string(), z.number()),
  /** Ally ids they could combine with, by technique. */
  combos: z.record(z.string(), z.string()),
  traits: z.array(z.string()),
  /** A nameless foe's template, or a canon or Tier 2 person's notable rank. */
  foe: z.string().optional(),
  criminal: z.boolean(),
  marine: z.boolean(),
  bounty: z.number().min(0),
  fame: z.number(),
  leader: z.boolean(),
  /** Things to use in the fight (data/battle.json `items`), by id. */
  kit: z.record(z.string(), z.number().int().min(0)),
  /** Waiting to tag in (a duel with allies at hand). */
  reserve: z.boolean(),
  /** A crew battle's fighter left off the board: fighting at the fronts, not in a duel. */
  front: z.boolean(),
});
export type Fighter = z.infer<typeof FighterSchema>;

export const BattleSideSchema = z.strictObject({
  name: z.string().min(1),
  morale: z.number(),
  order: z.enum(ORDERS),
  /** The fighter an order names (focus on, protect). */
  target: z.string().nullable(),
  /** The rank and file behind the named fighters (crew battles, wars): how many, how strong. */
  ranks: z.number().min(0),
  rankPower: z.number().min(0),
  broken: z.boolean(),
});
export type BattleSide = z.infer<typeof BattleSideSchema>;

export const ShipInBattleSchema = z.strictObject({
  name: z.string().min(1),
  vessel: z.string().min(1),
  hull: z.number(),
  maxHull: z.number(),
  cannons: z.number().int().min(0),
  speed: z.number(),
  /** Burning: hull lost each round until put out. */
  fire: z.number().int().min(0),
  struck: z.boolean(),
  sunk: z.boolean(),
});
export type ShipInBattle = z.infer<typeof ShipInBattleSchema>;

export const FrontStateSchema = z.strictObject({
  name: z.string().min(1),
  strength: z.tuple([z.number(), z.number()]),
  morale: z.tuple([z.number(), z.number()]),
  /** Fighter ids commanding each side here. */
  commanders: z.tuple([z.string().nullable(), z.string().nullable()]),
  broken: z.tuple([z.boolean(), z.boolean()]),
});
export type FrontState = z.infer<typeof FrontStateSchema>;

export const BattleLineSchema = z.strictObject({
  exchange: z.number().int(),
  text: z.string(),
  tone: z.enum(['good', 'bad', 'plain', 'alert']),
});
export type BattleLine = z.infer<typeof BattleLineSchema>;

export const BattleResultSchema = z.strictObject({
  /** The side that won, or null (a draw, a spar called on time, both fled). */
  winner: z.union([z.literal(0), z.literal(1)]).nullable(),
  /** How it ended for the player's side. */
  how: z.enum(['won', 'lost', 'fled', 'draw']),
  /** A decisive win or a heavy loss (the critical bands of an event's fight). */
  decisive: z.boolean(),
  exchanges: z.number().int(),
});
export type BattleResult = z.infer<typeof BattleResultSchema>;

export const BattleStateSchema = z.strictObject({
  id: z.number().int().min(1),
  scale: z.enum(['duel', 'skirmish', 'crew', 'naval', 'war']),
  mode: z.enum(['tactical', 'quick', 'narrated']),
  /** A spar or a contest's stop rule, if any. */
  stop: z.enum(['first_hit', 'first_knockdown', 'time_limit', 'yield']).nullable(),
  spar: z.boolean(),
  contest: z.string().nullable(),
  water: z.boolean(),
  weather: z.string().nullable(),
  place: z.string().nullable(),
  tick: z.number().int(),
  exchange: z.number().int().min(0),
  maxExchanges: z.number().int().min(1),
  fighters: z.array(FighterSchema),
  sides: z.tuple([BattleSideSchema, BattleSideSchema]),
  /** The player's quick-mode stance. */
  stance: z.string(),
  /** Crew battles: who fights whom (fighter id pairs); the rest join the fronts. */
  board: z.array(z.tuple([z.string(), z.string()])),
  ships: z.array(ShipInBattleSchema),
  range: z.enum(['far', 'near', 'adjacent']).nullable(),
  /** Naval battles open into a crew battle when someone boards. */
  boarded: z.boolean(),
  fronts: z.array(FrontStateSchema),
  /** Wars: the front the player stands on. */
  playerFront: z.number().int().min(0),
  round: z.number().int().min(0),
  log: z.array(BattleLineSchema),
  /** What started it, so its result can be applied when it ends. */
  source: z.strictObject({
    kind: z.enum(['event', 'beat', 'activity', 'contest', 'debug', 'heart']),
    id: z.string().min(1),
    choice: z.string().optional(),
    roles: z.record(z.string(), z.string()).optional(),
    causeSeq: z.number().int().min(0).optional(),
  }),
  /** The decision that holds time still while it lasts. */
  decisionId: z.number().int().nullable(),
  /** The post-fight card (injuries, what it taught, bounty, who saw), once it is over. */
  card: z.array(BattleLineSchema),
  result: BattleResultSchema.nullable(),
});
export type BattleState = z.infer<typeof BattleStateSchema>;

/** A person's fights: their tally, and against whom (Phase 5, save version 6). */
export const FightRecordSchema = z.strictObject({
  won: z.number().int().min(0),
  lost: z.number().int().min(0),
  drawn: z.number().int().min(0),
  spars: z.number().int().min(0),
  /** Other person's id -> [won, lost, drawn] against them. */
  against: z.record(z.string(), z.tuple([z.number().int(), z.number().int(), z.number().int()])),
});
export type FightRecord = z.infer<typeof FightRecordSchema>;

export const BATTLE_VERB_IDS = VERBS;
