import type { BattleState, Fighter } from '../../engine/battle-state';
import type { Activity, ContestDef, GameData } from '../../engine/data/schemas';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { Entity } from '../../engine/state';
import { dpow } from '../../engine/dmath';
import { combatPowerOf, humanAgeOf, livingRelations, personOf, reputation } from '../life/body';
import { pay, reportLine, type LifeEnv } from '../life/env';
import { decide } from './ai';
import { applyAftermath, PLAYER_FIGHTER } from './aftermath';
import { ctxOf, newBattle, openingLine, setBonds } from './battle';
import { fighterOf, foeFighter } from './fighters';
import { tierSpan } from './ladder';
import { runBattle } from './scales';
import { playerFighter } from './player';

/**
 * Sparring and contests (Phase 5). A spar is a fight with Spare intent and a stop rule (first
 * hit, first knockdown, a time limit, until one yields): nobody dies, injuries come a tenth as
 * often, and it trains between drills and real fights, more against a stronger partner (up to x2
 * at 20% stronger) and little against a much weaker one. A mentor's spar counts as teaching (the
 * activity's teacher multiplier). Spars move relationships and every pair's record.
 *
 * Contests are fights with special rules (data/battle.json `contests`): a colosseum tournament's
 * rounds with no Devil Fruits and the crowd betting, a pit fight for money, a dojo's ranking
 * matches, sumo, and a Davy Back Fight's three games between crews.
 */

export interface ActivityFight {
  result: 'won' | 'lost' | 'draw';
  /** Training multiplier from the partner's strength (spars), 1 otherwise. */
  mult: number;
  partner: string;
  battle: BattleState;
}

/** A partner's training value: x maxMult at `stronger` (20% stronger), falling off fast below even. */
export function partnerMult(data: GameData, mine: number, theirs: number): number {
  const s = data.battle.spar.partner;
  const r = theirs / Math.max(1, mine);
  if (r >= 1 + s.stronger) return s.maxMult;
  if (r >= 1) return 1 + ((r - 1) / s.stronger) * (s.maxMult - 1);
  return Math.max(s.floor, dpow(r, 2));
}

/** Someone to spar with: by the activity's wish, a mentor, rival or friend, else someone here. */
function partnerFor(env: LifeEnv, fight: NonNullable<Activity['fight']>, rng: Rng): Entity | null {
  const { state, p, data, tick } = env;
  const pools: Entity[][] = [];
  const add = (kind: 'mentor' | 'rival' | 'friend') =>
    pools.push(
      livingRelations(state, p.c, kind).filter(
        (e) => !e.character?.place || e.character.place === p.c.place,
      ),
    );
  if (fight.partner === 'mentor' || fight.partner === 'any') add('mentor');
  if (fight.partner === 'rival' || fight.partner === 'any') add('rival');
  if (fight.partner === 'friend' || fight.partner === 'any') add('friend');
  for (const pool of pools) {
    const fit = pool.filter((e) => {
      const q = personOf(data, e);
      return q !== null && humanAgeOf(data, q, tick) >= 12 && humanAgeOf(data, q, tick) < 65;
    });
    if (fit.length > 0 && rng.fork('known').chance(0.7)) return rng.fork('pick').pick(fit);
  }
  if (fight.partner === 'local' || fight.partner === 'any') {
    const mine = combatPowerOf(data, p.entity, tick);
    const here = Object.values(state.entities).filter((e) => {
      const c = e.character;
      if (!c?.npc || !c.alive || c.place !== p.c.place || e.flags['status'] === 'imprisoned')
        return false;
      const q = personOf(data, e);
      return q !== null && humanAgeOf(data, q, tick) >= 14 && humanAgeOf(data, q, tick) < 55;
    });
    // Someone near your level (the dojo puts you with your own kind).
    const near = here.filter((e) => {
      const cp = combatPowerOf(data, e, tick);
      return cp > mine * 0.6 && cp < mine * 1.6;
    });
    if (near.length > 0) return rng.fork('local').pick(near.sort((a, b) => (a.id < b.id ? -1 : 1)));
  }
  return null;
}

function resultOf(battle: BattleState): 'won' | 'lost' | 'draw' {
  const w = battle.result?.winner;
  return w === 0 ? 'won' : w === 1 ? 'lost' : 'draw';
}

/**
 * The month's fight for an activity: a spar with a partner (or a foe like them), a brawl with
 * whoever is there, a crew's training day. Played in quick mode with the player's stance, with
 * everything a fight leaves applied (the activity itself trains, so the fight does not again).
 */
export function activityFight(env: LifeEnv, act: Activity, rng: Rng): ActivityFight | null {
  const { state, data, p, tick } = env;
  const fight = act.fight;
  if (!fight || !p.c.alive) return null;
  if (fight.kind === 'contest' && fight.contest) {
    const contest = data.battle.contests.find((c) => c.id === fight.contest);
    if (contest) return runContest(env, contest, rng);
  }
  const spar = fight.kind === 'spar' || fight.kind === 'group';
  const me = playerFighter(state, data, tick, spar ? 'spare' : 'spare');
  const partner = fight.kind === 'brawl' ? null : partnerFor(env, fight, rng.fork('partner'));
  let other: Fighter;
  if (partner) {
    other = fighterOf(state, data, partner, tick, { id: 'p1', side: 1, intent: 'spare' });
  } else {
    const foe = data.battle.foes.find(
      (f) => f.id === (fight.foe ?? (spar ? 'foe_dojo_student' : 'foe_thug')),
    );
    if (!foe) return null;
    // A nameless partner near the player's own strength; a brawl's drunk or thug as they come.
    const cp = spar ? Math.round(me.cp * rng.fork('level').float(0.75, 1.35)) : undefined;
    other = foeFighter(data, foe, rng.fork('foe'), {
      id: 'p1',
      side: 1,
      intent: spar ? 'spare' : foe.intent === 'kill' ? 'capture' : foe.intent,
      ...(cp !== undefined ? { cp } : {}),
    });
  }
  state.counters.battleId += 1;
  const battle = newBattle(data, {
    id: state.counters.battleId,
    scale: 'duel',
    mode: 'quick',
    tick,
    place: p.place.atSea ? null : p.place.id,
    fighters: [me, other],
    sides: [p.entity.name, other.name],
    source: { kind: 'activity', id: act.id },
    spar,
    stop: spar ? (fight.stop ?? 'first_knockdown') : null,
    ...(typeof p.entity.flags['battle.stance'] === 'string'
      ? { stance: p.entity.flags['battle.stance'] as string }
      : {}),
  });
  setBonds(state, data, battle, tick);
  const ctx = ctxOf(state, data, battle);
  openingLine(ctx);
  runBattle(ctx, decide);
  const mult = spar ? partnerMult(data, me.cp, other.cp) : 1;
  const drafts: NewsDraft[] = [];
  const after = applyAftermath(state, data, battle, tick, drafts, mult, false);
  for (const line of after.lines.slice(1))
    if (line.tone === 'bad') reportLine(env, line.text, line.tone);
  return { result: resultOf(battle), mult, partner: other.name, battle };
}

// ---- Contests ----------------------------------------------------------------------------------

/**
 * A contest: rounds against entrants from its tiers, stronger each round, under its rules. Winning
 * every round takes the purse; each round won is a little fame. A bet on yourself, where the crowd
 * bets, pays at the odds the crowd gave.
 */
export function runContest(env: LifeEnv, contest: ContestDef, rng: Rng): ActivityFight | null {
  const { state, data, p, tick } = env;
  if (contest.entry > 0) {
    if (p.c.berries < contest.entry) return null;
    pay(env, -contest.entry);
  }
  const pool = data.battle.foes.filter(
    (f) => contest.tiers.includes(f.tier) && f.id !== 'foe_sea_king' && f.id !== 'foe_pacifista',
  );
  let last: BattleState | null = null;
  let won = 0;
  for (let round = 0; round < contest.rounds; round++) {
    const r = rng.fork('round', round);
    const foe = r.pick(pool.length > 0 ? pool : data.battle.foes);
    const tier = contest.tiers[Math.min(contest.tiers.length - 1, round)] ?? foe.tier;
    const span = tierSpan(data, tier);
    const cp = Math.round(
      span.min + ((span.max ?? span.min * 1.4) - span.min) * r.fork('cp').float(0.1, 0.8),
    );
    const me = playerFighter(state, data, tick, 'spare', {
      noFruits: contest.noFruits,
      noWeapons: contest.noWeapons,
    });
    if (round > 0 && last) {
      const prev = last.fighters.find((f) => f.player);
      if (prev)
        me.hp = Math.max(1, Math.round(me.maxHp * Math.min(1, prev.hp / prev.maxHp + 0.25)));
    }
    const other = foeFighter(data, foe, r.fork('foe'), {
      id: 'p1',
      side: 1,
      intent: 'spare',
      cp,
      noFruits: contest.noFruits,
      noWeapons: contest.noWeapons,
    });
    state.counters.battleId += 1;
    const battle = newBattle(data, {
      id: state.counters.battleId,
      scale: 'duel',
      mode: 'quick',
      tick,
      place: p.place.atSea ? null : p.place.id,
      fighters: [me, other],
      sides: [p.entity.name, other.name],
      source: { kind: 'contest', id: contest.id },
      spar: contest.kind !== 'davy_back',
      stop: contest.stop ?? 'first_knockdown',
      contest: contest.id,
    });
    const ctx = ctxOf(state, data, battle);
    openingLine(ctx);
    runBattle(ctx, decide);
    // The crowd's odds, and a bet on yourself where they bet.
    if (contest.betting && round === 0) {
      const stake = Math.min(Math.max(0, p.c.berries), Math.max(1000, contest.entry * 2));
      const odds = other.cp / Math.max(1, me.cp);
      if (stake > 0)
        pay(env, battle.result?.winner === 0 ? Math.round(stake * Math.max(0.2, odds)) : -stake);
    }
    applyAftermath(state, data, battle, tick, [], 1, false);
    last = battle;
    if (battle.result?.winner !== 0) break;
    won += 1;
    if (!p.c.alive) break;
  }
  if (!last) return null;
  if (won > 0) reputation(p.entity, 'fame').base += won;
  if (won === contest.rounds && contest.purse > 0) {
    pay(env, contest.purse);
    reportLine(env, `${contest.name}: won every round, and the purse.`, 'good');
  } else
    reportLine(
      env,
      `${contest.name}: ${won} of ${contest.rounds} rounds won.`,
      won > 0 ? 'plain' : 'bad',
    );
  const result = won === contest.rounds ? 'won' : won > 0 ? 'draw' : 'lost';
  return {
    result,
    mult: 1,
    partner: last.fighters.find((f) => !f.player)?.name ?? 'someone',
    battle: last,
  };
}

export { PLAYER_FIGHTER };
