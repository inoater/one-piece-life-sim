import type { GameData, Mission } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { CrewMember, Entity, WorldState } from '../../engine/state';
import { axisValue, relOf } from '../heart/bonds';
import { tellFact } from '../heart/facts';
import { statTotal } from '../life/body';
import { pay, type LifeEnv } from '../life/env';
import { bandFor, successChance, type Band } from '../story/checks';
import { crewSay } from './members';
import { roleFit, roleOf } from './roles';
import { hereOf, byId, CrewError, crewLedBy, memberRecord, placeName, renderCrew } from './state';
import { makeCandidate } from './world';

/**
 * Delegation (Phase 8): send a crewmate (or a subordinate captain) on a mission while the player
 * does something else: scout an island, gather rumours, buy supplies, recruit, collect a debt,
 * carry a message, guard a place, track someone. It takes months, runs on the member's stats (by
 * the mission's weights, against its difficulty), and comes back with a report, and sometimes
 * trouble. A sharp scout's report names what a dull one's misses.
 */

export function missionValue(
  data: GameData,
  mission: Mission,
  entity: Entity,
  member: CrewMember,
  tick: number,
): number {
  let v = 0;
  for (const [stat, w] of Object.entries(mission.stats))
    v += (w ?? 0) * statTotal(entity, stat, tick);
  // Role skill helps: a lookout scouts, a quartermaster buys.
  const role = roleOf(data, member.role);
  if (role) v += roleFit(data, entity, role, tick, member.mastery[member.role] ?? 0).score * 0.1;
  return v;
}

export function missionLock(
  state: WorldState,
  data: GameData,
  player: Entity,
  memberId: string,
  missionId: string,
  target: string | null,
): string | null {
  const crew = crewLedBy(state, player)?.crew;
  if (!crew) return 'You lead no crew';
  const member = memberRecord(crew, memberId);
  if (!member) return 'They are not in your crew';
  if (member.away) return 'They are away already';
  if (member.hurtUntil !== null && member.hurtUntil > state.tick) return 'They are laid up';
  const mission = byId(data.crew.missions, missionId);
  if (!mission) return `There is no mission "${missionId}"`;
  if (mission.target === 'place' && (!target || !data.locations[target])) return 'Choose a place';
  if (mission.target === 'person' && (!target || !state.entities[target]?.character))
    return 'Choose someone';
  if (mission.kind === 'debt' && target) {
    const theirs = relOf(state.entities[target] as Entity, player.id);
    if (!theirs || axisValue(data, theirs, 'debt', state.tick) <= 0) return 'They owe you nothing';
  }
  return null;
}

export function sendOnMission(
  env: LifeEnv,
  memberId: string,
  missionId: string,
  target: string | null,
): void {
  const { state, data, tick, p } = env;
  const lock = missionLock(state, data, p.entity, memberId, missionId, target);
  if (lock) throw new CrewError(lock);
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const member = crew ? memberRecord(crew, memberId) : undefined;
  const mission = byId(data.crew.missions, missionId);
  const entity = state.entities[memberId];
  if (!crew || !member || !mission || !entity) return;
  const months = env.rng
    .fork('months', memberId, missionId, tick)
    .int(mission.months.min, mission.months.max);
  const record = appendLog(state, tick, {
    kind: 'life',
    summary: `You sent ${entity.name} to ${mission.name.toLowerCase()}${target ? ` (${state.entities[target]?.name ?? placeName(data, target)})` : ''}: back in ${months} month${months === 1 ? '' : 's'}.`,
    tags: ['personal', 'crew', 'mission'],
    actorIds: [p.entity.id],
    targetIds: [memberId],
    place: hereOf(data, p.entity),
    cause: env.cause,
    knownBy: [p.entity.id],
  });
  member.away = { mission: missionId, target, since: tick, until: tick + months, seq: record.seq };
  for (const lineup of Object.values(crew.lineups))
    for (const [post, who] of Object.entries(lineup)) if (who === memberId) delete lineup[post];
}

/** What they found, by kind and band: the report's middle, and what it does. */
function outcome(
  env: LifeEnv,
  mission: Mission,
  band: Band,
  entity: Entity,
  target: string | null,
  value: number,
): string {
  const { state, data, tick, p } = env;
  const good = band === 'criticalSuccess' || band === 'success';
  const rng = env.rng.fork('mission-outcome', entity.id, tick);
  switch (mission.kind) {
    case 'scout': {
      const loc = target ? data.locations[target] : undefined;
      const place = target ? state.entities[target]?.place : undefined;
      if (!loc) return 'nothing there';
      const bits: string[] = [];
      bits.push(`danger ${loc.danger} of 5`);
      if (good) {
        bits.push(
          `${(place?.residents.adults ?? 0) + (place?.residents.children ?? 0) + (place?.residents.elders ?? 0)} people`,
        );
        if (loc.features.includes('marine_base')) bits.push('a Marine base');
        if (loc.features.includes('underworld')) bits.push('an underworld market');
        if (place?.controller)
          bits.push(`held by ${state.entities[place.controller]?.name ?? 'someone'}`);
      }
      if (band === 'criticalSuccess') {
        const legend = (state.crews?.legends ?? []).find(
          (id) => state.entities[id]?.character?.place === target,
        );
        if (legend) {
          const e = state.entities[legend];
          if (e) {
            e.flags['legend.heard'] = true;
            bits.push(`and talk of ${e.name}, who lives there`);
          }
        }
        const travel = p.c.travel;
        if (travel && !travel.visited.includes(target as string))
          bits.push('a safe anchorage marked on the chart');
      }
      return bits.join(', ');
    }
    case 'rumours': {
      if (!good) return 'sea stories';
      const told = tellFact(
        state,
        data,
        p.entity,
        entity,
        'rumour',
        undefined,
        rng,
        band === 'criticalSuccess',
      );
      return told.text;
    }
    case 'supplies': {
      const ship = Object.values(state.entities).find(
        (e) => e.ship?.ownerId === p.entity.id && !e.ship.sunk,
      );
      const months = good ? (band === 'criticalSuccess' ? 6 : 4) : 2;
      const cost = (band === 'criticalFailure' ? 3000 : band === 'failure' ? 2000 : 1200) * months;
      pay(env, -Math.min(p.c.berries, cost));
      if (ship?.ship) ship.ship.supplies += months * Math.max(1, ship.ship.crew + 1);
      return `${months} months of stores for ${cost.toLocaleString('en-GB')} Berries`;
    }
    case 'recruit': {
      if (!good) return 'nobody';
      const here = hereOf(data, p.entity) ?? entity.character?.place ?? null;
      const found = here
        ? makeCandidate(env, here, 'mission', rng, band === 'criticalSuccess' ? 1.3 : 1)
        : null;
      return found ? `${found.name}, who is waiting to meet you` : 'nobody';
    }
    case 'debt': {
      const other = target ? state.entities[target] : undefined;
      const theirs = other ? relOf(other, p.entity.id) : undefined;
      const owed = theirs ? Math.max(0, axisValue(data, theirs, 'debt', tick)) : 0;
      const share = band === 'criticalSuccess' ? 1 : band === 'success' ? 0.7 : 0;
      const got = Math.round(owed * 300 * share);
      if (got > 0) pay(env, got);
      return got > 0 ? `${got.toLocaleString('en-GB')} Berries` : 'nothing';
    }
    case 'message': {
      const other = target ? state.entities[target] : undefined;
      const theirs = other ? relOf(other, p.entity.id) : undefined;
      if (good && theirs) {
        theirs.opinion.mods.push({
          source: 'Your message',
          value: band === 'criticalSuccess' ? 6 : 3,
          kind: 'flat',
        });
        theirs.lastSeen = tick;
        return `${other?.name ?? 'they'} sent warm word back`;
      }
      return 'no reply';
    }
    case 'guard': {
      const base = crewLedBy(state, p.entity)?.crew?.bases.find((b) => b.place === target);
      if (base)
        base.defence = Math.min(
          100,
          base.defence + (good ? 15 : 0) - (band === 'criticalFailure' ? 15 : 0),
        );
      return good ? 'all quiet' : 'a break-in nobody stopped';
    }
    case 'track': {
      const other = target ? state.entities[target] : undefined;
      if (!other?.character || !good) return 'the trail went cold';
      const told = tellFact(state, data, p.entity, entity, 'person', other.id, rng, true);
      return told.text;
    }
  }
  void value;
  return 'nothing';
}

/** Members back from their missions this month: each with a report (and sometimes trouble). */
export function missionsMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const member of crew.members) {
    const away = member.away;
    if (!away || away.until > tick) continue;
    const entity = state.entities[member.id];
    const mission = byId(data.crew.missions, away.mission);
    member.away = null;
    if (!entity?.character?.alive || !mission) continue;
    const value = missionValue(data, mission, entity, member, tick);
    const chance = successChance(value, mission.difficulty);
    const rng = env.rng.fork('mission', member.id, away.since);
    const band = bandFor(rng.next(), chance);
    const report = outcome(env, mission, band, entity, away.target, value);
    const target = away.target
      ? (state.entities[away.target]?.name ?? placeName(data, away.target))
      : placeName(data, hereOf(data, p.entity));
    const text = mission.report[band];
    crewSay(
      env,
      crewEnt,
      entity,
      'missionBack',
      { report: renderReport(env, crewEnt, entity, text, target, report) },
      band === 'failure' || band === 'criticalFailure' ? 'bad' : 'good',
      ['mission', `mission:${mission.kind}`, `band:${band}`],
    );
    crew.tally['missions'] = (crew.tally['missions'] ?? 0) + 1;
    // Trouble comes back with them sometimes (worse when it went badly).
    const trouble =
      mission.trouble * (band === 'criticalFailure' ? 3 : band === 'failure' ? 1.5 : 0.5);
    if (rng.fork('trouble').chance(trouble)) {
      member.hurtUntil = tick + 2;
      crew.morale = Math.max(0, crew.morale - 3);
      crewSay(
        env,
        crewEnt,
        entity,
        'missionTrouble',
        { mission: mission.name.toLowerCase(), report: 'hurt, and followed part of the way' },
        'bad',
        ['mission', 'trouble'],
      );
    }
  }
}

function renderReport(
  env: LifeEnv,
  crewEnt: Entity,
  entity: Entity,
  template: string,
  target: string,
  report: string,
): string {
  return renderCrew(
    env.state,
    env.data,
    crewEnt,
    entity,
    template,
    env.rng.fork('report', entity.id),
    { target, report },
  );
}
