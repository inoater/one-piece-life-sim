import type { BondKind, GameData, RelAxis, RelRequires } from '../../engine/data/schemas';
import { REL_AXES } from '../../engine/data/schemas';
import type { Entity, Modifier, Relationship, Stat, WorldState } from '../../engine/state';
import { addMod, makeStat, statValue } from '../../engine/stats';
import { locationIdOf } from '../places/place';
import { RECIPROCAL } from '../genesis/family';
import { humanAgeOf, personOf } from '../life/body';
import { heartOrRoll, moodOf } from './profile';

/**
 * A relationship as the heart sees it (Phase 7). Each pair who have met holds two records, one on
 * each side, and every axis is a Stat whose modifiers name the logged event behind them (rule 3):
 * Affection is the record's `opinion`; trust, respect, fear, rivalry, attraction and debt are kept
 * in `axes`, and start at rest. A bond kind (friendship, romance, a student...) is read from what
 * the player calls the other, and shows bars: some are axes, the rest are the bond's own, kept on
 * the other's record (their Devotion, their Jealousy).
 *
 * Debt runs the other's way: on their record, positive means they owe the player.
 */

export const relOf = (entity: Entity | undefined, otherId: string): Relationship | undefined =>
  entity?.character?.relationships.find((r) => r.id === otherId);

export interface Pair {
  /** How the player sees them. */
  mine: Relationship;
  /** How they see the player. */
  theirs: Relationship;
}

/**
 * Both sides of the player's tie to someone. A side that was never made is filled in (`create`),
 * or, for a view that must not change the world, stands in at rest without being stored.
 */
export function pairOf(player: Entity, other: Entity, create = true): Pair | null {
  const mine = relOf(player, other.id);
  if (!mine || !other.character) return null;
  let theirs = relOf(other, player.id);
  if (!theirs) {
    theirs = {
      id: player.id,
      kind: RECIPROCAL[mine.kind],
      opinion: makeStat(Math.round(statValue(mine.opinion, mine.sinceTick))),
      sinceTick: mine.sinceTick,
    };
    if (create) other.character.relationships.push(theirs);
  }
  return { mine, theirs };
}

export function bondOf(data: GameData, kind: Relationship['kind']): BondKind {
  return data.heart.relationship.bonds[kind] ?? 'friendship';
}

export function axisRange(data: GameData, axis: RelAxis): { min: number; max: number } {
  const def = data.heart.relationship.axes[axis];
  return { min: def?.min ?? -100, max: def?.max ?? 100 };
}

/** The Stat behind an axis (made at rest the first time it moves). */
export function axisStat(rel: Relationship, axis: RelAxis): Stat {
  if (axis === 'affection') return rel.opinion;
  rel.axes ??= {};
  return (rel.axes[axis] ??= makeStat(0));
}

export function axisValue(
  data: GameData,
  rel: Relationship | undefined,
  axis: RelAxis,
  tick: number,
): number {
  if (!rel) return 0;
  const stat = axis === 'affection' ? rel.opinion : rel.axes?.[axis];
  if (!stat) return 0;
  const { min, max } = axisRange(data, axis);
  return Math.max(min, Math.min(max, statValue(stat, tick)));
}

/**
 * Add to a stat as a named modifier: one per source ("Shared a meal", "Insulted"), adding up over
 * time, pointing at the latest event behind it. Kept inside the range given. Returns what moved.
 */
export function moveStat(
  stat: Stat,
  delta: number,
  source: string,
  seq: number | undefined,
  tick: number,
  range: { min: number; max: number },
): number {
  if (delta === 0 || !Number.isFinite(delta)) return 0;
  const now = statValue(stat, tick);
  const target = Math.max(range.min, Math.min(range.max, now + delta));
  const moved = Math.round((target - now) * 100) / 100;
  if (moved === 0) return 0;
  const mod = stat.mods.find(
    (m) => m.source === source && m.kind === 'flat' && m.expiresTick === undefined,
  );
  if (mod) {
    mod.value = Math.round((mod.value + moved) * 100) / 100;
    if (seq !== undefined) mod.seq = seq;
  } else {
    const fresh: Modifier = { source, value: moved, kind: 'flat' };
    if (seq !== undefined) fresh.seq = seq;
    addMod(stat, fresh);
  }
  return moved;
}

export function moveAxis(
  data: GameData,
  rel: Relationship,
  axis: RelAxis,
  delta: number,
  source: string,
  seq: number | undefined,
  tick: number,
): number {
  return moveStat(axisStat(rel, axis), delta, source, seq, tick, axisRange(data, axis));
}

export interface BarDef {
  id: string;
  name: string;
  axis?: RelAxis;
  rest: number;
  drift: number;
  driftApart: number;
  together: number;
  apart: number;
  max: number;
}

export function barsOf(data: GameData, bond: BondKind): BarDef[] {
  return (data.heart.bonds[bond]?.bars ?? []) as BarDef[];
}

/** A bar of the bond's own (made at rest the first time it is needed). */
export function barStat(theirs: Relationship, def: BarDef): Stat {
  theirs.bars ??= {};
  return (theirs.bars[def.id] ??= makeStat(def.rest));
}

/** Where a bar or axis stands, read from their side: "loyalty", "trust", "jealousy". */
export function readBar(
  data: GameData,
  theirs: Relationship | undefined,
  bond: BondKind,
  id: string,
  tick: number,
): number {
  if (!theirs) return 0;
  if ((REL_AXES as readonly string[]).includes(id))
    return axisValue(data, theirs, id as RelAxis, tick);
  const def = barsOf(data, bond).find((b) => b.id === id);
  if (def) {
    const stat = theirs.bars?.[def.id];
    const v = stat ? statValue(stat, tick) : def.rest;
    return Math.max(0, Math.min(def.max, v));
  }
  // A bar another bond has (a former lover's jealousy): read it if it was ever kept.
  const stat = theirs.bars?.[id];
  return stat ? Math.max(0, statValue(stat, tick)) : 0;
}

/** Move a bar (an axis, if the bar is one) on their side. */
export function moveBar(
  data: GameData,
  theirs: Relationship,
  bond: BondKind,
  id: string,
  delta: number,
  source: string,
  seq: number | undefined,
  tick: number,
): number {
  if ((REL_AXES as readonly string[]).includes(id))
    return moveAxis(data, theirs, id as RelAxis, delta, source, seq, tick);
  const def =
    barsOf(data, bond).find((b) => b.id === id) ??
    Object.values(data.heart.bonds)
      .flatMap((b) => (b?.bars ?? []) as BarDef[])
      .find((b) => b.id === id && !b.axis);
  if (!def || def.axis)
    return def?.axis ? moveAxis(data, theirs, def.axis, delta, source, seq, tick) : 0;
  return moveStat(barStat(theirs, def), delta, source, seq, tick, { min: 0, max: def.max });
}

export function monthsKnown(rel: Relationship, tick: number): number {
  return Math.max(0, tick - rel.sinceTick);
}

/** Two people in the same place (neither at sea apart). */
export function together(data: GameData, a: Entity, b: Entity): boolean {
  const ca = a.character;
  const cb = b.character;
  if (!ca || !cb) return false;
  const pa = locationIdOf(data, ca);
  const pb = locationIdOf(data, cb);
  if (pa === null || pb === null) {
    const va = ca.travel?.voyage?.shipId ?? null;
    return va !== null && pa === null && pb === null && va === (cb.travel?.voyage?.shipId ?? null);
  }
  return pa === pb;
}

/** The record of their meeting: what a relationship's base values trace to. */
export function markMet(a: Entity, b: Entity, seq: number): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const rel = relOf(x, y.id);
    if (rel && rel.metSeq === undefined) rel.metSeq = seq;
  }
}

/** The log record a modifier traces to: its own event, or (a trait's first impression) the meeting. */
export function traceOf(rel: Relationship, mod: Modifier): number | undefined {
  return mod.seq ?? rel.metSeq;
}

/** What the player calls them, in the heart's words: first matching label in data/heart.json. */
export function labelOf(data: GameData, pair: Pair, tick: number): { id: string; name: string } {
  const { mine, theirs } = pair;
  const bond = bondOf(data, mine.kind);
  const reached = new Set(theirs.milestones ?? []);
  for (const label of data.heart.labels) {
    if (label.kinds.length > 0 && !label.kinds.includes(mine.kind)) continue;
    if (label.sworn !== undefined && (mine.sworn === true) !== label.sworn) continue;
    if (label.romance && (!mine.romance || !label.romance.includes(mine.romance))) continue;
    if (label.milestone && !reached.has(label.milestone)) continue;
    if (label.months !== undefined && monthsKnown(mine, tick) > label.months) continue;
    let ok = true;
    for (const [id, min] of Object.entries(label.min))
      if (readBar(data, theirs, bond, id, tick) < min) ok = false;
    for (const [id, max] of Object.entries(label.max))
      if (readBar(data, theirs, bond, id, tick) > max) ok = false;
    if (ok) return { id: label.id, name: label.name };
  }
  return { id: 'acquaintance', name: 'Acquaintance' };
}

/** Whether romance is possible between the player and them: both adults, both open, the setting on. */
export function romanceAllowed(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
): boolean {
  if (state.config.romance === false) return false;
  const pp = personOf(data, player);
  const op = personOf(data, other);
  if (!pp || !op || other.flags['animal'] !== undefined) return false;
  const min = data.heart.romance.minAge;
  if (humanAgeOf(data, pp, state.tick) < min || humanAgeOf(data, op, state.tick) < min)
    return false;
  return heartOrRoll(state, data, other).profile.romance !== false;
}

/** Does a relationship meet a requirement (an intent's, or an initiative's)? Null when it does. */
export function requiresReason(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
  r: RelRequires,
): string | null {
  const pair = pairOf(player, other, false);
  if (!pair) return 'You do not know them';
  const { mine, theirs } = pair;
  const tick = state.tick;
  const bond = bondOf(data, mine.kind);
  if (r.kinds.length > 0 && !r.kinds.includes(mine.kind)) return 'Not with them';
  if (r.notKinds.includes(mine.kind)) return 'Not with them';
  if (r.bonds.length > 0 && !r.bonds.includes(bond)) return 'Not with them';
  for (const [axis, min] of Object.entries(r.min))
    if (axisValue(data, theirs, axis as RelAxis, tick) < (min ?? 0))
      return axis === 'debt' ? 'They do not owe you' : `Their ${axis} is too low`;
  for (const [axis, max] of Object.entries(r.max))
    if (axisValue(data, theirs, axis as RelAxis, tick) > (max ?? 0))
      return `Their ${axis} is too high`;
  for (const [bar, min] of Object.entries(r.minBars))
    if (readBar(data, theirs, bond, bar, tick) < min) return `Not yet`;
  for (const [bar, max] of Object.entries(r.maxBars))
    if (readBar(data, theirs, bond, bar, tick) > max) return `Not now`;
  if (r.romance && (!mine.romance || !r.romance.includes(mine.romance))) return 'Not yet';
  if (r.romantic && !romanceAllowed(state, data, player, other))
    return 'Romance is not possible between you';
  if (r.sworn !== undefined && (mine.sworn === true) !== r.sworn)
    return r.sworn ? 'You are not sworn siblings' : 'You are sworn siblings already';
  const heart = heartOrRoll(state, data, other);
  for (const [axis, range] of Object.entries(r.personality)) {
    const v = heart?.profile.axes[axis] ?? 0;
    if (range?.min !== undefined && v < range.min) return 'Not their way';
    if (range?.max !== undefined && v > range.max) return 'Not their way';
  }
  if (r.moods.length > 0 && !r.moods.includes(moodOf(heart, tick))) return 'Not in this mood';
  if (r.minAge > 0) {
    const pp = personOf(data, player);
    const op = personOf(data, other);
    if (pp && humanAgeOf(data, pp, tick) < r.minAge) return 'You are too young';
    if (op && humanAgeOf(data, op, tick) < r.minAge) return 'They are too young';
  }
  return null;
}

/** Everyone the player knows who is alive, with both sides of the tie (`create`: see pairOf). */
export function circle(
  state: WorldState,
  player: Entity,
  create = true,
): { other: Entity; pair: Pair }[] {
  const out: { other: Entity; pair: Pair }[] = [];
  for (const rel of player.character?.relationships ?? []) {
    const other = state.entities[rel.id];
    if (!other?.character?.alive || other.id === player.id) continue;
    const pair = pairOf(player, other, create);
    if (pair) out.push({ other, pair });
  }
  return out;
}
