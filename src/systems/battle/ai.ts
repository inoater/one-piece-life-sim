import type { Fighter, FighterMove } from '../../engine/battle-state';
import type { BattleVerb } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import {
  active,
  alliesOf,
  canTouch,
  enemiesOf,
  fighter,
  powerOf,
  targetFor,
  type BattleCtx,
  type Plan,
} from './engine';
import { rawStat } from './fighters';

/**
 * How a fighter who is not being steered chooses (Phase 5): the computer's people by their
 * temperament (data/battle.json `ai`), the player in quick mode by their stance. A few things come
 * before the weights, because anyone would do them: coat against a Logia, heal when about to fall,
 * run when the stance says so, finish a pinned foe someone means to take alive.
 */

function usable(ctx: BattleCtx, f: Fighter, m: FighterMove, target: Fighter | undefined): boolean {
  if (m.cost * ctx.data.battle.stamina.techniqueCostMult > f.stamina + 2) return false;
  if (m.form === 'boost') return f.status.overdrive === null;
  if (m.form === 'guard' || m.form === 'counter' || m.form === 'support') return true;
  return target !== undefined;
}

function pickMove(
  ctx: BattleCtx,
  f: Fighter,
  target: Fighter | undefined,
  rng: Rng,
): FighterMove | undefined {
  const low = target ? target.hp / target.maxHp < 0.3 : false;
  const pool = f.moves.filter(
    (m) =>
      usable(ctx, f, m, target) &&
      m.form !== 'support' &&
      (!target || canTouch(ctx, f, target, m) || m.form === 'boost'),
  );
  return rng.weightedPick(pool, (m) => {
    let w = 1 + m.power / 40;
    if (m.signature) w *= 1.6;
    if (m.finisher) w *= low ? 2.5 : 0.4;
    if (m.form === 'boost') w *= f.hp / f.maxHp < 0.75 ? 1.5 : 0.3;
    if (m.form === 'guard' || m.form === 'counter') w *= 0.4;
    return w;
  });
}

function weightsFor(ctx: BattleCtx, f: Fighter): Partial<Record<BattleVerb, number>> {
  const rules = ctx.data.battle;
  if (f.player) {
    const stance = rules.stances.find((s) => s.id === ctx.battle.stance) ?? rules.stances[0];
    if (stance) return stance.weights;
  }
  return rules.ai[f.temperament];
}

export function decide(ctx: BattleCtx, f: Fighter, rng: Rng): Plan {
  const { battle, data } = ctx;
  const rules = data.battle;
  const side = battle.sides[f.side];
  const share = f.hp / f.maxHp;
  const enemies = enemiesOf(battle, f);
  if (enemies.length === 0) return { verb: 'guard' };
  const stance = f.player ? rules.stances.find((s) => s.id === battle.stance) : undefined;

  // Orders from the side.
  if (side.order === 'protect' && side.target && side.target !== f.id)
    f.status.protects = side.target;
  else if (f.role !== 'guard') f.status.protects = null;
  if (stance?.protect) {
    const weakest = alliesOf(battle, f).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
    f.status.protects = weakest?.id ?? null;
  }
  if (side.order === 'combo') {
    for (const [partnerId, moveId] of Object.entries(f.combos)) {
      const partner = fighter(battle, partnerId);
      if (partner && active(partner) && partner.combos[f.id]) {
        side.order = 'none';
        return {
          verb: 'technique',
          move: moveId,
          partner: partnerId,
          target: side.target ?? undefined,
        };
      }
    }
  }

  const target = targetFor(ctx, f, { verb: 'strike' }, null);
  const fleeAt = stance ? stance.fleeAt : f.foe && f.intent !== 'kill' ? 0.2 : 0;
  if (!battle.spar && fleeAt > 0 && share < fleeAt) return { verb: 'flee' };

  // Haki: a coat against a Logia (or a strong foe), a read now and then, a king's burst.
  const coatCost = rules.haki.coat.cost;
  const touchable = target ? canTouch(ctx, f, target, null) : true;
  if (f.armament > 0 && f.status.coated === 0 && f.haki >= coatCost) {
    if (
      !touchable ||
      (target && powerOf(target) >= powerOf(f) * 0.6 && rng.fork('coat').chance(0.6))
    )
      return { verb: 'haki', haki: 'coat', target: target?.id };
  }
  if (f.conqueror > 0 && f.haki >= rules.haki.burst.cost && !battle.spar) {
    const mine = rawStat(f, 'willpower') * powerOf(f);
    const weak = enemies.filter(
      (e) => rawStat(e, 'willpower') * powerOf(e) < mine * rules.haki.burst.ratio,
    );
    if (weak.length >= Math.min(2, enemies.length) && rng.fork('burst').chance(0.7))
      return { verb: 'haki', haki: 'burst' };
  }
  if (
    f.observation > 0 &&
    f.status.read === 0 &&
    f.haki >= rules.haki.read.cost &&
    rng.fork('read').chance(0.25)
  )
    return { verb: 'haki', haki: 'read' };

  // A foe nobody can touch: find a way, or get away.
  if (target && !touchable) {
    const way = f.moves.find((m) => canTouch(ctx, f, target, m) && usable(ctx, f, m, target));
    if (way) return { verb: 'technique', move: way.id, target: target.id };
    if (f.seastone) return { verb: 'grapple', target: target.id };
    if (!battle.spar && rng.fork('hopeless').chance(0.4)) return { verb: 'flee' };
    return { verb: 'guard' };
  }

  // Patch up, or patch up a friend.
  if ((f.kit['kit_medicine'] ?? 0) > 0) {
    if (share < 0.35) return { verb: 'item', item: 'kit_medicine', target: f.id };
    const hurt = alliesOf(battle, f).find((a) => a.hp / a.maxHp < 0.3);
    if (hurt && f.role === 'support')
      return { verb: 'item', item: 'kit_medicine', target: hurt.id };
  }
  if (f.role === 'support') {
    const heal = f.moves.find((m) => m.form === 'support' && m.effects.includes('heal'));
    if (heal && alliesOf(battle, f).some((a) => a.hp / a.maxHp < 0.5))
      return { verb: 'technique', move: heal.id };
  }
  // Someone meant to be taken alive, pinned and weak: bind them.
  if (
    target &&
    f.intent === 'capture' &&
    target.status.pinnedBy === f.id &&
    target.hp / target.maxHp < rules.grapple.captureBelow
  )
    return { verb: 'grapple', target: target.id };
  if (
    target &&
    f.intent !== 'kill' &&
    !battle.spar &&
    target.hp / target.maxHp < rules.talk.surrenderBelow &&
    rng.fork('demand').chance(0.25)
  )
    return { verb: 'talk', talk: 'surrender', target: target.id };

  const base = weightsFor(ctx, f);
  const fallBack = side.order === 'fall_back' ? 3 : 1;
  const move = pickMove(ctx, f, target, rng.fork('move'));
  const options: { verb: BattleVerb; w: number }[] = [
    { verb: 'strike', w: target ? (base.strike ?? 1) : 0 },
    { verb: 'technique', w: move ? (base.technique ?? 1) : 0 },
    { verb: 'guard', w: (base.guard ?? 1) * fallBack },
    { verb: 'evade', w: (base.evade ?? 1) * fallBack },
    { verb: 'feint', w: target && !battle.spar ? (base.feint ?? 0.5) * 0.6 : 0 },
    {
      verb: 'grapple',
      w: target ? (base.grapple ?? 0.5) * (f.intent === 'capture' ? 1.5 : 0.6) : 0,
    },
    { verb: 'talk', w: battle.spar ? 0 : (base.talk ?? 0) * 0.3 },
  ];
  const verb = rng.fork('verb').weightedPick(options, (o) => o.w)?.verb ?? 'strike';
  switch (verb) {
    case 'technique':
      return { verb, move: move?.id, target: target?.id };
    case 'talk':
      return { verb, talk: rng.fork('talk').chance(0.7) ? 'taunt' : 'stall', target: target?.id };
    default:
      return { verb, target: target?.id };
  }
}
