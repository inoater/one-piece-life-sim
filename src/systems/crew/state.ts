import type { CrewKind, GameData } from '../../engine/data/schemas';
import { Rng as RngClass, type Rng } from '../../engine/rng';
import { makeStat, STAT_IDS } from '../../engine/stats';
import type { CrewMember, CrewState, Entity, WorldState } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { capitalize } from '../genesis/text';
import { moveBar, pairOf, readBar, relOf } from '../heart/bonds';
import { heartVars } from '../heart/speech';
import { reputationValue, statTotal } from '../life/body';
import { locationIdOf } from '../places/place';

/**
 * A crew as the rest of the crew code sees it (Phase 8): which crew someone leads, who is in it,
 * how many it can hold, and how each member feels (their crewmate bars, Phase 7). Every group the
 * player leads (a pirate crew, a Marine unit, a mercenary company, a Revolutionary cell...) is an
 * organization entity with a `crew` block; a member carries `crew.of` (their captain, as Phase 7
 * already did) and `crew.id` (the crew).
 */

export class CrewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrewError';
  }
}

/** On a leader: the crew they lead. */
export const LEADS = 'crew.leads';
/** On a member: their captain (Phase 7's flag). */
export const CAPTAIN = 'crew.of';
/** On a member: the crew. */
export const IN_CREW = 'crew.id';

export function crewEntity(state: WorldState, id: string | null | undefined): Entity | null {
  const e = id ? state.entities[id] : undefined;
  return e?.crew ? e : null;
}

/** The crew someone leads, if any. */
export function crewLedBy(state: WorldState, leader: Entity | null | undefined): Entity | null {
  const id = leader?.flags[LEADS];
  return typeof id === 'string' ? crewEntity(state, id) : null;
}

export function playerCrew(state: WorldState): Entity | null {
  return crewLedBy(state, state.playerId ? state.entities[state.playerId] : null);
}

export function crewOfEntity(crew: Entity): CrewState {
  if (!crew.crew) throw new CrewError(`${crew.id} is not a crew`);
  return crew.crew;
}

export function memberRecord(crew: CrewState, id: string): CrewMember | undefined {
  return crew.members.find((m) => m.id === id);
}

export interface MemberAt {
  member: CrewMember;
  entity: Entity;
}

/** The living members, in the order they joined. */
export function membersOf(state: WorldState, crew: CrewState): MemberAt[] {
  const out: MemberAt[] = [];
  for (const member of crew.members) {
    const entity = state.entities[member.id];
    if (entity?.character?.alive) out.push({ member, entity });
  }
  return out;
}

/** Members aboard and fit to stand a post: not away on a mission, not laid up. */
export function onHand(state: WorldState, crew: CrewState, tick: number): MemberAt[] {
  return membersOf(state, crew).filter(
    ({ member }) => member.away === null && (member.hurtUntil === null || member.hurtUntil <= tick),
  );
}

export function kindOf(data: GameData, crew: CrewState): CrewKind {
  const kind = data.crew.kinds.find((k) => k.id === crew.kind) ?? data.crew.kinds[0];
  if (!kind) throw new CrewError('data/crew.json has no kinds');
  return kind;
}

export function byId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  return list.find((x) => x.id === id);
}

/** Fame tiers passed (data/crew.json limits): 0 for nobody, up to the number of thresholds. */
export function fameTier(data: GameData, entity: Entity, tick: number): number {
  const fame = reputationValue(entity, 'fame', tick);
  return data.crew.limits.fameTiers.filter((t) => fame >= t).length;
}

export interface LimitPart {
  source: string;
  value: number;
}

/**
 * How many will follow the leader before morale strains (the plan's design value):
 * 6 + Charisma / 10 + 4 per fame tier, raised by officers and divisions.
 */
export function crewLimit(
  state: WorldState,
  data: GameData,
  leader: Entity,
  crew: CrewState,
): { limit: number; parts: LimitPart[] } {
  const rules = data.crew.limits;
  const tick = state.tick;
  const structure = byId(data.crew.structures, crew.structure);
  const officers = crew.members.filter((m) => m.officer).length;
  const parts: LimitPart[] = [
    { source: 'A core crew', value: rules.base },
    {
      source: 'Your Charisma',
      value: Math.floor(statTotal(leader, 'charisma', tick) * rules.perCharisma),
    },
    { source: 'Your fame', value: fameTier(data, leader, tick) * rules.perFameTier },
  ];
  if (structure && officers > 0)
    parts.push({
      source: 'Officers',
      value: Math.round(Math.min(officers, structure.officers) * structure.perOfficer),
    });
  if (structure && crew.divisions.length > 0)
    parts.push({
      source: 'Divisions',
      value: Math.round(
        Math.min(crew.divisions.length, structure.divisions) * structure.perDivision,
      ),
    });
  return { limit: parts.reduce((n, p) => n + p.value, 0), parts };
}

/** A member's crewmate bar toward the captain (Loyalty, Morale, Belonging; Respect is an axis). */
export function barOf(
  state: WorldState,
  data: GameData,
  leader: Entity,
  other: Entity,
  bar: 'loyalty' | 'morale' | 'belonging' | 'respect',
): number {
  const theirs = relOf(other, leader.id);
  return theirs ? readBar(data, theirs, 'crewmate', bar, state.tick) : 0;
}

export const loyaltyOf = (state: WorldState, data: GameData, leader: Entity, other: Entity) =>
  barOf(state, data, leader, other, 'loyalty');

/** Move one of their crewmate bars, named for its cause and traced to a record (rule 3, rule 6). */
export function moveCrewBar(
  data: GameData,
  leader: Entity,
  other: Entity,
  bar: 'loyalty' | 'morale' | 'belonging',
  by: number,
  source: string,
  seq: number | undefined,
  tick: number,
): void {
  if (by === 0) return;
  const pair = pairOf(leader, other, false);
  if (!pair) return;
  moveBar(data, pair.theirs, 'crewmate', bar, by, source, seq, tick);
}

/** A line in the captain's log (it writes itself: voyages, battles, who joined, left, died). */
export function crewLog(crew: CrewState, tick: number, text: string): void {
  crew.log.push({ tick, text });
  if (crew.log.length > 200) crew.log.splice(0, crew.log.length - 200);
}

export function bountyOf(entity: Entity | undefined): number {
  const b = entity?.flags['bounty'];
  return typeof b === 'number' ? b : 0;
}

export function crewLine(data: GameData, id: string): string {
  const text = data.crew.lines[id];
  if (text === undefined) throw new CrewError(`data/crew.json has no line "${id}"`);
  return text;
}

export interface CrewExtra {
  role?: string;
  post?: string;
  mission?: string;
  target?: string;
  report?: string;
  quest?: string;
  arc?: string;
  other?: string;
  epithet?: string;
  bounty?: string;
  months?: string;
  count?: string;
  place?: string;
  amount?: string;
}

/** A crew line, in a crewmate's voice when it names one (rule 1: the words are data). */
export function renderCrew(
  state: WorldState,
  data: GameData,
  crew: Entity | null,
  speaker: Entity | null,
  template: string,
  rng: Rng,
  extra: CrewExtra = {},
): string {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const base: Record<string, string> = speaker
    ? heartVars(state, data, speaker, rng, { amount: extra.amount ?? '0' })
    : heartVars(state, data, player ?? (crew as Entity), rng, { amount: extra.amount ?? '0' });
  const vars: Record<string, string> = {
    ...base,
    crew: crew?.name ?? 'crew',
    captain: player?.name ?? 'the captain',
    role: extra.role ?? 'a hand',
    post: extra.post ?? 'a post',
    mission: extra.mission ?? 'the mission',
    target: extra.target ?? 'someone',
    report: extra.report ?? 'nothing to report',
    quest: extra.quest ?? 'something',
    arc: extra.arc ?? 'their story',
    other: extra.other ?? 'someone',
    epithet: extra.epithet ?? 'the Nameless',
    bounty: extra.bounty ?? '0',
    months: extra.months ?? '0',
    count: extra.count ?? '0',
  };
  if (extra.place !== undefined) vars['place'] = extra.place;
  // A crew named "The Rook Pirates" mid-sentence reads "the Rook Pirates".
  vars['crew'] = vars['crew']?.replace(/^The /, '') ?? 'crew';
  return capitalize(renderTemplate(template, vars));
}

export function placeName(data: GameData, id: string | null | undefined): string {
  return id ? (data.locations[id]?.name ?? id) : 'the open sea';
}

export function roleName(data: GameData, id: string): string {
  return byId(data.crew.roles, id)?.name ?? id;
}

/** Where someone stands on the map (their birthplace's node until they have moved); null at sea. */
export function hereOf(data: GameData, entity: Entity | null | undefined): string | null {
  const c = entity?.character;
  return c ? locationIdOf(data, c) : null;
}

/**
 * The body of numbers someone would have (Phase 2's friends and Phase 1's family were never given
 * one): rolled from a stream keyed to their id, the way Phase 3 makes its named people, so a view
 * can read it without storing it and joining stores exactly the same.
 */
export function bodyStats(data: GameData, entity: Entity, tick: number): Entity['stats'] {
  const c = entity.character;
  const out: Entity['stats'] = {};
  if (!c) return out;
  const age = Math.max(0, (tick - c.birthTick) / 12);
  const grown = Math.min(1, Math.max(0.15, age / 20));
  for (const id of STAT_IDS) {
    if (entity.stats[id] || id === 'luck') continue;
    const mental = (data.character.mental as readonly string[]).includes(id);
    const base = RngClass.root(`body:${entity.id}`).fork(id).normal(38, 9) * (mental ? 1 : grown);
    out[id] = makeStat(Math.round(Math.max(3, Math.min(95, base)) * 10) / 10);
  }
  return out;
}

/** Them, with that body filled in where they have none (a copy: nothing is stored). */
export function withBody(data: GameData, entity: Entity, tick: number): Entity {
  const extra = bodyStats(data, entity, tick);
  return Object.keys(extra).length === 0
    ? entity
    : { ...entity, stats: { ...entity.stats, ...extra } };
}
