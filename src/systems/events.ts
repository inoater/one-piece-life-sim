import { dateOf, templateVarsFor, type DateInfo } from '../engine/calendar';
import type { GameData, Effect, EventDef } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import type { NewsDraft, TickStep } from '../engine/pipeline';
import { PUBLIC_KNOWLEDGE, type EventRecord, type WorldState } from '../engine/state';
import { renderTemplate } from '../engine/template';

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

/** Effects available to events and choices: log, setFlag, schedule. Applied in order. */
function applyEffects(state: WorldState, effects: readonly Effect[], site: EffectSite): void {
  const vars = templateVarsFor(site.date);
  for (const effect of effects) {
    switch (effect.kind) {
      case 'log':
        appendLog(state, site.tick, {
          kind: 'effect',
          summary: renderTemplate(effect.text, vars),
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
    }
  }
}

export interface FireContext {
  tick: number;
  date: DateInfo;
  newsDrafts: NewsDraft[];
}

export function fireEvent(
  state: WorldState,
  def: EventDef,
  ctx: FireContext,
  causeSeq?: number,
): EventRecord {
  const vars = templateVarsFor(ctx.date);
  const knownBy = def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : [];
  const record = appendLog(state, ctx.tick, {
    kind: 'event',
    summary: renderTemplate(def.text, vars),
    tags: unique(['event', def.type, ...def.tags]),
    cause: def.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy,
  });

  applyEffects(state, def.effects, {
    tick: ctx.tick,
    date: ctx.date,
    cause: def.id,
    causeSeq: record.seq,
    knownBy,
  });

  if (def.news !== undefined) {
    ctx.newsDrafts.push({
      text: renderTemplate(def.news, vars),
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
  applyEffects(state, choice.effects, {
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
