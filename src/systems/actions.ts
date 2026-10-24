import { z } from 'zod';
import type { GameData } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import type { SideEffect, TickContext, TickStep } from '../engine/pipeline';
import {
  EFFORTS,
  FlagValueSchema,
  SCAR_AREAS,
  SEVERITIES,
  type QueuedAction,
  type WorldState,
} from '../engine/state';
import { CAPTAIN_ORDERS, TECH_FORMS, TECH_TAGS, TRAVEL_MODES } from '../engine/data/schemas';
import {
  abandonDraft,
  buyEncyclopedia,
  buyFruitCommand,
  buyGear,
  combineCommand,
  debugGiveFruit,
  debugPowerPoints,
  debugWakeHaki,
  eatCommand,
  identifyCommand,
  inventCommand,
  learnTrackCommand,
  renameMove,
  setFocus,
} from './powers/commands';
import { addDebugModifier, spawnTestEntity } from './devtools';
import { resolveDecision, scheduleEvent } from './events';
import { livePlayerRoutine } from './life';
import {
  carryOn,
  chooseJob,
  debugInjure,
  debugKill,
  enterOpenEnded,
  payDebt,
  setRoutine,
  takeLoan,
} from './life/commands';
import { CONTINUE_MODES } from './life/death';
import { ensureWorldLayer } from './places/history';
import { ensureFruitLayer } from './powers/month';
import {
  buyPose,
  buyShip,
  coatShip,
  debugKillEntity,
  debugTeleport,
  dismissHands,
  giveOrder,
  hireHands,
  provision,
  repairShip,
  sail,
  sellShip,
} from './voyage/commands';

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
  // ---- The life loop (Phase 2)
  z.strictObject({
    type: z.literal('life/routine'),
    routine: z
      .array(z.strictObject({ activity: z.string().min(1), effort: z.enum(EFFORTS) }))
      .max(6),
  }),
  z.strictObject({ type: z.literal('life/job'), jobId: z.string().min(1).nullable() }),
  z.strictObject({ type: z.literal('life/borrow'), amount: z.number().int().min(1) }),
  z.strictObject({ type: z.literal('life/repay'), amount: z.number().int().min(1) }),
  z.strictObject({
    type: z.literal('life/continue'),
    mode: z.enum(CONTINUE_MODES),
    targetId: z.string().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('life/openEnded') }),
  z.strictObject({
    type: z.literal('debug/injure'),
    severity: z.enum(SEVERITIES),
    area: z.union([z.enum(SCAR_AREAS), z.literal('roll')]).default('roll'),
  }),
  z.strictObject({
    type: z.literal('debug/kill'),
    cause: z.string().min(1).max(80).default('a debug command'),
  }),
  // ---- The world (Phase 3)
  z.strictObject({
    type: z.literal('travel/sail'),
    lane: z.string().min(1),
    mode: z.enum(TRAVEL_MODES),
  }),
  z.strictObject({ type: z.literal('travel/order'), order: z.enum(CAPTAIN_ORDERS) }),
  z.strictObject({ type: z.literal('travel/buyShip'), vessel: z.string().min(1) }),
  z.strictObject({ type: z.literal('travel/sellShip') }),
  z.strictObject({ type: z.literal('travel/hire'), count: z.number().int().min(1).max(200) }),
  z.strictObject({ type: z.literal('travel/dismiss'), count: z.number().int().min(1).max(200) }),
  z.strictObject({ type: z.literal('travel/provision'), months: z.number().int().min(1).max(24) }),
  z.strictObject({ type: z.literal('travel/repair') }),
  z.strictObject({ type: z.literal('travel/coat') }),
  z.strictObject({
    type: z.literal('travel/pose'),
    kind: z.enum(['log', 'eternal']),
    target: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('debug/killEntity'),
    entityId: z.string().min(1),
    cause: z.string().min(1).max(80).default('a debug command'),
  }),
  z.strictObject({ type: z.literal('debug/teleport'), location: z.string().min(1) }),
  // ---- Powers (Phase 4)
  z.strictObject({ type: z.literal('powers/learn'), track: z.string().min(1) }),
  z.strictObject({ type: z.literal('powers/focus'), track: z.string().min(1).nullable() }),
  z.strictObject({ type: z.literal('powers/eat'), fruit: z.string().min(1) }),
  z.strictObject({
    type: z.literal('powers/identify'),
    fruit: z.string().min(1),
    how: z.enum(['encyclopedia', 'scholar']),
  }),
  z.strictObject({ type: z.literal('powers/buyFruit'), fruit: z.string().min(1) }),
  z.strictObject({ type: z.literal('powers/buyGear'), weapon: z.string().min(1) }),
  z.strictObject({ type: z.literal('powers/buyEncyclopedia') }),
  z.strictObject({
    type: z.literal('powers/invent'),
    source: z.string().min(1),
    form: z.enum(TECH_FORMS),
    tag: z.enum(TECH_TAGS),
    name: z.string().min(1).max(40),
  }),
  z.strictObject({ type: z.literal('powers/abandon'), draft: z.string().min(1) }),
  z.strictObject({
    type: z.literal('powers/rename'),
    move: z.string().min(1),
    name: z.string().max(40),
  }),
  z.strictObject({
    type: z.literal('powers/combine'),
    partner: z.string().min(1),
    move: z.string().min(1),
    partnerMove: z.string().min(1),
    name: z.string().max(40),
  }),
  z.strictObject({ type: z.literal('debug/giveFruit'), fruit: z.string().min(1).optional() }),
  z.strictObject({
    type: z.literal('debug/wakeHaki'),
    haki: z.enum(['observation', 'armament', 'conqueror']),
  }),
  z.strictObject({
    type: z.literal('debug/powerPoints'),
    track: z.string().min(1),
    points: z.number().min(0).max(10000).default(0),
    breakthrough: z.boolean().default(false),
  }),
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

    case 'life/routine':
    case 'life/job':
    case 'life/borrow':
    case 'life/repay':
    case 'life/continue':
    case 'life/openEnded':
    case 'debug/injure':
    case 'debug/kill':
      try {
        applyLifeAction(state, data, action);
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(error instanceof Error ? error.message : String(error));
      }
      // A plan, a job, a loan: what the player decided survives closing the tab, like a decision.
      if (action.type.startsWith('life/')) effects.push({ kind: 'autosave' });
      break;

    case 'travel/sail':
    case 'travel/order':
    case 'travel/buyShip':
    case 'travel/sellShip':
    case 'travel/hire':
    case 'travel/dismiss':
    case 'travel/provision':
    case 'travel/repair':
    case 'travel/coat':
    case 'travel/pose':
    case 'debug/killEntity':
    case 'debug/teleport':
      try {
        applyTravelAction(state, data, action);
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(error instanceof Error ? error.message : String(error));
      }
      // Setting sail, buying a ship: decisions that survive closing the tab.
      if (action.type.startsWith('travel/')) effects.push({ kind: 'autosave' });
      break;

    case 'powers/learn':
    case 'powers/focus':
    case 'powers/eat':
    case 'powers/identify':
    case 'powers/buyFruit':
    case 'powers/buyGear':
    case 'powers/buyEncyclopedia':
    case 'powers/invent':
    case 'powers/abandon':
    case 'powers/rename':
    case 'powers/combine':
    case 'debug/giveFruit':
    case 'debug/wakeHaki':
    case 'debug/powerPoints':
      try {
        applyPowersAction(state, data, action);
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(error instanceof Error ? error.message : String(error));
      }
      // Eating a fruit, choosing a style: decisions that survive closing the tab.
      if (action.type.startsWith('powers/')) effects.push({ kind: 'autosave' });
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

type LifeAction = Extract<
  Action,
  {
    type:
      | 'life/routine'
      | 'life/job'
      | 'life/borrow'
      | 'life/repay'
      | 'life/continue'
      | 'life/openEnded'
      | 'debug/injure'
      | 'debug/kill';
  }
>;

function applyLifeAction(state: WorldState, data: GameData, action: LifeAction): void {
  switch (action.type) {
    case 'life/routine':
      setRoutine(state, data, action.routine);
      break;
    case 'life/job':
      chooseJob(state, data, action.jobId);
      break;
    case 'life/borrow':
      takeLoan(state, data, action.amount);
      break;
    case 'life/repay':
      payDebt(state, data, action.amount);
      break;
    case 'life/continue':
      carryOn(state, data, action.mode, action.targetId);
      break;
    case 'life/openEnded':
      enterOpenEnded(state, data);
      break;
    case 'debug/injure':
      debugInjure(state, data, action.severity, action.area);
      break;
    case 'debug/kill':
      debugKill(state, data, action.cause);
      break;
  }
}

type TravelAction = Extract<
  Action,
  { type: `travel/${string}` | 'debug/killEntity' | 'debug/teleport' }
>;

function applyTravelAction(state: WorldState, data: GameData, action: TravelAction): void {
  switch (action.type) {
    case 'travel/sail':
      sail(state, data, action.lane, action.mode);
      break;
    case 'travel/order':
      giveOrder(state, data, action.order);
      break;
    case 'travel/buyShip':
      buyShip(state, data, action.vessel);
      break;
    case 'travel/sellShip':
      sellShip(state, data);
      break;
    case 'travel/hire':
      hireHands(state, data, action.count);
      break;
    case 'travel/dismiss':
      dismissHands(state, data, action.count);
      break;
    case 'travel/provision':
      provision(state, data, action.months);
      break;
    case 'travel/repair':
      repairShip(state, data);
      break;
    case 'travel/coat':
      coatShip(state, data);
      break;
    case 'travel/pose':
      buyPose(state, data, action.kind, action.target);
      break;
    case 'debug/killEntity':
      debugKillEntity(state, data, action.entityId, action.cause);
      break;
    case 'debug/teleport':
      debugTeleport(state, data, action.location);
      break;
  }
}

type PowersAction = Extract<
  Action,
  { type: `powers/${string}` | 'debug/giveFruit' | 'debug/wakeHaki' | 'debug/powerPoints' }
>;

function applyPowersAction(state: WorldState, data: GameData, action: PowersAction): void {
  switch (action.type) {
    case 'powers/learn':
      learnTrackCommand(state, data, action.track);
      break;
    case 'powers/focus':
      setFocus(state, data, action.track);
      break;
    case 'powers/eat':
      eatCommand(state, data, action.fruit);
      break;
    case 'powers/identify':
      identifyCommand(state, data, action.fruit, action.how);
      break;
    case 'powers/buyFruit':
      buyFruitCommand(state, data, action.fruit);
      break;
    case 'powers/buyGear':
      buyGear(state, data, action.weapon);
      break;
    case 'powers/buyEncyclopedia':
      buyEncyclopedia(state, data);
      break;
    case 'powers/invent':
      inventCommand(state, data, {
        source: action.source,
        form: action.form,
        tag: action.tag,
        name: action.name,
      });
      break;
    case 'powers/abandon':
      abandonDraft(state, data, action.draft);
      break;
    case 'powers/rename':
      renameMove(state, data, action.move, action.name);
      break;
    case 'powers/combine':
      combineCommand(state, data, action.partner, action.move, action.partnerMove, action.name);
      break;
    case 'debug/giveFruit':
      debugGiveFruit(state, data, action.fruit);
      break;
    case 'debug/wakeHaki':
      debugWakeHaki(state, data, action.haki);
      break;
    case 'debug/powerPoints':
      debugPowerPoints(state, data, action.track, action.points, action.breakthrough);
      break;
  }
}

export type QueuedActionHandler = (
  state: WorldState,
  ctx: TickContext,
  action: QueuedAction,
) => void;

/**
 * Step 1: resolve the player's chosen actions: one-off queued actions in the order they were
 * queued, then the month's routine (`routine`, the life loop's activities since Phase 2).
 */
export function createResolveActionsStep(
  handlers: Readonly<Record<string, QueuedActionHandler>>,
  routine?: (state: WorldState, ctx: TickContext) => void,
  prepare?: (state: WorldState, ctx: TickContext) => void,
): TickStep {
  return {
    id: 'resolveActions',
    run(state, ctx) {
      prepare?.(state, ctx);
      if (state.queue.length === 0) {
        routine?.(state, ctx);
        return;
      }
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
      routine?.(state, ctx);
    },
  };
}

/**
 * Before anything else in a month: a world someone is living in needs its map, factions, canon
 * cast and people (Phase 3). A world saved before Phase 3 gets them, and its past, here.
 */
function prepareWorld(state: WorldState, ctx: TickContext): void {
  if (state.playerId !== null) {
    ensureWorldLayer(state, ctx.data);
    ensureFruitLayer(state, ctx.data);
  }
}

export const resolveActions = createResolveActionsStep({}, livePlayerRoutine, prepareWorld);
