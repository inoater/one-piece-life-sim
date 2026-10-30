import {
  HEART_AXES,
  type GameData,
  type HeartAxis,
  type Register,
} from '../../engine/data/schemas';
import { REGISTERS } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { Entity, HeartData, Mood, Profile, WorldState } from '../../engine/state';
import { makeStat } from '../../engine/stats';

/**
 * Who someone is (Phase 7): seven axes, three values, a dream, likes and dislikes, a voice, a fear
 * and a soft spot.
 *
 * A person's heart is made the first time the world has reason to know it (they meet the player,
 * reach out, gossip, marry), from a stream keyed to their id, so it is the same whenever it is
 * made: canon people from their voice pack in data/heart.json, everyone else rolled from where they
 * come from, their trade and their traits, and children leaning toward their parents. The player's
 * axes are their traits plus Phase 4's hidden drift counters, worked out again every month.
 */

export const clampAxis = (n: number): number => Math.max(-100, Math.min(100, Math.round(n)));

export function heartOf(entity: Entity | undefined): HeartData | undefined {
  return entity?.character?.heart;
}

/** Axis leanings from traits and (for the player) the drift counters, without noise. */
export function leanings(data: GameData, entity: Entity): Record<HeartAxis, number> {
  const out = Object.fromEntries(HEART_AXES.map((a) => [a, 0])) as Record<HeartAxis, number>;
  const c = entity.character;
  if (!c) return out;
  for (const id of c.traits) {
    for (const [axis, v] of Object.entries(data.heart.traitLeanings[id] ?? {}))
      out[axis as HeartAxis] += v ?? 0;
  }
  for (const [counter, value] of Object.entries(c.personality?.axes ?? {})) {
    const map = data.heart.driftAxes[counter];
    if (map) out[map.axis] += value * map.scale;
  }
  return out;
}

function pickValues(
  data: GameData,
  axes: Record<string, number>,
  occupation: string | undefined,
  rng: Rng,
): string[] {
  return data.heart.values
    .map((v) => {
      let score = rng.fork('value', v.id).float(0, 25);
      for (const [axis, w] of Object.entries(v.axes)) score += ((w ?? 0) * (axes[axis] ?? 0)) / 5;
      if (occupation && v.occupations.includes(occupation)) score += 30;
      return { id: v.id, score };
    })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, 3)
    .map((v) => v.id);
}

function pickDream(
  data: GameData,
  values: readonly string[],
  occupation: string | undefined,
  rng: Rng,
): string {
  const dream = rng.weightedPick(data.heart.dreams, (d) => {
    let w = d.weight;
    if (d.values.some((v) => values.includes(v))) w *= 3;
    if (occupation && d.occupations.includes(occupation)) w *= 3;
    return w;
  });
  return dream?.id ?? (data.heart.dreams[0]?.id as string);
}

function pickRegister(data: GameData, axes: Record<string, number>, rng: Rng): Register {
  return (
    rng.weightedPick(REGISTERS, (id) => {
      const r = data.heart.registers[id];
      if (!r) return 0;
      let lean = 1;
      for (const [axis, w] of Object.entries(r.axes)) lean += ((w ?? 0) * (axes[axis] ?? 0)) / 100;
      return r.weight * Math.max(0.1, lean);
    }) ?? 'plain'
  );
}

/** Roll someone's profile: their traits, home and trade lean it; `parents` pull it their way. */
export function rollProfile(
  state: WorldState,
  data: GameData,
  entity: Entity,
  parents: readonly Entity[] = [],
): Profile {
  const rng = Rng.root(state.seed).fork('heart', entity.id);
  const c = entity.character;
  const canon = data.heart.canon[entity.id];
  const lean = leanings(data, entity);
  const culture = c ? (data.heart.cultureLeanings[c.birthplace] ?? {}) : {};
  const parentAxes = parents
    .map((p) => p.character?.heart?.profile.axes)
    .filter((a): a is Record<string, number> => a !== undefined);
  const axes: Record<string, number> = {};
  for (const axis of HEART_AXES) {
    const r = rng.fork('axis', axis);
    if (canon?.axes[axis] !== undefined) {
      axes[axis] = clampAxis(canon.axes[axis] ?? 0);
      continue;
    }
    const inherited =
      parentAxes.length > 0
        ? parentAxes.reduce((s, a) => s + (a[axis] ?? 0), 0) / parentAxes.length
        : null;
    const noise =
      inherited === null
        ? r.normal(0, data.heart.spread)
        : r.normal(0, data.heart.heredity.personalityNoise);
    axes[axis] = clampAxis((inherited ?? 0) + lean[axis] + (culture[axis] ?? 0) + noise);
  }
  const occupation = c?.occupation;
  const values =
    canon && canon.values.length > 0
      ? [...canon.values]
      : pickValues(data, axes, occupation, rng.fork('values'));
  const dream = canon?.dream ?? pickDream(data, values, occupation, rng.fork('dream'));
  const likes = data.heart.likes;
  const like = (kind: keyof typeof likes) => rng.fork('like', kind).pick(likes[kind]);
  const liked = [like('food'), like('topic'), like('people'), like('place')];
  const dislikeFrom = (kind: keyof typeof likes) =>
    rng.fork('dislike', kind).pick(likes[kind].filter((x) => !liked.includes(x)));
  const dislikes = [dislikeFrom('food'), dislikeFrom('topic')];
  const voiceRng = rng.fork('voice');
  const register = canon?.register ?? pickRegister(data, axes, voiceRng.fork('register'));
  const tic =
    canon !== undefined
      ? canon.tic
      : voiceRng.fork('tic?').chance(data.heart.ticShare)
        ? voiceRng.fork('tic').pick(data.heart.tics)
        : null;
  const laugh =
    canon !== undefined
      ? canon.laugh
      : voiceRng.fork('laugh?').chance(data.heart.laughShare)
        ? voiceRng.fork('laugh').pick(data.heart.laughs)
        : null;
  const soft = rng.fork('soft');
  const family = (c?.relationships ?? []).filter((r) => r.kind === 'child' || r.kind === 'sibling');
  const softSpot =
    family.length > 0 && soft.chance(0.5)
      ? soft.pick(family).id
      : soft.fork('thing').pick(data.heart.softSpots);
  return {
    axes,
    values,
    dream,
    likes: liked,
    dislikes,
    voice: { register, tic, laugh },
    fear: rng.fork('fear').pick(data.heart.fears),
    softSpot,
    romance: rng.fork('romance').chance(data.heart.romance.openShare),
  };
}

/** Someone's heart, made now if the world has not needed it before. */
export function ensureHeart(
  state: WorldState,
  data: GameData,
  entity: Entity,
  parents: readonly Entity[] = [],
): HeartData {
  const c = entity.character;
  if (!c) throw new Error(`${entity.id} is not a person`);
  if (c.heart) return c.heart;
  const profile = rollProfile(state, data, entity, parents);
  c.heart = {
    profile,
    mood: { id: 'content', until: state.tick },
    morale: data.heart.morale.rest,
    conscience: makeStat(data.heart.conscience.rest),
    memories: [],
  };
  if (entity.id === state.playerId) syncPlayerProfile(data, entity);
  return c.heart;
}

/**
 * Someone's heart for reading only: theirs, or the one they will have when the world first needs
 * it (the same roll, not stored). Views and odds use this, so looking never changes the world.
 */
export function heartOrRoll(state: WorldState, data: GameData, entity: Entity): HeartData {
  const made = entity.character?.heart;
  if (made) return made;
  const profile = rollProfile(state, data, entity);
  if (entity.id === state.playerId) {
    const lean = leanings(data, entity);
    for (const axis of HEART_AXES) profile.axes[axis] = clampAxis(lean[axis]);
  }
  return {
    profile,
    mood: { id: 'content', until: state.tick },
    morale: data.heart.morale.rest,
    conscience: makeStat(data.heart.conscience.rest),
    memories: [],
  };
}

/** The player's axes are who they have become: traits and drift counters, every month. */
export function syncPlayerProfile(data: GameData, entity: Entity): void {
  const heart = entity.character?.heart;
  if (!heart) return;
  const lean = leanings(data, entity);
  for (const axis of HEART_AXES) heart.profile.axes[axis] = clampAxis(lean[axis]);
}

export function axisOf(profile: Profile, axis: HeartAxis): number {
  return profile.axes[axis] ?? 0;
}

/** "You are honest to a fault": the player's tendencies, strongest first (rule 4: words, not numbers). */
export function tendencies(data: GameData, profile: Profile): string[] {
  return data.heart.axes
    .map((a) => ({ a, v: profile.axes[a.id] ?? 0 }))
    .filter(({ v }) => Math.abs(v) >= 20)
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
    .map(({ a, v }) =>
      v >= 60
        ? a.tendency.strongHigh
        : v >= 20
          ? a.tendency.high
          : v <= -60
            ? a.tendency.strongLow
            : a.tendency.low,
    );
}

/** "Bold", "Cautious" or nothing for each axis that leans (for someone else's profile). */
export function axisWords(data: GameData, profile: Profile): string[] {
  return data.heart.axes
    .map((a) => ({ a, v: profile.axes[a.id] ?? 0 }))
    .filter(({ v }) => Math.abs(v) >= 25)
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
    .map(({ a, v }) => (Math.abs(v) >= 65 ? 'very ' : '') + (v > 0 ? a.high : a.low).toLowerCase());
}

export function dreamText(data: GameData, profile: Profile): string {
  return data.heart.dreams.find((d) => d.id === profile.dream)?.text ?? profile.dream;
}

export function moodOf(heart: HeartData | undefined, tick: number): Mood {
  if (!heart) return 'content';
  return heart.mood.until > tick ? heart.mood.id : 'content';
}

/** Set a mood for the months its kind lasts. A month's grief is not cut short by a joke. */
export function setMood(data: GameData, heart: HeartData, mood: Mood, tick: number): void {
  const months = data.heart.moods[mood]?.months ?? 1;
  const now = moodOf(heart, tick);
  if (now === 'grieving' && mood !== 'grieving' && mood !== 'angry') return;
  heart.mood = { id: mood, until: tick + months + 1 };
  heart.morale = clampMorale(heart.morale + (data.heart.morale.byMood[mood] ?? 0) / 2);
}

export const clampMorale = (n: number): number =>
  Math.max(0, Math.min(100, Math.round(n * 10) / 10));
