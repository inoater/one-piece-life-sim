import type { GameData } from '../../engine/data/schemas';
import type { Entity, HeartData, Memory, WorldState } from '../../engine/state';
import type { Rng } from '../../engine/rng';
import { ensureHeart } from './profile';

/**
 * What people remember (Phase 7): a short list per person of what happened with someone, when,
 * where, how much it matters and the log record behind it. Each kind fades at its own rate (a
 * grudge slower than a favour); the faintest drop off when the list is full. Memories weigh a
 * person's choices, surface in what they say, and spread as gossip.
 */

/** "that favour in Loguetown", "that rescue at sea". */
export function memoryWhere(data: GameData, kind: string, placeId: string | null): string {
  const name = data.heart.memories[kind]?.name ?? kind;
  const place = placeId ? data.locations[placeId]?.name : undefined;
  return `that ${name} ${place ? `in ${place}` : 'at sea'}`;
}

export function remember(
  state: WorldState,
  data: GameData,
  holder: Entity,
  input: {
    about: string;
    kind: string;
    weight: number;
    place: string | null;
    seq?: number;
    heardFrom?: string;
  },
): Memory | null {
  if (!holder.character || input.weight === 0 || !data.heart.memories[input.kind]) return null;
  const heart = ensureHeart(state, data, holder);
  const where = memoryWhere(data, input.kind, input.place);
  const recent = heart.memories.find(
    (m) =>
      m.about === input.about &&
      m.kind === input.kind &&
      m.where === where &&
      m.heardFrom === input.heardFrom &&
      state.tick - m.tick < 6,
  );
  if (recent) {
    recent.weight = Math.round((recent.weight + input.weight) * 10) / 10;
    recent.tick = state.tick;
    if (input.seq !== undefined) recent.seq = input.seq;
    return recent;
  }
  const memory: Memory = {
    about: input.about,
    kind: input.kind,
    where,
    tick: state.tick,
    weight: input.weight,
  };
  if (input.seq !== undefined) memory.seq = input.seq;
  if (input.heardFrom !== undefined) memory.heardFrom = input.heardFrom;
  heart.memories.push(memory);
  if (heart.memories.length > data.heart.memoryCap) {
    heart.memories.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || b.tick - a.tick);
    heart.memories.length = data.heart.memoryCap;
  }
  return memory;
}

/** Months pass: every memory fades toward nothing by its kind's rate; the gone ones go. */
export function fadeMemories(data: GameData, heart: HeartData, months = 1): void {
  if (heart.memories.length === 0) return;
  for (const m of heart.memories) {
    const fade = ((data.heart.memories[m.kind]?.fadePerYear ?? 5) * months) / 12;
    m.weight = m.weight > 0 ? Math.max(0, m.weight - fade) : Math.min(0, m.weight + fade);
    m.weight = Math.round(m.weight * 100) / 100;
  }
  heart.memories = heart.memories.filter((m) => Math.abs(m.weight) >= 1);
}

/** How much what someone remembers of another weighs, all told (favours positive). */
export function memoryWeight(heart: HeartData | undefined, about: string): number {
  if (!heart) return 0;
  let sum = 0;
  for (const m of heart.memories) if (m.about === about) sum += m.weight;
  return sum;
}

/** The memory they would bring up: the heaviest they hold about someone, if it matters. */
export function strongestMemory(heart: HeartData | undefined, about: string): Memory | null {
  let best: Memory | null = null;
  for (const m of heart?.memories ?? []) {
    if (m.about !== about || Math.abs(m.weight) < 8) continue;
    if (!best || Math.abs(m.weight) > Math.abs(best.weight)) best = m;
  }
  return best;
}

/** A line of theirs about a memory ("You still owe me for {memory}"), as a template. */
export function memoryLine(data: GameData, memory: Memory, rng: Rng): string | null {
  const lines = data.heart.memories[memory.kind]?.lines;
  return lines && lines.length > 0 ? rng.pick(lines) : null;
}

/** Drop the worst of what they hold against someone (an apology accepted). Returns the kind. */
export function forgiveWorst(heart: HeartData, about: string, all: boolean): string | null {
  const bad = heart.memories
    .filter((m) => m.about === about && m.weight < 0)
    .sort((a, b) => a.weight - b.weight);
  const worst = bad[0];
  if (!worst) return null;
  if (all) heart.memories = heart.memories.filter((m) => !(m.about === about && m.weight < 0));
  else worst.weight = Math.round((worst.weight / 2) * 10) / 10;
  return worst.kind;
}
