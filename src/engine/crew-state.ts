import { z } from 'zod';

/**
 * The saved shape of a crew (Phase 8, save version 9): every group the player leads, built in one
 * creator, is an organization entity carrying a `crew` block. It lives apart from state.ts the way
 * battle-state.ts does, so the systems that read it do not pull in the whole world schema.
 *
 * Who is in a crew is the members list; how each feels about the captain stays on their
 * relationship (Phase 7's crewmate bars: Loyalty, Morale, Respect, Belonging), so one number is
 * never kept in two places.
 */

export const CREW_SITUATIONS = ['sea', 'battle', 'port', 'storm'] as const;
export type CrewSituation = (typeof CREW_SITUATIONS)[number];

/** A crewmate's personal story (data/arcs): which step they are on, and where it points. */
export const ArcStateSchema = z.strictObject({
  id: z.string().min(1),
  step: z.number().int().min(0),
  /** The month the current step began. */
  since: z.number().int(),
  /** Where the step points (a location id), when it points somewhere. */
  place: z.string().nullable(),
  /** A stat's value to reach, Berries to pay, talks to have: the step's own number. */
  goal: z.number().nullable(),
  done: z.boolean(),
  doneTick: z.number().int().optional(),
});
export type ArcState = z.infer<typeof ArcStateSchema>;

export const CrewMemberSchema = z.strictObject({
  id: z.string().min(1),
  /** Their role (data/crew.json roles): what they are good at. */
  role: z.string().min(1),
  joined: z.number().int(),
  /** A ranked crew's chart (a Marine unit's ranks): index into the kind's ranks. */
  rank: z.number().int().min(0),
  /** An officer (first mate, quartermaster, a division's commander): raises the crew's limit. */
  officer: z.boolean(),
  /** A numbered division they serve in, when the crew has divisions. */
  division: z.number().int().min(0).nullable(),
  /** Joined only to be carried somewhere (a joining condition): leaves there unless won over. */
  bound: z.string().nullable(),
  /** Role skill, 0 to 100, for each role they have served in. */
  mastery: z.record(z.string(), z.number().min(0).max(100)),
  /** Months served at each post ("sea:helm"). */
  served: z.record(z.string(), z.number().int().min(0)),
  titles: z.array(z.string()),
  /** Their monthly regimen: what to train (a stat or a track), how hard, and with whom. */
  plan: z
    .strictObject({
      focus: z.string().min(1),
      effort: z.enum(['light', 'normal', 'hard']),
      partner: z.string().nullable(),
    })
    .nullable(),
  /** Sent away on a mission until a month. */
  away: z
    .strictObject({
      mission: z.string().min(1),
      target: z.string().nullable(),
      since: z.number().int(),
      until: z.number().int(),
      seq: z.number().int().min(0).optional(),
    })
    .nullable(),
  arcs: z.array(ArcStateSchema),
  pinned: z.boolean(),
  /** Tracks a crewmate taught them: track id -> the teacher's id. */
  taught: z.record(z.string(), z.string()),
  /** Hurt in the crew's fights: out of the line-up until a month. */
  hurtUntil: z.number().int().nullable(),
});
export type CrewMember = z.infer<typeof CrewMemberSchema>;

export const FleetEntrySchema = z.strictObject({
  /** The subordinate crew (an organization entity) and its captain. */
  crewId: z.string().min(1),
  captainId: z.string().min(1),
  /** 0 to 100: how firmly they hold to the oath of the sake cups. */
  loyalty: z.number().min(0).max(100),
  /** 0 to 100: how much they want a fleet of their own. */
  ambition: z.number().min(0).max(100),
  order: z.string().min(1),
  since: z.number().int(),
  /** A place the order points at (hold, patrol, raid). */
  target: z.string().nullable(),
});
export type FleetEntry = z.infer<typeof FleetEntrySchema>;

export const AllianceSchema = z.strictObject({
  captainId: z.string().min(1),
  goal: z.string().min(1),
  /** The goal's place or person, when it names one. */
  target: z.string().nullable(),
  since: z.number().int(),
  status: z.enum(['holding', 'met', 'broken']),
  ended: z.number().int().nullable(),
});
export type Alliance = z.infer<typeof AllianceSchema>;

export const BaseSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  place: z.string().min(1),
  /** Room id -> level (1 built; higher, improved). */
  rooms: z.record(z.string(), z.number().int().min(1)),
  since: z.number().int(),
  lastRaid: z.number().int().nullable(),
  /** 0 to 100: the walls and the guard. Raids take it down; months build it back. */
  defence: z.number().min(0).max(100),
});
export type Base = z.infer<typeof BaseSchema>;

export const PrisonerSchema = z.strictObject({
  id: z.string().min(1),
  since: z.number().int(),
  where: z.enum(['ship', 'base']),
  /** Berries asked for them. */
  ransom: z.number().int().min(0),
  interrogated: z.boolean(),
});
export type Prisoner = z.infer<typeof PrisonerSchema>;

export const CrewStateSchema = z.strictObject({
  /** data/crew.json kinds: pirate, marine, mercenary, hunter, revolutionary, cipher... */
  kind: z.string().min(1),
  leaderId: z.string().min(1),
  /** The Jolly Roger, emblem or house mark, in words (the Phase 14 designer draws it). */
  symbol: z.string(),
  colours: z.string(),
  dress: z.string(),
  /** Creed rule id -> the option chosen. */
  creed: z.record(z.string(), z.string()),
  command: z.string().min(1),
  structure: z.string().min(1),
  pay: z.string().min(1),
  home: z.strictObject({ kind: z.enum(['ship', 'base', 'none']), id: z.string().nullable() }),
  foundedTick: z.number().int(),
  members: z.array(CrewMemberSchema),
  /** Who served and is gone: left, deserted, died, retired. */
  former: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      tick: z.number().int(),
      why: z.string().min(1),
    }),
  ),
  /** Situation -> post id -> who stands there (one person; two posts held at once is double duty). */
  lineups: z.record(z.string(), z.record(z.string(), z.string())),
  /** "sea:helm": a post the auto-fill must not change. */
  locks: z.record(z.string(), z.boolean()),
  /** Fill the posts by role every month (the watch rota fills itself). */
  auto: z.boolean(),
  /** 0 to 100: the group's mood (Phase 7's group morale), from its members'. */
  morale: z.number().min(0).max(100),
  /** The common purse: loot banked, pay drawn from it. */
  treasury: z.number().int(),
  /** Months the pay has not been met. */
  unpaid: z.number().int().min(0),
  traditions: z.array(
    z.strictObject({ id: z.string().min(1), since: z.number().int(), last: z.number().int() }),
  ),
  /** The captain's log, written by itself (rule 6): voyages, battles, who joined, left, died. */
  log: z.array(z.strictObject({ tick: z.number().int(), text: z.string().min(1) })),
  /** Votes the captain overruled: a crew remembers being ignored. */
  ignored: z.number().int().min(0),
  divisions: z.array(
    z.strictObject({ name: z.string().min(1), commanderId: z.string().nullable() }),
  ),
  fleet: z.array(FleetEntrySchema),
  alliances: z.array(AllianceSchema),
  bases: z.array(BaseSchema),
  prisoners: z.array(PrisonerSchema),
  /** Tallies for the crew page: battles won and lost, voyages, missions. */
  tally: z.record(z.string(), z.number()),
});
export type CrewState = z.infer<typeof CrewStateSchema>;

/** A candidate's side of being recruited: what has been tried, what they asked for (save v9). */
export const RecruitStateSchema = z.strictObject({
  /** Pitches tried on them, and the month of the last refusal. */
  pitched: z.array(z.string()),
  refused: z.number().int().nullable(),
  /** What the player had to show at the last refusal (fame tier, deeds): new things reopen it. */
  refusedWith: z.number().int().nullable(),
  /** Objection id -> answered. */
  objections: z.record(z.string(), z.boolean()),
  /** A pitch landed: they are listening. */
  listening: z.boolean(),
  /** Their joining condition, once they named it: a personal quest with a tracker. */
  quest: z
    .strictObject({
      id: z.string().min(1),
      since: z.number().int(),
      /** What the quest points at: a place, a person, an amount, a number to reach. */
      place: z.string().nullable(),
      target: z.string().nullable(),
      amount: z.number(),
      /** Lessons given, a fight won, a debt paid: how far along it is. */
      progress: z.number(),
      status: z.enum(['open', 'met', 'failed']),
      /** The moment's month, for a condition that only comes at a dramatic turn. */
      at: z.number().int().nullable(),
    })
    .nullable(),
  promised: z.array(z.string()),
});
export type RecruitState = z.infer<typeof RecruitStateSchema>;

/** The world's recruiting grounds (save v9): boards, prisons, auctions, hidden legends. */
export const CrewWorldSchema = z.strictObject({
  /** Place -> the "Looking for a ship" list: who, made which quarter. */
  boards: z.record(
    z.string(),
    z.strictObject({ tick: z.number().int(), ids: z.array(z.string()) }),
  ),
  prisons: z.record(
    z.string(),
    z.strictObject({ tick: z.number().int(), ids: z.array(z.string()) }),
  ),
  auctions: z.record(
    z.string(),
    z.strictObject({ tick: z.number().int(), ids: z.array(z.string()) }),
  ),
  /** The extraordinary people each world hides, found only by rumour and exploring. */
  legends: z.array(z.string()),
});
export type CrewWorld = z.infer<typeof CrewWorldSchema>;
