import type { GameData, PowerEvent } from '../../engine/data/schemas';
import type { CharacterData, Entity } from '../../engine/state';
import { derived, flagOf, statTotal } from '../life/body';
import { addProgress, breakthroughTrack, line, openTrack, tell, type PowerCtx } from './tracks';
import {
  ensurePowers,
  HAKI_COLOURS,
  HAKI_TRACKS,
  hakiAwake,
  notePowerEvent,
  type HakiColour,
} from './state';

/**
 * Haki (Phase 4). Everyone carries all three seeds; most never wake them.
 *
 *  - Observation and Armament wake under four triggers: months of Train Spirit seeds (the Phase 2
 *    seed counters reaching `seedMonths`, then a chance each month), a near-death moment, a crisis
 *    that protects someone, or a teacher's push. Each needs a little Willpower first.
 *  - Conqueror's wakes only in someone with King's Qualities (a hidden trait, about one in a few
 *    million at birth), and only in a surge: a crisis, a brush with death, a clash. Drills never
 *    wake it. The first surge knocks out everyone weak-willed nearby.
 *
 * Haki stamina is a derived value (Willpower-based) that refills each month; haki training spends
 * it, and spending past the pool costs Vigor. Haki stages add to Combat Power through the stage's
 * `combat` (the plan's "haki bonus").
 */

export type WakeTrigger = 'seed' | 'near_death' | 'crisis' | 'teacher' | 'clash';

export function hasKingsQualities(data: GameData, c: CharacterData): boolean {
  return c.traits.includes(data.powers.haki.kingsQualitiesTrait);
}

/** The chance a trigger wakes this colour now (0 when it cannot: Conqueror's without the trait). */
export function wakeChance(ctx: PowerCtx, colour: HakiColour, trigger: WakeTrigger): number {
  const { data, c, entity, tick } = ctx;
  const rules = data.powers.haki;
  if (hakiAwake(c, colour)) return 0;
  if (colour === 'conqueror') {
    if (!hasKingsQualities(data, c)) return 0;
    if (trigger === 'seed' || trigger === 'teacher') return 0;
    return trigger === 'clash'
      ? 0.6
      : trigger === 'crisis'
        ? rules.crisisChance * 1.5
        : rules.nearDeathChance * 1.5;
  }
  if (statTotal(entity, 'willpower', tick) < rules.minWillpower) return 0;
  switch (trigger) {
    case 'seed':
      return rules.seedChance;
    case 'near_death':
      return rules.nearDeathChance;
    case 'crisis':
      return rules.crisisChance;
    case 'teacher':
      return rules.teacherChance;
    case 'clash':
      return rules.crisisChance * 0.5;
  }
}

/** Try to wake one colour. True if it woke. */
export function tryWake(ctx: PowerCtx, colour: HakiColour, trigger: WakeTrigger): boolean {
  const chance = wakeChance(ctx, colour, trigger);
  if (chance <= 0 || !ctx.rng.fork('wake', colour, trigger).chance(chance)) return false;
  wake(ctx, colour, trigger);
  return true;
}

/** Wake a colour for certain (an event's doing, or a debug command). */
export function wake(ctx: PowerCtx, colour: HakiColour, trigger: WakeTrigger | 'event'): void {
  const { data } = ctx;
  if (hakiAwake(ctx.c, colour)) return;
  const trackId = HAKI_TRACKS[colour];
  openTrack(ctx, trackId, { source: `woke (${trigger})`, quiet: true });
  const track = data.tracks[trackId];
  tell(
    ctx,
    line(data, colour === 'conqueror' ? 'conquerorWakes' : 'hakiWakes'),
    { title: track?.name ?? colour },
    ['haki'],
  );
  if (colour === 'conqueror') {
    // The first surge: everyone weak-willed nearby falls (the plan: "a whole crowd the first time").
    ctx.entity.flags['haki.conqueror.surged'] = ctx.tick;
    tell(ctx, line(data, 'conquerorSurge'), {}, ['haki'], 'alert');
  }
}

/** Months of Train Spirit: the Phase 2 seed counters, and a chance a seed wakes. */
export function seedMonth(ctx: PowerCtx): void {
  const { data, state, entity } = ctx;
  for (const colour of ['observation', 'armament'] as const) {
    if (hakiAwake(ctx.c, colour)) continue;
    const seeds = flagOf(state, entity, `haki.seed.${colour}`);
    if (typeof seeds !== 'number' || seeds < data.powers.haki.seedMonths) continue;
    tryWake(ctx, colour, 'seed');
  }
}

/** Something that moves powers happened: record it, and let it wake haki or break a plateau. */
export function powerEvent(ctx: PowerCtx, event: PowerEvent): void {
  notePowerEvent(ctx.c, event, ctx.tick);
  switch (event) {
    case 'near_death':
      for (const colour of HAKI_COLOURS) tryWake(ctx, colour, 'near_death');
      break;
    case 'crisis':
      for (const colour of HAKI_COLOURS) tryWake(ctx, colour, 'crisis');
      break;
    case 'clash':
      tryWake(ctx, 'conqueror', 'clash');
      break;
    case 'mentor_push':
      for (const colour of ['observation', 'armament'] as const) tryWake(ctx, colour, 'teacher');
      breakthroughTrack(ctx);
      break;
    case 'defeat':
      if (ctx.rng.fork('defeat').chance(0.35)) breakthroughTrack(ctx);
      break;
    default:
      break;
  }
  // Conqueror's leaps forward in crises and clashes, not in drills.
  if (
    hakiAwake(ctx.c, 'conqueror') &&
    ['crisis', 'clash', 'near_death', 'stronger_foe'].includes(event)
  ) {
    addProgress(ctx, HAKI_TRACKS.conqueror, event === 'clash' ? 12 : 6, 'fight');
  }
}

// ---- Stamina --------------------------------------------------------------------------------

export function staminaPool(data: GameData, entity: Entity, tick: number): number {
  if (!data.character.derived.some((d) => d.id === 'hakiStamina')) return 0;
  return Math.max(0, derived(data, entity, 'hakiStamina', tick));
}

/** Refill haki stamina for the month (only someone with a colour awake has any). */
export function refillStamina(data: GameData, entity: Entity, tick: number): void {
  const c = entity.character;
  if (!c?.powers || !HAKI_COLOURS.some((h) => hakiAwake(c, h))) return;
  c.powers.stamina = staminaPool(data, entity, tick);
}

/** Spend haki stamina. Returns the Vigor owed for spending past the pool. */
export function spendStamina(data: GameData, entity: Entity, amount: number): number {
  const c = entity.character;
  if (!c || amount <= 0) return 0;
  const powers = ensurePowers(c);
  const paid = Math.min(powers.stamina, amount);
  powers.stamina = Math.round((powers.stamina - paid) * 100) / 100;
  const over = amount - paid;
  return over > 0 ? Math.ceil(over * data.powers.haki.vigorPerOverspend) : 0;
}
