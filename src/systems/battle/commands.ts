import type { BattleVerb, FightSpec, GameData } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';
import type { Plan } from './engine';
import {
  battleAct,
  BattleError,
  beginFight,
  buildFight,
  buyKit,
  moveFront,
  setBoardCommand,
  setMode,
  setOrder,
  setStance,
} from './player';
import type { NavalPlan } from './scales';

/**
 * The player's battle commands (Phase 5), checked and applied. The UI sends these; nothing here
 * reads the page (rule 7).
 */

export type BattleCommand =
  | {
      type: 'battle/act';
      verb: BattleVerb;
      move?: string | undefined;
      target?: string | undefined;
      item?: string | undefined;
      haki?: 'read' | 'coat' | 'burst' | undefined;
      talk?: 'taunt' | 'surrender' | 'persuade' | 'stall' | undefined;
      partner?: string | undefined;
    }
  | { type: 'battle/naval'; move: NavalPlan['move']; attack: NavalPlan['attack'] }
  | { type: 'battle/stance'; stance: string }
  | { type: 'battle/mode'; mode: 'tactical' | 'quick' }
  | { type: 'battle/order'; order: string; target: string | null }
  | { type: 'battle/board'; pairs: [string, string][] }
  | { type: 'battle/front'; index: number }
  | { type: 'battle/buyKit'; item: string }
  | {
      type: 'debug/fight';
      foe: string;
      count: number;
      scale: 'duel' | 'skirmish' | 'crew' | 'naval' | 'war';
      intent: 'spare' | 'capture' | 'kill';
      mode: 'tactical' | 'quick';
    };

function planOf(c: Extract<BattleCommand, { type: 'battle/act' }>): Plan {
  const plan: Plan = { verb: c.verb };
  if (c.move) plan.move = c.move;
  if (c.target) plan.target = c.target;
  if (c.item) plan.item = c.item;
  if (c.haki) plan.haki = c.haki;
  if (c.talk) plan.talk = c.talk;
  if (c.partner) plan.partner = c.partner;
  return plan;
}

/** A fight to test the engine with from the debug panel: foes of a kind, at a scale. */
function debugFight(
  state: WorldState,
  data: GameData,
  c: Extract<BattleCommand, { type: 'debug/fight' }>,
): void {
  if (!data.battle.foes.some((f) => f.id === c.foe)) throw new BattleError(`No foe "${c.foe}"`);
  const band = { text: 'The debug fight is over.', effects: [] };
  const spec: FightSpec = {
    scale: c.scale,
    foes: [{ kind: 'foe', foe: c.foe, count: c.count }],
    intent: c.intent,
    mine: 'spare',
    allies: c.scale === 'crew' || c.scale === 'naval' ? 'crew' : 'none',
    mode: c.mode,
    fronts:
      c.scale === 'war'
        ? [
            { name: 'The left', mine: { strength: 200 }, theirs: { strength: 220 } },
            { name: 'The centre', mine: { strength: 300 }, theirs: { strength: 300 } },
          ]
        : [],
    water: false,
    ...(c.scale === 'naval' ? { ship: { vessel: 'vessel_caravel', crew: 12 } } : {}),
    success: band,
    failure: band,
  };
  const p = state.playerId ? state.entities[state.playerId] : undefined;
  const battle = buildFight(state, data, spec, {
    tick: state.tick,
    place: p?.character?.place ?? null,
    roles: {},
    source: { kind: 'debug', id: 'debug_fight' },
  });
  beginFight(state, data, battle, 'A debug fight');
}

export function applyBattleCommand(state: WorldState, data: GameData, c: BattleCommand): void {
  switch (c.type) {
    case 'battle/act':
      battleAct(state, data, planOf(c));
      return;
    case 'battle/naval':
      battleAct(state, data, { verb: 'guard' }, { move: c.move, attack: c.attack });
      return;
    case 'battle/stance':
      setStance(state, data, c.stance);
      return;
    case 'battle/mode':
      setMode(state, data, c.mode);
      return;
    case 'battle/order':
      if (!data.battle.orders.some((o) => o.id === c.order))
        throw new BattleError(`No order "${c.order}"`);
      setOrder(state, c.order, c.target);
      return;
    case 'battle/board':
      setBoardCommand(state, c.pairs);
      return;
    case 'battle/front':
      moveFront(state, c.index);
      return;
    case 'battle/buyKit':
      buyKit(state, data, c.item);
      return;
    case 'debug/fight':
      debugFight(state, data, c);
      return;
  }
}
