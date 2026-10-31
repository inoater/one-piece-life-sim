import type { GameData } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { makeStat } from '../../engine/stats';
import type { Base } from '../../engine/crew-state';
import type { Entity, FleetEntry, WorldState } from '../../engine/state';
import { winChance } from '../battle/battle';
import { axisValue, moveAxis, pairOf, relOf, together } from '../heart/bonds';
import { tellFact } from '../heart/facts';
import { heartOrRoll } from '../heart/profile';
import { combatPowerOf, reputation } from '../life/body';
import { speedHealing } from '../life/health';
import { pay, type LifeEnv } from '../life/env';
import { successChance } from '../story/checks';
import { addMember, crewSay, removeMember } from './members';
import { crewEffect } from './posts';
import {
  hereOf,
  byId,
  CrewError,
  crewLedBy,
  crewLog,
  fameTier,
  memberRecord,
  placeName,
} from './state';

/**
 * What a crew holds beyond its ship (Phase 8): bases and hideouts with rooms to build, a fleet of
 * subordinate crews sworn with sake cups (each captain with loyalty and ambitions of their own),
 * alliances between captains for a shared goal, and prisoners to hold, question, ransom, hand to
 * the Marines, recruit or let go.
 */

// ---- Bases ---------------------------------------------------------------------------------------

export function baseLock(
  state: WorldState,
  data: GameData,
  player: Entity,
  kindId: string,
): string | null {
  const crew = crewLedBy(state, player)?.crew;
  if (!crew) return 'You lead no crew';
  const kind = byId(data.crew.bases.kinds, kindId);
  if (!kind) return `There is no kind of base "${kindId}"`;
  const place = hereOf(data, player);
  const loc = place ? data.locations[place] : undefined;
  if (!place || !loc) return 'Claim a base ashore';
  if (crew.bases.some((b) => b.place === place)) return 'You have a base here already';
  const missing = kind.needs.find((f) => !loc.features.includes(f));
  if (missing) return `It needs ${missing.replace(/_/g, ' ')} here`;
  if ((player.character?.berries ?? 0) < kind.cost)
    return `It costs ${kind.cost.toLocaleString('en-GB')} Berries`;
  return null;
}

export function claimBase(env: LifeEnv, kindId: string, name?: string): Base {
  const { state, data, tick, p } = env;
  const lock = baseLock(state, data, p.entity, kindId);
  if (lock) throw new CrewError(lock);
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const kind = byId(data.crew.bases.kinds, kindId);
  const place = hereOf(data, p.entity);
  if (!crewEnt || !crew || !kind || !place) throw new CrewError('Cannot claim a base');
  pay(env, -kind.cost);
  const base: Base = {
    id: `base_${crew.bases.length + 1}`,
    name: name?.trim().slice(0, 60) || `${kind.name} on ${placeName(data, place)}`,
    kind: kind.id,
    place,
    rooms: {},
    since: tick,
    lastRaid: null,
    defence: kind.defence,
  };
  crew.bases.push(base);
  if (crew.home.kind === 'none') crew.home = { kind: 'base', id: base.id };
  crewSay(env, crewEnt, null, 'baseClaimed', { target: base.name }, 'good', ['base']);
  crewLog(crew, tick, `Claimed a base: ${base.name}.`);
  return base;
}

export function buildRoom(env: LifeEnv, baseId: string, roomId: string): void {
  const { state, data, p } = env;
  const crew = crewLedBy(state, p.entity)?.crew;
  const base = crew?.bases.find((b) => b.id === baseId);
  const room = byId(data.crew.bases.rooms, roomId);
  if (!crew || !base) throw new CrewError('No such base');
  if (!room) throw new CrewError(`There is no room "${roomId}"`);
  const level = base.rooms[room.id] ?? 0;
  if (level >= 3) throw new CrewError('It is as good as it gets');
  const cost = room.cost * (level + 1);
  if (p.c.berries < cost) throw new CrewError(`It costs ${cost.toLocaleString('en-GB')} Berries`);
  pay(env, -cost);
  base.rooms[room.id] = level + 1;
  crewLog(
    crew,
    state.tick,
    `${base.name}: ${room.name.toLowerCase()} ${level === 0 ? 'built' : 'improved'}.`,
  );
}

/** A room's worth at a base (its value times its level). */
export function roomValue(data: GameData, base: Base, roomId: string): number {
  return (byId(data.crew.bases.rooms, roomId)?.value ?? 0) * (base.rooms[roomId] ?? 0);
}

/** The base where the player stands, if any. */
export function baseHere(state: WorldState, data: GameData, player: Entity): Base | undefined {
  const crew = crewLedBy(state, player)?.crew;
  const place = hereOf(data, player);
  return place ? crew?.bases.find((b) => b.place === place) : undefined;
}

export function basesMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const base of crew.bases) {
    const kind = byId(data.crew.bases.kinds, base.kind);
    let upkeep = 0;
    for (const [id, level] of Object.entries(base.rooms))
      upkeep += (byId(data.crew.bases.rooms, id)?.upkeep ?? 0) * level;
    if (upkeep > 0) {
      const fromPurse = Math.min(crew.treasury, upkeep);
      crew.treasury -= fromPurse;
      const rest = upkeep - fromPurse;
      if (rest > 0 && p.c.berries >= rest) pay(env, -rest);
      else if (rest > 0) base.defence = Math.max(0, base.defence - 5);
    }
    // What the rooms do.
    const dock = roomValue(data, base, 'dock');
    if (dock > 0)
      for (const e of Object.values(state.entities))
        if (e.ship?.ownerId === p.entity.id && e.ship.place === base.place && !e.ship.sunk)
          e.ship.hull = Math.min(e.stats['hull']?.base ?? e.ship.hull, e.ship.hull + dock);
    const atBase = hereOf(data, p.entity) === base.place;
    const infirmary = roomValue(data, base, 'infirmary');
    if (atBase && infirmary > 0) speedHealing(env, infirmary);
    crew.treasury += Math.floor(crew.treasury * roomValue(data, base, 'treasury'));
    if (atBase) crew.morale = Math.min(100, crew.morale + roomValue(data, base, 'shrine'));
    // The walls are mended month by month.
    const rest = (kind?.defence ?? 30) + roomValue(data, base, 'armoury');
    base.defence = Math.min(100, Math.max(base.defence, Math.min(rest, base.defence + 3)));
    // Raids: more likely the more famous the crew, with no warning if nobody keeps watch.
    const tier = fameTier(data, p.entity, tick);
    const warned = atBase ? crewEffect(state, data, 'port.raid') : 0.2;
    const chance =
      (data.crew.bases.raidChance + tier * data.crew.bases.raidPerFameTier) *
      Math.max(0.2, 1 + warned);
    const rng = env.rng.fork('raid', base.id, tick);
    if (!rng.chance(chance)) continue;
    base.lastRaid = tick;
    const held = rng
      .fork('held')
      .chance(successChance(base.defence + roomValue(data, base, 'armoury'), 40 + tier * 10));
    let report: string;
    if (held) {
      report = 'they were beaten off at the walls';
      base.defence = Math.max(0, base.defence - 5);
    } else {
      const lost = Math.round(crew.treasury * 0.3);
      crew.treasury -= lost;
      const rooms = Object.keys(base.rooms).sort();
      const hit = rooms.length > 0 ? rng.fork('room').pick(rooms) : null;
      if (hit) {
        const level = (base.rooms[hit] ?? 1) - 1;
        if (level <= 0) delete base.rooms[hit];
        else base.rooms[hit] = level;
      }
      base.defence = Math.max(0, base.defence - 20);
      report = `they got in${lost > 0 ? ` and took ${lost.toLocaleString('en-GB')} Berries` : ''}${hit ? `, and wrecked the ${byId(data.crew.bases.rooms, hit)?.name.toLowerCase() ?? hit}` : ''}`;
    }
    crewSay(env, crewEnt, null, 'baseRaid', { target: base.name, report }, held ? 'plain' : 'bad', [
      'base',
      'raid',
    ]);
    crewLog(crew, tick, `${base.name} was raided: ${report}.`);
  }
}

// ---- The fleet -----------------------------------------------------------------------------------

/** Would this captain swear to the player (Respect or Fear enough), and could they? */
export function swearLock(
  state: WorldState,
  data: GameData,
  player: Entity,
  captainId: string,
): string | null {
  const crew = crewLedBy(state, player)?.crew;
  if (!crew) return 'You lead no crew';
  const captain = state.entities[captainId];
  if (!captain?.character?.alive) return 'Nobody of that name';
  if (crew.fleet.some((f) => f.captainId === captainId)) return 'They are sworn to you already';
  const leads = Object.values(state.entities).find(
    (e) => e.org?.active && e.org.leaderId === captainId && !e.crew,
  );
  if (!leads) return 'They captain no crew';
  if (!together(data, player, captain)) return 'They are not here';
  const theirs = relOf(captain, player.id);
  if (!theirs) return 'You do not know them';
  const tick = state.tick;
  const { respect, fear } = data.crew.fleet.swear;
  if (
    axisValue(data, theirs, 'respect', tick) < respect &&
    axisValue(data, theirs, 'fear', tick) < fear
  )
    return `They would need to respect you (${respect}) or fear you (${fear})`;
  return null;
}

function newEntry(
  state: WorldState,
  data: GameData,
  crewId: string,
  captain: Entity,
  tick: number,
): FleetEntry {
  const axes = heartOrRoll(state, data, captain).profile.axes;
  return {
    crewId,
    captainId: captain.id,
    loyalty: 60,
    ambition: Math.max(
      0,
      Math.min(100, 40 + (axes['proud'] ?? 0) * 0.3 + (axes['bold'] ?? 0) * 0.2),
    ),
    order: 'patrol',
    since: tick,
    target: captain.character?.place ?? null,
  };
}

/** A captain drinks from the player's cup: their crew sails under the player's flag. */
export function swear(env: LifeEnv, captainId: string): void {
  const { state, data, tick, p } = env;
  const lock = swearLock(state, data, p.entity, captainId);
  if (lock) throw new CrewError(lock);
  const crewEnt = crewLedBy(state, p.entity);
  const captain = state.entities[captainId];
  const org = Object.values(state.entities).find(
    (e) => e.org?.active && e.org.leaderId === captainId && !e.crew,
  );
  if (!crewEnt?.crew || !captain || !org?.org) return;
  org.org.umbrella = crewEnt.id;
  crewEnt.crew.fleet.push(newEntry(state, data, org.id, captain, tick));
  crewSay(env, crewEnt, captain, 'fleetSworn', {}, 'good', ['fleet']);
  crewLog(crewEnt.crew, tick, `${org.name} swore to the flag, under ${captain.name}.`);
}

/** An officer takes a second ship and a crew of their own, sworn to the player. */
export function detach(env: LifeEnv, memberId: string, shipId: string): void {
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const member = crew ? memberRecord(crew, memberId) : undefined;
  const captain = state.entities[memberId];
  const ship = state.entities[shipId];
  if (!crewEnt || !crew || !member || !captain) throw new CrewError('They are not in your crew');
  if (!member.officer) throw new CrewError('Only an officer can captain a ship of their own');
  if (!ship?.ship || ship.ship.ownerId !== p.entity.id || ship.ship.sunk)
    throw new CrewError('Not your ship');
  if (p.c.travel?.voyage?.shipId === shipId) throw new CrewError('You are sailing her');
  removeMember(state, data, crewEnt, memberId, 'took a ship of their own', tick, 'keep');
  const org = createEntity(state, {
    type: 'organization',
    origin: 'player',
    name: `${captain.character?.givenName ?? captain.name}'s ${ship.name.replace(/^the /i, '')}`,
    tier: 1,
    stats: { strength: makeStat(Math.round(combatPowerOf(data, captain, tick) / 100)) },
    knownBy: [p.entity.id],
  });
  org.org = {
    kind: 'crew',
    active: true,
    leaderId: memberId,
    members: [memberId],
    opinions: {},
    umbrella: crewEnt.id,
    home: ship.ship.place,
    foundedTick: tick,
    endedTick: null,
  };
  ship.ship.ownerId = memberId;
  const entry = newEntry(state, data, org.id, captain, tick);
  entry.loyalty = 75;
  crew.fleet.push(entry);
  crewLog(
    crew,
    tick,
    `${captain.name} took ${ship.name} and a crew of their own, under your flag.`,
  );
}

export function fleetOrder(
  env: LifeEnv,
  crewId: string,
  orderId: string,
  target: string | null,
): void {
  const { state, data, p } = env;
  const crew = crewLedBy(state, p.entity)?.crew;
  const entry = crew?.fleet.find((f) => f.crewId === crewId);
  const order = byId(data.crew.fleet.orders, orderId);
  if (!entry) throw new CrewError('That crew is not sworn to you');
  if (!order) throw new CrewError(`There is no order "${orderId}"`);
  if (order.target === 'place' && (!target || !data.locations[target]))
    throw new CrewError('Choose a place');
  entry.order = order.id;
  entry.target = order.target === 'place' ? target : null;
}

/** The fleet's month: each sworn crew does what it was told, and its captain thinks about it. */
export function fleetMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const entry of [...crew.fleet]) {
    const captain = state.entities[entry.captainId];
    const org = state.entities[entry.crewId];
    if (!captain?.character?.alive || !org?.org?.active) {
      crew.fleet = crew.fleet.filter((f) => f !== entry);
      continue;
    }
    const order = byId(data.crew.fleet.orders, entry.order);
    const rng = env.rng.fork('fleet', entry.crewId, tick);
    if (order) {
      if (rng.fork('risk').chance(order.risk)) {
        entry.loyalty = Math.max(0, entry.loyalty - 5);
        crewSay(
          env,
          crewEnt,
          captain,
          'fleetOrder',
          { report: `${org.name} came off badly (${order.name.toLowerCase()})` },
          'bad',
          ['fleet'],
          false,
        );
      } else {
        crew.treasury += order.berries;
        if (order.berries > 0) entry.loyalty = Math.min(100, entry.loyalty + 0.5);
      }
    }
    // Ambition grows; loyalty settles toward what they are shown.
    entry.ambition = Math.min(100, entry.ambition + 0.3);
    const theirs = relOf(captain, p.entity.id);
    const respect = theirs ? axisValue(data, theirs, 'respect', tick) : 0;
    entry.loyalty = Math.max(0, Math.min(100, entry.loyalty + (respect - 30) / 60));
    if (entry.loyalty < data.crew.fleet.breakBelow && entry.ambition > 60) {
      crew.fleet = crew.fleet.filter((f) => f !== entry);
      org.org.umbrella = 'org_pirates';
      crewSay(env, crewEnt, captain, 'fleetBroke', {}, 'alert', ['fleet']);
      crewLog(crew, tick, `${org.name} broke away from the fleet.`);
    }
  }
}

/** The strength the fleet brings to a fight it was told to join (ranks of fighters). */
export function fleetInBattle(state: WorldState, data: GameData, player: Entity): number {
  const crew = crewLedBy(state, player)?.crew;
  if (!crew) return 0;
  let n = 0;
  for (const f of crew.fleet) {
    if (f.order !== 'battle') continue;
    const org = state.entities[f.crewId]?.org;
    n += 6 + (org?.members.length ?? 0) * 2;
  }
  void data;
  return n;
}

// ---- Alliances -----------------------------------------------------------------------------------

export const ALLIANCE_GOALS = ['reach', 'hold', 'defeat'] as const;

export function ally(env: LifeEnv, captainId: string, goal: string, target: string | null): void {
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const captain = state.entities[captainId];
  if (!crewEnt || !crew) throw new CrewError('You lead no crew');
  if (!captain?.character?.alive) throw new CrewError('Nobody of that name');
  if (!(ALLIANCE_GOALS as readonly string[]).includes(goal))
    throw new CrewError(`There is no goal "${goal}"`);
  if (crew.alliances.some((a) => a.captainId === captainId && a.status === 'holding'))
    throw new CrewError('You are allies already');
  const theirs = relOf(captain, p.entity.id);
  if (!theirs || axisValue(data, theirs, 'trust', tick) < 20)
    throw new CrewError('They do not trust you enough');
  if (goal === 'reach' && (!target || !data.locations[target]))
    throw new CrewError('Choose a place');
  if (goal === 'defeat' && (!target || !state.entities[target]?.character))
    throw new CrewError('Choose someone');
  crew.alliances.push({
    captainId,
    goal,
    target: goal === 'hold' ? null : target,
    since: tick,
    status: 'holding',
    ended: null,
  });
  const what =
    goal === 'reach'
      ? `reach ${placeName(data, target)}`
      : goal === 'defeat'
        ? `bring down ${state.entities[target ?? '']?.name ?? 'them'}`
        : 'hold together for half a year';
  crewSay(env, crewEnt, captain, 'allianceMade', { quest: what }, 'good', ['alliance']);
}

export function alliancesMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const a of crew.alliances) {
    if (a.status !== 'holding') continue;
    const captain = state.entities[a.captainId];
    if (!captain?.character?.alive) {
      a.status = 'broken';
      a.ended = tick;
      continue;
    }
    const here = hereOf(data, p.entity);
    const met =
      a.goal === 'reach'
        ? here === a.target
        : a.goal === 'hold'
          ? tick - a.since >= 6
          : state.entities[a.target ?? '']?.character?.alive === false ||
            (p.c.fights?.against[a.target ?? '']?.[0] ?? 0) > 0;
    if (met) {
      a.status = 'met';
      a.ended = tick;
      const pair = pairOf(p.entity, captain);
      if (pair) moveAxis(data, pair.theirs, 'trust', 10, 'An alliance kept', undefined, tick);
      crewSay(env, crewEnt, captain, 'allianceMet', { quest: a.goal }, 'good', ['alliance']);
      continue;
    }
    const theirs = relOf(captain, p.entity.id);
    const honest = heartOrRoll(state, data, captain).profile.axes['honest'] ?? 0;
    const trust = theirs ? axisValue(data, theirs, 'trust', tick) : 0;
    if (honest < 0 && trust < 30 && env.rng.fork('ally-betray', a.captainId, tick).chance(0.04)) {
      a.status = 'broken';
      a.ended = tick;
      const pair = pairOf(p.entity, captain);
      if (pair) moveAxis(data, pair.mine, 'trust', -25, 'Betrayed an alliance', undefined, tick);
      crewSay(env, crewEnt, captain, 'allianceBroken', {}, 'alert', ['alliance']);
    }
  }
}

// ---- Prisoners -----------------------------------------------------------------------------------

export function prisonRoom(state: WorldState, data: GameData, player: Entity): number {
  const crew = crewLedBy(state, player)?.crew;
  if (!crew) return 0;
  const ship = Object.values(state.entities).some(
    (e) => e.ship?.ownerId === player.id && !e.ship.sunk,
  );
  return (
    (ship ? data.crew.prisoners.brig : 0) +
    crew.bases.reduce((n, b) => n + roomValue(data, b, 'prison'), 0)
  );
}

/** The beaten, taken prisoner (a fight's fate): as many as there is room for. */
export function takePrisoners(env: LifeEnv, ids: readonly string[]): string[] {
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  if (!crewEnt || !crew) return [];
  const room = prisonRoom(state, data, p.entity) - crew.prisoners.length;
  const taken = ids
    .filter((id) => state.entities[id]?.character?.alive)
    .slice(0, Math.max(0, room));
  for (const id of taken) {
    const e = state.entities[id];
    if (!e) continue;
    const where =
      crew.bases.length > 0 && crew.bases.some((b) => b.place === hereOf(data, p.entity))
        ? 'base'
        : 'ship';
    crew.prisoners.push({
      id,
      since: tick,
      where,
      ransom:
        Math.round((combatPowerOf(data, e, tick) * data.crew.prisoners.ransomPerCp) / 1000) * 1000,
      interrogated: false,
    });
    e.flags['prisoner.of'] = crewEnt.id;
    crewSay(env, crewEnt, e, 'prisoner', {}, 'plain', ['prisoner']);
  }
  return taken;
}

export function prisonerAct(env: LifeEnv, id: string, act: string): void {
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const prisoner = crew?.prisoners.find((x) => x.id === id);
  const e = state.entities[id];
  if (!crewEnt || !crew || !prisoner || !e?.character)
    throw new CrewError('You hold nobody of that name');
  const free = () => {
    crew.prisoners = crew.prisoners.filter((x) => x.id !== id);
    delete e.flags['prisoner.of'];
  };
  const rng = env.rng.fork('prisoner', id, act, tick);
  switch (act) {
    case 'interrogate': {
      if (prisoner.interrogated) throw new CrewError('They have told you all they will');
      prisoner.interrogated = true;
      // Held and afraid, they cannot lie well (Phase 7's facts, forced true).
      const told = tellFact(
        state,
        data,
        p.entity,
        e,
        e.character.secret ? 'secret' : 'rumour',
        undefined,
        rng,
        true,
      );
      if (e.character.secret) e.character.secret.found = true;
      crewSay(env, crewEnt, e, 'secretFound', { report: told.text }, 'alert', [
        'prisoner',
        'interrogate',
      ]);
      return;
    }
    case 'ransom':
      pay(env, prisoner.ransom);
      free();
      crewSay(
        env,
        crewEnt,
        e,
        'ransomed',
        { bounty: prisoner.ransom.toLocaleString('en-GB') },
        'good',
        ['prisoner'],
      );
      return;
    case 'marines': {
      const reward =
        Math.round((combatPowerOf(data, e, tick) * data.crew.prisoners.marinePerCp) / 1000) * 1000;
      pay(env, reward);
      free();
      e.flags['status'] = 'imprisoned';
      reputation(p.entity, 'fame').base += 1;
      crewLog(crew, tick, `${e.name} was handed to the Marines.`);
      return;
    }
    case 'recruit': {
      const theirs = relOf(e, p.entity.id);
      const fear = theirs ? axisValue(data, theirs, 'fear', tick) : 0;
      const respect = theirs ? axisValue(data, theirs, 'respect', tick) : 0;
      if (!rng.chance(successChance(p.c ? respect + fear * 0.5 + 30 : 30, 55)))
        throw new CrewError(`${e.name} would rather stay in irons`);
      free();
      addMember(env, crewEnt, e, { how: 'prisoner' });
      return;
    }
    case 'release': {
      free();
      const pair = pairOf(p.entity, e);
      if (pair) moveAxis(data, pair.theirs, 'affection', 10, 'Let go', undefined, tick);
      crewLog(crew, tick, `${e.name} was let go.`);
      return;
    }
    default:
      throw new CrewError(`You cannot "${act}" a prisoner`);
  }
}

export function prisonersMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const prisoner of [...crew.prisoners]) {
    const e = state.entities[prisoner.id];
    if (!e?.character?.alive) {
      crew.prisoners = crew.prisoners.filter((x) => x !== prisoner);
      continue;
    }
    const held = prisoner.where === 'base' ? 0.5 : 1;
    if (env.rng.fork('escape', prisoner.id, tick).chance(data.crew.prisoners.escape * held)) {
      crew.prisoners = crew.prisoners.filter((x) => x !== prisoner);
      delete e.flags['prisoner.of'];
      crewSay(env, crewEnt, e, 'escaped', {}, 'bad', ['prisoner', 'escaped']);
    }
  }
  void winChance;
}
