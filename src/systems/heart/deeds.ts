import type { GameData, RepDim } from '../../engine/data/schemas';
import { REP_DIMS } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Entity, HeartData, WorldState } from '../../engine/state';
import { addMod, makeStat, statValue } from '../../engine/stats';
import { lanesFrom } from '../places/graph';
import { moveStat } from './bonds';
import { clampAxis, clampMorale, ensureHeart } from './profile';

/**
 * What a deed does beyond the moment (Phase 7): to the doer's conscience, and to what people say
 * of them.
 *
 * Conscience is a bar from 0 to 100: acting against one's own values (a kind Marine burning a
 * village) lowers it, living by them raises it, and the past weighs less each year. Falling below
 * the line brings guilt: Willpower lost for months, a darker mood, and the person drifting toward
 * what they did. For the player, a guilt event they must answer.
 *
 * Reputation (separate from fame and bounty) is what people say the player is, place by place,
 * faction by faction and for the family name: honourable or treacherous, kind or cruel, brave or
 * cowardly, generous or greedy. It spreads along the sea lanes a quarter at a time and colours
 * first impressions before any relationship exists.
 */

export function conscienceOf(heart: HeartData | undefined, tick: number): number {
  return heart ? Math.max(0, Math.min(100, statValue(heart.conscience, tick))) : 70;
}

export interface ConscienceChange {
  moved: number;
  /** It fell below the guilt line with this deed. */
  guilty: boolean;
}

/**
 * A deed's weight on someone's conscience: each tag that betrays one of their values (or their
 * nature) lowers it, each that lives by them raises it, as a modifier traced to the deed's record.
 */
export function weighDeed(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tags: readonly string[],
  seq: number | undefined,
): ConscienceChange {
  const rules = data.heart.conscience;
  const heart = ensureHeart(state, data, entity);
  const tick = state.tick;
  const before = conscienceOf(heart, tick);
  let delta = 0;
  for (const tag of tags) {
    const deed = rules.deeds[tag];
    if (!deed) continue;
    const betrays = deed.against.some((v) => heart.profile.values.includes(v));
    const nature = deed.axis ? (heart.profile.axes[deed.axis] ?? 0) * deed.sign : 0;
    if (betrays || nature >= 30) delta -= rules.drop * (betrays && nature >= 30 ? 1.5 : 1);
    if (deed.by.some((v) => heart.profile.values.includes(v))) delta += rules.rise;
  }
  if (delta === 0) return { moved: 0, guilty: false };
  const source = delta < 0 ? 'Acting against what you value' : 'Living by what you value';
  const moved = moveStat(heart.conscience, delta, source, seq, tick, { min: 0, max: 100 });
  const after = conscienceOf(heart, tick);
  return { moved, guilty: before >= rules.guiltBelow && after < rules.guiltBelow };
}

/**
 * Guilt, for anyone: Willpower lost for months, morale down, and their nature drifting toward
 * what they did (the kind grow harder). Returns the line it writes for the player.
 */
export function feelGuilt(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tags: readonly string[],
  seq: number,
): void {
  const rules = data.heart.conscience;
  const heart = ensureHeart(state, data, entity);
  const tick = state.tick;
  // Someone the world never needed numbers for has an ordinary will until now.
  const will = (entity.stats['willpower'] ??= makeStat(40));
  addMod(will, {
    source: 'Guilt',
    value: rules.willpower,
    kind: 'flat',
    expiresTick: tick + rules.months,
    seq,
  });
  heart.morale = clampMorale(heart.morale - 10);
  heart.mood = { id: 'grieving', until: tick + 2 };
  for (const tag of tags) {
    const deed = rules.deeds[tag];
    if (!deed?.axis || entity.id === state.playerId) continue;
    // The player's nature drifts through their own counters; others' through their profile.
    const now = heart.profile.axes[deed.axis] ?? 0;
    heart.profile.axes[deed.axis] = clampAxis(now - 6 * Math.sign(deed.sign));
  }
}

/** A Tier 2 person or anyone else acts against their values: logged known to nobody (rule 4). */
export function npcDeed(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tags: readonly string[],
  what: string,
): ConscienceChange {
  const record = appendLog(state, state.tick, {
    kind: 'life',
    summary: `${entity.name} ${what}.`,
    tags: ['heart', 'deed', ...tags],
    actorIds: [entity.id],
    place: entity.character?.place ?? null,
    cause: 'sys:heart',
    knownBy: [],
  });
  const change = weighDeed(state, data, entity, tags, record.seq);
  if (change.guilty) {
    feelGuilt(state, data, entity, tags, record.seq);
    appendLog(state, state.tick, {
      kind: 'life',
      summary: `What ${entity.name} did sits badly: guilt, sleepless nights, a weaker will.`,
      tags: ['heart', 'guilt'],
      actorIds: [entity.id],
      cause: 'sys:heart',
      causeSeq: record.seq,
      knownBy: [],
    });
  }
  return change;
}

// ---- Reputation -------------------------------------------------------------------------------

export function repOf(heart: HeartData | undefined, scope: string, dim: RepDim): number {
  return heart?.rep?.[scope]?.[dim] ?? 0;
}

function bump(data: GameData, heart: HeartData, scope: string, dim: RepDim, by: number): void {
  heart.rep ??= {};
  const s = (heart.rep[scope] ??= {});
  const max = data.heart.reputation.max;
  s[dim] = Math.round(Math.max(-max, Math.min(max, (s[dim] ?? 0) + by)) * 10) / 10;
}

/** The scopes a deed is heard in: where it happened, who holds that place, the family name. */
export function scopesOf(state: WorldState, entity: Entity, place: string | null): string[] {
  const out: string[] = [];
  if (place) {
    out.push(place);
    const controller = state.entities[place]?.place?.controller;
    if (controller) out.push(controller);
  }
  const family = entity.character?.familyName;
  if (family) out.push(`family:${family}`);
  return out;
}

/** What a deed says of the player, heard where it happened. */
export function deedReputation(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tags: readonly string[],
  place: string | null,
): void {
  const heart = ensureHeart(state, data, entity);
  for (const tag of tags) {
    const dims = data.heart.reputation.tags[tag];
    if (!dims) continue;
    for (const scope of scopesOf(state, entity, place)) {
      // The family name hears of it more faintly.
      const share = scope.startsWith('family:') ? 0.3 : 1;
      for (const [dim, by] of Object.entries(dims))
        bump(data, heart, scope, dim as RepDim, (by ?? 0) * share);
    }
  }
}

/** What a place (and whoever holds it, and the family name) says of someone, summed. */
export function repAt(
  state: WorldState,
  heart: HeartData | undefined,
  entity: Entity,
  place: string | null,
): Record<RepDim, number> {
  const out = Object.fromEntries(REP_DIMS.map((d) => [d, 0])) as Record<RepDim, number>;
  for (const scope of scopesOf(state, entity, place)) {
    const share = scope.startsWith('family:') ? 0.5 : scope === place ? 1 : 0.5;
    for (const dim of REP_DIMS) out[dim] += repOf(heart, scope, dim) * share;
  }
  return out;
}

/** "honourable and brave" for a place: the dims people there would name, or null. */
export function repWords(data: GameData, rep: Record<RepDim, number>, min = 10): string | null {
  const words = REP_DIMS.filter((d) => Math.abs(rep[d]) >= min)
    .sort((a, b) => Math.abs(rep[b]) - Math.abs(rep[a]))
    .map((d) => {
      const def = data.heart.reputation.dims[d];
      return rep[d] > 0 ? (def?.high ?? d) : (def?.low ?? d);
    });
  if (words.length === 0) return null;
  return words.length === 1
    ? (words[0] as string)
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * A quarter passes: each place's word of the player carries a share to the places its lanes
 * reach (if it is louder there), and everything fades a little. Returns places that heard of the
 * player for the first time (for the "word has reached" line).
 */
export function spreadReputation(data: GameData, entity: Entity): string[] {
  const heart = entity.character?.heart;
  if (!heart?.rep) return [];
  const rules = data.heart.reputation;
  const fresh: string[] = [];
  const places = Object.keys(heart.rep)
    .filter((s) => s in data.locations)
    .sort();
  const adds: [string, RepDim, number][] = [];
  for (const place of places) {
    for (const edge of lanesFrom(data, place)) {
      for (const dim of REP_DIMS) {
        const here = repOf(heart, place, dim);
        const there = repOf(heart, edge.to, dim);
        if (Math.abs(here) > Math.abs(there) + 2)
          adds.push([edge.to, dim, (here - there) * rules.spread]);
      }
    }
  }
  for (const [place, dim, by] of adds) {
    const known = Object.values(heart.rep[place] ?? {}).some((v) => Math.abs(v) >= 10);
    bump(data, heart, place, dim, by);
    if (!known && Object.values(heart.rep[place] ?? {}).some((v) => Math.abs(v) >= 10))
      fresh.push(place);
  }
  const keep = 1 - rules.fade / 4;
  for (const scope of Object.keys(heart.rep)) {
    const s = heart.rep[scope] ?? {};
    for (const dim of Object.keys(s)) s[dim] = Math.round((s[dim] ?? 0) * keep * 100) / 100;
  }
  return [...new Set(fresh)].sort();
}
