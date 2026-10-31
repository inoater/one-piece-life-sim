import type { GameData } from '../../engine/data/schemas';
import type { Entity, RecruitState, WorldState } from '../../engine/state';
import { appendLog } from '../../engine/log';
import { winChance } from '../battle/battle';
import { axisValue, relOf, together } from '../heart/bonds';
import { remember } from '../heart/memory';
import { ensureHeart, heartOrRoll } from '../heart/profile';
import { repAt } from '../heart/deeds';
import { combatPowerOf, humanAgeOf, personOf, statTotal } from '../life/body';
import { pay, type LifeEnv } from '../life/env';
import { successChance } from '../story/checks';
import { addMember, crewSay, meet } from './members';
import { startQuest } from './quests';
import { hereOf, byId, CrewError, crewLedBy, crewLimit, fameTier, kindOf, withBody } from './state';
import { foundCrew } from './creator';

/**
 * Winning someone over (Phase 8): recruiting is a scene, not a click. The pitch (a dream,
 * freedom, adventure, money, revenge, protection, belonging, a cause) lands or not by their values
 * and nature, the player's Charisma and fame, and what is between them; then their objections,
 * each answered by a check, a promise, a deed or a payment; then, for someone worth having, a
 * joining condition (a personal quest, quests.ts). A refusal is remembered: trying again needs a
 * pitch they have not heard, or something new to show (a fame tier, a deed done).
 */

export function freshRecruit(): RecruitState {
  return {
    pitched: [],
    refused: null,
    refusedWith: null,
    objections: {},
    listening: false,
    quest: null,
    promised: [],
  };
}

export function recruitOf(other: Entity): RecruitState {
  const c = other.character;
  if (!c) throw new CrewError('Not a person');
  c.recruit ??= freshRecruit();
  return c.recruit;
}

/** What the player has to show: a new fame tier, a stronger arm, a bigger crew, quests done. */
export function showStamp(state: WorldState, data: GameData, player: Entity): number {
  const crew = crewLedBy(state, player)?.crew;
  return (
    fameTier(data, player, state.tick) * 1000 +
    Math.floor(combatPowerOf(data, player, state.tick) / 100) * 10 +
    (crew?.members.length ?? 0) +
    (typeof player.flags['crew.quests'] === 'number'
      ? (player.flags['crew.quests'] as number) * 100
      : 0)
  );
}

/** Is someone on a hard canon beat's path (Canon mode refuses them until their part is played)? */
export function onCanonPath(state: WorldState, data: GameData, other: Entity): string | null {
  if (state.config.canonMode !== 'canon' || other.origin !== 'canon') return null;
  for (const beat of Object.values(data.canon)) {
    if (beat.anchor !== 'hard') continue;
    const status = state.canon.beats[beat.id]?.status ?? 'pending';
    if (status !== 'pending') continue;
    if (Object.values(beat.roles).some((r) => r.char === other.id)) return beat.name;
  }
  return null;
}

/** On a list at the player's place (a board, a cell, an auction block): may be approached unmet. */
export function listedHere(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): boolean {
  const place = hereOf(data, player);
  const w = state.crews;
  if (!place || !w) return false;
  return [w.boards[place], w.prisons[place], w.auctions[place]].some((l) =>
    l?.ids.includes(other.id),
  );
}

/** Why they cannot be pitched now (null when they can). */
export function pitchLock(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): string | null {
  const c = other.character;
  if (!c?.alive) return 'They are dead';
  if (other.id === player.id) return 'You lead yourself already';
  if (other.flags['animal'] !== undefined) return 'Animals come as companions, not crew';
  if (other.flags['crew.of'] === player.id) return 'They are in your crew';
  if (other.flags['captive'] === true) return 'Free them first';
  if (other.flags['status'] === 'imprisoned') return 'Get them out first';
  const pp = personOf(data, player);
  const op = personOf(data, other);
  if (op && humanAgeOf(data, op, state.tick) < 14) return 'They are too young';
  if (pp && humanAgeOf(data, pp, state.tick) < 14) return 'You are too young to lead anyone';
  if (!together(data, player, other) && !listedHere(state, data, player, other))
    return 'They are not here';
  const path = onCanonPath(state, data, other);
  if (path) return `Not while ${path} is still to come`;
  const crewEnt = crewLedBy(state, player);
  if (crewEnt?.crew) {
    const { limit } = crewLimit(state, data, player, crewEnt.crew);
    if (crewEnt.crew.members.length >= limit + 4) return 'Your crew cannot hold more';
  }
  return null;
}

export interface PitchPart {
  source: string;
  value: number;
}

/** How well a pitch would land, part by part (the person page shows the total in words). */
export function pitchParts(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
  pitchId: string,
): PitchPart[] {
  const tick = state.tick;
  const pitchDef = byId(data.crew.recruit.pitches, pitchId);
  const heart = heartOrRoll(state, data, other);
  const parts: PitchPart[] = [
    { source: 'Your Charisma', value: Math.round(statTotal(player, 'charisma', tick) * 0.5) },
  ];
  if (pitchDef) {
    let fit = 0;
    heart.profile.values.forEach((v, i) => {
      fit += (pitchDef.values[v] ?? 0) * (i === 0 ? 1.5 : i === 1 ? 1 : 0.6);
    });
    for (const [axis, w] of Object.entries(pitchDef.axes))
      fit += ((w ?? 0) * (heart.profile.axes[axis] ?? 0)) / 100;
    parts.push({
      source: `What “${pitchDef.name.toLowerCase()}” means to them`,
      value: Math.round(fit),
    });
  }
  const theirs = relOf(other, player.id);
  if (theirs) {
    const bond =
      axisValue(data, theirs, 'affection', tick) * 0.25 +
      axisValue(data, theirs, 'trust', tick) * 0.2 +
      axisValue(data, theirs, 'respect', tick) * 0.3;
    parts.push({ source: 'What is between you', value: Math.round(bond) });
  }
  const tier = fameTier(data, player, tick);
  if (tier > 0) parts.push({ source: 'Your name', value: tier * 4 });
  const place = hereOf(data, player);
  const rep = repAt(state, ensureHeart(state, data, player), player, place);
  if (Math.abs(rep.honour) >= 5)
    parts.push({ source: 'What is said of you here', value: Math.round(rep.honour * 0.3) });
  // A rival crew's member: how much they still hold to their captain.
  const crewId = other.character?.npc?.crewId;
  if (crewId) {
    const loyal = npcCrewLoyalty(other);
    parts.push({ source: 'Loyal to their captain', value: -Math.round(loyal / 2) });
  }
  const recruit = other.character?.recruit;
  if (recruit?.refused !== null && recruit?.refused !== undefined)
    parts.push({ source: 'They said no before', value: -8 });
  if (other.flags['recruit.source'] === 'defector')
    parts.push({ source: 'Ready to leave the service', value: 12 });
  if (other.flags['recruit.source'] === 'spared')
    parts.push({ source: 'You spared them', value: 10 });
  return parts;
}

/** A rival crew's member's loyalty to their own captain (rolled from their id; 0 to 100). */
export function npcCrewLoyalty(other: Entity): number {
  const flag = other.flags['crew.loyalty'];
  if (typeof flag === 'number') return flag;
  let h = 0;
  for (const ch of other.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 15 + (h % 70);
}

export function pitchChance(data: GameData, parts: readonly PitchPart[]): number {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return successChance(total, data.crew.recruit.lands);
}

/** Objections that apply to them (data/crew.json recruit.objections, by `when`). */
export function objectionsFor(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): string[] {
  const tick = state.tick;
  const c = other.character;
  if (!c) return [];
  const heart = heartOrRoll(state, data, other);
  const crewEnt = crewLedBy(state, player);
  const kind = crewEnt?.crew ? kindOf(data, crewEnt.crew) : byId(data.crew.kinds, 'pirate');
  const op = personOf(data, other);
  const age = op ? humanAgeOf(data, op, tick) : 30;
  const applies = (when: string): boolean => {
    switch (when) {
      case 'family':
        return c.relationships.some((r) => {
          if (r.kind !== 'parent' && r.kind !== 'child') return false;
          const e = state.entities[r.id];
          return (
            e?.character?.alive === true && e.character.place === c.place && r.id !== player.id
          );
        });
      case 'weak':
        return (
          combatPowerOf(data, withBody(data, other, tick), tick) >
          combatPowerOf(data, player, tick) * 1.15
        );
      case 'distrust':
        return (
          (kind?.outlaw ?? false) &&
          (heart.profile.values.includes('justice') || (heart.profile.axes['free'] ?? 0) < -30)
        );
      case 'job': {
        const occ = c.occupation;
        return (
          occ !== undefined &&
          !['occ_pirate', 'occ_sailor', 'occ_street_kid', 'occ_bandit', 'occ_mercenary'].includes(
            occ,
          ) &&
          other.id.charCodeAt(other.id.length - 1) % 2 === 0
        );
      }
      case 'loyal':
        return (
          c.npc?.crewId !== undefined ||
          (typeof other.flags['crew.of'] === 'string' && other.flags['crew.of'] !== player.id)
        );
      case 'debt':
        return other.flags['recruit.debt'] === true || c.berries < 0;
      case 'seasick':
        return c.traits.includes('trait_landlubber');
      case 'cause':
        return (kind?.fighting ?? true) && heart.profile.values.includes('peace');
      case 'old':
        return age >= 55;
      default:
        return false;
    }
  };
  return data.crew.recruit.objections.filter((o) => applies(o.when)).map((o) => o.id);
}

/** Objections they still hold. */
export function openObjections(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): string[] {
  const r = other.character?.recruit;
  return objectionsFor(state, data, player, other).filter((id) => r?.objections[id] !== true);
}

/** Someone worth having names a condition first (their strength, their talent, a legend). */
function wantsCondition(env: LifeEnv, other: Entity): boolean {
  const { state, data, tick, p } = env;
  if (other.flags['legend'] !== undefined) return true;
  const talent = other.character?.hidden?.talent;
  const strong =
    combatPowerOf(data, withBody(data, other, tick), tick) >=
    combatPowerOf(data, p.entity, tick) * 0.8;
  const gifted = talent !== undefined && talent !== 'ordinary';
  const chance = data.crew.recruit.conditionChance * (strong || gifted ? 1.4 : 0.7);
  void state;
  return env.rng.fork('condition?', other.id).chance(Math.min(0.95, chance));
}

/** All doubts settled: they join, or name what they want first. */
export function conclude(env: LifeEnv, other: Entity, how: string): 'joined' | 'quest' | 'waiting' {
  const r = recruitOf(other);
  if (r.quest?.status === 'open') return 'waiting';
  if (r.quest === null && wantsCondition(env, other)) {
    startQuest(env, other);
    return 'quest';
  }
  const crewEnt = crewLedBy(env.state, env.p.entity) ?? foundCrew(env, { kind: 'pirate' });
  addMember(env, crewEnt, other, { how, loyalty: r.quest?.status === 'met' ? 12 : 0 });
  return 'joined';
}

/** Pitch someone. */
export function pitch(
  env: LifeEnv,
  otherId: string,
  pitchId: string,
): 'listening' | 'joined' | 'quest' | 'refused' {
  const { state, data, tick, p } = env;
  const other = state.entities[otherId];
  if (!other?.character) throw new CrewError('There is nobody of that name');
  const lock = pitchLock(state, data, p.entity, other);
  if (lock) throw new CrewError(lock);
  const pitchDef = byId(data.crew.recruit.pitches, pitchId);
  if (!pitchDef) throw new CrewError(`There is no pitch "${pitchId}"`);
  const r = recruitOf(other);
  if (r.listening) throw new CrewError('They are listening already: answer their doubts');
  if (r.quest?.status === 'open') throw new CrewError('They have named what they want first');
  const stamp = showStamp(state, data, p.entity);
  if (
    r.refused !== null &&
    tick - r.refused < data.crew.recruit.refusalMonths &&
    r.pitched.includes(pitchId) &&
    (r.refusedWith ?? 0) >= stamp
  )
    throw new CrewError(
      'They have heard that already: try something new, or show them something new',
    );
  if (pitchDef.berries > 0) {
    if (p.c.berries < pitchDef.berries)
      throw new CrewError(`That pitch needs ${pitchDef.berries} Berries up front`);
    pay(env, -pitchDef.berries);
  }
  // Someone on a list here (a board, a cell, an auction): met now, if not before.
  meet(env, other);
  const parts = pitchParts(state, data, p.entity, other, pitchId);
  const chance = pitchChance(data, parts);
  if (!r.pitched.includes(pitchId)) r.pitched.push(pitchId);
  const lands = env.rng.fork('pitch', otherId, pitchId, tick).chance(chance);
  if (!lands) {
    r.refused = tick;
    r.refusedWith = stamp;
    const record = crewSay(env, crewLedBy(state, p.entity), other, 'refused', {}, 'bad', [
      'recruit',
      'refused',
    ]);
    remember(state, data, other, {
      about: p.entity.id,
      kind: 'slight',
      weight: 3,
      place: hereOf(data, p.entity),
      seq: record.seq,
    });
    return 'refused';
  }
  r.listening = true;
  r.refused = null;
  crewSay(env, crewLedBy(state, p.entity), other, 'listening', {}, 'good', ['recruit']);
  if (openObjections(state, data, p.entity, other).length > 0) return 'listening';
  const how =
    typeof other.flags['recruit.source'] === 'string'
      ? (other.flags['recruit.source'] as string)
      : 'pitch';
  const done = conclude(env, other, how);
  return done === 'joined' ? 'joined' : done === 'quest' ? 'quest' : 'listening';
}

/** Answer one of their objections. */
export function answerObjection(
  env: LifeEnv,
  otherId: string,
  objectionId: string,
  answerId: string,
): 'answered' | 'refused' | 'joined' | 'quest' {
  const { state, data, tick, p } = env;
  const other = state.entities[otherId];
  if (!other?.character) throw new CrewError('There is nobody of that name');
  const r = recruitOf(other);
  if (!r.listening) throw new CrewError('Pitch them first');
  if (!openObjections(state, data, p.entity, other).includes(objectionId))
    throw new CrewError('That is not what worries them');
  const def = byId(data.crew.recruit.objections, objectionId);
  const answer = def?.answers.find((a) => a.id === answerId);
  if (!def || !answer) throw new CrewError(`No answer "${answerId}" to that`);
  const crewEnt = crewLedBy(state, p.entity);
  let ok = true;
  switch (answer.kind) {
    case 'check': {
      const rng = env.rng.fork('answer', otherId, objectionId, tick);
      if (answer.stat === 'combatPower') {
        ok = rng.chance(
          winChance(
            data,
            combatPowerOf(data, p.entity, tick),
            combatPowerOf(data, withBody(data, other, tick), tick),
          ),
        );
      } else {
        const stat = answer.stat ?? 'charisma';
        ok = rng.chance(successChance(statTotal(p.entity, stat, tick), answer.difficulty));
      }
      break;
    }
    case 'promise': {
      r.promised.push(objectionId);
      const record = appendLog(state, tick, {
        kind: 'life',
        summary: `You promised ${other.name}: ${answer.label.toLowerCase()}.`,
        tags: ['personal', 'crew', 'promise'],
        actorIds: [p.entity.id],
        targetIds: [other.id],
        place: hereOf(data, p.entity),
        cause: env.cause,
        knownBy: [p.entity.id],
      });
      remember(state, data, other, {
        about: p.entity.id,
        kind: 'promise',
        weight: 20,
        place: hereOf(data, p.entity),
        seq: record.seq,
      });
      break;
    }
    case 'pay':
      if (p.c.berries < answer.amount) throw new CrewError(`That needs ${answer.amount} Berries`);
      pay(env, -answer.amount);
      break;
    case 'deed':
      // A deed to show: their joining condition becomes "beat me", now.
      r.objections[objectionId] = true;
      startQuest(env, other, 'jc_duel');
      return 'quest';
  }
  if (!ok) {
    r.listening = false;
    r.refused = tick;
    r.refusedWith = showStamp(state, data, p.entity);
    crewSay(env, crewEnt, other, 'refused', {}, 'bad', ['recruit', 'refused']);
    return 'refused';
  }
  r.objections[objectionId] = true;
  crewSay(env, crewEnt, other, 'answered', {}, 'good', ['recruit']);
  if (openObjections(state, data, p.entity, other).length > 0) return 'answered';
  const how =
    typeof other.flags['recruit.source'] === 'string'
      ? (other.flags['recruit.source'] as string)
      : 'pitch';
  const done = conclude(env, other, how);
  return done === 'joined' ? 'joined' : done === 'quest' ? 'quest' : 'answered';
}
