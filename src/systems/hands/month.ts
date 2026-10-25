import type { Activity, GameData } from '../../engine/data/schemas';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { lifeLog, renderLife, reportLine, type LifeEnv } from '../life/env';
import { HAKI_TRACKS, hakiAwake, trackStateOf } from '../powers/state';
import { cookMonth } from './crafting';
import { curseMonth } from './curses';
import { rechargeMonth } from './gear';
import { ensureHands, itemStory } from './items';
import { cargoCount, marketsMonth, ownShip } from './market';
import { shipMonth, yardMonth } from './ships';
import { handsBuilt, swordsMonth } from './swords';
import { cachesYear, huntMonth } from './treasure';
import { inHand } from './weapons';

/**
 * The hands' part of the month (Phase 6): the player's (step 7: dials refill, a yard works on a
 * ship it was paid for, a ship's upkeep, care and spirit, the curses, a blade slowly turning black)
 * and the world's (step 4: canon weapons follow the story, markets settle, others dig treasure).
 * Activities with a `hand` (drills, a treasure hunt, ship care, cooking) act in step 1.
 */

export function handsMonth(env: LifeEnv): void {
  const { state, data, p } = env;
  if (!p.c.hands) return;
  rechargeMonth(state, data, p.entity);
  yardMonth(env);
  shipMonth(env);
  curseMonth(env);
  blackBladeMonth(env);
  p.entity.flags['hands.cargo'] = cargoCount(p.entity) > 0;
}

export function handsWorldMonth(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  news: NewsDraft[],
): void {
  if (!handsBuilt(state)) return;
  swordsMonth(state, data, tick, rng.fork('swords'));
  marketsMonth(state, data);
  cachesYear(state, data, tick, rng.fork('caches'), news);
}

/**
 * Years of Armament poured into a blade by a strong wielder turn it black for good: each month the
 * wielder practised or fought with it coated (Armament at the stage that coats a weapon) counts,
 * more for a stronger Armament.
 */
function blackBladeMonth(env: LifeEnv): void {
  const { state, data, p, tick } = env;
  const c = p.c;
  if (!hakiAwake(c, 'armament')) return;
  const ts = trackStateOf(c, HAKI_TRACKS.armament);
  const rule = data.hands.black;
  if (!ts || ts.stage < rule.armamentStage) return;
  const active = Object.values(c.powers?.tracks ?? {}).some((t) => t.lastUsed >= tick);
  if (!active) return;
  for (const item of inHand(state, data, p.entity)) {
    const b = item.item;
    if (!b || b.black || b.family !== 'blade') continue;
    b.blackness =
      Math.round(((b.blackness ?? 0) + 1 + (ts.stage - rule.armamentStage) * rule.perStage) * 100) /
      100;
    if (b.blackness < rule.months) continue;
    b.black = true;
    itemStory(item, tick, `Turned black in the hands of ${p.entity.name}.`);
    const text = renderLife(env, data.hands.lines['black'] ?? '', { item: item.name });
    lifeLog(env, text, { kind: 'event', tags: ['personal', 'sword', 'deed'] });
    reportLine(env, text, 'good');
    p.c.life?.deeds.push({ tick, text });
  }
}

/** The family a month of drills trains: the weapon in hand, or what the activity is about. */
function drillFamily(env: LifeEnv, act: Activity): string | null {
  const main = inHand(env.state, env.data, env.p.entity)[0];
  if (act.hand === 'drill') return main?.item?.family ?? null;
  if (act.tags.includes('blade')) return 'blade';
  if (act.id === 'act_marksmanship') return main?.item?.family === 'bow' ? 'bow' : 'firearm';
  return null;
}

/** What an activity with hands does in its month (step 1): drills, a hunt, ship care, cooking. */
export function handsActivity(env: LifeEnv, act: Activity, scale: number, rng: Rng): void {
  const { state, data, p } = env;
  const family = drillFamily(env, act);
  if (family) {
    const hands = ensureHands(p.entity);
    const now = hands.skills[family] ?? 0;
    const gain = data.hands.skill.perDrill * scale * (1 - now / 105);
    hands.skills[family] = Math.min(100, Math.round((now + Math.max(0, gain)) * 100) / 100);
  }
  switch (act.hand) {
    case 'treasure':
      huntMonth(env, scale, rng.fork('hunt'));
      break;
    case 'ship': {
      const ship = ownShip(state, p);
      const s = ship?.ship;
      if (!ship || !s) break;
      const max = ship.stats['hull']?.base ?? s.hull;
      s.hull = Math.min(max, s.hull + max * 0.05 * scale);
      s.care = (s.care ?? 0) + 1;
      const hands = ensureHands(p.entity);
      const skill = hands.crafts.shipbuilding ?? 0;
      hands.crafts.shipbuilding = Math.min(
        100,
        Math.round((skill + data.hands.craft.perMonth * 0.6 * scale * (1 - skill / 110)) * 100) /
          100,
      );
      break;
    }
    case 'cook':
      cookMonth(env, scale);
      break;
    default:
      break;
  }
}
