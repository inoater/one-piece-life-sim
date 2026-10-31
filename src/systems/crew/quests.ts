import type { FightSpec, GameData, JoiningCondition } from '../../engine/data/schemas';
import { SWORD_GRADES } from '../../engine/data/defs';
import { Rng } from '../../engine/rng';
import { statLabel } from '../../engine/stats';
import type { Entity, WorldState } from '../../engine/state';
import { beginFight, buildFight } from '../battle/player';
import { sortedValues } from '../genesis/options';
import { axisValue, relOf, together } from '../heart/bonds';
import { repAt } from '../heart/deeds';
import { startHeartFight } from '../heart/effects';
import { ensureHeart, heartOrRoll } from '../heart/profile';
import { giveItem, carried } from '../hands/items';
import { shipNumbers } from '../hands/ships';
import { combatPowerOf, reputation, reputationValue, statTotal } from '../life/body';
import { relate } from '../life/people';
import { pay, type LifeEnv } from '../life/env';
import { makeNpc } from '../places/people';
import { isDev, locations } from '../places/graph';
import { setUser } from '../powers/fruits';
import { openTrack, powerCtxFor } from '../powers/tracks';
import { successChance } from '../story/checks';
import { addMember, crewSay } from './members';
import { roleFit, roleOf } from './roles';
import {
  hereOf,
  CrewError,
  crewLedBy,
  crewLine,
  membersOf,
  placeName,
  renderCrew,
  withBody,
} from './state';
import { pushCrewDecision } from './decisions';

/**
 * Joining conditions (Phase 8, data/conditions): what someone worth having wants before they join,
 * run end to end as a personal quest with a tracker. Twenty kinds: beat me in a duel, beat my
 * rival, save my village, pay my debt, find my sister, earn my master's blessing, take me
 * somewhere, show me strength, make a name, a real ship, a Devil Fruit, a sword worth carrying,
 * honour, the moment, teach me, break my friend out, pay up front, give it time, a doctor, beat
 * me at my own game. Some are done by what the player does anyway (strength, fame, a ship), some
 * by an action at the right place (`questAct`), and the moment by being there when it comes.
 */

function conditionWeight(
  state: WorldState,
  data: GameData,
  other: Entity,
  cond: JoiningCondition,
): number {
  const profile = heartOrRoll(state, data, other).profile;
  let w = cond.weight;
  for (const v of profile.values) w *= cond.values[v] ?? 1;
  for (const [axis, per] of Object.entries(cond.axes))
    w *= Math.max(0.2, 1 + ((per ?? 0) * (profile.axes[axis] ?? 0)) / 100);
  return w;
}

/** A place a condition can point at: somewhere else (not here), a Marine base, their home. */
function somewhere(data: GameData, rng: Rng, here: string | null, feature?: string): string | null {
  const places = locations(data).filter(
    (l) => !isDev(l) && l.id !== here && (!feature || l.features.includes(feature as never)),
  );
  const local = places.filter((l) => here && data.locations[here]?.region === l.region);
  const pool = local.length > 0 ? local : places;
  return pool.length > 0 ? rng.pick(pool).id : null;
}

/** Someone a condition needs (a rival, a master): a person of the place, made now. */
function personFor(
  env: LifeEnv,
  placeId: string,
  rng: Rng,
  power: number,
  occupation?: string,
): Entity | null {
  const loc = env.data.locations[placeId];
  if (!loc) return null;
  const e = makeNpc(env.state, env.data, loc, rng, env.tick, rng.fork('age').int(25, 55));
  if (!e?.character) return null;
  if (occupation) e.character.occupation = occupation;
  // Strong enough to be what the condition says.
  const now = combatPowerOf(env.data, e, env.tick);
  if (power > 0 && now > 0) {
    const k = Math.max(0.5, Math.min(4, power / now));
    for (const id of ['strength', 'speed', 'durability', 'dexterity', 'willpower', 'perception'])
      if (e.stats[id]) e.stats[id].base = Math.round(e.stats[id].base * k * 10) / 10;
  }
  return e;
}

/** Start their joining condition (chosen by their values and nature, unless named). */
export function startQuest(env: LifeEnv, other: Entity, conditionId?: string): void {
  const { state, data, tick, p } = env;
  const c = other.character;
  if (!c) return;
  c.recruit ??= {
    pitched: [],
    refused: null,
    refusedWith: null,
    objections: {},
    listening: true,
    quest: null,
    promised: [],
  };
  const rng = env.rng.fork('quest', other.id, tick);
  const pool = sortedValues(data.conditions);
  const cond = conditionId
    ? data.conditions[conditionId]
    : rng.weightedPick(pool, (x) => conditionWeight(state, data, other, x));
  if (!cond) throw new CrewError(`There is no joining condition "${conditionId ?? ''}"`);
  const here = hereOf(data, p.entity);
  const theirs = c.place ?? here;
  const quest = {
    id: cond.id,
    since: tick,
    place: null as string | null,
    target: null as string | null,
    amount: cond.amount,
    progress: 0,
    status: 'open' as const,
    at: null as number | null,
  };
  const cp = combatPowerOf(data, withBody(data, other, tick), tick);
  switch (cond.kind) {
    case 'duel':
      quest.amount = p.c.fights?.against[other.id]?.[0] ?? 0;
      break;
    case 'rival': {
      const place = theirs ?? here;
      const rival = place ? personFor(env, place, rng.fork('rival'), cp * cond.amount) : null;
      if (rival) {
        relate(other, rival, 'rival', -40, tick, rng.fork('relate'));
        quest.target = rival.id;
        quest.place = place;
        quest.amount = p.c.fights?.against[rival.id]?.[0] ?? 0;
      }
      break;
    }
    case 'home':
    case 'honour':
      quest.place = theirs;
      break;
    case 'kin':
    case 'escort':
      quest.place = somewhere(data, rng.fork('place'), here);
      break;
    case 'prison':
      quest.place = somewhere(data, rng.fork('place'), null, 'marine_base');
      break;
    case 'blessing': {
      const place = theirs ?? here;
      const master = place
        ? personFor(env, place, rng.fork('master'), cp * 1.3, 'occ_teacher')
        : null;
      if (master) {
        relate(other, master, 'mentor', 50, tick, rng.fork('relate'));
        quest.target = master.id;
        quest.place = place;
      }
      break;
    }
    case 'strength':
      quest.amount = Math.round(Math.max(cp, combatPowerOf(data, p.entity, tick)) * cond.amount);
      break;
    case 'fame':
      quest.amount = Math.round(
        Math.max(cond.amount, reputationValue(p.entity, 'fame', tick) + 10),
      );
      break;
    case 'moment':
      quest.at = tick + cond.months + rng.fork('at').int(0, 4);
      break;
    case 'contest': {
      const stats = [
        'strength',
        'speed',
        'endurance',
        'dexterity',
        'intellect',
        'perception',
        'charisma',
      ];
      quest.target = stats.reduce(
        (best, s) => (statTotal(other, s, tick) > statTotal(other, best, tick) ? s : best),
        'strength',
      );
      break;
    }
    default:
      break;
  }
  c.recruit.quest = quest;
  c.recruit.listening = true;
  const crewEnt = crewLedBy(state, p.entity);
  crewSay(
    env,
    crewEnt,
    other,
    'questStart',
    { quest: questText(state, data, other) ?? cond.name },
    'alert',
    ['quest', `quest:${cond.kind}`],
  );
  // "Take me somewhere": they come aboard now, bound for the place.
  if (cond.kind === 'escort' && quest.place && crewEnt) {
    addMember(env, crewEnt, other, { how: 'escort', bound: quest.place });
    c.recruit.quest = { ...quest };
  }
}

/** The tracker's line: "Beat Garo Ridgehorn in a duel". */
export function questText(state: WorldState, data: GameData, other: Entity): string | null {
  const q = other.character?.recruit?.quest;
  const cond = q ? data.conditions[q.id] : undefined;
  if (!q || !cond) return null;
  const target = q.target
    ? (state.entities[q.target]?.name ??
      (q.target in data.locations ? placeName(data, q.target) : statLabel(q.target).toLowerCase()))
    : 'someone';
  return renderCrew(state, data, null, other, cond.tracker, Rng.root(`quest:${other.id}`), {
    target,
    place: placeName(data, q.place),
    amount: Math.round(q.amount).toLocaleString('en-GB'),
    months: String(cond.months),
  });
}

/** Is their condition met now? (Read by the month, and by the person page's tracker.) */
export function questMet(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): boolean {
  const q = other.character?.recruit?.quest;
  const cond = q ? data.conditions[q.id] : undefined;
  if (!q || !cond || q.status !== 'open') return q?.status === 'met';
  const tick = state.tick;
  const c = player.character;
  if (!c) return false;
  switch (cond.kind) {
    case 'duel':
      return (c.fights?.against[other.id]?.[0] ?? 0) > q.amount || q.progress >= 1;
    case 'rival':
      return (
        (q.target !== null && (c.fights?.against[q.target]?.[0] ?? 0) > q.amount) || q.progress >= 1
      );
    case 'kin':
      return q.place !== null && hereOf(data, player) === q.place;
    case 'strength':
      return combatPowerOf(data, player, tick) >= q.amount;
    case 'fame':
      return reputationValue(player, 'fame', tick) >= q.amount;
    case 'ship': {
      const crew = crewLedBy(state, player)?.crew;
      const aboard = (crew?.members.length ?? 0) + 1;
      return Object.values(state.entities).some(
        (e) =>
          e.ship?.ownerId === player.id && !e.ship.sunk && shipNumbers(data, e).maxCrew > aboard,
      );
    }
    case 'honour': {
      const rep = repAt(state, ensureHeart(state, data, player), player, q.place);
      return rep.honour >= q.amount;
    }
    case 'trust': {
      const theirs = relOf(other, player.id);
      return (
        theirs !== undefined &&
        axisValue(data, theirs, 'trust', tick) >= q.amount &&
        tick - q.since >= cond.months
      );
    }
    case 'teach':
      return q.progress >= q.amount;
    case 'doctor': {
      const crew = crewLedBy(state, player)?.crew;
      const doctor = roleOf(data, 'doctor');
      const has =
        crew !== undefined &&
        doctor !== undefined &&
        membersOf(state, crew).some(
          ({ member, entity }) =>
            member.role === 'doctor' &&
            roleFit(data, entity, doctor, tick, member.mastery['doctor'] ?? 0).score >= 45,
        );
      return has || q.progress >= 1;
    }
    case 'escort':
      return q.progress >= 1;
    default:
      return q.progress >= 1;
  }
}

/** What doing it takes now, in a word for the page ("Go to Loguetown", "Pay 30,000"). */
export function questActs(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): { id: string; label: string; lock: string | null }[] {
  const q = other.character?.recruit?.quest;
  const cond = q ? data.conditions[q.id] : undefined;
  if (!q || !cond || q.status !== 'open') return [];
  const here = hereOf(data, player);
  const atSea =
    player.character?.travel?.voyage !== null && player.character?.travel?.voyage !== undefined;
  const at = (place: string | null) =>
    atSea || here !== place ? `Go to ${placeName(data, place)}` : null;
  const money = (n: number) =>
    (player.character?.berries ?? 0) < n ? `Needs ${n.toLocaleString('en-GB')} Berries` : null;
  switch (cond.kind) {
    case 'duel':
      return [
        {
          id: 'fight',
          label: `Fight ${other.name}`,
          lock: together(data, player, other) ? null : 'They are not here',
        },
      ];
    case 'rival': {
      const rival = q.target ? state.entities[q.target] : undefined;
      return [
        {
          id: 'fight',
          label: `Fight ${rival?.name ?? 'the rival'}`,
          lock: !rival?.character?.alive ? 'Gone' : at(q.place),
        },
      ];
    }
    case 'home':
      return [{ id: 'fight', label: 'Drive the bandits out', lock: at(q.place) }];
    case 'debt':
    case 'signing':
      return [
        {
          id: 'pay',
          label: `Pay ${Math.round(q.amount).toLocaleString('en-GB')} Berries`,
          lock: money(q.amount),
        },
      ];
    case 'doctor':
      return [
        {
          id: 'pay',
          label: `Pay ${Math.round(q.amount).toLocaleString('en-GB')} Berries for medicine`,
          lock: money(q.amount),
        },
      ];
    case 'fruit':
      return [
        {
          id: 'give',
          label: 'Give them a Devil Fruit',
          lock: uneatenFruit(state, player) ? null : 'You carry no Devil Fruit',
        },
      ];
    case 'blade':
      return [
        {
          id: 'give',
          label: 'Give them a sword',
          lock: gradedBlade(state, player) ? null : 'You carry no graded sword',
        },
      ];
    case 'teach':
      return [
        { id: 'lesson', label: 'Give a lesson', lock: teachLock(state, data, player, other) },
      ];
    case 'prison':
      return [
        {
          id: 'pay',
          label: `Pay the bail (${Math.round(q.amount).toLocaleString('en-GB')})`,
          lock: at(q.place) ?? money(q.amount),
        },
        { id: 'fight', label: 'Break them out', lock: at(q.place) },
      ];
    case 'blessing':
      return [
        {
          id: 'ask',
          label: `Ask ${state.entities[q.target ?? '']?.name ?? 'the master'} for a blessing`,
          lock: at(q.place),
        },
      ];
    case 'contest':
      return [
        {
          id: 'contest',
          label: `Challenge them at ${statLabel(q.target ?? 'strength').toLowerCase()}`,
          lock: together(data, player, other) ? null : 'They are not here',
        },
      ];
    default:
      return [];
  }
}

function uneatenFruit(state: WorldState, player: Entity): Entity | undefined {
  return Object.values(state.entities).find(
    (e) => e.fruit?.holderId === player.id && e.fruit.container !== 'eaten',
  );
}

function gradedBlade(state: WorldState, player: Entity): Entity | undefined {
  const ok = SWORD_GRADES.slice(0, SWORD_GRADES.indexOf('graded') + 1) as readonly string[];
  return carried(state, player).find(
    (i) => i.item?.grade !== undefined && ok.includes(i.item.grade),
  );
}

function teachLock(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): string | null {
  const q = other.character?.recruit?.quest;
  if (!together(data, player, other)) return 'They are not here';
  if (q?.at === state.tick) return 'One lesson a month';
  return styleToTeach(data, player) ? null : 'You have no style to teach';
}

function styleToTeach(data: GameData, player: Entity): string | null {
  const tracks = player.character?.powers?.tracks ?? {};
  for (const id of Object.keys(tracks).sort()) {
    const t = data.tracks[id];
    if (
      t &&
      (t.family === 'style' || t.family === 'sword' || t.family === 'six_powers') &&
      (tracks[id]?.stage ?? 0) >= 1
    )
      return id;
  }
  return null;
}

/** A fight for a quest (bandits at home, guards at a cell): the player and whoever is with them. */
function questFight(env: LifeEnv, other: Entity, kind: 'home' | 'prison', count: number): void {
  const { state, data, tick } = env;
  const band = { text: 'The fight is over.', effects: [] };
  const spec: FightSpec = {
    scale: 'skirmish',
    foes: [{ kind: 'foe', foe: kind === 'home' ? 'foe_bandit' : 'foe_marine', count }],
    intent: 'capture',
    mine: 'capture',
    allies: 'friends',
    mode: 'prefer',
    fronts: [],
    water: false,
    success: band,
    failure: band,
  };
  const battle = buildFight(state, data, spec, {
    tick,
    place: hereOf(data, env.p.entity),
    roles: { other: other.id },
    source: { kind: 'heart', id: `crew:${kind}`, roles: { other: other.id } },
  });
  beginFight(state, data, battle, kind === 'home' ? 'The bandits' : 'The guards');
}

/** Do what the quest asks, here and now. */
export function questAct(env: LifeEnv, otherId: string, act: string): void {
  const { state, data, tick, p } = env;
  const other = state.entities[otherId];
  const q = other?.character?.recruit?.quest;
  const cond = q ? data.conditions[q.id] : undefined;
  if (!other || !q || !cond || q.status !== 'open')
    throw new CrewError('They have asked nothing of you');
  const option = questActs(state, data, p.entity, other).find((a) => a.id === act);
  if (!option) throw new CrewError('That will not do it');
  if (option.lock) throw new CrewError(option.lock);
  const rng = env.rng.fork('quest-act', otherId, act, tick);
  switch (cond.kind) {
    case 'duel':
      startHeartFight(env, other, 'duel', 'crew:duel', `You fight ${other.name}`);
      break;
    case 'rival': {
      const rival = state.entities[q.target ?? ''];
      if (rival) startHeartFight(env, rival, 'duel', 'crew:rival', `You fight ${rival.name}`);
      break;
    }
    case 'home':
      questFight(env, other, 'home', 3 + rng.int(0, 2));
      break;
    case 'debt':
    case 'signing':
    case 'doctor':
      pay(env, -Math.round(q.amount));
      q.progress = 1;
      break;
    case 'fruit': {
      const fruit = uneatenFruit(state, p.entity);
      if (!fruit) throw new CrewError('You carry no Devil Fruit');
      setUser(state, data, fruit, other, {
        tick,
        text: `Given to ${other.name} by ${p.entity.name}, who ate it.`,
      });
      q.progress = 1;
      break;
    }
    case 'blade': {
      const blade = gradedBlade(state, p.entity);
      if (!blade) throw new CrewError('You carry no graded sword');
      giveItem(state, data, blade, other, tick, `Given to ${other.name} by ${p.entity.name}.`);
      q.progress = 1;
      break;
    }
    case 'teach': {
      q.progress += 1;
      q.at = tick;
      const style = styleToTeach(data, p.entity);
      const ctx = powerCtxFor(state, data, other, tick, rng);
      if (style && ctx && q.progress >= q.amount)
        openTrack(ctx, style, {
          source: `Taught by ${p.entity.name}`,
          teacherMult: 1.3,
          quiet: true,
        });
      crewSay(
        env,
        crewLedBy(state, p.entity),
        other,
        'taught',
        { other: 'them', target: style ? (data.tracks[style]?.name ?? 'fighting') : 'fighting' },
        'good',
        ['lesson'],
      );
      break;
    }
    case 'prison':
      if (act === 'pay') {
        pay(env, -Math.round(q.amount));
        q.progress = 1;
      } else questFight(env, other, 'prison', 2 + rng.int(0, 2));
      break;
    case 'blessing': {
      const master = state.entities[q.target ?? ''];
      const respect = master
        ? axisValue(
            data,
            relOf(master, p.entity.id) ?? {
              id: '',
              kind: 'friend',
              opinion: { base: 0, mods: [] },
              sinceTick: tick,
            },
            'respect',
            tick,
          )
        : 0;
      const chance = successChance(
        statTotal(p.entity, 'charisma', tick) +
          respect * 0.5 +
          combatPowerOf(data, p.entity, tick) / 40,
        45,
      );
      if (rng.chance(chance)) q.progress = 1;
      else
        crewSay(env, crewLedBy(state, p.entity), master ?? other, 'refused', {}, 'bad', ['quest']);
      break;
    }
    case 'contest': {
      const stat = q.target ?? 'strength';
      const chance = successChance(statTotal(p.entity, stat, tick), statTotal(other, stat, tick));
      if (rng.chance(chance)) q.progress = 1;
      else crewSay(env, crewLedBy(state, p.entity), other, 'refused', {}, 'bad', ['quest']);
      break;
    }
    default:
      throw new CrewError('Nothing to do but what it says');
  }
}

/** A quest fight is over (the crew's `fought` hook): a win does it. */
export function questFightDone(
  state: WorldState,
  data: GameData,
  sourceId: string,
  otherId: string | undefined,
  won: boolean,
): void {
  if (!otherId || !won) return;
  const other = state.entities[otherId];
  const q = other?.character?.recruit?.quest;
  if (!q || q.status !== 'open') return;
  const kind = data.conditions[q.id]?.kind;
  if (
    (sourceId === 'crew:home' && kind === 'home') ||
    (sourceId === 'crew:prison' && kind === 'prison') ||
    (sourceId === 'crew:rival' && kind === 'rival') ||
    (sourceId === 'crew:duel' && kind === 'duel')
  )
    q.progress = 1;
}

/**
 * The month's quests: a condition met brings them in (with the bond of having been asked and
 * answered); one left too long is given up; the moment, when it comes, finds the player there or
 * does not.
 */
export function questMonth(env: LifeEnv, joinWith: (other: Entity) => void): void {
  const { state, data, tick, p } = env;
  for (const rel of [...p.c.relationships]) {
    const other = state.entities[rel.id];
    const q = other?.character?.recruit?.quest;
    if (!other?.character?.alive || !q || q.status !== 'open') continue;
    const cond = data.conditions[q.id];
    if (!cond) continue;
    if (cond.expires > 0 && tick - q.since > cond.expires) {
      q.status = 'failed';
      crewSay(
        env,
        crewLedBy(state, p.entity),
        other,
        'questFailed',
        { quest: questText(state, data, other) ?? cond.name },
        'bad',
        ['quest'],
      );
      continue;
    }
    if (cond.kind === 'moment' && q.at !== null && tick >= q.at) {
      if (together(data, p.entity, other)) {
        q.at = null;
        pushCrewDecision(state, data, {
          kind: 'moment',
          title: `${other.name}, at the lowest point`,
          text: renderCrew(
            state,
            data,
            crewLedBy(state, p.entity),
            other,
            '{name} has lost everything this month: home, work, and the people {they} counted on. {say.sad}',
            env.rng.fork('moment', other.id),
            {},
          ),
          choices: [
            { id: 'help', label: 'Be there for them' },
            { id: 'leave', label: 'Leave them to it' },
          ],
          roles: { other: other.id },
        });
      } else q.at = tick + 6;
      continue;
    }
    if (!questMet(state, data, p.entity, other)) continue;
    q.status = 'met';
    p.entity.flags['crew.quests'] =
      (typeof p.entity.flags['crew.quests'] === 'number'
        ? (p.entity.flags['crew.quests'] as number)
        : 0) + 1;
    crewSay(
      env,
      crewLedBy(state, p.entity),
      other,
      'questDone',
      { quest: questText(state, data, other) ?? cond.name },
      'good',
      ['quest', `questDone:${cond.kind}`],
    );
    if (other.flags['crew.of'] !== p.entity.id) joinWith(other);
  }
}

export { crewLine, reputation };
