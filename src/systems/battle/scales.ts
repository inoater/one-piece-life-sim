import type { BattleState, Fighter, ShipInBattle } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import { decide } from './ai';
import { winChance, type Decide } from './battle';
import {
  active,
  fighter,
  runExchange,
  say,
  settle,
  standing,
  type BattleCtx,
  type Plan,
} from './engine';

/**
 * The larger scales (Phase 5), on the same exchange engine:
 *
 *  - crew battle: up to about a hundred a side. The named fighters the match-up board pairs off
 *    fight duels, exchange by exchange; everyone else (the rank and file, and the named left off
 *    the board) fights at the fronts, resolved in rounds by strength. A duel won frees its winner
 *    for another match-up or the fronts. Morale breaks a side.
 *  - naval battle: ship against ship, round by round: close, hold or flee; fire, ram or board. A
 *    boarding turns it into a crew battle on the decks; a ship that sinks takes its fruit users
 *    with it unless someone pulls them out.
 *  - war: fronts with strength, morale and a commander each, resolved a round at a time; the named
 *    duel is wherever the player stands, and a commander falling, or a Conqueror's burst over a
 *    weak front, can break it.
 */

export type MakeHelper = (caller: Fighter) => Fighter | null;

// ---- The match-up board ------------------------------------------------------------------------

/** Odds in words, the way the board tells them. */
export function oddsWords(chance: number): string {
  if (chance >= 0.9) return 'almost certain';
  if (chance >= 0.7) return 'likely';
  if (chance >= 0.55) return 'a fair chance';
  if (chance >= 0.45) return 'even';
  if (chance >= 0.3) return 'a hard fight';
  if (chance >= 0.1) return 'a long shot';
  return 'hopeless';
}

/** The chance `a` beats `b` one to one (the abstract resolver's answer, fitted to the engine). */
export function duelOdds(data: GameData, a: Fighter, b: Fighter): number {
  return winChance(data, a.cp * (a.hp / a.maxHp), b.cp * (b.hp / b.maxHp));
}

function named(battle: BattleState, side: 0 | 1): Fighter[] {
  return battle.fighters.filter((f) => f.side === side && f.down === null && !f.reserve);
}

/** Put the board in place: these pairs fight duels, everyone else goes to the fronts. */
export function setBoard(battle: BattleState, pairs: readonly (readonly [string, string])[]): void {
  battle.board = [];
  const used = new Set<string>();
  for (const [a, b] of pairs) {
    const fa = fighter(battle, a);
    const fb = fighter(battle, b);
    if (!fa || !fb || fa.side === fb.side || fa.down || fb.down || used.has(a) || used.has(b))
      continue;
    battle.board.push(fa.side === 0 ? [a, b] : [b, a]);
    used.add(a);
    used.add(b);
  }
  for (const f of battle.fighters) f.front = f.down === null && !f.reserve && !used.has(f.id);
}

/**
 * The computer's board: each of its best fighters against the strongest enemy still free (the
 * classic way, splitting a crew across the enemy's officers). The player's own pairing, if they
 * made one, is kept.
 */
export function autoBoard(
  battle: BattleState,
  keep: readonly (readonly [string, string])[] = [],
): void {
  const pairs: [string, string][] = keep.map(([a, b]) => [a, b]);
  const taken = new Set(pairs.flat());
  const free = (side: 0 | 1) =>
    named(battle, side)
      .filter((f) => !taken.has(f.id))
      .sort((x, y) => y.cp - x.cp || (x.id < y.id ? -1 : 1));
  const mine = free(0);
  const theirs = free(1);
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
    pairs.push([(mine[i] as Fighter).id, (theirs[i] as Fighter).id]);
  }
  setBoard(battle, pairs);
}

/** Keep each duel on the board to its own pair. */
function boardDecide(choose: Decide): Decide {
  return (ctx, f, rng) => {
    const plan = choose(ctx, f, rng);
    const pair = ctx.battle.board.find(([a, b]) => a === f.id || b === f.id);
    if (!pair) return plan;
    const foe = pair[0] === f.id ? pair[1] : pair[0];
    const target = fighter(ctx.battle, foe);
    return target && active(target) && plan.verb !== 'flee' && !plan.partner
      ? { ...plan, target: foe }
      : plan;
  };
}

// ---- Fronts ------------------------------------------------------------------------------------

function frontStrength(battle: BattleState, side: 0 | 1): number {
  const s = battle.sides[side];
  let sum = s.ranks * s.rankPower;
  for (const f of battle.fighters) {
    if (f.side === side && f.front && f.down === null) sum += f.cp * (f.hp / f.maxHp);
  }
  return sum;
}

/** The fronts' round: each side loses numbers by the other's strength; named fighters there are worn down. */
function frontsRound(ctx: BattleCtx, rng: Rng): void {
  const { battle, data } = ctx;
  const loss = data.battle.crew.frontLoss;
  const strength = [frontStrength(battle, 0), frontStrength(battle, 1)] as const;
  if (strength[0] + strength[1] <= 0) return;
  for (const side of [0, 1] as const) {
    const other = strength[side === 0 ? 1 : 0];
    const share = other / (strength[0] + strength[1]);
    const s = battle.sides[side];
    const lost = Math.min(
      s.ranks,
      s.ranks * loss * 2 * share * rng.fork('ranks', side).float(0.7, 1.3),
    );
    s.ranks = Math.round((s.ranks - lost) * 10) / 10;
    if (s.ranks + lost > 0) s.morale -= 20 * (lost / Math.max(1, s.ranks + lost));
    for (const f of battle.fighters) {
      if (f.side !== side || !f.front || f.down !== null) continue;
      f.hp -= Math.round(f.maxHp * loss * share * rng.fork('front', f.id).float(0.5, 1.5));
      if (f.hp <= 0) {
        f.hp = 0;
        f.down = 'ko';
        say(ctx, 'knocked_out', { b: f.name }, side === 0 ? 'bad' : 'good');
        s.morale -= f.leader ? data.battle.morale.leaderDown : data.battle.morale.memberDown;
      }
    }
  }
}

/** Duels that ended free their winners: a new match-up if an enemy is free, else the fronts. */
function reboard(battle: BattleState): void {
  const keep = battle.board.filter(([a, b]) => {
    const fa = fighter(battle, a);
    const fb = fighter(battle, b);
    return fa?.down === null && fb?.down === null;
  });
  if (keep.length === battle.board.length) return;
  // Winners rejoin as free fighters; the board pairs them again if it can.
  for (const f of battle.fighters) if (f.down === null) f.front = false;
  autoBoard(battle, keep);
}

function crewOver(ctx: BattleCtx): boolean {
  const { battle, data } = ctx;
  if (battle.result) return true;
  for (const side of [0, 1] as const) {
    const s = battle.sides[side];
    const left = named(battle, side).length > 0 || s.ranks >= 1;
    if (!left || (s.broken && s.morale <= data.battle.morale.breakAt)) {
      for (const f of named(battle, side)) f.down = 'fled';
      return settle(ctx);
    }
  }
  if (battle.round >= data.battle.crew.maxRounds) {
    const a =
      frontStrength(battle, 0) + named(battle, 0).reduce((n, f) => n + f.cp * (f.hp / f.maxHp), 0);
    const b =
      frontStrength(battle, 1) + named(battle, 1).reduce((n, f) => n + f.cp * (f.hp / f.maxHp), 0);
    const loser = a >= b ? 1 : 0;
    for (const f of named(battle, loser)) f.down = 'fled';
    battle.sides[loser].ranks = 0;
    return settle(ctx);
  }
  return false;
}

/** One exchange of a crew battle (and every few, a round at the fronts). */
function crewExchange(
  ctx: BattleCtx,
  plans: ReadonlyMap<string, Plan>,
  choose: Decide,
  makeHelper?: MakeHelper,
): boolean {
  const { battle, data } = ctx;
  if (battle.board.length === 0 && battle.exchange === 0) autoBoard(battle);
  runExchange(ctx, plans, boardDecide(choose), makeHelper);
  if (battle.exchange % data.battle.crew.exchangesPerRound === 0) {
    battle.round += 1;
    frontsRound(ctx, ctx.rng.fork('fronts', battle.round));
    for (const side of [0, 1] as const) {
      const s = battle.sides[side];
      if (!s.broken && s.morale <= data.battle.morale.breakAt) {
        s.broken = true;
        say(ctx, 'morale_break', { side: s.name }, side === 0 ? 'bad' : 'good');
      }
    }
  }
  reboard(battle);
  return crewOver(ctx);
}

// ---- Naval -------------------------------------------------------------------------------------

export interface NavalPlan {
  move: 'close' | 'hold' | 'flee';
  attack: 'fire' | 'ram' | 'board' | 'none';
}

const RANGES = ['far', 'near', 'adjacent'] as const;

function crewStrength(battle: BattleState, side: 0 | 1): number {
  return frontStrength(battle, side) + named(battle, side).reduce((n, f) => n + f.cp, 0);
}

/** The computer's captain: board a weaker crew, shell a stronger one, run from a much stronger ship. */
export function navalDecide(battle: BattleState, side: 0 | 1): NavalPlan {
  const me = battle.ships[side] as ShipInBattle;
  const them = battle.ships[side === 0 ? 1 : 0] as ShipInBattle;
  const mine = crewStrength(battle, side);
  const theirs = crewStrength(battle, side === 0 ? 1 : 0);
  const outgunned = me.cannons * me.hull < them.cannons * them.hull * 0.5;
  if (mine < theirs * 0.5 && outgunned) return { move: 'flee', attack: 'fire' };
  if (mine >= theirs * 1.1)
    return { move: 'close', attack: battle.range === 'adjacent' ? 'board' : 'fire' };
  return { move: 'hold', attack: battle.range === 'adjacent' ? 'ram' : 'fire' };
}

function sinkShip(ctx: BattleCtx, side: 0 | 1): void {
  const { battle } = ctx;
  const ship = battle.ships[side] as ShipInBattle;
  ship.sunk = true;
  say(ctx, 'naval_sunk', { b: ship.name }, side === 0 ? 'alert' : 'good');
  // Everyone goes into the sea: fruit users sink unless someone hauls them out.
  for (const f of battle.fighters.filter((x) => x.side === side && x.down === null)) {
    f.zone = 'water';
    if (f.fruit && !f.swimmer) {
      const rescuer = battle.fighters.find(
        (r) => r.side === side && r.down === null && r.id !== f.id && (r.swimmer || !r.fruit),
      );
      if (rescuer) say(ctx, 'rescued', { a: rescuer.name, b: f.name }, 'plain');
      else {
        f.down = 'dead';
        say(ctx, 'drowned', { b: f.name }, 'alert');
        continue;
      }
    }
    f.down = 'fled';
  }
  battle.sides[side].ranks = 0;
}

/** One round of ship against ship. */
function navalRound(ctx: BattleCtx, plans: [NavalPlan, NavalPlan], rng: Rng): void {
  const { battle, data } = ctx;
  const rules = data.battle.naval;
  const weather = rules.weather[battle.weather ?? 'clear'] ?? { accuracy: 1, ambush: 0 };
  battle.exchange += 1;
  battle.round += 1;
  // Movement: both want to close, the gap shuts; one runs and is faster, it is over.
  const idx = RANGES.indexOf(battle.range ?? 'far');
  // Closing moves toward "adjacent" (+1); running, toward "far" (-1); holding, neither.
  const want = plans.map((p) => (p.move === 'close' ? 1 : p.move === 'flee' ? -1 : 0));
  for (const side of [0, 1] as const) {
    if (plans[side].move !== 'flee') continue;
    const me = battle.ships[side] as ShipInBattle;
    const them = battle.ships[side === 0 ? 1 : 0] as ShipInBattle;
    const chance =
      0.5 + 0.5 * ((me.speed - them.speed) / Math.max(me.speed, them.speed)) + weather.ambush * 0.3;
    if (rng.fork('flee', side).chance(Math.max(0.05, Math.min(0.9, chance)))) {
      for (const f of named(battle, side)) f.down = 'fled';
      battle.sides[side].ranks = 0;
      say(ctx, 'flee_ok', { a: me.name }, side === 0 ? 'plain' : 'bad');
      return;
    }
  }
  const step = Math.sign((want[0] ?? 0) + (want[1] ?? 0));
  battle.range = RANGES[Math.max(0, Math.min(2, idx + step))] ?? 'far';
  // Fire, ram, board.
  for (const side of [0, 1] as const) {
    const me = battle.ships[side] as ShipInBattle;
    const them = battle.ships[side === 0 ? 1 : 0] as ShipInBattle;
    if (me.sunk || them.sunk || me.struck) continue;
    const plan = plans[side];
    if (plan.attack === 'fire' && battle.range !== 'adjacent') {
      const skill = Math.max(0.3, Math.min(2, (battle.sides[side].rankPower || 150) / 150));
      const acc = rules.cannon.accuracy * weather.accuracy * (battle.range === 'near' ? 1.2 : 0.8);
      const hits = Math.round(me.cannons * acc * rng.fork('shots', side).float(0.6, 1.4));
      const damage = Math.round(hits * rules.cannon.damage * skill * 10) / 10;
      them.hull = Math.max(0, them.hull - damage);
      if (hits > 0 && rng.fork('fire', side).chance(Math.min(0.8, rules.fire.chance * hits)))
        them.fire += 2;
      say(
        ctx,
        'naval_fire',
        { a: me.name, b: them.name, damage: String(Math.round(damage)) },
        side === 0 ? 'good' : 'bad',
      );
    } else if (plan.attack === 'ram' && battle.range === 'adjacent') {
      const force = rules.ram.damage * (me.hull / me.maxHull);
      them.hull = Math.max(0, them.hull - force);
      me.hull = Math.max(0, me.hull - force * rules.ram.self);
      say(ctx, 'naval_ram', { a: me.name, b: them.name }, side === 0 ? 'good' : 'bad');
    } else if (plan.attack === 'board' && battle.range === 'adjacent' && !battle.boarded) {
      battle.boarded = true;
      say(ctx, 'naval_board', { a: me.name, b: them.name }, side === 0 ? 'good' : 'bad');
    }
  }
  for (const side of [0, 1] as const) {
    const ship = battle.ships[side] as ShipInBattle;
    if (ship.fire > 0) {
      ship.hull = Math.max(0, ship.hull - rules.fire.damage);
      ship.fire = rng.fork('putOut', side).chance(0.35) ? 0 : ship.fire - 1;
    }
    if (!ship.sunk && ship.hull <= 0) sinkShip(ctx, side);
    else if (
      !ship.struck &&
      ship.hull < ship.maxHull * rules.strikeBelow &&
      battle.sides[side].morale < 60
    ) {
      ship.struck = true;
      say(ctx, 'naval_struck', { b: ship.name }, side === 0 ? 'bad' : 'good');
      for (const f of named(battle, side)) f.down = 'surrendered';
      battle.sides[side].ranks = 0;
    }
    battle.sides[side].morale -= ship.hull < ship.maxHull * 0.5 ? 5 : 0;
  }
  if (battle.round >= rules.maxRounds && !battle.boarded) {
    // Night falls; the ships part.
    for (const f of battle.fighters) if (f.down === null) f.down = 'fled';
  }
}

// ---- War ---------------------------------------------------------------------------------------

/** Who stands where in a war: the player's front fights its duel; everyone else is at their own front. */
export function placeAtFronts(battle: BattleState): void {
  const here = battle.fronts[battle.playerFront];
  const commandersHere = new Set((here?.commanders ?? []).filter((x): x is string => x !== null));
  const elsewhere = new Set(
    battle.fronts
      .flatMap((fr, i) => (i === battle.playerFront ? [] : fr.commanders))
      .filter((x): x is string => x !== null),
  );
  for (const f of battle.fighters) {
    if (f.down !== null) continue;
    f.front = elsewhere.has(f.id) && !commandersHere.has(f.id) && !f.player;
  }
}

function warRound(ctx: BattleCtx, rng: Rng): void {
  const { battle, data } = ctx;
  const rules = data.battle.war;
  battle.round += 1;
  battle.fronts.forEach((fr, i) => {
    if (fr.broken[0] || fr.broken[1]) return;
    const power = (side: 0 | 1) => {
      const cmd = fighter(battle, fr.commanders[side]);
      const per = battle.sides[side].rankPower || 150;
      return fr.strength[side] * per + (cmd && cmd.down === null ? cmd.cp * 4 : 0);
    };
    const a = power(0);
    const b = power(1);
    const chance = winChance(data, a, b);
    const r = rng.fork('front', i);
    const pushed = r.chance(chance) ? 0 : 1;
    const other = pushed === 0 ? 1 : 0;
    const lose = (side: 0 | 1, mult: number) => {
      fr.strength[side] = Math.max(
        0,
        Math.round(
          fr.strength[side] * (1 - rules.frontLoss * mult * r.fork('loss', side).float(0.7, 1.3)),
        ),
      );
      fr.morale[side] -= 12 * mult;
    };
    lose(other as 0 | 1, 1.5);
    lose(pushed as 0 | 1, 0.6);
    const ws = battle.sides[pushed].name;
    const ls = battle.sides[other].name;
    say(ctx, 'war_front', { front: fr.name, a: ws, b: ls }, pushed === 0 ? 'good' : 'bad');
    for (const side of [0, 1] as const) {
      const cmd = fighter(battle, fr.commanders[side]);
      if (cmd && cmd.down !== null && fr.morale[side] > -999) {
        fr.morale[side] -= rules.commanderFalls;
        fr.commanders[side] = null;
      }
      // A Conqueror's burst used here this round breaks a weak front outright.
      const king = battle.fighters.find(
        (f) =>
          f.side !== side &&
          f.down === null &&
          f.totals.used.includes('haki:conqueror') &&
          f.conqueror > 0 &&
          (i === battle.playerFront || fr.commanders[f.side] === f.id),
      );
      if (
        king &&
        fr.strength[side] * (battle.sides[side].rankPower || 150) < king.cp * rules.burstBreaks * 20
      )
        fr.morale[side] = 0;
      if (fr.morale[side] <= rules.breakAt || fr.strength[side] <= 0) {
        fr.broken[side] = true;
        say(
          ctx,
          'war_broken',
          { front: fr.name, side: battle.sides[side].name },
          side === 0 ? 'bad' : 'good',
        );
      }
    }
  });
  for (const f of battle.fighters) {
    const i = f.totals.used.indexOf('haki:conqueror');
    if (i >= 0) f.totals.used.splice(i, 1, 'haki:conqueror:spent');
  }
}

function warOver(ctx: BattleCtx): boolean {
  const { battle, data } = ctx;
  if (battle.result) return true;
  const held = (side: 0 | 1) => battle.fronts.filter((fr) => !fr.broken[side]).length;
  const lost0 = held(0) === 0;
  const lost1 = held(1) === 0;
  if (lost0 || lost1 || battle.round >= data.battle.war.maxRounds) {
    const winner: 0 | 1 = lost1 && !lost0 ? 0 : lost0 && !lost1 ? 1 : held(0) >= held(1) ? 0 : 1;
    for (const f of named(battle, winner === 0 ? 1 : 0)) f.down = f.down ?? 'fled';
    battle.sides[winner === 0 ? 1 : 0].ranks = 0;
    for (const f of named(battle, winner)) f.front = false;
    battle.sides[winner].ranks = Math.max(battle.sides[winner].ranks, 1);
    return settle(ctx);
  }
  return false;
}

function warExchange(ctx: BattleCtx, plans: ReadonlyMap<string, Plan>, choose: Decide): boolean {
  const { battle, data } = ctx;
  placeAtFronts(battle);
  runExchange(ctx, plans, choose);
  for (const side of [0, 1] as const)
    battle.sides[side].ranks = battle.fronts.reduce(
      (n, fr) => n + (fr.broken[side] ? 0 : fr.strength[side]),
      0,
    );
  if (battle.exchange % data.battle.crew.exchangesPerRound === 0)
    warRound(ctx, ctx.rng.fork('war', battle.round));
  return warOver(ctx);
}

// ---- One step, whatever the scale ----------------------------------------------------------------

/**
 * Advance a battle by one step: an exchange (duels, skirmishes, crew battles, wars) or a round of
 * ship against ship. Returns true when it is over.
 */
export function stepBattle(
  ctx: BattleCtx,
  plans: ReadonlyMap<string, Plan> = new Map(),
  choose: Decide = decide,
  makeHelper?: MakeHelper,
  naval?: NavalPlan,
): boolean {
  const { battle } = ctx;
  if (battle.result) return true;
  switch (battle.scale) {
    case 'crew':
      return crewExchange(ctx, plans, choose, makeHelper);
    case 'war':
      return warExchange(ctx, plans, choose);
    case 'naval': {
      if (battle.boarded) return crewExchange(ctx, plans, choose, makeHelper);
      navalRound(
        ctx,
        [naval ?? navalDecide(battle, 0), navalDecide(battle, 1)],
        ctx.rng.fork('naval', battle.round),
      );
      if (battle.boarded) autoBoard(battle);
      return settleNaval(ctx);
    }
    default:
      return runExchange(ctx, plans, choose, makeHelper);
  }
}

function settleNaval(ctx: BattleCtx): boolean {
  const { battle } = ctx;
  const gone = (side: 0 | 1) => named(battle, side).length === 0 && battle.sides[side].ranks < 1;
  if (gone(0) || gone(1)) {
    for (const side of [0, 1] as const) if (gone(side)) battle.sides[side].ranks = 0;
    return settle(ctx);
  }
  return false;
}

/** Run a battle to its end, whatever its scale. */
export function runBattle(ctx: BattleCtx, choose: Decide = decide, makeHelper?: MakeHelper): void {
  let guard = 0;
  while (!ctx.battle.result && guard < 2000) {
    stepBattle(ctx, new Map(), choose, makeHelper);
    guard += 1;
  }
  if (!ctx.battle.result) settle(ctx);
}

export { standing };
