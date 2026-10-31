import type { GameData } from '../../engine/data/schemas';
import { CREW_SITUATIONS } from '../../engine/crew-state';
import { STAT_IDS } from '../../engine/stats';
import type { CrewSituation, WorldState } from '../../engine/state';
import { appendLog } from '../../engine/log';
import { setUser } from '../powers/fruits';
import { heartEnv } from '../heart/talk';
import { heartOrRoll } from '../heart/profile';
import type { LifeEnv } from '../life/env';
import { editCrew, foundCrew, importCrew, type CrewSpec } from './creator';
import { ally, buildRoom, claimBase, detach, fleetOrder, prisonerAct, swear } from './holdings';
import { crewSay, removeMember } from './members';
import { sendOnMission } from './missions';
import { autoFill, postsOf } from './posts';
import { questAct } from './quests';
import { answerObjection, pitch } from './recruit';
import { plantSpy } from './spies';
import { byId, CrewError, crewLedBy, memberRecord } from './state';
import { breakOut, buyOut, freeCaptive } from './world';

/**
 * What the player can do with a crew between months (Phase 8): found one in the creator and change
 * it; pitch someone, answer their doubts, work on what they asked for; free a prisoner, buy out a
 * sentence, free a captive; give roles, posts, locks and training plans; send someone on a mission;
 * offer a Devil Fruit; dismiss, promote, pin; swear a captain to the fleet, give it orders, make an
 * alliance; claim a base and build its rooms; deal with prisoners; and import a saved crew. Each
 * checks the rules the Crew page shows and throws the reason.
 */

export type CrewCommand =
  | ({ type: 'crew/found' } & CrewSpec)
  | ({ type: 'crew/edit' } & Omit<CrewSpec, 'kind'>)
  | { type: 'crew/pitch'; target: string; pitch: string }
  | { type: 'crew/answer'; target: string; objection: string; answer: string }
  | { type: 'crew/quest'; target: string; act: string }
  | { type: 'crew/free'; target: string; how: 'bail' | 'break' | 'buy' }
  | { type: 'crew/role'; member: string; role: string }
  | { type: 'crew/post'; situation: CrewSituation; post: string; member: string | null }
  | { type: 'crew/lock'; situation: CrewSituation; post: string; on: boolean }
  | { type: 'crew/auto'; on: boolean }
  | {
      type: 'crew/plan';
      member: string;
      focus: string;
      effort: 'light' | 'normal' | 'hard';
      partner: string | null;
    }
  | { type: 'crew/send'; member: string; mission: string; target: string | null }
  | { type: 'crew/dismiss'; member: string }
  | { type: 'crew/promote'; member: string }
  | { type: 'crew/division'; member: string; division: number | null }
  | { type: 'crew/pin'; member: string; on: boolean }
  | { type: 'crew/offerFruit'; member: string; fruit: string }
  | { type: 'crew/swear'; captain: string }
  | { type: 'crew/detach'; member: string; ship: string }
  | { type: 'crew/order'; crew: string; order: string; target: string | null }
  | { type: 'crew/ally'; captain: string; goal: string; target: string | null }
  | { type: 'crew/claimBase'; kind: string; name?: string | undefined }
  | { type: 'crew/build'; base: string; room: string }
  | { type: 'crew/prisoner'; prisoner: string; act: string }
  | { type: 'crew/treasury'; amount: number }
  | { type: 'crew/import'; text: string }
  | { type: 'debug/plantSpy'; member: string; faction: string };

function crewOrThrow(env: LifeEnv) {
  const crewEnt = crewLedBy(env.state, env.p.entity);
  if (!crewEnt?.crew) throw new CrewError('You lead no crew: found one first');
  return { crewEnt, crew: crewEnt.crew };
}

function memberOrThrow(env: LifeEnv, id: string) {
  const { crewEnt, crew } = crewOrThrow(env);
  const member = memberRecord(crew, id);
  const entity = env.state.entities[id];
  if (!member || !entity) throw new CrewError('They are not in your crew');
  return { crewEnt, crew, member, entity };
}

/** Would they eat a Devil Fruit offered to them? Some refuse (the careful, the proud swimmer). */
export function fruitRefusal(state: WorldState, data: GameData, memberId: string): string | null {
  const e = state.entities[memberId];
  if (!e?.character) return 'Nobody of that name';
  if (e.character.powers?.fruit) return 'They have eaten one already';
  const axes = heartOrRoll(state, data, e).profile.axes;
  const swimmer =
    e.character.traits.includes('trait_strong_swimmer') ||
    e.character.traits.includes('trait_water_born');
  if (swimmer || (axes['bold'] ?? 0) < -40) return 'They will not give up the sea';
  return null;
}

export function applyCrewCommand(state: WorldState, data: GameData, cmd: CrewCommand): void {
  const env = heartEnv(state, data, `action:${cmd.type}`);
  if (!env) throw new CrewError('Nobody alive is being played');
  const tick = state.tick;
  switch (cmd.type) {
    case 'crew/found': {
      const { type: _t, ...spec } = cmd;
      void _t;
      foundCrew(env, spec);
      return;
    }
    case 'crew/edit': {
      const { type: _t, ...spec } = cmd;
      void _t;
      editCrew(env, spec);
      return;
    }
    case 'crew/import':
      importCrew(env, cmd.text);
      return;
    case 'crew/pitch':
      pitch(env, cmd.target, cmd.pitch);
      return;
    case 'crew/answer':
      answerObjection(env, cmd.target, cmd.objection, cmd.answer);
      return;
    case 'crew/quest':
      questAct(env, cmd.target, cmd.act);
      return;
    case 'crew/free':
      if (cmd.how === 'bail') buyOut(env, cmd.target);
      else if (cmd.how === 'break') breakOut(env, cmd.target);
      else freeCaptive(env, cmd.target);
      return;
    case 'crew/role': {
      const { member } = memberOrThrow(env, cmd.member);
      if (!byId(data.crew.roles, cmd.role)) throw new CrewError(`There is no role "${cmd.role}"`);
      if (cmd.role === 'captain') throw new CrewError('There is one captain');
      member.role = cmd.role;
      return;
    }
    case 'crew/post': {
      const { crewEnt, crew } = crewOrThrow(env);
      if (!(CREW_SITUATIONS as readonly string[]).includes(cmd.situation))
        throw new CrewError('No such situation');
      if (!postsOf(data, cmd.situation).some((p) => p.id === cmd.post))
        throw new CrewError(`There is no post "${cmd.post}"`);
      const lineup = { ...(crew.lineups[cmd.situation] ?? {}) };
      if (cmd.member === null) delete lineup[cmd.post];
      else {
        if (cmd.member !== env.p.entity.id && !memberRecord(crew, cmd.member))
          throw new CrewError('They are not in your crew');
        lineup[cmd.post] = cmd.member;
      }
      crew.lineups[cmd.situation] = lineup;
      // Setting a post by hand locks it, so the rota does not undo it.
      crew.locks[`${cmd.situation}:${cmd.post}`] = true;
      if (crew.auto) autoFill(state, data, crewEnt, tick);
      return;
    }
    case 'crew/lock': {
      const { crew } = crewOrThrow(env);
      if (cmd.on) crew.locks[`${cmd.situation}:${cmd.post}`] = true;
      else delete crew.locks[`${cmd.situation}:${cmd.post}`];
      return;
    }
    case 'crew/auto': {
      const { crewEnt, crew } = crewOrThrow(env);
      crew.auto = cmd.on;
      if (cmd.on) autoFill(state, data, crewEnt, tick);
      return;
    }
    case 'crew/plan': {
      const ids =
        cmd.member === 'all' ? crewOrThrow(env).crew.members.map((m) => m.id) : [cmd.member];
      if (!(STAT_IDS as readonly string[]).includes(cmd.focus) && !data.tracks[cmd.focus])
        throw new CrewError(`Nothing to train called "${cmd.focus}"`);
      if (cmd.focus === 'luck') throw new CrewError('Luck cannot be trained');
      for (const id of ids) {
        const { crew, member } = memberOrThrow(env, id);
        if (cmd.partner !== null && cmd.partner !== id && !memberRecord(crew, cmd.partner))
          throw new CrewError('Their partner must be in the crew');
        member.plan = {
          focus: cmd.focus,
          effort: cmd.effort,
          partner: cmd.partner === id ? null : cmd.partner,
        };
      }
      return;
    }
    case 'crew/send':
      sendOnMission(env, cmd.member, cmd.mission, cmd.target);
      return;
    case 'crew/dismiss': {
      const { crewEnt, entity } = memberOrThrow(env, cmd.member);
      crewSay(env, crewEnt, entity, 'left', {}, 'plain', ['dismissed']);
      removeMember(state, data, crewEnt, cmd.member, 'dismissed', tick);
      // Letting someone go is a deserter's matter only if the creed says nobody leaves.
      return;
    }
    case 'crew/promote': {
      const { crew, member, entity, crewEnt } = memberOrThrow(env, cmd.member);
      const structure = byId(data.crew.structures, crew.structure);
      if (member.officer) throw new CrewError('They are an officer already');
      if (!structure || crew.members.filter((m) => m.officer).length >= structure.officers)
        throw new CrewError(
          structure?.officers === 0 ? 'A flat crew has no officers' : 'No officer’s place is free',
        );
      member.officer = true;
      crewSay(env, crewEnt, entity, 'promoted', {}, 'good', ['promotion']);
      return;
    }
    case 'crew/division': {
      const { crew, member } = memberOrThrow(env, cmd.member);
      const structure = byId(data.crew.structures, crew.structure);
      if (cmd.division === null) {
        member.division = null;
        return;
      }
      if (!structure || structure.divisions === 0)
        throw new CrewError('This crew has no divisions');
      if (cmd.division < 0 || cmd.division >= structure.divisions)
        throw new CrewError('No such division');
      while (crew.divisions.length <= cmd.division)
        crew.divisions.push({ name: `Division ${crew.divisions.length + 1}`, commanderId: null });
      member.division = cmd.division;
      const div = crew.divisions[cmd.division];
      if (div && div.commanderId === null && member.officer) div.commanderId = member.id;
      return;
    }
    case 'crew/pin': {
      const { member } = memberOrThrow(env, cmd.member);
      member.pinned = cmd.on;
      return;
    }
    case 'crew/offerFruit': {
      const { crewEnt, entity } = memberOrThrow(env, cmd.member);
      const fruit = state.entities[cmd.fruit];
      if (
        !fruit?.fruit ||
        fruit.fruit.holderId !== env.p.entity.id ||
        fruit.fruit.container === 'eaten'
      )
        throw new CrewError('You do not carry that fruit');
      const refusal = fruitRefusal(state, data, cmd.member);
      if (refusal) {
        crewSay(env, crewEnt, entity, 'fruitNo', {}, 'plain', ['fruit']);
        throw new CrewError(refusal);
      }
      setUser(state, data, fruit, entity, {
        tick,
        text: `Offered to ${entity.name} by ${env.p.entity.name}, who ate it.`,
      });
      crewSay(env, crewEnt, entity, 'fruitYes', {}, 'alert', ['fruit']);
      return;
    }
    case 'crew/swear':
      swear(env, cmd.captain);
      return;
    case 'crew/detach':
      detach(env, cmd.member, cmd.ship);
      return;
    case 'crew/order':
      fleetOrder(env, cmd.crew, cmd.order, cmd.target);
      return;
    case 'crew/ally':
      ally(env, cmd.captain, cmd.goal, cmd.target);
      return;
    case 'crew/claimBase':
      claimBase(env, cmd.kind, cmd.name);
      return;
    case 'crew/build':
      buildRoom(env, cmd.base, cmd.room);
      return;
    case 'crew/prisoner':
      prisonerAct(env, cmd.prisoner, cmd.act);
      return;
    case 'crew/treasury': {
      const { crew } = crewOrThrow(env);
      // Positive: into the common purse; negative: out of it.
      if (cmd.amount > 0 && env.p.c.berries < cmd.amount)
        throw new CrewError('You do not have that much');
      if (cmd.amount < 0 && crew.treasury < -cmd.amount)
        throw new CrewError('The purse does not hold that much');
      env.p.c.berries -= cmd.amount;
      crew.treasury += cmd.amount;
      return;
    }
    case 'debug/plantSpy': {
      const { entity } = memberOrThrow(env, cmd.member);
      plantSpy(entity, cmd.faction);
      appendLog(state, tick, {
        kind: 'system',
        summary: `Debug: ${entity.name} now spies for ${cmd.faction}.`,
        tags: ['system', 'debug'],
        cause: 'action:debug/plantSpy',
        knownBy: [env.p.entity.id],
      });
      return;
    }
  }
}
