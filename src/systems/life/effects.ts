import type { LifeEffect } from '../../engine/data/schemas';
import type { Entity, RelationKind } from '../../engine/state';
import { scheduleEvent } from '../events';
import { formatBerries } from '../genesis/text';
import { humanAgeOf, isMarried, livingRelations, reputation } from './body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from './env';
import { fallIll, hurt, injure, restore } from './health';
import { meetPerson, relate, shiftOpinion } from './people';
import { firstImpressions, giveTraitTo, removeTrait } from './traits';
import { raisePotential, trainStat } from './training';
import { delayVoyage, overboard, redirect, shipEffect } from '../voyage/sea';
import { countBehaviour, drift, driftCtxOf } from './personality';
import { dateOf, formatDate } from '../../engine/calendar';
import { hasKingsQualities, powerEvent, wake } from '../powers/haki';
import { curse, findFruit, hearRumour, revealSecret } from '../powers/fruits';
import { findSomething } from '../hands/gear';
import { giveMap } from '../hands/treasure';
import { loseCargo } from '../hands/market';
import {
  addProgress,
  breakthroughTrack,
  fightingTracks,
  openTrack,
  powerCtxOf,
  practiceTarget,
} from '../powers/tracks';

/**
 * What a month can do to a life, in one place: activity outcomes, job shifts and events all apply
 * their effects through here (data/life.json and the effect list in schemas.ts say what exists).
 *
 * Effects that decide what a sentence says (who was met, how much money) run before the sentence
 * is written; effects that write lines of their own (an injury, a fever, an arrest) run after it,
 * so the chronicle reads in the order things happened.
 */

/** The people an outcome may name, chosen once so its text and its effects agree. */
export type Cast = Partial<Record<string, Entity>>;

export interface EffectScope {
  cast: Cast;
  /** Filled by a relationship or opinion effect: {other}. */
  other?: Entity;
  /** Filled by a berries effect: {amount}. */
  amount?: number;
}

/** Effects that write their own line in the chronicle: applied after the outcome's sentence. */
export const AFTER_TEXT = new Set<LifeEffect['kind']>([
  'injury',
  'illness',
  'health',
  'potential',
  'arrest',
  'schedule',
  'redirect',
  'overboard',
  // Phase 4: powers write their own lines.
  'powerEvent',
  'powerPoints',
  'powerBreakthrough',
  'learnTrack',
  'findFruit',
  'fruitSecret',
  'fruitRumour',
  'wakeHaki',
]);

const OPINION_KIND: Record<string, RelationKind> = {
  parent: 'parent',
  sibling: 'sibling',
  mentor: 'mentor',
  friend: 'friend',
  rival: 'rival',
  sweetheart: 'sweetheart',
  protege: 'protege',
  child: 'child',
  guardian: 'guardian',
};

/** Jailed, or fined if the fine can be paid. */
export function arrest(env: LifeEnv, fine: number, months: number): void {
  const { life, p, data, tick } = env;
  if (fine > 0 && p.c.berries >= fine) {
    pay(env, -fine);
    const text = `You were caught and fined ${formatBerries(fine)} Berries.`;
    lifeLog(env, text, { kind: 'event', tags: ['personal', 'crime', 'money'] });
    reportLine(env, text, 'bad');
    return;
  }
  const stay = Math.max(1, months);
  life.jailedUntil = Math.max(life.jailedUntil ?? 0, tick + 1 + stay);
  // Phase 4: a cell for a fruit user means seastone cuffs.
  curse(env, life.jailedUntil, true);
  const text = renderLife(env, data.life.lines.jailed, { months: String(stay) });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'crime'], knownBy: ['*'] });
  reportLine(env, text, 'alert');
  if (life.job && stay >= 2) {
    const job = data.jobs[life.job.id];
    const lost = `You lost your job${job ? ` as ${job.name.toLowerCase()}` : ''} while you were inside.`;
    lifeLog(env, lost, { tags: ['personal', 'work'] });
    reportLine(env, lost, 'bad');
    life.job = null;
  }
  reputation(p.entity, 'infamy').base += 1;
}

export function applyLifeEffect(env: LifeEnv, effect: LifeEffect, scope: EffectScope): void {
  const { data, state, tick, p, life } = env;
  const rng = env.rng.fork('effect', effect.kind);
  switch (effect.kind) {
    case 'train':
      for (const [stat, points] of Object.entries(effect.stats))
        trainStat(data, p.entity, p.c, stat, points ?? 0, tick);
      break;
    case 'berries': {
      const amount = rng.int(Math.min(effect.min, effect.max), Math.max(effect.min, effect.max));
      pay(env, amount);
      scope.amount = Math.abs(amount);
      break;
    }
    case 'injury':
      injure(env, { severity: effect.severity, area: effect.area, cause: effect.cause });
      break;
    case 'illness':
      fallIll(env, effect.illness);
      break;
    case 'health':
      if (effect.fraction >= 0) restore(env, effect.fraction);
      else hurt(env, -effect.fraction, 'accident', 'an accident');
      break;
    case 'trait':
      giveTraitTo(
        data,
        p.entity,
        effect.trait,
        `${capitalSource(env.cause)}, ${formatDate(dateOf(data.calendar, tick))}`,
        tick,
      );
      break;
    case 'flag':
      p.entity.flags[effect.flag] = effect.value;
      break;
    case 'count': {
      const now = p.entity.flags[effect.flag];
      p.entity.flags[effect.flag] = (typeof now === 'number' ? now : 0) + effect.by;
      break;
    }
    case 'fame':
      reputation(p.entity, 'fame').base += effect.value;
      break;
    case 'infamy':
      reputation(p.entity, 'infamy').base += effect.value;
      break;
    case 'opinion': {
      if (effect.target === 'family') {
        for (const kind of ['parent', 'sibling', 'child', 'guardian'] as const) {
          for (const other of livingRelations(state, p.c, kind))
            shiftOpinion(p.entity, other.id, effect.value, tick);
        }
        break;
      }
      const other =
        scope.cast[effect.target] ??
        livingRelations(state, p.c, OPINION_KIND[effect.target] ?? 'friend')[0];
      if (other) {
        shiftOpinion(p.entity, other.id, effect.value, tick);
        scope.other = other;
      }
      break;
    }
    case 'relationship': {
      const other = meetPerson(state, data, p, rng, tick, humanAgeOf(data, p, tick), {
        ageOffset: effect.ageOffset,
        ...(effect.occupation !== undefined ? { occupation: effect.occupation } : {}),
        flags: effect.flags,
      });
      relate(p.entity, other, effect.role, effect.opinion, tick, rng.fork('relate'));
      firstImpressions(data, p.entity, other);
      scope.other = other;
      break;
    }
    case 'potential': {
      const stats = [...data.character.physical, ...data.character.mental];
      const stat = effect.stat === 'random' ? rng.pick(stats) : effect.stat;
      raisePotential(env, stat, rng.float(effect.min, effect.max), 'Breakthrough');
      break;
    }
    case 'marry': {
      const spouse = scope.cast['sweetheart'] ?? livingRelations(state, p.c, 'sweetheart')[0];
      if (!spouse || isMarried(p.entity)) break;
      p.entity.flags['married'] = true;
      spouse.flags['married'] = true;
      shiftOpinion(p.entity, spouse.id, 15, tick);
      shiftOpinion(spouse, p.entity.id, 15, tick);
      scope.other = spouse;
      break;
    }
    case 'conceive':
      life.expecting.push(tick + data.life.family.gestationMonths);
      break;
    case 'joinGang': {
      const gang = rng.fork('gang').pick(data.life.gangNames);
      life.gang = gang;
      p.entity.flags['gang.member'] = true;
      const members = rng.fork('members').int(effect.members.min, effect.members.max);
      for (let i = 0; i < members; i++) {
        const memberRng = rng.fork('member', i);
        const other = meetPerson(state, data, p, memberRng, tick, humanAgeOf(data, p, tick), {
          ageOffset: { min: -2, max: 6 },
          flags: { 'gang.name': gang },
        });
        relate(
          p.entity,
          other,
          'friend',
          20 + memberRng.int(0, 30),
          tick,
          memberRng.fork('relate'),
        );
      }
      break;
    }
    case 'deed':
      // The outcome's own sentence is the deed; the caller records it once the text is written.
      break;
    case 'arrest':
      arrest(
        env,
        rng.fork('fine').int(effect.fine.min, effect.fine.max),
        rng.fork('months').int(effect.months.min, effect.months.max),
      );
      break;
    case 'schedule':
      scheduleEvent(
        state,
        effect.eventId,
        tick + effect.afterMonths,
        `life:${env.cause}`,
        env.causeSeq,
      );
      break;
    // Phase 3: the vessel the character is aboard (or their own ship, moored where they are).
    case 'hull':
      shipEffect(env, 'hull', effect.value);
      break;
    case 'supplies':
      shipEffect(env, 'supplies', effect.months);
      break;
    case 'crew':
      shipEffect(env, 'crew', effect.value);
      break;
    case 'morale':
      shipEffect(env, 'morale', effect.value);
      break;
    case 'delay':
      delayVoyage(env, effect.months);
      break;
    case 'redirect': {
      const voyage = p.c.travel?.voyage;
      if (voyage) redirect(env, voyage, 'redirect');
      break;
    }
    case 'overboard':
      if (p.c.travel?.voyage) overboard(env);
      break;
    case 'bounty': {
      const now = p.entity.flags['bounty'];
      const next = Math.max(0, (typeof now === 'number' ? now : 0) + effect.value);
      if (next > 0) p.entity.flags['bounty'] = next;
      else delete p.entity.flags['bounty'];
      if (effect.value > 0) reputation(p.entity, 'infamy').base += 1;
      break;
    }
    // Phase 4
    case 'drift':
      drift(driftCtxOf(env), effect.tags);
      break;
    case 'behaviour':
      countBehaviour(p.c, effect.counter, effect.by);
      break;
    case 'loseTrait':
      removeTrait(data, p.entity, effect.trait);
      break;
    case 'powerEvent':
      powerEvent(powerCtxOf(env), effect.event);
      break;
    case 'powerPoints': {
      const ctx = powerCtxOf(env);
      const target = effect.track ?? practiceTarget(p.c, data, fightingTracks(p.c, data));
      if (target) addProgress(ctx, target, effect.points, effect.practice);
      break;
    }
    case 'powerBreakthrough':
      breakthroughTrack(powerCtxOf(env), effect.track);
      break;
    case 'learnTrack':
      openTrack(powerCtxOf(env), effect.track, { source: env.cause });
      break;
    case 'findFruit':
      findFruit(env, {
        ...(effect.fruit !== undefined ? { fruit: effect.fruit } : {}),
        ...(effect.rarity !== undefined ? { rarity: effect.rarity } : {}),
      });
      break;
    case 'immerse':
      curse(env, tick + effect.months);
      break;
    case 'fruitSecret':
      revealSecret(env);
      break;
    case 'fruitRumour':
      hearRumour(env);
      break;
    case 'wakeHaki': {
      const ctx = powerCtxOf(env);
      if (effect.haki !== 'conqueror' || hasKingsQualities(data, p.c))
        wake(ctx, effect.haki, 'event');
      break;
    }
    // Phase 6: things in hand, maps, cargo.
    case 'findItem':
      findSomething(env, effect.item, effect.graded);
      break;
    case 'treasureMap':
      giveMap(env, effect.mapKind);
      break;
    case 'cargo':
      loseCargo(env, effect.share);
      break;
  }
}

/** "evt_pirates_in_harbour#fight" -> "An event" style source text for the sheet. */
function capitalSource(cause: string): string {
  if (cause.startsWith('evt_')) return 'An event';
  if (cause.startsWith('act_')) return 'Something you did';
  if (cause.startsWith('job_')) return 'Your work';
  if (cause.startsWith('beat_')) return 'History';
  return 'Life';
}
