import { dateOf, templateVarsFor, type DateInfo } from '../engine/calendar';
import type { GameData, Effect, EventDef } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import type { NewsDraft, TickStep } from '../engine/pipeline';
import { PUBLIC_KNOWLEDGE, type EventRecord, type WorldState } from '../engine/state';
import { Rng } from '../engine/rng';
import { renderTemplate } from '../engine/template';
import { ensureLife } from './life/body';
import { applyLifeEffect } from './life/effects';
import type { LifeEnv } from './life/env';

/**
 * Values for {player.*} and {legacy.*} in event text. A world with no player (a debug world, or
 * one made before Phase 1) still renders: the variables fall back to neutral words.
 */
export function storyVars(state: WorldState, data: GameData): Record<string, string> {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const c = player?.character;
  const parentId = c?.family?.parentIds.find((id) => {
    const parent = state.entities[id];
    return parent !== undefined && typeof parent.flags['family.title'] === 'string';
  });
  const parent = parentId ? state.entities[parentId] : undefined;
  const pronouns = parent?.character?.pronouns;
  return {
    'player.name': player?.name ?? 'someone',
    'player.givenName': c?.givenName ?? player?.name ?? 'someone',
    'player.familyName': c?.familyName || c?.givenName || player?.name || 'someone',
    'player.race': c ? (data.races[c.race]?.name ?? c.race) : 'person',
    'player.home': c ? (data.birthplaces[c.birthplace]?.home ?? 'home') : 'home',
    'legacy.parent':
      pronouns === 'he' ? 'your father' : pronouns === 'she' ? 'your mother' : 'your parent',
    'legacy.parentName': parent?.name ?? 'your parent',
  };
}

/** Event text starts a sentence even when its first word comes from a variable ("your father ..."). */
function sentence(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Step 5: roll events. Canon beats first, then random events.
 *
 * What exists in Phase 0 is the part everything else builds on:
 *  - a scheduler: events fire during the tick whose number is >= their scheduled tick;
 *  - firing: a log record, effects, optional news, and an optional decision for the player;
 *  - decisions: pending choices that stop time-skipping until resolved;
 *  - chains: an effect can schedule a follow-up N months later.
 *
 * Not yet: canon beats and random selection (candidate collection, weights, cooldowns,
 * conditions). Those arrive with the event engine in Phase 3. `conditions`, `weight` and
 * `cooldown` are validated but not evaluated; events are only fired when scheduled or forced.
 */

/** Remove repeats, keeping first-seen order: an event whose type is also one of its tags lists it once. */
function unique(tags: readonly string[]): string[] {
  return [...new Set(tags)];
}

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

export function scheduleEvent(
  state: WorldState,
  eventId: string,
  tick: number,
  source: string,
  causeSeq?: number,
): void {
  state.scheduled.push({ eventId, tick, source, ...(causeSeq !== undefined ? { causeSeq } : {}) });
}

interface EffectSite {
  tick: number;
  date: DateInfo;
  /** The event that caused these effects. */
  cause: string;
  /** The log record that caused them. */
  causeSeq: number;
  knownBy: string[];
}

/**
 * Effects available to events and choices: log, setFlag, schedule, and (since Phase 2) everything
 * a month of life can do to the player (money, injuries, traits, opinions...), applied through the
 * life loop. Applied in order. Life effects need someone alive to happen to; without a living
 * player they are skipped. Their randomness is keyed to the record that caused them.
 */
function applyEffects(
  state: WorldState,
  data: GameData,
  effects: readonly Effect[],
  site: EffectSite,
): void {
  const vars = { ...templateVarsFor(site.date), ...storyVars(state, data) };
  effects.forEach((effect, index) => {
    switch (effect.kind) {
      case 'log':
        appendLog(state, site.tick, {
          kind: 'effect',
          summary: sentence(renderTemplate(effect.text, vars)),
          tags: unique(['effect', ...effect.tags]),
          cause: site.cause,
          causeSeq: site.causeSeq,
          knownBy: site.knownBy,
        });
        break;
      case 'setFlag':
        state.flags[effect.flag] = effect.value;
        break;
      case 'schedule':
        scheduleEvent(
          state,
          effect.eventId,
          site.tick + effect.afterMonths,
          `chain:${site.cause}`,
          site.causeSeq,
        );
        break;
      default: {
        const p = ensureLife(state, data);
        if (!p?.c.life) break;
        const env: LifeEnv = {
          state,
          data,
          tick: site.tick,
          rng: Rng.root(state.seed).fork('eventEffect', site.causeSeq, index),
          p,
          life: p.c.life,
          cause: site.cause,
          causeSeq: site.causeSeq,
        };
        applyLifeEffect(env, effect, { cast: {} });
      }
    }
  });
}

export interface FireContext {
  tick: number;
  date: DateInfo;
  newsDrafts: NewsDraft[];
  data: GameData;
}

export function fireEvent(
  state: WorldState,
  def: EventDef,
  ctx: FireContext,
  causeSeq?: number,
): EventRecord {
  const vars = { ...templateVarsFor(ctx.date), ...storyVars(state, ctx.data) };
  const knownBy = def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : [];
  const record = appendLog(state, ctx.tick, {
    kind: 'event',
    summary: sentence(renderTemplate(def.text, vars)),
    tags: unique(['event', def.type, ...def.tags]),
    cause: def.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy,
  });

  applyEffects(state, ctx.data, def.effects, {
    tick: ctx.tick,
    date: ctx.date,
    cause: def.id,
    causeSeq: record.seq,
    knownBy,
  });

  if (def.news !== undefined) {
    ctx.newsDrafts.push({
      text: sentence(renderTemplate(def.news, vars)),
      tags: unique(['news', ...def.tags]),
      sourceSeq: record.seq,
    });
  }

  if (def.choices.length > 0) {
    state.counters.decisionId += 1;
    state.pending.push({
      id: state.counters.decisionId,
      eventId: def.id,
      firedTick: ctx.tick,
      recordSeq: record.seq,
      title: def.title,
      text: record.summary,
      choices: def.choices.map((c) => ({
        id: c.id,
        label: c.label,
        ...(c.text !== undefined ? { text: c.text } : {}),
      })),
    });
  }
  return record;
}

/**
 * Apply the player's choice to a pending decision. Effects count months from the current month
 * (`state.tick`, the month about to be lived).
 */
export function resolveDecision(
  state: WorldState,
  data: GameData,
  decisionId: number,
  choiceId: string,
): void {
  const index = state.pending.findIndex((d) => d.id === decisionId);
  const decision = state.pending[index];
  if (index === -1 || !decision) throw new EventError(`There is no pending decision ${decisionId}`);
  const def = data.events[decision.eventId];
  if (!def) {
    // The content was removed after the save was made. Drop the decision rather than leave the
    // world stuck on a choice nobody can resolve.
    state.pending.splice(index, 1);
    appendLog(state, state.tick, {
      kind: 'system',
      summary: `Decision "${decision.title}" was dropped: event "${decision.eventId}" no longer exists in the data.`,
      tags: ['system', 'warning'],
      cause: 'sys:resolveDecision',
      causeSeq: decision.recordSeq,
    });
    return;
  }
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) {
    const valid = def.choices.map((c) => c.id).join(', ');
    throw new EventError(`"${choiceId}" is not a choice of ${def.id} (choices: ${valid})`);
  }

  state.pending.splice(index, 1);
  const knownBy = def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : [];
  const record = appendLog(state, state.tick, {
    kind: 'decision',
    summary: `Chose "${choice.label}" (${decision.title}).`,
    tags: unique(['decision', ...def.tags]),
    cause: def.id,
    causeSeq: decision.recordSeq,
    knownBy,
  });
  applyEffects(state, data, choice.effects, {
    tick: state.tick,
    date: dateOf(data.calendar, state.tick),
    cause: def.id,
    causeSeq: record.seq,
    knownBy,
  });
}

export const rollEvents: TickStep = {
  id: 'rollEvents',
  run(state, ctx) {
    // 1. Canon beats (Phase 3).

    // 2. Scheduled events that are due. Events scheduled while these fire are at least a month
    //    away, so they are not picked up in the same tick.
    const due = state.scheduled.filter((s) => s.tick <= ctx.tick);
    if (due.length > 0) {
      state.scheduled = state.scheduled.filter((s) => s.tick > ctx.tick);
      for (const scheduled of due) {
        const def = ctx.data.events[scheduled.eventId];
        if (!def) {
          appendLog(state, ctx.tick, {
            kind: 'system',
            summary: `Scheduled event "${scheduled.eventId}" no longer exists in the data and was skipped.`,
            tags: ['system', 'warning'],
            cause: 'sys:scheduler',
          });
          continue;
        }
        fireEvent(state, def, ctx, scheduled.causeSeq);
      }
    }

    // 3. Random events (Phase 3).
  },
};
