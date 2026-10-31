import type { GameData } from '../../engine/data/schemas';
import type { ArcState, CrewMember, Entity, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { winChance } from '../battle/battle';
import { remember } from '../heart/memory';
import { combatPowerOf } from '../life/body';
import type { LifeEnv } from '../life/env';
import { crewSay, memberBreakthrough } from './members';
import { hereOf, crewLedBy, crewLog, kindOf, moveCrewBar, onHand, renderCrew } from './state';
import { giveBounty } from './bounty';

/**
 * Personal arcs (Phase 8, data/arcs): each crewmate carries 1 to 3 stories from their backstory
 * and dream. Their steps fire in the right places (months aboard, a new island, a region, a fight
 * of their own, training, talks with the captain, Berries, time asking around in port); finishing
 * one is a breakthrough (Phase 2: a stat's potential rises) and deepens the bond.
 */

function atPort(data: GameData, entity: Entity): string | null {
  return hereOf(data, entity);
}

/** Set a step going: where it starts, and its number. */
function beginStep(
  state: WorldState,
  data: GameData,
  arc: ArcState,
  entity: Entity,
  leader: Entity,
  tick: number,
): void {
  const def = data.arcs[arc.id];
  const step = def?.steps[arc.step];
  arc.since = tick;
  arc.place = atPort(data, leader);
  arc.goal = null;
  if (!step) return;
  if (step.kind === 'train' && step.stat) {
    const s = entity.stats[step.stat];
    arc.goal = Math.round(((s ? statValue(s, tick) : 0) + step.amount) * 10) / 10;
  } else if (step.kind === 'talk' || step.kind === 'port') arc.goal = step.amount;
  else if (step.kind === 'berries') arc.goal = step.amount;
  void state;
}

/** Is the step done now? (A fight is fought here when it is its turn.) */
function stepDone(env: LifeEnv, arc: ArcState, member: CrewMember, entity: Entity): boolean {
  const { state, data, tick, p } = env;
  const def = data.arcs[arc.id];
  const step = def?.steps[arc.step];
  if (!step) return true;
  const here = atPort(data, p.entity);
  switch (step.kind) {
    case 'serve':
      return tick - arc.since >= step.amount;
    case 'visit':
      return here !== null && here !== arc.place;
    case 'region':
      return here !== null && data.locations[here]?.region === step.region;
    case 'train': {
      const s = step.stat ? entity.stats[step.stat] : undefined;
      return s !== undefined && arc.goal !== null && statValue(s, tick) >= arc.goal;
    }
    case 'talk':
      return (arc.goal ?? 0) <= 0;
    case 'port':
      if (here !== null) arc.goal = (arc.goal ?? step.amount) - 1;
      return (arc.goal ?? 0) <= 0;
    case 'berries': {
      const crew = crewLedBy(state, p.entity)?.crew;
      if (crew && crew.treasury >= (arc.goal ?? 0)) {
        crew.treasury -= arc.goal ?? 0;
        arc.goal = 0;
      }
      return (arc.goal ?? 0) <= 0;
    }
    case 'fight': {
      // Someone from their past: a fight of their own, ashore, with the crew at their back.
      if (here === null || tick - arc.since < 1) return false;
      const crew = crewLedBy(state, p.entity)?.crew;
      const mine = combatPowerOf(data, entity, tick);
      const help = crew
        ? onHand(state, crew, tick).filter((m) => m.member.id !== member.id).length
        : 0;
      const chance = winChance(data, mine * (1 + help * 0.05), mine * step.power);
      const won = env.rng.fork('arc-fight', arc.id, entity.id, tick).chance(chance);
      if (!won) {
        member.hurtUntil = tick + 2;
        arc.since = tick + 2;
        return false;
      }
      const f = entity.character;
      if (f) {
        f.fights ??= { won: 0, lost: 0, drawn: 0, spars: 0, against: {} };
        f.fights.won += 1;
      }
      // An outlaw crew's fighter who wins a fight of their own is worth more to the law.
      const crewEnt = crewLedBy(state, p.entity);
      if (crewEnt?.crew && kindOf(data, crewEnt.crew).outlaw)
        giveBounty(
          env,
          crewEnt,
          entity,
          Math.round(mine * step.power * data.crew.bounty.perPower * 40),
        );
      return true;
    }
  }
  return false;
}

/** The month's arcs for one crewmate: at most one step a month. */
export function arcMonth(env: LifeEnv, crewEnt: Entity, member: CrewMember, entity: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew || member.away !== null) return;
  const arc = member.arcs.find((a) => !a.done && a.since <= tick);
  if (!arc) return;
  const def = data.arcs[arc.id];
  if (!def) {
    arc.done = true;
    return;
  }
  // A step that counts something starts its count the first month it is its turn.
  const kind = def.steps[arc.step]?.kind;
  if (
    arc.goal === null &&
    (kind === 'train' || kind === 'talk' || kind === 'port' || kind === 'berries')
  )
    beginStep(state, data, arc, entity, p.entity, tick);
  if (!stepDone(env, arc, member, entity)) return;
  const step = def.steps[arc.step];
  crewSay(
    env,
    crewEnt,
    entity,
    'arcStep',
    {
      arc: def.name.toLowerCase(),
      quest: step
        ? renderCrew(state, data, crewEnt, entity, step.line, env.rng.fork('arc-line', entity.id))
        : '',
    },
    'plain',
    ['arc', `arc:${arc.id}`],
  );
  arc.step += 1;
  if (arc.step < def.steps.length) {
    beginStep(state, data, arc, entity, p.entity, tick);
    return;
  }
  arc.done = true;
  arc.doneTick = tick;
  memberBreakthrough(
    entity,
    def.breakthrough,
    env.rng.fork('breakthrough', arc.id).float(2, 5),
    def.name,
  );
  const done = crewSay(env, crewEnt, entity, 'arcDone', { arc: def.name.toLowerCase() }, 'good', [
    'arc',
    'arcDone',
    `arcDone:${arc.id}`,
  ]);
  crewLog(crew, tick, `${entity.name}'s story was told: ${def.name.toLowerCase()}.`);
  moveCrewBar(data, p.entity, entity, 'loyalty', def.loyalty, def.name, done.seq, tick);
  moveCrewBar(data, p.entity, entity, 'belonging', def.loyalty / 2, def.name, done.seq, tick);
  remember(state, data, entity, {
    about: p.entity.id,
    kind: 'kindness',
    weight: 25,
    place: hereOf(data, p.entity),
    seq: done.seq,
  });
  // The next arc, if any, begins a little later.
  const next = member.arcs.find((a) => !a.done && a.id !== arc.id);
  if (next && next.since < tick + 3) next.since = tick + 3;
}

/** A talk with the captain counts toward an arc that needs talking (the crew's `talked` hook). */
export function arcTalked(state: WorldState, data: GameData, otherId: string): void {
  const crew = state.playerId ? crewLedBy(state, state.entities[state.playerId])?.crew : undefined;
  const member = crew?.members.find((m) => m.id === otherId);
  const arc = member?.arcs.find((a) => !a.done && a.since <= state.tick);
  // Only a talk step counts talks.
  if (!arc || arc.goal === null || data.arcs[arc.id]?.steps[arc.step]?.kind !== 'talk') return;
  arc.goal = Math.max(0, arc.goal - 1);
}
