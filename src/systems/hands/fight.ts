import type { BattleState, ShipInBattle } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { Entity } from '../../engine/state';
import type { LifeEnv } from '../life/env';
import { renderLife } from '../life/env';
import { absorbBlows, battleKit, spendKit } from './gear';
import { destroyItem, ensureHands, itemOf, itemStory } from './items';
import { ownShip } from './market';
import { designStats, shipStory, spiritSaves } from './ships';

/**
 * What a fight does to the things in hand (Phase 6): blades dull and wear (graded blades of the
 * best grades never break, black ones never chip), weapon skill grows with use, dials and nets
 * spent come off the gear, an impact dial soaks up the blows, and a sea fight's damage stays on the
 * ship that took it.
 */

export interface FightLine {
  text: string;
  tone: 'good' | 'bad' | 'plain' | 'alert';
}

export function handsAfterFight(env: LifeEnv, battle: BattleState, lines: FightLine[]): void {
  const { state, data, p, tick } = env;
  const me = battle.fighters.find((f) => f.player);
  if (!me || !p.c.hands) return;
  const rng = Rng.root(state.seed).fork('hands-fight', battle.id, tick);
  // Gear used in the fight.
  spendKit(state, data, p.entity, battleKit(state, data, p.entity), me.kit, tick);
  if (me.totals.taken > 0) absorbBlows(state, data, p.entity);
  // The weapons in hand.
  const used = me.totals.hits > 0 || me.totals.dealt > 0;
  const hands = ensureHands(p.entity);
  const foes = battle.fighters.filter((f) => f.side !== me.side).map((f) => f.name);
  for (const [i, id] of (me.weapon?.items ?? []).entries()) {
    const item = itemOf(state, id);
    const b = item?.item;
    if (!item || !b || b.holderId !== p.entity.id) continue;
    if (i === 0 && b.family) {
      const now = hands.skills[b.family] ?? 0;
      const gain = data.hands.skill.perFight * (battle.spar ? 0.5 : 1) * (1 - now / 105);
      hands.skills[b.family] = Math.min(100, Math.round((now + Math.max(0, gain)) * 100) / 100);
    }
    if (battle.spar || !used) continue;
    wear(env, item, rng.fork('wear', id), lines);
    if ((b.grade ?? 'ungraded') !== 'ungraded' && b.container !== 'destroyed')
      itemStory(item, tick, `Drawn by ${p.entity.name} against ${foes.slice(0, 2).join(' and ')}.`);
  }
  // A sea fight's damage stays on the ship.
  const mine = battle.ships[0];
  if (mine) shipAfterFight(env, mine, battle.ships[1]?.name ?? 'an enemy ship', lines);
}

function wear(env: LifeEnv, item: Entity, rng: Rng, lines: FightLine[]): void {
  const { state, data, tick } = env;
  const b = item.item;
  if (!b) return;
  const e = data.hands.edge;
  const grade = data.hands.grades[b.grade ?? 'ungraded'];
  if (b.sharpness !== undefined && !b.black) {
    const before = b.sharpness;
    b.sharpness = Math.max(0, before - rng.fork('edge').int(e.perFight.min, e.perFight.max));
    if (before >= e.dull && b.sharpness < e.dull)
      lines.push({
        text: renderLife(env, data.hands.lines['dulled'] ?? '', { item: item.name }),
        tone: 'bad',
      });
  }
  if (b.durability !== undefined && !grade?.unbreakable && !b.black) {
    b.durability = Math.max(0, b.durability - rng.fork('wear').int(e.wear.min, e.wear.max));
    if (b.durability <= 0) {
      destroyItem(state, data, item, tick, `Broke in ${env.p.entity.name}'s hands.`);
      lines.push({
        text: renderLife(env, data.hands.lines['broke'] ?? '', { item: item.name }),
        tone: 'bad',
      });
    }
  }
}

function shipAfterFight(env: LifeEnv, mine: ShipInBattle, enemy: string, lines: FightLine[]): void {
  const { state, p, tick } = env;
  const voyage = p.c.travel?.voyage;
  if (voyage?.vessel) {
    voyage.vessel.hull = Math.max(0, Math.min(voyage.vessel.maxHull, mine.hull));
    return;
  }
  const ship = ownShip(state, p);
  const s = ship?.ship;
  if (!ship || !s) return;
  s.hull = Math.max(0, mine.hull);
  shipStory(ship, tick, `Fought ${enemy}${mine.sunk ? ', and went down' : ''}.`);
  if ((mine.sunk || s.hull <= 0) && spiritSaves(env, ship)) {
    lines.push({
      text: `The ${ship.name.replace(/^the /i, '')} stayed afloat, somehow.`,
      tone: 'good',
    });
  }
}

/** The player's own ship as it goes into a sea fight: her hull, guns and speed from her design. */
export function ownShipInBattle(data: GameData, ship: Entity): Partial<ShipInBattle> {
  const s = ship.ship;
  if (!s) return {};
  const maxHull = ship.stats['hull']?.base ?? s.hull;
  const stats = s.design ? designStats(data, s.design) : null;
  return {
    hull: s.hull,
    maxHull,
    speed: ship.stats['speed']?.base ?? 120,
    ...(stats
      ? { cannons: Math.max(0, Math.round(stats.cannons + stats.ram / 10 + stats.boarding / 10)) }
      : {}),
  };
}
