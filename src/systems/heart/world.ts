import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { combatPowerOf } from '../life/body';
import { relate } from '../life/people';
import { winChance } from '../battle/battle';
import { peopleAt } from '../places/people';
import { moveAxis, relOf } from './bonds';
import { npcDeed } from './deeds';
import { remember } from './memory';
import { ensureHeart, heartOf } from './profile';
import { renderHeart } from './speech';

/**
 * People and each other (Phase 7): Tier 2 people hold relationships among themselves, not only
 * with the player. Each quarter a few pairs who share a place meet, befriend, fall out, duel or
 * betray, as their personalities lean. It is logged known to nobody (rule 4); duels and
 * betrayals, and marriages among people the player knows, make the news.
 */

const MEETINGS_PER_QUARTER = 6;
const NEWS_PER_QUARTER = 2;

function news(
  state: WorldState,
  data: GameData,
  who: Entity,
  line: string,
  rng: Rng,
  drafts: NewsDraft[],
  tags: string[],
): void {
  drafts.push({
    text: renderHeart(state, data, who, line, rng),
    tags: ['news', 'people', ...tags],
    place: who.character?.place ?? null,
  });
}

function log(state: WorldState, a: Entity, b: Entity, summary: string, tags: string[]): number {
  return appendLog(state, state.tick, {
    kind: 'life',
    summary,
    tags: ['heart', 'npc', ...tags],
    actorIds: [a.id],
    targetIds: [b.id],
    place: a.character?.place ?? null,
    cause: 'sys:heart',
    knownBy: [],
  }).seq;
}

export function heartWorldQuarter(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  drafts: NewsDraft[],
): void {
  if (tick % 3 !== 1) return;
  const byPlace = peopleAt(state, tick);
  const places = [...byPlace.keys()].filter((k) => (byPlace.get(k)?.length ?? 0) >= 2).sort();
  if (places.length === 0) return;
  let told = 0;
  for (let i = 0; i < MEETINGS_PER_QUARTER; i++) {
    const r = rng.fork('meet', i);
    const ids = byPlace.get(r.pick(places)) ?? [];
    const a = state.entities[r.fork('a').pick(ids)];
    const b = state.entities[r.fork('b').pick(ids)];
    if (!a?.character?.alive || !b?.character?.alive || a.id === b.id) continue;
    const ha = ensureHeart(state, data, a);
    ensureHeart(state, data, b);
    const ab = relOf(a, b.id);
    const ba = relOf(b, a.id);
    const loud = told < NEWS_PER_QUARTER;
    if (!ab || !ba) {
      // Strangers: a friendship, if the two get on.
      const warmth = (ha.profile.axes['kind'] ?? 0) + (heartOf(b)?.profile.axes['kind'] ?? 0);
      if (!r.fork('like').chance(0.35 + warmth / 400)) continue;
      relate(a, b, 'friend', 30, tick, r.fork('relate'));
      const seq = log(state, a, b, `${a.name} and ${b.name} became friends.`, ['friends']);
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        const rel = relOf(x, y.id);
        if (rel) rel.metSeq = seq;
      }
      continue;
    }
    if (ab.kind === 'rival') {
      // Rivals settle it: a duel, the abstract way.
      const p = winChance(data, combatPowerOf(data, a, tick), combatPowerOf(data, b, tick));
      const [winner, loser] = r.fork('duel').chance(p) ? [a, b] : [b, a];
      const seq = log(state, winner, loser, `${winner.name} beat ${loser.name} in a duel.`, [
        'duel',
      ]);
      const lw = relOf(loser, winner.id);
      if (lw) moveAxis(data, lw, 'respect', 8, 'A duel lost', seq, tick);
      if (loud && r.fork('news').chance(0.5)) {
        news(state, data, winner, data.heart.lines.npcDuel, r.fork('line'), drafts, ['duel']);
        told += 1;
      }
      continue;
    }
    if (ab.kind !== 'friend') continue;
    const dishonest = (ha.profile.axes['honest'] ?? 0) < -30;
    if (dishonest && r.fork('betray').chance(0.25)) {
      const seq = log(state, a, b, `${a.name} betrayed ${b.name}.`, ['betrayal']);
      moveAxis(data, ba, 'trust', -40, 'Betrayed', seq, tick);
      moveAxis(data, ba, 'affection', -30, 'Betrayed', seq, tick);
      remember(state, data, b, {
        about: a.id,
        kind: 'betrayal',
        weight: -40,
        place: b.character.place ?? null,
        seq,
      });
      npcDeed(state, data, a, ['treacherous'], `betrayed ${b.name}`);
      if (loud) {
        news(state, data, b, data.heart.lines.npcBetrayal, r.fork('line'), drafts, ['betrayal']);
        told += 1;
      }
      continue;
    }
    if (r.fork('feud').chance(0.15)) {
      ab.kind = 'rival';
      ba.kind = 'rival';
      const seq = log(state, a, b, `${a.name} and ${b.name} fell out.`, ['feud']);
      moveAxis(data, ab, 'affection', -30, 'A falling-out', seq, tick);
      moveAxis(data, ba, 'affection', -30, 'A falling-out', seq, tick);
      moveAxis(data, ab, 'rivalry', 30, 'A falling-out', seq, tick);
      moveAxis(data, ba, 'rivalry', 30, 'A falling-out', seq, tick);
      if (loud && r.fork('news').chance(0.3)) {
        news(state, data, a, data.heart.lines.npcFeud, r.fork('line'), drafts, ['feud']);
        told += 1;
      }
    }
  }
}

/** Two people the world simulates have married: news, when the player knows either of them. */
export function marriageNews(
  state: WorldState,
  data: GameData,
  a: Entity,
  b: Entity,
  rng: Rng,
  drafts: NewsDraft[],
): void {
  const player = state.playerId;
  if (!player || (!relOf(a, player) && !relOf(b, player))) return;
  ensureHeart(state, data, a);
  news(state, data, a, data.heart.lines.npcMarried, rng, drafts, ['marriage']);
}
