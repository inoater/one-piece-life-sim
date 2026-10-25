import type { BattleState, Fighter, FighterMove } from '../../engine/battle-state';
import type { BattleRules, BattleVerb, GameData } from '../../engine/data/schemas';
import { dpow } from '../../engine/dmath';
import type { Rng } from '../../engine/rng';
import { rawStat } from './fighters';

/**
 * The exchange (Phase 5): one round of a fight, the same for a bar brawl, a duel on a rooftop, a
 * skirmish of ten a side, the named duels of a crew battle and of a war.
 *
 * Everyone declares an action; defences (guard, evade, a read, a coat, a counter, an overdrive) take
 * hold first; then the rest resolve in order of initiative (Speed + 0.5 x Perception + 10 x
 * Observation stage + a d20). The plan's formulas, all tunable in data/battle.json:
 *
 *   hit chance  clamp(50 + 50 x (accuracy - evasion) / max(accuracy, evasion), 5%, 95%)
 *   damage      attack x technique power / 100 x attack / (attack + defence) x scale
 *   Logia       a blow without Armament, seastone or a weakness passes through and does nothing
 *   matchups    data/fruitMatchups.json multiplies a blow, cancels it, or makes it land
 *   stamina     every action costs fight stamina; empty, damage and evasion are halved
 *   second wind once a fight, at 0 Health, a Willpower roll to stand again at 10%
 *
 * Every random draw comes from the battle's own stream, keyed by exchange and fighter (rule 6),
 * so a fight replays exactly and one fighter's luck never moves another's.
 */

export interface BattleCtx {
  battle: BattleState;
  data: GameData;
  /** The battle's root stream. */
  rng: Rng;
}

export interface Plan {
  verb: BattleVerb;
  /** A technique's id (verb "technique"). */
  move?: string;
  /** A fighter id. */
  target?: string;
  /** A kit id (verb "item"). */
  item?: string;
  haki?: 'read' | 'coat' | 'burst';
  talk?: 'taunt' | 'surrender' | 'persuade' | 'stall';
  /** A combination technique's partner (both use their action on it). */
  partner?: string;
}

// ---- Who is where ------------------------------------------------------------------------------

export function active(f: Fighter): boolean {
  return f.down === null && !f.reserve && !f.front;
}

export function standing(battle: BattleState, side: 0 | 1): Fighter[] {
  return battle.fighters.filter((f) => f.side === side && active(f));
}

export function fighter(battle: BattleState, id: string | undefined | null): Fighter | undefined {
  return id ? battle.fighters.find((f) => f.id === id) : undefined;
}

export function enemiesOf(battle: BattleState, f: Fighter): Fighter[] {
  return standing(battle, f.side === 0 ? 1 : 0);
}

export function alliesOf(battle: BattleState, f: Fighter): Fighter[] {
  return standing(battle, f.side).filter((a) => a.id !== f.id);
}

function zoneDepth(data: GameData, zone: string): number {
  return data.battle.zones.find((z) => z.id === zone)?.depth ?? 0;
}

/** How deep into the other side a move can reach: blades the front, guns the rear. */
function reach(move: FighterMove | null): number {
  const range = move?.range ?? 'melee';
  if (range === 'far' || range === 'area' || move?.form === 'projectile') return 2;
  if (range === 'near') return 1;
  return 0;
}

/** Can `a` strike `b` with this move from where they stand? */
export function canReach(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
): boolean {
  const { battle, data } = ctx;
  let depth = zoneDepth(data, b.zone);
  // With their front line down, the middle is open to blades; with the middle down, the rear.
  const others = standing(battle, b.side);
  if (!others.some((o) => zoneDepth(data, o.zone) < depth)) depth = 0;
  if (b.zone === 'water' && !a.swimmer && reach(move) < 1) return false;
  return reach(move) >= depth || a.zone === 'high' || a.zone === 'rigging';
}

// ---- The numbers -------------------------------------------------------------------------------

/** Power: k, with an overdrive's boost and a shrunken body's weakness. */
export function powerOf(f: Fighter): number {
  let p = f.k;
  if (f.status.overdrive) p *= 1 + f.status.overdrive.boost / 100;
  if (f.status.shrunk > 0) p *= 0.6;
  if (f.cursed) p *= 0.1;
  return p;
}

function eff(f: Fighter, stat: string): number {
  return rawStat(f, stat) * powerOf(f);
}

function roleMod(data: GameData, f: Fighter, which: 'attack' | 'defence'): number {
  const role = data.battle.roles.find((r) => r.id === f.role);
  return 1 + (role?.[which] ?? 0) / 100;
}

function empty(f: Fighter): boolean {
  return f.stamina <= 0;
}

export function accuracyOf(ctx: BattleCtx, a: Fighter, move: FighterMove | null): number {
  const rules = ctx.data.battle;
  // Phase 6: skill with the weapon's family sharpens the aim too.
  const skill =
    a.weapon && usesWeapon(a, move) ? a.weapon.attack / 2 + (a.weapon.accuracy ?? 0) : 0;
  let acc = (rawStat(a, 'dexterity') + skill) * powerOf(a);
  acc *= 1 + (a.observation * rules.hit.observationPerStage) / 100;
  acc *= (move?.accuracy ?? 75) / 75;
  if (a.status.taunted > 0) acc *= 1 - rules.talk.tauntAccuracy / 100;
  if (a.status.blinded > 0) acc *= 0.6;
  const zone = rules.zones.find((z) => z.id === a.zone);
  if (zone && reach(move) >= 1) acc *= 1 + zone.rangedAccuracy / 100;
  return Math.max(1, acc);
}

export function evasionOf(ctx: BattleCtx, b: Fighter): number {
  const rules = ctx.data.battle;
  let ev = eff(b, 'speed');
  ev *= 1 + (b.observation * rules.evade.observationPerStage) / 100;
  if (b.status.evading) ev *= 1 + rules.evade.bonus / 100;
  if (b.status.read > 0) ev *= 1 + rules.evade.read / 100;
  if (empty(b)) ev *= rules.damage.emptyStamina;
  if (b.status.pinned > 0 || b.status.stunned > 0) ev *= 0.2;
  if (b.zone === 'water' && !b.swimmer) ev *= 0.6;
  return Math.max(1, ev);
}

/** The chance a blow lands, 5% to 95%. */
export function hitChance(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
): number {
  const h = ctx.data.battle.hit;
  const acc =
    accuracyOf(ctx, a, move) + (b.status.opened === a.id ? ctx.data.battle.feint.accuracy : 0);
  const ev = evasionOf(ctx, b);
  const raw = h.base + (h.slope * (acc - ev)) / Math.max(acc, ev);
  return Math.max(h.min, Math.min(h.max, raw)) / 100;
}

function usesWeapon(a: Fighter, move: FighterMove | null): boolean {
  if (!a.weapon) return false;
  if (!move) return true;
  const kind = a.weapon.kind;
  return move.tags.includes(kind === 'swords' ? 'sword' : kind) || move.tags.includes('weapon');
}

function attackOf(ctx: BattleCtx, a: Fighter, move: FighterMove | null): number {
  const rules = ctx.data.battle;
  const ranged = move && (move.tags.includes('gun') || move.tags.includes('bow'));
  const base = ranged
    ? (rawStat(a, 'dexterity') + rawStat(a, 'perception')) / 2
    : move?.source === 'fruit' && reach(move) >= 1
      ? (rawStat(a, 'strength') + rawStat(a, 'willpower')) / 2
      : rawStat(a, 'strength');
  const weapon = a.weapon && usesWeapon(a, move) ? a.weapon.attack : 0;
  let atk = (base + weapon) * powerOf(a) * roleMod(ctx.data, a, 'attack');
  if (a.status.coated > 0) atk *= 1 + a.armament * rules.damage.coatDamagePerStage;
  if (empty(a)) atk *= rules.damage.emptyStamina;
  return Math.max(1, atk);
}

function defenceOf(ctx: BattleCtx, b: Fighter): number {
  const rules = ctx.data.battle;
  // Phase 6: defence = Durability + Armament + armour (armour does nothing in the water).
  const armour = b.zone === 'water' ? 0 : (b.armour ?? 0);
  let def = (rawStat(b, 'durability') + armour) * powerOf(b) * roleMod(ctx.data, b, 'defence');
  if (b.status.coated > 0) def *= 1 + b.armament * rules.damage.coatDefencePerStage;
  return Math.max(1, def);
}

// ---- Logia and matchups ------------------------------------------------------------------------

function sideMatches(spec: string, tags: readonly string[], f: Fighter | null): boolean {
  if (spec === 'any') return true;
  if (spec.startsWith('tag:')) return tags.includes(spec.slice(4));
  if (spec.startsWith('power:')) return f?.fruit?.power === spec.slice(6);
  if (spec.startsWith('type:')) return f?.fruit?.type === spec.slice(5);
  if (spec === 'seastone') return f?.seastone === true;
  if (spec === 'sea') return tags.includes('sea') || tags.includes('water');
  return false;
}

export interface Matchup {
  result: keyof BattleRules['matchups'];
  text: string;
}

/** The matchup between a blow (its tags and its user's fruit) and the one it lands on. */
export function matchupOf(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
): Matchup | null {
  if (!b.fruit || b.cursed) return null;
  const tags = [...(move?.tags ?? []), ...(move?.source === 'fruit' ? (a.fruit?.tags ?? []) : [])];
  for (const pair of ctx.data.matchups.pairs) {
    if (sideMatches(pair.attacker, tags, a) && sideMatches(pair.defender, b.fruit.tags, b))
      return { result: pair.result, text: pair.text };
  }
  return null;
}

/**
 * The Logia rule: a blow passes through a Logia user unless it carries Armament (a coat, or a
 * haki technique), seastone, a technique that ignores it, or something their fruit is weak to.
 */
export function canTouch(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
): boolean {
  if (!b.fruit?.logia || b.cursed) return true;
  if (b.status.stunned > 0 && b.zone === 'water') return true;
  if (a.status.coated > 0) return true;
  const tags = move?.tags ?? [];
  if (tags.includes('armament') || tags.includes('haki')) return true;
  if (move?.effects.includes('ignore_logia') || move?.effects.includes('internal')) return true;
  if (a.seastone && (!move || move.form === 'strike' || move.form === 'grapple')) return true;
  if (tags.some((t) => b.fruit?.weaknesses.includes(t))) return true;
  if (tags.includes('water') || tags.includes('sea')) return true;
  const m = matchupOf(ctx, a, b, move);
  return m !== null && (m.result === 'wins' || m.result === 'solidifies');
}

// ---- Lines -------------------------------------------------------------------------------------

export function say(
  ctx: BattleCtx,
  id: string,
  vars: Record<string, string>,
  tone: 'good' | 'bad' | 'plain' | 'alert' = 'plain',
): void {
  const template = ctx.data.battle.lines[id] ?? id;
  const text = template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  ctx.battle.log.push({ exchange: ctx.battle.exchange, text, tone });
}

function toneFor(f: Fighter, good: boolean): 'good' | 'bad' | 'plain' {
  return f.side === 0 ? (good ? 'good' : 'bad') : good ? 'bad' : 'good';
}

// ---- Damage, downs and the field -----------------------------------------------------------------

function sideOf(battle: BattleState, side: 0 | 1) {
  return battle.sides[side];
}

function rescuerFor(ctx: BattleCtx, f: Fighter): Fighter | undefined {
  return alliesOf(ctx.battle, f).find((a) => a.swimmer || !a.fruit);
}

/**
 * Someone at 0 Health. A second wind first (once a fight, not in a spar); then the field (a fruit
 * user who goes into the water sinks unless someone dives in after them); then, only if whoever
 * downed them meant to kill, the chance it is death. Otherwise they are out.
 */
function drop(ctx: BattleCtx, b: Fighter, by: Fighter | null, blow: number): void {
  const { battle, data } = ctx;
  const rules = data.battle;
  const rng = ctx.rng.fork('drop', battle.exchange, b.id);
  const share = blow / b.maxHp;
  if (!battle.spar && !b.status.secondWind) {
    b.status.secondWind = true;
    const sw = rules.secondWind;
    const chance = Math.max(
      0,
      Math.min(sw.max, sw.base + (rawStat(b, 'willpower') - 50) * sw.willpower - share * sw.blow),
    );
    if (rng.fork('second').chance(chance)) {
      b.hp = Math.max(1, Math.round(b.maxHp * sw.restore));
      say(ctx, 'second_wind', { b: b.name }, toneFor(b, true));
      return;
    }
  }
  b.hp = 0;
  b.downBy = by?.id ?? null;
  if (by) by.totals.kos += 1;
  const inWater = b.zone === 'water' || (battle.water && rng.fork('falls').chance(0.35));
  if (inWater && b.fruit && !b.swimmer && !battle.spar) {
    const rescuer = rescuerFor(ctx, b);
    if (rescuer) {
      say(ctx, 'rescued', { a: rescuer.name, b: b.name }, toneFor(b, true));
    } else {
      b.down = 'dead';
      say(ctx, 'drowned', { b: b.name }, 'alert');
      afterDown(ctx, b, by);
      return;
    }
  }
  if (by && by.intent === 'kill' && !battle.spar) {
    const overkill = Math.max(0, share - 0.2);
    if (
      rng
        .fork('death')
        .chance(Math.min(0.95, rules.death.killBlow + overkill * rules.death.overkill))
    ) {
      b.down = 'dead';
      say(ctx, 'killed', { b: b.name }, 'alert');
      afterDown(ctx, b, by);
      return;
    }
  }
  b.down = by?.intent === 'capture' && !battle.spar ? 'captured' : 'ko';
  say(
    ctx,
    b.down === 'captured' ? 'captured' : 'knocked_out',
    { a: by?.name ?? '', b: b.name },
    toneFor(b, false),
  );
  afterDown(ctx, b, by);
}

function afterDown(ctx: BattleCtx, b: Fighter, by: Fighter | null): void {
  const m = ctx.data.battle.morale;
  const side = sideOf(ctx.battle, b.side);
  side.morale -= b.leader ? m.leaderDown : m.memberDown;
  if (by?.leader) sideOf(ctx.battle, by.side).morale += m.leaderWin;
}

export interface Blow {
  damage: number;
  hit: boolean;
  blocked: 'logia' | 'immune' | null;
}

/**
 * One blow from `a` at `b` (already chosen to land or miss by the caller): the damage formula,
 * guard, coat, matchups and the Logia rule, then the wounds and the fall.
 */
function strikeWith(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
  power: number,
  rng: Rng,
  splash = false,
): Blow {
  const { battle, data } = ctx;
  const rules = data.battle;
  if (!canTouch(ctx, a, b, move)) {
    if (!splash) say(ctx, 'logia', { a: a.name, b: b.name }, toneFor(b, true));
    return { damage: 0, hit: true, blocked: 'logia' };
  }
  const atk = attackOf(ctx, a, move);
  // Phase 6: an untamed hungry blade drinks its wielder's haki with every cut, then their strength.
  if (a.weapon?.drain && usesWeapon(a, move)) {
    const drink = a.weapon.drain;
    if (a.haki >= drink) a.haki -= drink;
    else {
      a.stamina = Math.max(0, a.stamina - (drink - a.haki));
      a.haki = 0;
    }
  }
  const def0 = defenceOf(ctx, b);
  const def = move?.effects.includes('internal') ? def0 * (1 - rules.damage.internalIgnores) : def0;
  let damage =
    atk *
    (power / 100) *
    dpow((2 * atk) / (atk + def), rules.damage.ratioExponent) *
    0.5 *
    rules.damage.scale;
  damage *= 1 + rng.float(-rules.damage.variance, rules.damage.variance);
  if (rng.fork('crit').chance(rules.damage.crit.chance)) damage *= rules.damage.crit.mult;
  const opened = b.status.opened === a.id;
  if (b.status.guarding && !opened && !move?.effects.includes('pierce_guard')) {
    damage *= 1 - rules.damage.guard - b.armament * rules.damage.armamentGuardPerStage;
  }
  if (opened) b.status.opened = null;
  const m = matchupOf(ctx, a, b, move);
  if (m) {
    damage *= rules.matchups[m.result] ?? 1;
    if (!splash) say(ctx, 'matchup', { text: m.text }, 'plain');
    if (damage <= 0) return { damage: 0, hit: true, blocked: 'immune' };
  }
  if (move?.finisher && b.hp < b.maxHp * 0.3) damage *= 1.2;
  damage = Math.max(1, Math.round(damage));
  b.hp -= damage;
  a.totals.dealt += damage;
  a.totals.hits += 1;
  b.totals.taken += damage;
  if (damage >= b.maxHp * rules.damage.injuryShare) b.totals.wounds.push(damage / b.maxHp);
  // What a technique does beyond the damage.
  for (const effect of move?.effects ?? []) {
    switch (effect) {
      case 'burn':
        b.status.burning = Math.max(b.status.burning, 2);
        break;
      case 'freeze':
      case 'stun':
        if (rng.fork('stun').chance(0.5)) b.status.stunned = Math.max(b.status.stunned, 1);
        break;
      case 'shock':
        if (rng.fork('shock').chance(0.3)) b.status.stunned = Math.max(b.status.stunned, 1);
        break;
      case 'bind':
        b.status.pinned = Math.max(b.status.pinned, 1);
        b.status.pinnedBy = a.id;
        break;
      case 'bleed':
        b.status.bleeding = Math.max(b.status.bleeding, 2);
        break;
      case 'poison':
        b.status.poisoned = Math.max(b.status.poisoned, 3);
        break;
      case 'blind':
        b.status.blinded = Math.max(b.status.blinded, 2);
        break;
      case 'fear':
        sideOf(battle, b.side).morale -= 4;
        break;
      case 'drain':
        a.hp = Math.min(a.maxHp, a.hp + Math.round(damage * 0.3));
        break;
      case 'disarm':
        b.weapon = null;
        break;
      case 'knockout':
        if (b.hp < b.maxHp * 0.25) b.hp = 0;
        break;
    }
  }
  if (battle.spar && battle.stop === 'first_hit') b.status.callAt = -1;
  if (b.hp <= 0) drop(ctx, b, a, damage);
  return { damage, hit: true, blocked: null };
}

/** One blow that lands, with nothing random but its own stream: for tests and tools. */
export function landBlow(
  ctx: BattleCtx,
  a: Fighter,
  b: Fighter,
  move: FighterMove | null,
  power: number,
  rng: Rng,
): Blow {
  return strikeWith(ctx, a, b, move, power, rng, true);
}

function howHard(b: Fighter, damage: number): string {
  const share = damage / b.maxHp;
  if (share >= 0.4) return ' with a crushing blow';
  if (share >= 0.2) return ' hard';
  if (share >= 0.08) return '';
  return ', barely';
}

/** A friend throws themselves in front of a blow meant for someone (taking the blow). */
function interposer(ctx: BattleCtx, target: Fighter, rng: Rng): Fighter | undefined {
  const rules = ctx.data.battle.protect;
  for (const ally of alliesOf(ctx.battle, target)) {
    if (ally.status.stunned > 0 || ally.status.pinned > 0) continue;
    let chance = 0;
    if (ally.status.protects === target.id)
      chance = ally.role === 'guard' ? rules.guardRole : rules.guardRole * 0.8;
    else {
      const bond = ally.bonds[target.id] ?? 0;
      if (bond <= 0) continue;
      chance = rules.base + (bond / 100) * rules.bond;
      for (const t of ally.traits) chance += rules.traits[t] ?? 0;
    }
    if (chance > 0 && rng.fork('protect', ally.id).chance(Math.min(0.9, chance))) return ally;
  }
  return undefined;
}

/** An attack: who is hit, whether it lands, every hit of it, and what it does. */
function attack(
  ctx: BattleCtx,
  a: Fighter,
  target: Fighter,
  move: FighterMove | null,
  rng: Rng,
  powerMult = 1,
  label?: string,
): void {
  const rules = ctx.data.battle;
  const form = rules.damage.forms[(move?.form ?? 'strike') as keyof typeof rules.damage.forms] ?? {
    power: 1,
    hits: 1,
  };
  const basePower = (move ? move.power : 20) * form.power * powerMult;
  const hits = Math.max(1, form.hits);
  let total = 0;
  let landed = false;
  let b = target;
  // A blow worth taking for a friend: someone may step in front of it.
  const expected = (attackOf(ctx, a, move) * basePower * hits) / 100;
  if (expected >= b.maxHp * rules.protect.minShare) {
    const shield = interposer(ctx, b, rng.fork('shield'));
    if (shield) {
      say(ctx, 'protect', { a: shield.name, b: b.name }, toneFor(shield, true));
      shield.status.guarding = true;
      b = shield;
    }
  }
  for (let i = 0; i < hits && b.down === null; i++) {
    const r = rng.fork('hit', i);
    if (!r.chance(hitChance(ctx, a, b, move))) continue;
    const blow = strikeWith(ctx, a, b, move, basePower, r.fork('dmg'));
    if (blow.blocked) {
      landed = true;
      break;
    }
    total += blow.damage;
    landed = true;
  }
  // An area technique catches the others standing near.
  if (move?.form === 'area' || move?.range === 'area') {
    for (const other of enemiesOf(ctx.battle, a)) {
      if (other.id === b.id || other.zone !== b.zone) continue;
      const r = rng.fork('splash', other.id);
      if (r.chance(hitChance(ctx, a, other, move)))
        strikeWith(ctx, a, other, move, basePower * rules.damage.areaSplash, r, true);
    }
  }
  const name = label ?? move?.name ?? '';
  if (b.down === null || total > 0) {
    if (landed && total > 0) {
      say(
        ctx,
        move ? 'technique_hit' : 'strike_hit',
        { a: a.name, b: b.name, move: name, how: howHard(b, total) },
        toneFor(a, true),
      );
    } else if (!landed) {
      say(
        ctx,
        move ? 'technique_miss' : 'strike_miss',
        { a: a.name, b: b.name, move: name },
        toneFor(a, false),
      );
      // A readied counter answers a blow that missed.
      if (b.status.countering && b.down === null && active(b)) {
        b.status.countering = false;
        const counter = b.moves.find((m) => m.form === 'counter') ?? null;
        attack(ctx, b, a, counter, rng.fork('counter'), 1);
      }
    }
  }
}

// ---- Actions -----------------------------------------------------------------------------------

function cost(ctx: BattleCtx, f: Fighter, plan: Plan): number {
  const s = ctx.data.battle.stamina;
  const move = plan.move ? f.moves.find((m) => m.id === plan.move) : undefined;
  return (s.costs[plan.verb] ?? 0) + (move ? move.cost * s.techniqueCostMult : 0);
}

function spend(ctx: BattleCtx, f: Fighter, amount: number): void {
  const was = f.stamina > 0;
  f.stamina = Math.max(0, f.stamina - amount);
  if (was && f.stamina <= 0) say(ctx, 'exhausted', { a: f.name }, toneFor(f, false));
}

/** Whom an action goes at: the plan's target if it can be reached, else the nearest worth hitting. */
export function targetFor(
  ctx: BattleCtx,
  f: Fighter,
  plan: Plan,
  move: FighterMove | null,
): Fighter | undefined {
  const enemies = enemiesOf(ctx.battle, f);
  const named = fighter(ctx.battle, plan.target);
  if (named && named.side !== f.side && active(named) && canReach(ctx, f, named, move))
    return named;
  const side = ctx.battle.sides[f.side];
  const focus = side.order === 'focus' ? fighter(ctx.battle, side.target) : undefined;
  if (focus && active(focus) && canReach(ctx, f, focus, move)) return focus;
  const reachable = enemies.filter((e) => canReach(ctx, f, e, move));
  const pool = reachable.length > 0 ? reachable : enemies;
  return [...pool].sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp || (x.id < y.id ? -1 : 1))[0];
}

function overdriveFor(data: GameData, move: FighterMove) {
  return data.battle.overdrive.techniques[move.id] ?? data.battle.overdrive.default;
}

function useTechnique(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): void {
  const move = f.moves.find((m) => m.id === plan.move);
  if (!move) {
    act(ctx, f, { ...plan, verb: 'strike' }, rng);
    return;
  }
  if (!f.totals.used.includes(move.id)) f.totals.used.push(move.id);
  if (move.tags.includes('haki')) f.haki = Math.max(0, f.haki - move.cost * 0.5);
  switch (move.form) {
    case 'boost': {
      if (move.effects.includes('transform') || ctx.data.battle.overdrive.techniques[move.id]) {
        const od = overdriveFor(ctx.data, move);
        f.status.overdrive = {
          move: move.id,
          name: move.name,
          left: od.exchanges,
          boost: od.boost,
        };
        say(ctx, 'overdrive', { a: f.name, move: move.name }, toneFor(f, true));
      } else {
        f.status.overdrive = { move: move.id, name: move.name, left: 3, boost: 15 };
        say(ctx, 'overdrive', { a: f.name, move: move.name }, toneFor(f, true));
      }
      return;
    }
    case 'guard':
    case 'movement':
    case 'counter':
    case 'support':
      // Their effect was set at the start of the exchange; a support technique heals now.
      if (move.form === 'support' && move.effects.includes('heal')) {
        const hurt = [f, ...alliesOf(ctx.battle, f)].sort(
          (x, y) => x.hp / x.maxHp - y.hp / y.maxHp,
        )[0];
        if (hurt) hurt.hp = Math.min(hurt.maxHp, hurt.hp + Math.round(hurt.maxHp * 0.2));
        say(ctx, 'item_heal', { a: hurt?.name ?? f.name, item: move.name }, toneFor(f, true));
      }
      if (move.form === 'movement') {
        const target = targetFor(ctx, f, plan, move);
        if (target) attack(ctx, f, target, move, rng);
      }
      return;
    case 'grapple':
      grapple(ctx, f, plan, rng, move);
      return;
    default: {
      const target = targetFor(ctx, f, plan, move);
      if (target) attack(ctx, f, target, move, rng);
    }
  }
}

function grapple(
  ctx: BattleCtx,
  f: Fighter,
  plan: Plan,
  rng: Rng,
  move: FighterMove | null = null,
): void {
  const rules = ctx.data.battle;
  const target = targetFor(ctx, f, plan, null);
  if (!target) return;
  if (!rng.fork('grab').chance(hitChance(ctx, f, target, move ?? { ...GRAB }))) {
    say(ctx, 'grapple_miss', { a: f.name, b: target.name }, toneFor(f, false));
    return;
  }
  if (!canTouch(ctx, f, target, move)) {
    say(ctx, 'logia', { a: f.name, b: target.name }, toneFor(target, true));
    return;
  }
  target.status.pinned = rules.grapple.pinExchanges;
  target.status.pinnedBy = f.id;
  say(ctx, 'grapple_pin', { a: f.name, b: target.name }, toneFor(f, true));
  // Someone meaning to take them alive binds them once they are weak enough (seastone for a user).
  if (
    f.intent === 'capture' &&
    !ctx.battle.spar &&
    target.hp < target.maxHp * rules.grapple.captureBelow &&
    (!target.fruit || f.seastone)
  ) {
    target.down = 'captured';
    target.downBy = f.id;
    f.totals.kos += 1;
    if (target.fruit) target.cursed = true;
    say(ctx, 'captured', { a: f.name, b: target.name }, toneFor(f, true));
    afterDown(ctx, target, f);
    return;
  }
  const power = move ? move.power : rules.grapple.throwPower;
  strikeWith(ctx, f, target, move, power, rng.fork('throw'));
  if (target.down === null)
    say(ctx, 'grapple_throw', { a: f.name, b: target.name }, toneFor(f, true));
}

const GRAB: FighterMove = {
  id: 'grapple',
  name: 'Grapple',
  form: 'grapple',
  tags: ['grip'],
  effects: [],
  power: 10,
  accuracy: 60,
  cost: 0,
  range: 'melee',
  source: 'basic',
  signature: false,
  finisher: false,
};

/** A thing to use in a fight: battle kit (data/battle.json) or gear with a battle effect (Phase 6). */
function kitItem(
  ctx: BattleCtx,
  id: string | undefined,
): { id: string; name: string; effect: string; value: number } | null {
  if (!id) return null;
  const kit = ctx.data.battle.items.find((i) => i.id === id);
  if (kit) return kit;
  const gear = ctx.data.items[id];
  return gear?.battle
    ? { id, name: gear.name, effect: gear.battle.effect, value: gear.battle.value }
    : null;
}

function useItem(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): void {
  const item = kitItem(ctx, plan.item);
  if (!item || (f.kit[item.id] ?? 0) <= 0) {
    f.status.guarding = true;
    return;
  }
  f.kit[item.id] = (f.kit[item.id] ?? 0) - 1;
  const target =
    fighter(ctx.battle, plan.target) && fighter(ctx.battle, plan.target)?.side !== f.side
      ? (fighter(ctx.battle, plan.target) as Fighter)
      : enemiesOf(ctx.battle, f)[0];
  switch (item.effect) {
    case 'impact':
    case 'reject': {
      if (!target || !active(target)) break;
      const blow = strikeWith(ctx, f, target, null, 100 * item.value, rng.fork('dial'), true);
      say(
        ctx,
        item.effect === 'impact' ? 'item_impact' : 'item_reject',
        { a: f.name, b: target.name, damage: String(blow.damage) },
        toneFor(f, true),
      );
      if (item.effect === 'reject') f.hp = Math.max(1, f.hp - Math.round(f.maxHp * 0.12));
      break;
    }
    case 'flame':
      if (target && active(target)) {
        target.status.burning = Math.max(target.status.burning, Math.round(item.value));
        say(ctx, 'item_flame', { a: f.name, b: target.name }, toneFor(f, true));
      }
      break;
    case 'flash':
      if (target && active(target)) {
        target.status.blinded = Math.max(target.status.blinded, Math.round(item.value));
        say(ctx, 'item_flash', { a: f.name, b: target.name }, toneFor(f, true));
      }
      break;
    case 'gust':
      f.status.evading = true;
      f.status.read = Math.max(f.status.read, 1);
      say(ctx, 'item_gust', { a: f.name }, 'plain');
      break;
    case 'net':
      if (target && active(target)) {
        target.status.pinned = Math.max(target.status.pinned, Math.round(item.value));
        target.status.pinnedBy = f.id;
        const weak = target.fruit !== null && !target.cursed;
        if (weak) target.cursed = true;
        say(
          ctx,
          'item_net',
          { a: f.name, b: target.name, weak: weak ? ', the strength gone out of their fruit' : '' },
          toneFor(f, true),
        );
      }
      break;
  }
  switch (item.effect) {
    case 'heal': {
      const target = fighter(ctx.battle, plan.target);
      const who = target && target.side === f.side && active(target) ? target : f;
      who.hp = Math.min(who.maxHp, who.hp + Math.round(who.maxHp * item.value));
      say(ctx, 'item_heal', { a: who.name, item: item.name.toLowerCase() }, toneFor(f, true));
      break;
    }
    case 'smoke':
      f.status.evading = true;
      f.status.read = Math.max(f.status.read, 1);
      say(ctx, 'item_smoke', { a: f.name }, 'plain');
      break;
    case 'call':
      f.status.callAt = ctx.battle.exchange + Math.round(item.value);
      say(ctx, 'item_call', { a: f.name }, 'plain');
      break;
  }
}

function useHaki(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): void {
  const rules = ctx.data.battle;
  const kind = plan.haki ?? 'coat';
  if (kind === 'burst' && f.conqueror > 0 && f.haki >= rules.haki.burst.cost) {
    f.haki -= rules.haki.burst.cost;
    say(ctx, 'burst', { a: f.name }, toneFor(f, true));
    const mine = rawStat(f, 'willpower') * powerOf(f);
    for (const e of enemiesOf(ctx.battle, f)) {
      const theirs = rawStat(e, 'willpower') * powerOf(e);
      if (theirs < mine * rules.haki.burst.ratio && e.conqueror === 0) {
        e.down = 'ko';
        e.downBy = f.id;
        e.hp = 0;
        f.totals.kos += 1;
        say(ctx, 'burst_out', { b: e.name }, toneFor(e, false));
        afterDown(ctx, e, f);
      }
    }
    ctx.battle.sides[f.side === 0 ? 1 : 0].morale -= rules.haki.burst.morale;
    void rng;
    if (!f.totals.used.includes('haki:conqueror')) f.totals.used.push('haki:conqueror');
    return;
  }
  // Read and coat took hold at the start of the exchange; a coat also strikes.
  if (kind === 'coat' && f.status.coated > 0) {
    const target = targetFor(ctx, f, plan, null);
    if (target) attack(ctx, f, target, null, rng.fork('coated'));
  }
}

function talk(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): void {
  const rules = ctx.data.battle.talk;
  const target = targetFor(ctx, f, plan, { ...GRAB, range: 'far' }) ?? enemiesOf(ctx.battle, f)[0];
  if (!target) return;
  const charm = rawStat(f, 'charisma');
  const will = rawStat(target, 'willpower');
  switch (plan.talk ?? 'taunt') {
    case 'taunt':
      target.status.taunted = 2;
      say(ctx, 'taunt', { a: f.name, b: target.name }, 'plain');
      return;
    case 'surrender': {
      const share = target.hp / target.maxHp;
      const chance =
        share < rules.surrenderBelow
          ? rules.surrenderBase + (charm - will) / 200 + (rules.surrenderBelow - share)
          : 0;
      if (
        target.intent !== 'kill' &&
        rng.fork('yield').chance(Math.max(0, Math.min(0.9, chance)))
      ) {
        target.down = 'surrendered';
        target.downBy = f.id;
        say(ctx, 'surrender_yes', { a: f.name, b: target.name }, toneFor(f, true));
        afterDown(ctx, target, f);
      } else say(ctx, 'surrender_no', { a: f.name, b: target.name }, toneFor(f, false));
      return;
    }
    case 'persuade': {
      const all = ctx.battle.fighters.filter(active);
      const peaceful = all.every((x) => x.intent === 'spare');
      const chance = peaceful ? rules.persuadeBase + (charm - will) / 150 : 0;
      if (rng.fork('persuade').chance(Math.max(0, Math.min(0.9, chance)))) {
        say(ctx, 'persuade_yes', { a: f.name, b: target.name }, toneFor(f, true));
        ctx.battle.result = {
          winner: null,
          how: 'draw',
          decisive: false,
          exchanges: ctx.battle.exchange,
        };
      } else say(ctx, 'persuade_no', { a: f.name, b: target.name }, toneFor(f, false));
      return;
    }
    case 'stall':
      f.stamina = Math.min(f.maxStamina, f.stamina + rules.stallStamina);
      f.status.guarding = true;
      say(ctx, 'stall', { a: f.name }, 'plain');
      return;
  }
}

function flee(ctx: BattleCtx, f: Fighter, rng: Rng, smoke = 0): void {
  const rules = ctx.data.battle.flee;
  const enemies = enemiesOf(ctx.battle, f);
  const fastest = [...enemies].sort((x, y) => eff(y, 'speed') - eff(x, 'speed'))[0];
  if (!fastest) return;
  const mine = eff(f, 'speed');
  const theirs = eff(fastest, 'speed');
  const raw = rules.base + (rules.slope * (mine - theirs)) / Math.max(mine, theirs) + smoke;
  const pinned = f.status.pinned > 0 ? 0.2 : 1;
  if (rng.chance((Math.max(5, Math.min(95, raw)) / 100) * pinned)) {
    f.down = 'fled';
    say(ctx, 'flee_ok', { a: f.name }, toneFor(f, false));
    ctx.battle.sides[f.side].morale -= ctx.data.battle.morale.memberDown / 2;
  } else say(ctx, 'flee_fail', { a: f.name, b: fastest.name }, toneFor(f, false));
}

function combination(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): boolean {
  const partner = fighter(ctx.battle, plan.partner);
  const moveId = f.combos[plan.partner ?? ''];
  if (!partner || !active(partner) || !moveId) return false;
  const mine = f.moves.find((m) => m.id === plan.move) ?? f.moves.find((m) => m.id === moveId);
  const theirs = partner.moves.find((m) => m.id === partner.combos[f.id]);
  if (!mine || !theirs) return false;
  const target = targetFor(ctx, f, plan, mine);
  if (!target) return false;
  const name = `${mine.name} and ${theirs.name}`;
  say(ctx, 'combo', { a: f.name, b: partner.name, move: name }, toneFor(f, true));
  const power = (mine.power + theirs.power) * ctx.data.battle.combo.power;
  const merged: FighterMove = {
    ...mine,
    power,
    accuracy: Math.max(mine.accuracy, theirs.accuracy),
    tags: [...new Set([...mine.tags, ...theirs.tags])],
  };
  attack(ctx, f, target, merged, rng, 1, name);
  if (!f.totals.used.includes(mine.id)) f.totals.used.push(mine.id);
  if (!partner.totals.used.includes(theirs.id)) partner.totals.used.push(theirs.id);
  return true;
}

/** Carry out one fighter's action. */
export function act(ctx: BattleCtx, f: Fighter, plan: Plan, rng: Rng): void {
  spend(ctx, f, cost(ctx, f, plan));
  switch (plan.verb) {
    case 'strike': {
      const target = targetFor(ctx, f, plan, null);
      if (target) attack(ctx, f, target, null, rng);
      return;
    }
    case 'technique':
      if (plan.partner && combination(ctx, f, plan, rng)) return;
      useTechnique(ctx, f, plan, rng);
      return;
    case 'guard':
    case 'evade':
      return; // took hold at the start of the exchange
    case 'feint': {
      const target = targetFor(ctx, f, plan, null);
      if (!target) return;
      const mine = Math.max(eff(f, 'dexterity'), eff(f, 'intellect'));
      const theirs = eff(target, 'perception');
      const chance = 0.5 + (0.5 * (mine - theirs)) / Math.max(mine, theirs);
      if (rng.chance(Math.max(0.1, Math.min(0.9, chance)))) {
        target.status.opened = f.id;
        say(ctx, 'feint_ok', { a: f.name, b: target.name }, toneFor(f, true));
      } else say(ctx, 'feint_fail', { a: f.name, b: target.name }, toneFor(f, false));
      return;
    }
    case 'grapple':
      grapple(ctx, f, plan, rng);
      return;
    case 'haki':
      useHaki(ctx, f, plan, rng);
      return;
    case 'item':
      useItem(ctx, f, plan, rng);
      return;
    case 'talk':
      talk(ctx, f, plan, rng);
      return;
    case 'flee':
      flee(ctx, f, rng, f.status.evading ? ctx.data.battle.flee.smoke : 0);
      return;
  }
}

// ---- The exchange ------------------------------------------------------------------------------

/** Defences and stances take hold before anyone swings. */
function prepare(ctx: BattleCtx, f: Fighter, plan: Plan): void {
  const rules = ctx.data.battle;
  f.status.guarding = false;
  f.status.evading = false;
  if (plan.verb === 'guard' || (plan.verb === 'talk' && plan.talk === 'stall')) {
    f.status.guarding = true;
    say(ctx, plan.verb === 'guard' ? 'guard' : 'stall', { a: f.name }, 'plain');
  }
  if (plan.verb === 'evade') {
    f.status.evading = true;
    say(ctx, 'evade', { a: f.name }, 'plain');
  }
  if (plan.verb === 'item' && plan.item === 'kit_smoke') f.status.evading = true;
  if (plan.verb === 'haki') {
    if (plan.haki === 'read' && f.observation > 0 && f.haki >= rules.haki.read.cost) {
      f.haki -= rules.haki.read.cost;
      f.status.read = 2;
      say(ctx, 'read', { a: f.name }, toneFor(f, true));
      if (!f.totals.used.includes('haki:observation')) f.totals.used.push('haki:observation');
    }
    if (
      plan.haki === 'coat' &&
      f.armament > 0 &&
      f.haki >= rules.haki.coat.cost &&
      f.status.coated === 0
    ) {
      f.haki -= rules.haki.coat.cost;
      f.status.coated = rules.haki.coat.exchanges;
      say(ctx, 'coat', { a: f.name }, toneFor(f, true));
      if (!f.totals.used.includes('haki:armament')) f.totals.used.push('haki:armament');
    }
  }
  if (plan.verb === 'technique') {
    const move = f.moves.find((m) => m.id === plan.move);
    if (move?.form === 'guard') f.status.guarding = true;
    if (move?.form === 'movement') f.status.evading = true;
    if (move?.form === 'counter') f.status.countering = true;
    if (move?.tags.includes('armament') && f.armament > 0 && f.status.coated === 0)
      f.status.coated = 1;
  }
}

function initiative(ctx: BattleCtx, f: Fighter, rng: Rng): number {
  const i = ctx.data.battle.initiative;
  return (
    rawStat(f, 'speed') * i.speed +
    rawStat(f, 'perception') * i.perception +
    f.observation * i.observationPerStage +
    rng.int(1, i.die) +
    (f.status.overdrive ? 10 : 0)
  );
}

/** What happens at the end of every exchange: burns, bleeding, stamina, forms running out. */
function endOfExchange(ctx: BattleCtx): void {
  const rules = ctx.data.battle;
  for (const f of ctx.battle.fighters) {
    if (f.down !== null) continue;
    const dot =
      (f.status.burning > 0 ? 0.04 : 0) +
      (f.status.bleeding > 0 ? 0.03 : 0) +
      (f.status.poisoned > 0 ? 0.03 : 0);
    if (dot > 0 && !f.reserve && !f.front) {
      f.hp -= Math.max(1, Math.round(f.maxHp * dot));
      if (f.hp <= 0) drop(ctx, f, null, f.maxHp * dot);
    }
    for (const key of [
      'burning',
      'bleeding',
      'poisoned',
      'blinded',
      'taunted',
      'stunned',
      'read',
      'coated',
      'shrunk',
    ] as const) {
      if (f.status[key] > 0) f.status[key] -= 1;
    }
    if (f.status.pinned > 0) {
      f.status.pinned -= 1;
      if (f.status.pinned === 0) f.status.pinnedBy = null;
    }
    f.stamina = Math.min(f.maxStamina, f.stamina + rules.stamina.regen);
    const od = f.status.overdrive;
    if (od) {
      od.left -= 1;
      if (od.left <= 0) {
        f.status.overdrive = null;
        const move = f.moves.find((m) => m.id === od.move);
        const after = move ? overdriveFor(ctx.data, move).after : rules.overdrive.default.after;
        if (after.kind === 'exhausted') f.stamina = 0;
        if (after.kind === 'shrunk') f.status.shrunk = Math.max(1, Math.round(after.value));
        say(
          ctx,
          'overdrive_end',
          { text: after.text.replace('{name}', f.name) },
          toneFor(f, false),
        );
      }
    }
  }
}

/** A Den Den Mushi call answered: help arrives on the caller's side. */
function arrivals(
  ctx: BattleCtx,
  makeHelper: ((caller: Fighter) => Fighter | null) | undefined,
): void {
  if (!makeHelper) return;
  for (const f of [...ctx.battle.fighters]) {
    if (f.status.callAt === null || f.status.callAt < 0 || f.status.callAt > ctx.battle.exchange)
      continue;
    f.status.callAt = null;
    const helper = makeHelper(f);
    if (!helper) continue;
    ctx.battle.fighters.push(helper);
    say(ctx, 'call_arrives', { a: f.name, b: helper.name }, toneFor(f, true));
  }
}

/** A fresh fighter tags in for a hurt one (a duel with allies at hand). */
function tagIns(ctx: BattleCtx): void {
  const below = ctx.data.battle.tagIn.below;
  for (const side of [0, 1] as const) {
    const fresh = ctx.battle.fighters.find((f) => f.side === side && f.reserve && f.down === null);
    if (!fresh) continue;
    const up = standing(ctx.battle, side);
    const hurt = up.find((f) => f.hp < f.maxHp * below && !f.player);
    if (up.length > 0 && !hurt) continue;
    const out = hurt ?? ctx.battle.fighters.find((f) => f.side === side && f.down !== null);
    fresh.reserve = false;
    if (hurt) {
      fresh.zone = hurt.zone;
      hurt.reserve = true;
    }
    say(ctx, 'tag_in', { a: fresh.name, b: out?.name ?? '' }, toneFor(fresh, true));
  }
}

function morale(ctx: BattleCtx): void {
  const m = ctx.data.battle.morale;
  for (const side of [0, 1] as const) {
    const s = ctx.battle.sides[side];
    if (s.order === 'rally') {
      const leader =
        standing(ctx.battle, side).find((f) => f.leader) ?? standing(ctx.battle, side)[0];
      if (leader) {
        s.morale = Math.min(m.start, s.morale + rawStat(leader, 'charisma') * m.rally);
        say(ctx, 'rally', { a: leader.name, side: s.name }, side === 0 ? 'good' : 'bad');
      }
      s.order = 'none';
    }
    // A broken side runs (one fighter alone fights on: morale is a crowd's).
    if (!s.broken && s.morale <= m.breakAt && standing(ctx.battle, side).length > 1) {
      s.broken = true;
      say(ctx, 'morale_break', { side: s.name }, side === 0 ? 'bad' : 'good');
    }
  }
}

/** Is it over? Sets `battle.result` when it is. */
export function settle(ctx: BattleCtx): boolean {
  const { battle } = ctx;
  if (battle.result) return true;
  // Still in it: anyone not down (in a duel, at the fronts, or waiting to tag in), or rank and file.
  const present = (side: 0 | 1) =>
    battle.fighters.some((f) => f.side === side && f.down === null) ||
    battle.sides[side].ranks > 0.5;
  const a = present(0);
  const b = present(1);
  const sparStop = battle.spar && battle.fighters.some((f) => f.status.callAt === -1);
  if (
    sparStop ||
    (battle.stop === 'first_knockdown' &&
      battle.fighters.some((f) => f.down === 'ko' || f.down === 'captured'))
  ) {
    const hit = battle.fighters.find((f) => f.status.callAt === -1 || f.down !== null);
    const winner = hit ? ((hit.side === 0 ? 1 : 0) as 0 | 1) : null;
    finish(ctx, winner, `${hit?.name ?? 'someone'} ${sparStop ? 'is hit first' : 'goes down'}`);
    return true;
  }
  if (battle.stop === 'yield') {
    const yielded = battle.fighters.find(
      (f) => f.down === null && !f.reserve && f.hp < f.maxHp * ctx.data.battle.spar.yieldBelow,
    );
    if (yielded) {
      yielded.down = 'yielded';
      finish(ctx, yielded.side === 0 ? 1 : 0, `${yielded.name} yields`);
      return true;
    }
  }
  if (!a || !b) {
    const winner = a && !b ? 0 : b && !a ? 1 : null;
    finish(ctx, winner as 0 | 1 | null);
    return true;
  }
  if (battle.exchange >= battle.maxExchanges) {
    // Time: a spar on points, a fight a draw (the hurt side breaks off).
    const share = (side: 0 | 1) => {
      const fs = battle.fighters.filter((f) => f.side === side);
      return fs.reduce((n, f) => n + Math.max(0, f.hp) / f.maxHp, 0) / Math.max(1, fs.length);
    };
    const s0 = share(0);
    const s1 = share(1);
    const winner = battle.spar && Math.abs(s0 - s1) > 0.05 ? (s0 > s1 ? 0 : 1) : null;
    finish(ctx, winner, battle.spar ? 'time' : undefined);
    return true;
  }
  return false;
}

function finish(ctx: BattleCtx, winner: 0 | 1 | null, reason?: string): void {
  const { battle } = ctx;
  if (battle.spar && reason) say(ctx, 'stop_spar', { reason }, 'plain');
  const fled0 = battle.fighters
    .filter((f) => f.side === 0)
    .every((f) => f.down === 'fled' || f.reserve);
  const fled1 = battle.fighters
    .filter((f) => f.side === 1)
    .every((f) => f.down === 'fled' || f.reserve);
  const how: 'won' | 'lost' | 'fled' | 'draw' =
    winner === 0
      ? 'won'
      : winner === 1
        ? fled0
          ? 'fled'
          : 'lost'
        : fled1 || fled0
          ? 'fled'
          : 'draw';
  const mine = battle.fighters.filter((f) => f.side === 0);
  const share =
    mine.reduce((n, f) => n + Math.max(0, f.hp) / f.maxHp, 0) / Math.max(1, mine.length);
  const decisive =
    how === 'won'
      ? share > 0.6
      : how === 'lost'
        ? mine.some((f) => f.down === 'dead' || f.down === 'captured') || share <= 0
        : false;
  battle.result = { winner, how, decisive, exchanges: battle.exchange };
  // "{side} wins": the winning side named, whichever it is.
  const side = winner === null ? null : battle.sides[winner];
  say(
    ctx,
    how === 'draw' ? 'draw' : how === 'fled' && winner === null ? 'fled' : 'won',
    { side: side?.name ?? '' },
    how === 'won' ? 'good' : how === 'lost' ? 'bad' : 'plain',
  );
}

/**
 * One exchange. `plans` holds the choices already made (the player's); everyone else is asked
 * through `decide`. Returns true when the fight is over.
 */
export function runExchange(
  ctx: BattleCtx,
  plans: ReadonlyMap<string, Plan>,
  decide: (ctx: BattleCtx, f: Fighter, rng: Rng) => Plan,
  makeHelper?: (caller: Fighter) => Fighter | null,
): boolean {
  const { battle } = ctx;
  if (settle(ctx)) return true;
  battle.exchange += 1;
  const rng = ctx.rng.fork('x', battle.exchange);
  arrivals(ctx, makeHelper);
  tagIns(ctx);
  const acting = battle.fighters.filter(active);
  const chosen = new Map<string, Plan>();
  for (const f of acting) {
    const side = battle.sides[f.side];
    let plan = plans.get(f.id) ?? decide(ctx, f, rng.fork('decide', f.id));
    if (side.broken || side.order === 'retreat') plan = { verb: 'flee' };
    if (f.status.stunned > 0) plan = { verb: 'guard' };
    if (f.status.pinned > 0 && plan.verb !== 'flee')
      plan = { verb: 'grapple', target: f.status.pinnedBy ?? undefined };
    chosen.set(f.id, plan);
    prepare(ctx, f, plan);
  }
  const order = acting
    .map((f) => ({ f, i: initiative(ctx, f, rng.fork('init', f.id)) }))
    .sort((x, y) => y.i - x.i || (x.f.id < y.f.id ? -1 : 1));
  const done = new Set<string>();
  for (const { f } of order) {
    if (!active(f) || done.has(f.id) || battle.result) continue;
    const plan = chosen.get(f.id) as Plan;
    done.add(f.id);
    if (plan.partner) done.add(plan.partner);
    act(ctx, f, plan, rng.fork('act', f.id));
    if (settle(ctx)) break;
  }
  endOfExchange(ctx);
  morale(ctx);
  return settle(ctx);
}
