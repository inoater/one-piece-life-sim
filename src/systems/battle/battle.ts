import type {
  BattleSide,
  BattleState,
  Fighter,
  FighterMove,
  FrontState,
  ShipInBattle,
} from '../../engine/battle-state';
import type { GameData, TechniqueDef } from '../../engine/data/schemas';
import { dpow } from '../../engine/dmath';
import { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { compatible } from '../powers/techniques';
import { decide } from './ai';
import { canTouch, matchupOf, runExchange, settle, type BattleCtx, type Plan } from './engine';

/**
 * A battle from start to end (Phase 5): who stands where, their bonds, and the loop that runs
 * exchanges (or, for crew battles, naval battles and wars, rounds; see scales.ts) until it is over.
 * The abstract resolver below answers the same question in one roll, for fights nobody plays.
 */

export interface NewBattle {
  id: number;
  scale: BattleState['scale'];
  mode: BattleState['mode'];
  tick: number;
  place: string | null;
  fighters: Fighter[];
  sides: [string, string];
  source: BattleState['source'];
  spar?: boolean;
  stop?: BattleState['stop'];
  contest?: string | null;
  water?: boolean;
  weather?: string | null;
  maxExchanges?: number;
  stance?: string;
  ranks?: [number, number];
  rankPower?: [number, number];
  ships?: ShipInBattle[];
  fronts?: FrontState[];
}

function side(data: GameData, name: string, ranks: number, rankPower: number): BattleSide {
  return {
    name,
    morale: data.battle.morale.start,
    order: 'none',
    target: null,
    ranks,
    rankPower,
    broken: false,
  };
}

export function newBattle(data: GameData, opts: NewBattle): BattleState {
  const exchanges =
    opts.maxExchanges ??
    (opts.spar
      ? data.battle.spar.timeLimit
      : opts.scale === 'duel'
        ? 40
        : opts.scale === 'skirmish'
          ? 50
          : 200);
  return {
    id: opts.id,
    scale: opts.scale,
    mode: opts.mode,
    stop: opts.stop ?? null,
    spar: opts.spar ?? false,
    contest: opts.contest ?? null,
    water: opts.water ?? false,
    weather: opts.weather ?? null,
    place: opts.place,
    tick: opts.tick,
    exchange: 0,
    maxExchanges: exchanges,
    fighters: opts.fighters,
    sides: [
      side(data, opts.sides[0], opts.ranks?.[0] ?? 0, opts.rankPower?.[0] ?? 0),
      side(data, opts.sides[1], opts.ranks?.[1] ?? 0, opts.rankPower?.[1] ?? 0),
    ],
    stance: opts.stance ?? data.battle.stances[0]?.id ?? 'all_out',
    board: [],
    ships: opts.ships ?? [],
    range: opts.ships && opts.ships.length > 0 ? 'far' : null,
    boarded: false,
    fronts: opts.fronts ?? [],
    playerFront: 0,
    round: 0,
    log: [],
    source: opts.source,
    decisionId: null,
    card: [],
    result: null,
  };
}

/** The battle's own random stream: the world's seed and the battle's number (rule 6). */
export function battleRng(seed: string, battleId: number): Rng {
  return Rng.root(seed).fork('battle', battleId);
}

export function ctxOf(
  state: WorldState | { seed: string },
  data: GameData,
  battle: BattleState,
): BattleCtx {
  return { battle, data, rng: battleRng(state.seed, battle.id) };
}

/** Write "the Marines against you and Kibbo" style openings. */
export function openingLine(ctx: BattleCtx): void {
  const names = (s: 0 | 1) => {
    const fs = ctx.battle.fighters.filter((f) => f.side === s && !f.reserve);
    const named = fs.slice(0, 3).map((f) => f.name);
    const more = fs.length - named.length + Math.round(ctx.battle.sides[s].ranks);
    return more > 0 ? `${named.join(', ')} and ${more} more` : named.join(' and ');
  };
  ctx.battle.log.push({
    exchange: 0,
    text: `${names(0)} against ${names(1)}.`,
    tone: 'plain',
  });
}

// ---- Bonds and combinations ----------------------------------------------------------------------

function asDef(m: FighterMove): Pick<TechniqueDef, 'tags' | 'form'> {
  return {
    tags: m.tags as TechniqueDef['tags'],
    form: (m.form ?? 'strike') as TechniqueDef['form'],
  };
}

/**
 * Each fighter's opinion of their allies (taking the blow), and the pairs who can strike as one: a
 * combination technique they made together, or two moves that fit (Phase 4's rule), between
 * people bonded enough both ways.
 */
export function setBonds(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  tick: number,
): void {
  for (const f of battle.fighters) {
    const c = f.entityId ? state.entities[f.entityId]?.character : undefined;
    for (const ally of battle.fighters) {
      if (ally.side !== f.side || ally.id === f.id || !ally.entityId) continue;
      const rel = c?.relationships.find((r) => r.id === ally.entityId);
      if (rel) f.bonds[ally.id] = Math.round(statValue(rel.opinion, tick));
    }
  }
  const min = data.battle.combo.bond;
  for (const f of battle.fighters) {
    for (const ally of battle.fighters) {
      if (ally.side !== f.side || ally.id === f.id || f.combos[ally.id]) continue;
      const made = f.moves.find((m) => m.source === 'combo' && m.partner === ally.entityId);
      if (made && ally.moves.some((m) => m.id === made.id)) {
        f.combos[ally.id] = made.id;
        ally.combos[f.id] = made.id;
        continue;
      }
      if ((f.bonds[ally.id] ?? 0) < min || (ally.bonds[f.id] ?? 0) < min) continue;
      for (const mine of f.moves.filter((m) => m.power > 0)) {
        const theirs = ally.moves.find(
          (m) => m.power > 0 && compatible(asDef(mine) as TechniqueDef, asDef(m) as TechniqueDef),
        );
        if (theirs) {
          f.combos[ally.id] = mine.id;
          ally.combos[f.id] = theirs.id;
          break;
        }
      }
    }
  }
}

// ---- Running a fight ---------------------------------------------------------------------------

export type Decide = (ctx: BattleCtx, f: Fighter, rng: Rng) => Plan;

/** Exchanges until it is over (duels and skirmishes). */
export function runDuel(
  ctx: BattleCtx,
  makeHelper?: (caller: Fighter) => Fighter | null,
  choose: Decide = decide,
): void {
  let guard = 0;
  while (!settle(ctx) && guard < 1000) {
    runExchange(ctx, new Map(), choose, makeHelper);
    guard += 1;
  }
}

// ---- The abstract resolver ---------------------------------------------------------------------

/**
 * One fighter's weight in a fight nobody plays: their Combat Power and what is left of their
 * Health, cut to a sliver if they cannot touch anyone on the other side (a Logia and no haki), and
 * shifted by the best matchup they have against the strongest of them.
 */
export function effectivePower(data: GameData, f: Fighter, enemies: readonly Fighter[]): number {
  const rules = data.battle.abstract;
  const ctx = { data, battle: null as never, rng: Rng.root('abstract') } as BattleCtx;
  let p = Math.max(1, f.cp) * Math.max(0.05, f.hp / f.maxHp);
  if (f.cursed) p *= 0.1;
  if (enemies.length === 0) return p;
  const touchable = enemies.filter(
    (e) => canTouch(ctx, f, e, null) || f.moves.some((m) => canTouch(ctx, f, e, m)),
  );
  if (touchable.length === 0) return p * rules.blocked;
  const main = [...enemies].sort((x, y) => y.cp - x.cp)[0] as Fighter;
  let best = 0;
  for (const m of [null, ...f.moves]) {
    const r = matchupOf(ctx, f, main, m)?.result;
    const step =
      r === 'wins' || r === 'solidifies'
        ? 1
        : r === 'loses' || r === 'weakened'
          ? -1
          : r === 'immune' || r === 'nullifies'
            ? -2
            : 0;
    if (Math.abs(step) > Math.abs(best) || (step > 0 && best <= 0)) best = step;
  }
  return p * Math.max(0.1, 1 + best * rules.matchup);
}

/** A side's strength: its fighters' effective power summed (to a Lanchester-ish exponent), and its rank and file. */
export function sidePower(
  data: GameData,
  mine: readonly Fighter[],
  theirs: readonly Fighter[],
  ranks = 0,
  rankPower = 0,
): number {
  const e = data.battle.abstract.teamExponent;
  let sum = 0;
  for (const f of mine) sum += dpow(effectivePower(data, f, theirs), e);
  sum += ranks * dpow(Math.max(0, rankPower), e);
  return sum > 0 ? dpow(sum, 1 / Math.max(0.01, e)) : 0;
}

/** The chance the first side wins: a^g / (a^g + b^g). */
export function winChance(data: GameData, a: number, b: number): number {
  const g = data.battle.abstract.gamma;
  if (a <= 0 && b <= 0) return 0.5;
  if (a <= 0) return 0;
  if (b <= 0) return 1;
  // a^g / (a^g + b^g), written as 1 / (1 + (b/a)^g) so huge powers do not overflow.
  return 1 / (1 + dpow(b / a, g));
}

export interface AbstractResult {
  winner: 0 | 1;
  chance: number;
}

/** A fight nobody plays, in one roll. */
export function resolveAbstract(
  data: GameData,
  side0: readonly Fighter[],
  side1: readonly Fighter[],
  rng: Rng,
): AbstractResult {
  const chance = winChance(data, sidePower(data, side0, side1), sidePower(data, side1, side0));
  return { winner: rng.chance(chance) ? 0 : 1, chance };
}
