import type { Arc, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import { addMod, makeStat, statValue } from '../../engine/stats';
import type { CrewMember, Entity, EventRecord, WorldState } from '../../engine/state';
import { STAT_IDS } from '../../engine/stats';
import { divergeCharacter } from '../canon/cast';
import { sortedValues } from '../genesis/options';
import { markMet, pairOf, relOf } from '../heart/bonds';
import { firstMeeting } from '../heart/meet';
import { relate } from '../life/people';
import { appendLog } from '../../engine/log';
import { setKinds } from '../heart/effects';
import { ensureHeart } from '../heart/profile';
import { lifeLog, reportLine, type LifeEnv } from '../life/env';
import { Rng as RngClass } from '../../engine/rng';
import { bestRole } from './roles';
import {
  hereOf,
  CAPTAIN,
  crewLine,
  crewLog,
  IN_CREW,
  memberRecord,
  moveCrewBar,
  renderCrew,
  roleName,
  type CrewExtra,
  bodyStats,
} from './state';

/**
 * Joining and leaving (Phase 8). Joining makes someone a crewmate both ways (Phase 7's bond and
 * bars), a member of the crew with a role, Tier 1 while they serve (rule 5: they live month by
 * month on the player's rules), with a hidden potential to grow toward and 1 to 3 personal arcs
 * from their backstory and dream. A canon character who joins leaves the story (canon-diverged,
 * logged). Leaving undoes it, and the captain's log remembers both.
 */

/**
 * Meet someone (a name on a board, a freed prisoner, a legend found): the tie both ways, the
 * record of the meeting, first impressions (Phase 7). Nothing if they have met already.
 */
export function meet(env: LifeEnv, other: Entity, opinion = 5): void {
  const { state, data, tick, p } = env;
  if (relOf(p.entity, other.id) || !other.character) return;
  relate(p.entity, other, 'friend', opinion, tick, env.rng.fork('meet', other.id));
  const record = appendLog(state, tick, {
    kind: 'life',
    summary: `You met ${other.name}.`,
    tags: ['personal', 'relationship', 'met'],
    actorIds: [p.entity.id],
    targetIds: [other.id],
    place: hereOf(data, p.entity),
    cause: env.cause,
    knownBy: [p.entity.id],
  });
  markMet(p.entity, other, record.seq);
  firstMeeting(env, other, record.seq);
}

/** Write a crew line in the chronicle and the month card, in a crewmate's voice. */
export function crewSay(
  env: LifeEnv,
  crewEnt: Entity | null,
  speaker: Entity | null,
  lineId: string,
  extra: CrewExtra = {},
  tone: 'good' | 'bad' | 'plain' | 'alert' = 'plain',
  tags: string[] = [],
  event = true,
): EventRecord {
  const rng = env.rng.fork('crew-line', lineId, speaker?.id ?? '-');
  const text = renderCrew(
    env.state,
    env.data,
    crewEnt,
    speaker,
    crewLine(env.data, lineId),
    rng,
    extra,
  );
  const record = lifeLog(env, text, {
    kind: event ? 'event' : 'life',
    tags: ['personal', 'crew', `crew:${lineId}`, ...tags],
    ...(speaker ? { others: [speaker.id] } : {}),
  });
  reportLine(env, text, tone);
  return record;
}

/**
 * Generated people carry no hidden potential (Phase 3 made them as numbers): someone who joins
 * gets one, from a stream keyed to their id, so it is the same whenever it is made.
 */
export function ensurePotential(data: GameData, entity: Entity, tick: number): void {
  const c = entity.character;
  if (!c) return;
  // People met in passing (Phase 2's friends, Phase 1's family) were never given a body of numbers:
  // whoever stands a post gets one, the way Phase 3 makes its named people.
  Object.assign(entity.stats, bodyStats(data, entity, tick));
  if (c.hidden) return;
  const rng = RngClass.root(`potential:${entity.id}`);
  const tier =
    rng.fork('talent').weightedPick(data.character.talentTiers, (t) => t.chance) ??
    data.character.talentTiers[0];
  const potential: Record<string, ReturnType<typeof makeStat>> = {};
  for (const id of STAT_IDS) {
    const now = entity.stats[id] ? statValue(entity.stats[id], tick) : 30;
    const head = rng.fork('head', id).float(10, 30) * (tier?.potentialMult ?? 1);
    potential[id] = makeStat(
      Math.round(Math.min(160, Math.max(now + 8, now * 1.1 + head)) * 10) / 10,
    );
  }
  c.hidden = { talent: tier?.id ?? 'ordinary', potential };
}

/** Raise one stat's potential by a few percent: a crewmate's breakthrough (Phase 2's rule). */
export function memberBreakthrough(
  entity: Entity,
  stat: string,
  pct: number,
  source: string,
): void {
  const potential = entity.character?.hidden?.potential[stat];
  if (potential) addMod(potential, { source, value: Math.round(pct * 10) / 10, kind: 'pct' });
}

/** 1 to 3 personal arcs from their dream, values and trade (data/arcs). */
export function assignArcs(
  state: WorldState,
  data: GameData,
  entity: Entity,
  member: CrewMember,
  tick: number,
  rng: Rng,
): void {
  const profile = ensureHeart(state, data, entity).profile;
  const dream = data.heart.dreams.find((d) => d.text === profile.dream)?.id;
  const occ = entity.character?.occupation;
  const score = (arc: Arc): number => {
    let w = arc.weight * 0.25;
    if (dream && arc.dreams.includes(dream)) w += arc.weight * 3;
    for (const v of profile.values) if (arc.values.includes(v)) w += arc.weight;
    if (occ && arc.occupations.includes(occ)) w += arc.weight * 2;
    return w;
  };
  const pool = sortedValues(data.arcs).filter((a) => score(a) > 0);
  const count =
    1 + (rng.fork('count').chance(0.5) ? 1 : 0) + (rng.fork('third').chance(0.2) ? 1 : 0);
  const chosen: Arc[] = [];
  for (let i = 0; i < count; i++) {
    const left = pool.filter((a) => !chosen.includes(a));
    const pick = rng.fork('arc', i).weightedPick(left, score);
    if (pick) chosen.push(pick);
  }
  member.arcs = chosen.map((arc, i) => ({
    id: arc.id,
    step: 0,
    // Arcs after the first wait their turn: the second starts a year after joining.
    since: tick + i * 12,
    place: entity.character?.place ?? null,
    goal: null,
    done: false,
  }));
}

export interface JoinOptions {
  role?: string;
  /** Joined only to be carried somewhere (a joining condition's "take me to..."). */
  bound?: string;
  how: string;
  seq?: number;
  /** Extra Loyalty from how they came (a quest done, a life saved). */
  loyalty?: number;
}

/** Bring someone into the crew. Returns their member record (theirs already, if they were in). */
export function addMember(
  env: LifeEnv,
  crewEnt: Entity,
  other: Entity,
  opts: JoinOptions,
): CrewMember {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew || !other.character) throw new Error('not a crew or not a person');
  const existing = memberRecord(crew, other.id);
  if (existing) return existing;
  ensureHeart(state, data, other);
  meet(env, other, 20);
  const pair = pairOf(p.entity, other);
  if (!pair) throw new Error('cannot relate');
  setKinds(pair, 'crewmate');
  other.flags[CAPTAIN] = p.entity.id;
  other.flags[IN_CREW] = crewEnt.id;
  delete other.flags['captive'];
  if (other.flags['status'] === 'imprisoned') delete other.flags['status'];
  // They leave whatever crew they ran with (a poached member, a defector).
  const npc = other.character.npc;
  if (npc?.crewId && npc.crewId !== crewEnt.id) {
    const old = state.entities[npc.crewId]?.org;
    if (old) old.members = old.members.filter((m) => m !== other.id);
    delete npc.crewId;
  }
  other.tier = 1;
  ensurePotential(data, other, tick);
  const role = opts.role ?? bestRole(data, other, tick);
  const member: CrewMember = {
    id: other.id,
    role,
    joined: tick,
    rank: 0,
    officer: false,
    division: null,
    bound: opts.bound ?? null,
    mastery: {},
    served: {},
    titles: [],
    plan: null,
    away: null,
    arcs: [],
    pinned: false,
    taught: {},
    hurtUntil: null,
  };
  assignArcs(state, data, other, member, tick, env.rng.fork('arcs', other.id));
  crew.members.push(member);
  // A canon character who joins leaves the story (Probable and Random modes, or Canon off-path).
  if (other.origin === 'canon' && divergeCharacter(state, other.id)) {
    state.canon.divergences.push({
      tick,
      kind: 'player',
      entity: other.id,
      text: `${other.name} joined ${crewEnt.name} and left the story.`,
    });
  }
  const record = crewSay(
    env,
    crewEnt,
    other,
    'joined',
    { role: roleName(data, role).toLowerCase() },
    'good',
    ['join', `join:${opts.how}`],
  );
  if (opts.loyalty)
    moveCrewBar(
      data,
      p.entity,
      other,
      'loyalty',
      opts.loyalty,
      'How they were won over',
      record.seq,
      tick,
    );
  crewLog(
    crew,
    tick,
    renderCrew(
      state,
      data,
      crewEnt,
      other,
      crewLine(data, 'logJoined'),
      env.rng.fork('log', other.id),
      { role: roleName(data, role).toLowerCase() },
    ),
  );
  crew.morale = Math.min(100, crew.morale + data.crew.morale.joined);
  crew.tally['joined'] = (crew.tally['joined'] ?? 0) + 1;
  if (other.character.recruit) {
    other.character.recruit.listening = false;
    // Joining ends their condition, except "take me somewhere": that one ends on arrival.
    if (other.character.recruit.quest?.status === 'open' && !opts.bound)
      other.character.recruit.quest.status = 'met';
  }
  return member;
}

/** Someone leaves the crew (left, deserted, died, retired, dismissed, mutinied, betrayed). */
export function removeMember(
  state: WorldState,
  data: GameData,
  crewEnt: Entity,
  id: string,
  why: string,
  tick: number,
  after: 'friend' | 'former' | 'keep' = 'friend',
): boolean {
  const crew = crewEnt.crew;
  if (!crew) return false;
  const index = crew.members.findIndex((m) => m.id === id);
  if (index < 0) return false;
  crew.members.splice(index, 1);
  const other = state.entities[id];
  const leader = state.entities[crew.leaderId];
  if (other) {
    delete other.flags[CAPTAIN];
    delete other.flags[IN_CREW];
    other.tier = 2;
    if (leader && after !== 'keep') {
      const mine = relOf(leader, id);
      const theirs = relOf(other, leader.id);
      if (mine?.kind === 'crewmate') mine.kind = after === 'former' ? 'friend' : 'friend';
      if (theirs?.kind === 'crewmate') theirs.kind = 'friend';
    }
  }
  for (const situation of Object.keys(crew.lineups)) {
    const lineup = crew.lineups[situation] ?? {};
    for (const [post, who] of Object.entries(lineup)) if (who === id) delete lineup[post];
  }
  for (const m of crew.members) if (m.plan?.partner === id) m.plan.partner = null;
  for (const d of crew.divisions) if (d.commanderId === id) d.commanderId = null;
  crew.former.push({ id, name: other?.name ?? id, tick, why });
  if (crew.former.length > 60) crew.former.splice(0, crew.former.length - 60);
  crewLog(
    crew,
    tick,
    renderCrew(
      state,
      data,
      crewEnt,
      other ?? null,
      crewLine(data, why === 'died' ? 'logDied' : 'logLeft'),
      RngClass.root(`log:${id}:${tick}`),
      { report: why },
    ),
  );
  return true;
}
