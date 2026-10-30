import type { RelAxis, RepDim } from '../../engine/data/schemas';
import type { Entity } from '../../engine/state';
import type { LifeEnv } from '../life/env';
import { markMet, moveAxis, pairOf } from './bonds';
import { repAt } from './deeds';
import { memoryWeight } from './memory';
import { ensureHeart } from './profile';

/**
 * A first meeting (Phase 7): before any relationship exists, reputation speaks for the player.
 * What is said of them where they meet (and by whoever holds that place, and of their family name)
 * colours how the other starts out: a cruel name breeds fear, an honourable one trust. Whatever
 * the other has heard as gossip counts too. Each is a modifier traced to the meeting.
 */
export function firstMeeting(env: LifeEnv, other: Entity, seq: number | undefined): void {
  const { state, data, tick, p } = env;
  if (!other.character) return;
  ensureHeart(state, data, other);
  const myHeart = ensureHeart(state, data, p.entity);
  const pair = pairOf(p.entity, other);
  if (!pair) return;
  if (seq !== undefined) markMet(p.entity, other, seq);
  const place = p.place.location?.id ?? null;
  const rep = repAt(state, myHeart, p.entity, place);
  const where = place ? (data.locations[place]?.name ?? 'here') : 'at sea';
  const source = `What is said of you ${place ? `in ${where}` : where}`;
  for (const [axis, dims] of Object.entries(data.heart.relationship.firstImpression)) {
    let v = 0;
    for (const [dim, w] of Object.entries(dims ?? {})) v += (w ?? 0) * rep[dim as RepDim];
    if (Math.abs(v) >= 1)
      moveAxis(data, pair.theirs, axis as RelAxis, v, source, seq ?? pair.theirs.metSeq, tick);
  }
  const heard = memoryWeight(other.character.heart, p.entity.id);
  if (Math.abs(heard) >= 1)
    moveAxis(
      data,
      pair.theirs,
      'affection',
      heard * 0.3,
      'What they had heard of you',
      seq ?? pair.theirs.metSeq,
      tick,
    );
}
