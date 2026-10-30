import type { RepDim } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Entity } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { lifeLog, pay, reportLine, type LifeEnv } from '../life/env';
import { priceMult } from '../places/place';
import { humanAgeOf, personOf } from '../life/body';
import { bondOf, circle, moveAxis, moveBar, relOf, together } from './bonds';
import { repWords, spreadReputation } from './deeds';
import { tellFact } from './facts';
import { remember } from './memory';
import { clampMorale, ensureHeart, heartOf } from './profile';
import { renderHeart } from './speech';
import { feastHook } from './hooks';
import { heartEnv } from './talk';
import type { GameData } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';

/**
 * Group scenes (Phase 7): a banquet after a victory (or thrown for its own sake), where everyone
 * present grows closer, stories are told and secrets slip; a crew meeting, where a captain rules
 * or asks and the crew remembers which; and gossip, where each quarter what people remember of
 * the player spreads along the social graph and the player's name travels the sea lanes.
 */

export class SceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneError';
  }
}

/** Everyone the player knows who is here, old enough to sit at a table. */
export function present(env: LifeEnv): Entity[] {
  const { state, data, tick, p } = env;
  return circle(state, p.entity)
    .map(({ other }) => other)
    .filter((o) => {
      if (!together(data, p.entity, o)) return false;
      const op = personOf(data, o);
      return o.flags['animal'] !== undefined || (op !== null && humanAgeOf(data, op, tick) >= 6);
    });
}

/**
 * A feast. Each guest's affection rises, the bond's shared bars fill, everyone keeps the night as
 * a memory, and one of them lets a secret slip. `paid`: the player pays for it.
 */
export function banquet(env: LifeEnv, reason: string, paid: boolean): number {
  const { state, data, tick, p } = env;
  const guests = present(env);
  if (guests.length === 0) {
    if (paid) throw new SceneError('There is nobody here to feast with');
    return 0;
  }
  if (paid) {
    const cost = Math.round(
      150 * guests.length * priceMult(state, data, p.place.location?.id ?? ''),
    );
    if (p.c.berries < cost)
      throw new SceneError(`A feast for ${guests.length} costs ${formatBerries(cost)} Berries`);
    pay(env, -cost);
  }
  const place = p.place.location?.name ?? 'the deck';
  const text = data.heart.lines.banquet.replace('{place}', place);
  const record = lifeLog(env, `${reason} ${text}`.trim(), {
    kind: 'event',
    tags: ['personal', 'relationship', 'banquet', 'heart'],
    others: guests.map((g) => g.id),
  });
  reportLine(env, text, 'good');
  const source = `A feast in ${place}`;
  for (const guest of guests) {
    const pair = { mine: relOf(p.entity, guest.id), theirs: relOf(guest, p.entity.id) };
    if (!pair.mine || !pair.theirs) continue;
    moveAxis(data, pair.theirs, 'affection', 4, source, record.seq, tick);
    moveAxis(data, pair.mine, 'affection', 2, source, record.seq, tick);
    const bond = bondOf(data, pair.mine.kind);
    for (const bar of ['shared', 'belonging', 'bond', 'passion'])
      moveBar(data, pair.theirs, bond, bar, 3, source, record.seq, tick);
    remember(state, data, guest, {
      about: p.entity.id,
      kind: 'banquet',
      weight: 10,
      place: p.place.location?.id ?? null,
      seq: record.seq,
    });
    const heart = ensureHeart(state, data, guest);
    heart.morale = clampMorale(heart.morale + 6);
  }
  const me = ensureHeart(state, data, p.entity);
  me.morale = clampMorale(me.morale + 8);
  // Somewhere past the third barrel, a secret slips.
  const talkers = guests.filter((g) => g.flags['animal'] === undefined);
  const rng = env.rng.fork('banquet', tick);
  if (talkers.length > 0 && rng.chance(0.6)) {
    const who = rng.pick(talkers);
    const told = tellFact(state, data, p.entity, who, 'secret', undefined, rng.fork('secret'));
    const slip = renderHeart(state, data, who, data.heart.lines.banquetSecret, rng.fork('line'), {
      fact: told.text,
    });
    lifeLog({ ...env, causeSeq: record.seq }, slip, {
      tags: ['personal', 'relationship', 'banquet'],
      others: [who.id],
    });
    reportLine(env, slip, 'plain');
  }
  return guests.length;
}

feastHook.fire = (state, data) => {
  const env = heartEnv(state as WorldState, data as GameData, 'sys:victory');
  if (env) banquet(env, 'After the victory:', false);
};

/**
 * A crew meeting: rule (decide alone) or ask (put it to everyone). Free spirits resent being
 * ruled and the dutiful respect it; everyone likes being heard. Once a month.
 */
export function crewMeeting(env: LifeEnv, mode: 'rule' | 'ask'): void {
  const { state, data, tick, p } = env;
  const crew = circle(state, p.entity).filter(
    ({ other, pair }) => pair.mine.kind === 'crewmate' && together(data, p.entity, other),
  );
  if (crew.length === 0) throw new SceneError('There is no crew here to meet with');
  const heart = ensureHeart(state, data, p.entity);
  heart.reached ??= {};
  if (heart.reached['meeting'] === tick) throw new SceneError('One meeting a month is plenty');
  heart.reached['meeting'] = tick;
  const text = mode === 'ask' ? data.heart.lines.meetingAsk : data.heart.lines.meetingRule;
  const record = lifeLog(env, text, {
    kind: 'event',
    tags: ['personal', 'relationship', 'crew', 'meeting'],
    others: crew.map((c) => c.other.id),
  });
  reportLine(env, text, mode === 'ask' ? 'good' : 'plain');
  const source = mode === 'ask' ? 'Being heard' : 'Being ruled';
  for (const { other, pair } of crew) {
    const free = heartOf(other)?.profile.axes['free'] ?? 0;
    if (mode === 'ask') {
      moveBar(data, pair.theirs, 'crewmate', 'belonging', 4, source, record.seq, tick);
      moveBar(data, pair.theirs, 'crewmate', 'morale', 3, source, record.seq, tick);
    } else {
      const by = free > 20 ? -4 : free < -20 ? 2 : -1;
      moveBar(data, pair.theirs, 'crewmate', 'belonging', by, source, record.seq, tick);
      moveAxis(data, pair.theirs, 'respect', free < -20 ? 2 : 0, source, record.seq, tick);
      if (free > 20)
        remember(state, data, other, {
          about: p.entity.id,
          kind: 'insult',
          weight: -4,
          place: p.place.location?.id ?? null,
          seq: record.seq,
        });
    }
  }
}

/**
 * A quarter's gossip: the heaviest memories people hold of the player are retold to someone they
 * know (known to nobody; the player hears only what comes back). A listener who knows the player
 * warms or cools a little; one who does not will remember it when they meet. The player's name
 * also travels the sea lanes, and a place that hears of them for the first time is noted.
 */
export function gossipQuarter(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  const rules = data.heart.gossip;
  const rng = env.rng.fork('gossip', tick);
  const tellers = circle(state, p.entity)
    .map(({ other }) => other)
    .filter((o) => o.flags['animal'] === undefined);
  let told = 0;
  for (const teller of tellers) {
    if (told >= rules.perQuarter) break;
    const heart = heartOf(teller);
    const memory = heart?.memories
      .filter(
        (m) => m.about === p.entity.id && !m.heardFrom && Math.abs(m.weight) >= rules.minWeight,
      )
      .filter((m) => data.heart.memories[m.kind]?.gossip !== false)
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0];
    if (!memory) continue;
    const listeners = (teller.character?.relationships ?? [])
      .map((r) => state.entities[r.id])
      .filter(
        (e): e is Entity =>
          !!e?.character?.alive && e.id !== p.entity.id && e.flags['animal'] === undefined,
      );
    if (listeners.length === 0) continue;
    const listener = rng.fork('who', teller.id).pick(listeners);
    const weight = Math.round(memory.weight * rules.share * 10) / 10;
    const record = appendLog(state, tick, {
      kind: 'life',
      summary: `${teller.name} told ${listener.name} about ${p.entity.name}: ${memory.where}.`,
      tags: ['heart', 'gossip'],
      actorIds: [teller.id],
      targetIds: [listener.id, p.entity.id],
      place: teller.character?.place ?? null,
      cause: 'sys:gossip',
      ...(memory.seq !== undefined ? { causeSeq: memory.seq } : {}),
      knownBy: [],
    });
    remember(state, data, listener, {
      about: p.entity.id,
      kind: memory.kind,
      weight,
      place: teller.character?.place ?? null,
      seq: record.seq,
      heardFrom: teller.id,
    });
    const theirs = relOf(listener, p.entity.id);
    if (theirs)
      moveAxis(
        data,
        theirs,
        'affection',
        weight * 0.2,
        `Heard from ${teller.character?.givenName ?? teller.name}`,
        record.seq,
        tick,
      );
    // What is retold changes what is said of the player where it is told.
    const where = teller.character?.place;
    const rep = data.heart.memories[memory.kind]?.rep ?? {};
    const myHeart = ensureHeart(state, data, p.entity);
    if (where) {
      myHeart.rep ??= {};
      const scope = (myHeart.rep[where] ??= {});
      for (const [dim, by] of Object.entries(rep)) {
        const max = data.heart.reputation.max;
        const now = scope[dim] ?? 0;
        scope[dim] =
          Math.round(
            Math.max(-max, Math.min(max, now + (by ?? 0) * (Math.abs(memory.weight) / 20))) * 10,
          ) / 10;
      }
    }
    told += 1;
  }
  const fresh = spreadReputation(data, p.entity);
  const myHeart = ensureHeart(state, data, p.entity);
  for (const place of fresh.slice(0, 2)) {
    if (p.c.travel?.visited.includes(place)) continue;
    const rep = myHeart.rep?.[place] ?? {};
    const words = repWords(data, rep as Record<RepDim, number>);
    if (!words) continue;
    const text = data.heart.lines.gossip
      .replace('{place}', data.locations[place]?.name ?? place)
      .replace('{title}', words);
    lifeLog(env, text, { tags: ['personal', 'reputation'] });
  }
}
