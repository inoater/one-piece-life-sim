import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { entityIds } from '../../engine/entities';
import { axisValue, relOf } from '../heart/bonds';
import { heartOrRoll } from '../heart/profile';
import { statTotal } from '../life/body';
import type { LifeEnv } from '../life/env';
import { successChance } from '../story/checks';
import { pushCrewDecision } from './decisions';
import { crewSay, removeMember } from './members';
import { hereOf, crewLog, loyaltyOf, membersOf, renderCrew } from './state';

/**
 * Spies, betrayal and traitors (Phase 8). Any crew can hide a spy (an agent under cover, a Marine
 * plant, an informer). Signs appear as events; whether the captain sees through them is their
 * eye (Perception, Intellect, Observation, and how far they trust the spy) against the spy's
 * cover (Charisma, Intellect, deceit). The same rule runs for the player's crew and for the
 * world's crews, so a planted spy is caught in one and missed in another by the captains' stats.
 * A member with low loyalty and a better offer may sell the crew out, steal a fruit or the purse,
 * or take the ship.
 */

/** The captain's eye: how well they see through a cover. */
export function detectScore(data: GameData, captain: Entity, tick: number): number {
  const d = data.crew.spies.detect;
  const obs = captain.character?.powers?.tracks['track_observation'];
  return (
    d.base +
    d.perception * statTotal(captain, 'perception', tick) +
    d.intellect * statTotal(captain, 'intellect', tick) +
    d.observation * (obs ? obs.stage + 1 : 0)
  );
}

/** The spy's cover. */
export function coverScore(state: WorldState, data: GameData, spy: Entity, tick: number): number {
  const c = data.crew.spies.cover;
  const honest = heartOrRoll(state, data, spy).profile.axes['honest'] ?? 0;
  return (
    c.base +
    c.charisma * statTotal(spy, 'charisma', tick) +
    c.intellect * statTotal(spy, 'intellect', tick) +
    (c.deceit * Math.max(0, -honest)) / 100
  );
}

/** The chance a sign gives the spy away to this captain. Trust blinds (the captain's in the spy). */
export function catchChance(
  state: WorldState,
  data: GameData,
  captain: Entity,
  spy: Entity,
  tick: number,
): number {
  const mine = relOf(captain, spy.id);
  const trust = mine ? axisValue(data, mine, 'trust', tick) : 0;
  const eye = detectScore(data, captain, tick) + data.crew.spies.detect.trust * Math.max(0, trust);
  // A sharp eye against a thin cover is all but certain; the reverse, all but hopeless.
  return Math.max(
    0.02,
    Math.min(0.97, successChance(eye, coverScore(state, data, spy, tick)) * 1.1 - 0.05),
  );
}

export function plantSpy(spy: Entity, faction: string): void {
  spy.flags['spy.for'] = faction;
  if (spy.character) spy.character.secret = { id: 'spy', found: false };
}

/** The player's crew: a spy shows a sign; seen through, or not. */
export function spiesMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const { entity } of membersOf(state, crew)) {
    const faction = entity.flags['spy.for'];
    if (typeof faction !== 'string' || entity.flags['spy.found'] === true) continue;
    const rng = env.rng.fork('spy', entity.id, tick);
    if (!rng.fork('sign').chance(data.crew.spies.sign)) {
      // Unseen, the spy reports: the faction knows where the crew is (known to nobody: rule 4).
      if (rng.fork('report').chance(0.3))
        appendLog(state, tick, {
          kind: 'world',
          summary: `${entity.name} sent word of ${crewEnt.name}'s course to ${state.entities[faction]?.name ?? 'their masters'}.`,
          tags: ['world', 'crew', 'spy'],
          actorIds: [entity.id],
          targetIds: [crewEnt.id],
          place: null,
          cause: 'crew:spy',
          knownBy: [],
        });
      continue;
    }
    const sign = rng.fork('which').pick(data.crew.spies.signs);
    crewSay(
      env,
      crewEnt,
      entity,
      'spySign',
      { report: renderCrew(state, data, crewEnt, entity, sign, rng.fork('line')) },
      'alert',
      ['spy', 'sign'],
    );
    if (!rng.fork('caught').chance(catchChance(state, data, p.entity, entity, tick))) continue;
    entity.flags['spy.found'] = true;
    if (entity.character?.secret) entity.character.secret.found = true;
    crewSay(
      env,
      crewEnt,
      entity,
      'spyCaught',
      { target: state.entities[faction]?.name ?? 'someone' },
      'alert',
      ['spy', 'caught'],
    );
    crewLog(
      crew,
      tick,
      `${entity.name} was caught spying for ${state.entities[faction]?.name ?? 'someone'}.`,
    );
    pushCrewDecision(state, data, {
      kind: 'traitor',
      title: `${entity.name}, a spy`,
      text: `${entity.name} has been spying on the crew for ${state.entities[faction]?.name ?? 'someone'}. The crew is waiting to see what you do.`,
      choices: [
        { id: 'forgive', label: 'Forgive them, and keep them close' },
        { id: 'maroon', label: 'Maroon them' },
        { id: 'marines', label: 'Hand them over' },
        { id: 'execute', label: 'Execute them' },
      ],
      roles: { other: entity.id },
    });
  }
}

/** A member with low loyalty and a better offer: they sell out, steal or take the ship. */
export function betrayalMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  const rules = data.crew.betrayal;
  if (!crew) return;
  for (const { entity } of membersOf(state, crew)) {
    if (loyaltyOf(state, data, p.entity, entity) >= rules.below) continue;
    const honest = heartOrRoll(state, data, entity).profile.axes['honest'] ?? 0;
    if (honest >= 0) continue;
    const rng = env.rng.fork('betray', entity.id, tick);
    if (!rng.chance(rules.chance)) continue;
    const kind = rng.fork('kind').weightedPick(rules.kinds, (k) => k.weight);
    if (!kind) continue;
    let ok = true;
    if (kind.id === 'fruit') {
      const fruit = Object.values(state.entities).find(
        (e) => e.fruit?.holderId === p.entity.id && e.fruit.container !== 'eaten',
      );
      if (fruit?.fruit) fruit.fruit.holderId = entity.id;
      else ok = false;
    } else if (kind.id === 'treasury') {
      if (crew.treasury <= 0) ok = false;
      entity.character && (entity.character.berries += crew.treasury);
      crew.treasury = 0;
    } else if (kind.id === 'ship') {
      const ship = Object.values(state.entities).find(
        (e) =>
          e.ship?.ownerId === p.entity.id &&
          !e.ship.sunk &&
          e.ship.place !== null &&
          e.ship.place !== hereOf(data, p.entity),
      );
      if (ship?.ship) ship.ship.ownerId = entity.id;
      else ok = false;
    }
    if (!ok) continue;
    crewSay(
      env,
      crewEnt,
      entity,
      'betrayal',
      { report: renderCrew(state, data, crewEnt, entity, kind.line, rng.fork('line')) },
      'alert',
      ['betrayal', `betrayal:${kind.id}`],
    );
    removeMember(state, data, crewEnt, entity.id, `betrayed the crew (${kind.id})`, tick);
    crew.morale = Math.max(0, crew.morale - 8);
  }
}

/**
 * The world's crews, a quarter at a time: now and then a spy is planted in one, and each spy is
 * caught or missed by their captain's eye (the same rule as the player's).
 */
export function npcSpiesQuarter(state: WorldState, data: GameData, tick: number, rng: Rng): void {
  for (const id of entityIds(state)) {
    const org = state.entities[id];
    const o = org?.org;
    if (!org || !o?.active || o.kind !== 'crew' || !o.leaderId || org.crew) continue;
    const captain = state.entities[o.leaderId];
    if (!captain?.character?.alive) continue;
    const members = o.members
      .map((m) => state.entities[m])
      .filter((e): e is Entity => e?.character?.alive === true);
    const r = rng.fork(id);
    const spy = members.find(
      (m) => typeof m.flags['spy.for'] === 'string' && m.flags['spy.found'] !== true,
    );
    if (!spy) {
      const target =
        members.length > 1
          ? r.fork('who').pick(members.filter((m) => m.id !== o.leaderId))
          : undefined;
      if (target && r.fork('plant').chance(0.02))
        plantSpy(target, r.fork('faction').pick(data.crew.spies.factions));
      continue;
    }
    if (!r.fork('sign').chance(data.crew.spies.sign * 3)) continue;
    if (!r.fork('caught').chance(catchChance(state, data, captain, spy, tick))) continue;
    spy.flags['spy.found'] = true;
    o.members = o.members.filter((m) => m !== spy.id);
    if (spy.character?.npc) delete spy.character.npc.crewId;
    appendLog(state, tick, {
      kind: 'world',
      summary: `${captain.name} caught ${spy.name} spying on ${org.name} and threw them off the ship.`,
      tags: ['world', 'crew', 'spy', 'caught'],
      actorIds: [captain.id],
      targetIds: [spy.id],
      place: captain.character.place ?? null,
      cause: 'crew:spy',
      knownBy: [],
    });
  }
}
