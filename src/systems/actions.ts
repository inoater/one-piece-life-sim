import { z } from 'zod';
import type { GameData } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import type { SideEffect, TickContext, TickStep } from '../engine/pipeline';
import { FlagValueSchema, type QueuedAction, type WorldState } from '../engine/state';
import { addDebugModifier, spawnTestEntity } from './devtools';
import { resolveDecision, scheduleEvent } from './events';

/**
 * Actions: the only way the UI changes the world (rule 7: it reads state and sends actions).
 *
 * Two kinds, with different timing:
 *  - Immediate actions (decisions, debug tools) apply now, between ticks.
 *  - Queued actions are the player's chosen activities for the coming month. They wait in
 *    `state.queue` and are resolved by step 1 of the next tick. No activities exist yet (Phase 2
 *    registers train, work, rest and so on), so the handler table is empty today.
 *
 * Actions are validated at the boundary, so a malformed message fails with a clear error instead
 * of corrupting state.
 */

export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('decision/resolve'),
    decisionId: z.number().int().min(1),
    choiceId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('queue/add'),
    kind: z.string().min(1),
    payload: z.record(z.string(), FlagValueSchema).default({}),
  }),
  z.strictObject({ type: z.literal('debug/spawnTestEntity') }),
  z.strictObject({ type: z.literal('debug/forceEvent'), eventId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('debug/addModifier'),
    entityId: z.string().min(1),
    stat: z.string().min(1),
    value: z.number(),
    modKind: z.enum(['flat', 'pct']),
    months: z.number().int().min(1).max(1200).optional(),
    source: z.string().max(60).optional(),
  }),
  z.strictObject({ type: z.literal('debug/setOpenEnded'), value: z.boolean() }),
]);
export type Action = z.infer<typeof ActionSchema>;

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export interface ActionEnv {
  /** Debug actions are refused unless this is true (production builds pass false). */
  debug: boolean;
  /** Kinds that may be queued; defaults to none. */
  queueKinds?: readonly string[];
}

export function applyAction(
  state: WorldState,
  data: GameData,
  action: Action,
  env: ActionEnv,
): { effects: SideEffect[] } {
  if (action.type.startsWith('debug/') && !env.debug) {
    throw new ActionError('Debug actions are disabled in this build');
  }
  const effects: SideEffect[] = [];

  switch (action.type) {
    case 'decision/resolve':
      resolveDecision(state, data, action.decisionId, action.choiceId);
      effects.push({ kind: 'autosave' });
      break;

    case 'queue/add': {
      const kinds = env.queueKinds ?? [];
      if (!kinds.includes(action.kind)) {
        throw new ActionError(
          `"${action.kind}" is not an action kind${kinds.length > 0 ? ` (known: ${kinds.join(', ')})` : ' (no actions are registered yet)'}`,
        );
      }
      state.queue.push({ kind: action.kind, payload: action.payload });
      break;
    }

    case 'debug/spawnTestEntity':
      spawnTestEntity(state, data);
      break;

    case 'debug/forceEvent': {
      const def = data.events[action.eventId];
      if (!def) throw new ActionError(`There is no event "${action.eventId}"`);
      const record = appendLog(state, state.tick, {
        kind: 'system',
        summary: `Debug: forced ${def.id} to fire in the next month processed.`,
        tags: ['system', 'debug'],
        cause: 'action:debug/forceEvent',
      });
      scheduleEvent(state, def.id, state.tick, 'debug', record.seq);
      break;
    }

    case 'debug/addModifier':
      try {
        addDebugModifier(state, {
          entityId: action.entityId,
          stat: action.stat,
          value: action.value,
          kind: action.modKind,
          ...(action.months !== undefined ? { months: action.months } : {}),
          ...(action.source !== undefined ? { source: action.source } : {}),
        });
      } catch (error) {
        throw new ActionError(error instanceof Error ? error.message : String(error));
      }
      break;

    case 'debug/setOpenEnded':
      state.openEnded = action.value;
      appendLog(state, state.tick, {
        kind: 'system',
        summary: `Debug: open-ended play ${action.value ? 'enabled' : 'disabled'}.`,
        tags: ['system', 'debug'],
        cause: 'action:debug/setOpenEnded',
      });
      break;
  }
  return { effects };
}

export type QueuedActionHandler = (
  state: WorldState,
  ctx: TickContext,
  action: QueuedAction,
) => void;

/** Step 1: resolve the player's chosen actions, in the order they were queued. */
export function createResolveActionsStep(
  handlers: Readonly<Record<string, QueuedActionHandler>>,
): TickStep {
  return {
    id: 'resolveActions',
    run(state, ctx) {
      if (state.queue.length === 0) return;
      const queued = state.queue;
      state.queue = [];
      for (const action of queued) {
        const handler = handlers[action.kind];
        if (!handler) {
          appendLog(state, ctx.tick, {
            kind: 'system',
            summary: `Queued action "${action.kind}" has no handler and was dropped.`,
            tags: ['system', 'warning'],
            cause: 'sys:resolveActions',
          });
          continue;
        }
        handler(state, ctx, action);
      }
    },
  };
}

export const resolveActions = createResolveActionsStep({});
