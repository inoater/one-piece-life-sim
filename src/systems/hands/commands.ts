import type { GameData } from '../../engine/data/schemas';
import { CRAFTS, type Craft, type ShipDesign } from '../../engine/data/defs';
import { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { ensureLife } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { priceMult } from '../places/place';
import { shipHere } from '../voyage/plan';
import { abandonProject, startProject, startTemper } from './crafting';
import { cleanse, syncCurseFlags, testFate } from './curses';
import { gamble } from './gambling';
import { call, getVivreCard, useCarried } from './gear';
import {
  canWieldMore,
  ensureHands,
  HandsError,
  itemOf,
  itemStory,
  makeItem,
  syncGear,
} from './items';
import { buyItem, sellItem, tradeGood } from './market';
import { hastenBuild, importDesign, refitShip, startBuild } from './ships';
import { ShipDesignSchema } from '../../engine/data/defs';

/**
 * What the player can do with their hands between months (Phase 6): buy and sell, take up and put
 * away, have a blade sharpened or mended, eat and take what they carry, trade goods, start a
 * project or a tempering, face a cursed blade's test, call someone, get a Vivre Card, gamble, and
 * build, hurry and refit ships. Each checks the same rules the views show and throws the reason.
 */

function commandEnv(state: WorldState, data: GameData, what: string): LifeEnv {
  const p = ensureLife(state, data);
  if (!p?.c.life || !p.c.alive) throw new HandsError('Nobody alive is being played');
  ensureHands(p.entity);
  return {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('command', what, state.counters.logSeq),
    p,
    life: p.c.life,
    cause: `action:${what}`,
  };
}

function smithHere(env: LifeEnv): void {
  if (env.p.place.atSea || !(env.p.place.features as readonly string[]).includes('smithy'))
    throw new HandsError('There is no smith here');
}

export type HandsCommand =
  | { type: 'hands/buy'; key: string }
  | { type: 'hands/sell'; item: string }
  | { type: 'hands/wield'; item: string; on: boolean }
  | { type: 'hands/wear'; item: string | null }
  | { type: 'hands/discard'; item: string }
  | { type: 'hands/sharpen'; item: string }
  | { type: 'hands/mend'; item: string }
  | { type: 'hands/use'; item: string }
  | { type: 'hands/trade'; good: string; qty: number }
  | { type: 'hands/craft'; recipe: string }
  | { type: 'hands/temper'; item: string }
  | { type: 'hands/abandon' }
  | { type: 'hands/fate'; item: string }
  | { type: 'hands/cleanse'; item: string }
  | { type: 'hands/call'; target: string }
  | { type: 'hands/vivre'; target: string }
  | { type: 'hands/gamble'; game: string; stake: number }
  | { type: 'ship/build'; design: ShipDesign; by: 'yard' | 'self' }
  | { type: 'ship/hasten'; months: number }
  | { type: 'ship/refit'; design: ShipDesign }
  | { type: 'ship/saveDesign'; design: ShipDesign }
  | { type: 'ship/deleteDesign'; index: number }
  | { type: 'ship/importDesign'; text: string }
  | { type: 'debug/giveItem'; item: string }
  | { type: 'debug/handSkill'; skill: string; value: number };

export function applyHandsCommand(state: WorldState, data: GameData, cmd: HandsCommand): void {
  const env = commandEnv(state, data, cmd.type);
  const { p, tick } = env;
  const hands = ensureHands(p.entity);
  const mine = (id: string) => {
    const item = itemOf(state, id);
    if (!item?.item || item.item.holderId !== p.entity.id)
      throw new HandsError('You do not carry that');
    return item;
  };
  switch (cmd.type) {
    case 'hands/buy':
      buyItem(env, cmd.key);
      break;
    case 'hands/sell':
      sellItem(env, cmd.item);
      break;
    case 'hands/wield': {
      const item = mine(cmd.item);
      if (!item.item?.family) throw new HandsError('That is not a weapon');
      if (cmd.on) {
        if (!canWieldMore(state, p.entity, item)) {
          // One weapon of another kind: whatever was in hand is put away.
          hands.wield = [];
        }
        if (!hands.wield.includes(item.id)) hands.wield.push(item.id);
        const text = renderLife(env, data.hands.lines['wield'] ?? '', { item: item.name });
        reportLine(env, text, 'plain');
      } else hands.wield = hands.wield.filter((id) => id !== item.id);
      syncGear(state, data, p.entity);
      break;
    }
    case 'hands/wear':
      if (cmd.item === null) hands.armour = null;
      else {
        const item = mine(cmd.item);
        if (data.items[item.item?.defId ?? '']?.kind !== 'armour')
          throw new HandsError('That is not armour');
        hands.armour = item.id;
      }
      syncGear(state, data, p.entity);
      break;
    case 'hands/discard': {
      const item = mine(cmd.item);
      const graded =
        (item.item?.grade ?? 'ungraded') !== 'ungraded' ||
        data.weapons[item.item?.defId ?? '']?.canon;
      if (graded) {
        // A graded blade is never simply gone: it lies where it was left.
        hands.items = hands.items.filter((id) => id !== item.id);
        hands.wield = hands.wield.filter((id) => id !== item.id);
        if (item.item) {
          item.item.holderId = null;
          item.item.container = p.place.atSea ? 'sunken' : 'lying';
          item.item.place = p.place.location?.id ?? null;
        }
        itemStory(item, tick, `Left behind by ${p.entity.name}.`);
      } else {
        hands.items = hands.items.filter((id) => id !== item.id);
        hands.wield = hands.wield.filter((id) => id !== item.id);
        if (hands.armour === item.id) hands.armour = null;
        delete state.entities[item.id];
      }
      syncGear(state, data, p.entity);
      reportLine(env, `You got rid of ${item.name}.`, 'plain');
      break;
    }
    case 'hands/sharpen': {
      smithHere(env);
      const item = mine(cmd.item);
      const b = item.item;
      if (b?.sharpness === undefined) throw new HandsError('It has no edge to sharpen');
      if (b.black) throw new HandsError('A black blade never loses its edge');
      if (b.sharpness >= 100) throw new HandsError('It is as sharp as it gets');
      const cost = Math.round(
        data.hands.edge.sharpenCost * priceMult(state, data, p.place.location?.id ?? ''),
      );
      if (p.c.berries < cost)
        throw new HandsError(`The smith wants ${formatBerries(cost)} Berries`);
      pay(env, -cost);
      b.sharpness = 100;
      const text = renderLife(env, data.hands.lines['sharpened'] ?? '', { item: item.name });
      lifeLog(env, text, { tags: ['personal', 'gear', 'money'] });
      reportLine(env, text, 'plain');
      break;
    }
    case 'hands/mend': {
      smithHere(env);
      const item = mine(cmd.item);
      const b = item.item;
      if (b?.durability === undefined || b.maxDurability === undefined)
        throw new HandsError('There is nothing to mend');
      const damage = b.maxDurability - b.durability;
      if (damage <= 0) throw new HandsError('It needs no mending');
      const cost = Math.round(
        damage *
          data.hands.edge.repairPerPoint *
          priceMult(state, data, p.place.location?.id ?? ''),
      );
      if (p.c.berries < cost)
        throw new HandsError(`The smith wants ${formatBerries(cost)} Berries`);
      pay(env, -cost);
      b.durability = b.maxDurability;
      const text = renderLife(env, data.hands.lines['repaired'] ?? '', { item: item.name });
      lifeLog(env, text, { tags: ['personal', 'gear', 'money'] });
      reportLine(env, text, 'plain');
      break;
    }
    case 'hands/use':
      useCarried(env, cmd.item);
      break;
    case 'hands/trade':
      tradeGood(env, cmd.good, cmd.qty);
      break;
    case 'hands/craft':
      startProject(env, cmd.recipe);
      break;
    case 'hands/temper':
      startTemper(env, cmd.item);
      break;
    case 'hands/abandon':
      abandonProject(env);
      break;
    case 'hands/fate':
      testFate(env, cmd.item);
      break;
    case 'hands/cleanse':
      cleanse(env, cmd.item);
      break;
    case 'hands/call':
      call(env, cmd.target);
      break;
    case 'hands/vivre':
      getVivreCard(env, cmd.target);
      break;
    case 'hands/gamble':
      gamble(env, cmd.game, cmd.stake);
      break;
    case 'ship/build':
      startBuild(env, cmd.design, cmd.by);
      break;
    case 'ship/hasten':
      hastenBuild(env, cmd.months);
      break;
    case 'ship/refit': {
      const ship = shipHere(state, p);
      if (!ship) throw new HandsError('You have no ship moored here');
      refitShip(env, ship, cmd.design);
      break;
    }
    case 'ship/saveDesign': {
      const design = ShipDesignSchema.parse(cmd.design);
      if (hands.designs.length >= 12) throw new HandsError('Twelve saved designs at most');
      hands.designs.push(design);
      reportLine(env, `Design saved${design.name ? `: ${design.name}` : ''}.`, 'plain');
      break;
    }
    case 'ship/deleteDesign':
      if (!hands.designs[cmd.index]) throw new HandsError('There is no such design');
      hands.designs.splice(cmd.index, 1);
      break;
    case 'ship/importDesign': {
      const design = importDesign(data, cmd.text);
      if (hands.designs.length >= 12) throw new HandsError('Twelve saved designs at most');
      hands.designs.push(design);
      reportLine(env, `Design added${design.name ? `: ${design.name}` : ''}.`, 'plain');
      break;
    }
    case 'debug/giveItem': {
      if (!data.weapons[cmd.item] && !data.items[cmd.item])
        throw new HandsError(`There is no item "${cmd.item}"`);
      makeItem(state, data, {
        defId: cmd.item,
        container: 'held',
        holder: p.entity,
        tick,
        story: 'Conjured by a debug command.',
      });
      syncCurseFlags(state, data, p.entity);
      break;
    }
    case 'debug/handSkill': {
      const value = Math.max(0, Math.min(100, cmd.value));
      if ((CRAFTS as readonly string[]).includes(cmd.skill))
        hands.crafts[cmd.skill as Craft] = value;
      else if (cmd.skill in data.hands.families) hands.skills[cmd.skill] = value;
      else throw new HandsError(`There is no skill "${cmd.skill}"`);
      break;
    }
  }
  syncCurseFlags(state, data, p.entity);
}
