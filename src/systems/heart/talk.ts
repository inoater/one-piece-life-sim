import type { GameData, HeartBand, RelAxis, TalkIntent } from '../../engine/data/schemas';
import { crewHooks } from '../crew/hooks';
import { STAT_IDS } from '../../engine/stats';
import { Rng } from '../../engine/rng';
import type { BattleState } from '../../engine/battle-state';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { combatPowerOf, ensureLife, isJailed, statTotal, type Person } from '../life/body';
import { lifeLog, pay, reportLine, type LifeEnv } from '../life/env';
import { checkBonus } from '../life/traits';
import { priceMult } from '../places/place';
import { hasSnail } from '../hands/gear';
import { ensureHands } from '../hands/items';
import { winChance } from '../battle/battle';
import { onFightFinished } from '../battle/finish-hooks';
import { bandFor, successChance, type Band } from '../story/checks';
import { axisValue, moveAxis, pairOf, relOf, requiresReason, together, type Pair } from './bonds';
import { applyHeartEffect, startHeartFight } from './effects';
import { factKindOf, tellFact } from './facts';
import { memoryLine, memoryWeight, strongestMemory } from './memory';
import { ensureHeart, heartOf, heartOrRoll, moodOf } from './profile';
import { moodOpener, renderHeart } from './speech';

/**
 * Conversation (Phase 7). The Interact panel on a person offers intents (data/intents): each a
 * check of one of the player's stats against a difficulty set by the other's personality, their
 * feelings toward the player, their values, their mood and what they remember, with four result
 * bands, each with lines in the other's voice and effects. A duel or a spar is a Phase 5 fight
 * instead of a check. With a Den Den Mushi and their number, most intents work at a distance,
 * harder and with half the effect. Each talk is logged, and everything it moves traces to it.
 */

export class TalkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TalkError';
  }
}

export interface TalkOptions {
  /** A person, a place: what an information intent asks about. */
  topic?: string;
  /** Berries: a gift, a bribe, a loan asked for. */
  amount?: number;
  /** Over the Den Den Mushi. */
  remote?: boolean;
}

/** Kinds whose numbers the player has without asking (family, a lover, a crewmate). */
const KNOWN_NUMBERS = new Set([
  'parent',
  'child',
  'sibling',
  'guardian',
  'ward',
  'sweetheart',
  'crewmate',
]);

export function knowsNumber(p: Person, other: Entity): boolean {
  const rel = p.c.relationships.find((r) => r.id === other.id);
  return (
    (p.c.hands?.contacts ?? []).includes(other.id) ||
    (rel !== undefined && KNOWN_NUMBERS.has(rel.kind))
  );
}

function monthKey(tick: number, ...parts: string[]): string {
  return [String(tick), ...parts].join(':');
}

export function talksThisMonth(p: Person, otherId: string, tick: number): number {
  return p.c.heart?.talk?.[monthKey(tick, otherId)] ?? 0;
}

/** Why the player cannot do this with them now, or null. */
export function talkLock(
  state: WorldState,
  data: GameData,
  p: Person,
  other: Entity,
  intent: TalkIntent,
  opts: TalkOptions = {},
): string | null {
  const tick = state.tick;
  if (!other.character?.alive) return 'They are not alive';
  if (other.id === p.entity.id) return 'That is you';
  if (!p.c.relationships.some((r) => r.id === other.id)) return 'You do not know them';
  if (p.c.life && isJailed(p.c.life, tick)) return 'You are in a cell';
  if (state.battle) return 'Not in the middle of a fight';
  if (other.flags['animal'] !== undefined && intent.group !== 'friendly') return 'It is an animal';
  const here = together(data, p.entity, other);
  if (opts.remote) {
    if (here) return 'They are right here';
    if (!intent.remote) return 'Not over a Den Den Mushi';
    if (!hasSnail(state, data, p.entity)) return 'You need a Den Den Mushi';
    if (!knowsNumber(p, other)) return 'You do not have their number';
  } else if (!here) return 'They are not here';
  if (talksThisMonth(p, other.id, tick) >= data.heart.talk.perMonth)
    return `You have talked with ${other.character.givenName} enough this month`;
  if (p.c.heart?.talk?.[monthKey(tick, other.id, intent.id)] !== undefined)
    return 'Already this month';
  const reason = requiresReason(state, data, p.entity, other, intent.requires);
  if (reason) return reason;
  if (
    intent.topic === 'person' &&
    opts.topic !== undefined &&
    !state.entities[opts.topic]?.character
  )
    return 'Ask about whom?';
  if (intent.topic === 'place' && opts.topic !== undefined && !(opts.topic in data.locations))
    return 'Ask about where?';
  if (
    intent.topic === 'amount' &&
    opts.amount !== undefined &&
    intent.id !== 'int_ask_loan' &&
    opts.amount > p.c.berries
  )
    return 'You do not have that much';
  const cost = costOf(state, data, p, intent);
  if (cost > 0 && p.c.berries < cost) return `It costs ${formatBerries(cost)} Berries`;
  if (intent.id === 'int_blackmail') {
    const leverage = (p.c.heart?.facts ?? []).some((f) => f.about === other.id && f.truth);
    if (!leverage) return 'You know nothing to hold over them';
  }
  return null;
}

export function costOf(state: WorldState, data: GameData, p: Person, intent: TalkIntent): number {
  if (intent.cost <= 0) return 0;
  return Math.round(intent.cost * priceMult(state, data, p.place.location?.id ?? ''));
}

export interface TalkOdds {
  chance: number;
  words: string;
  value: number;
  difficulty: number;
}

export function chanceWords(data: GameData, chance: number): string {
  return data.heart.talk.chances.find((c) => chance >= c.min)?.text ?? 'hopeless';
}

/** The player's chance, in numbers and in words. */
export function talkOdds(
  state: WorldState,
  data: GameData,
  p: Person,
  other: Entity,
  intent: TalkIntent,
  opts: TalkOptions = {},
): TalkOdds {
  const tick = state.tick;
  if (intent.fight) {
    const chance = winChance(
      data,
      combatPowerOf(data, p.entity, tick),
      combatPowerOf(data, other, tick),
    );
    return { chance, words: chanceWords(data, chance), value: 0, difficulty: 0 };
  }
  const heart = heartOrRoll(state, data, other);
  const theirs = relOf(other, p.entity.id);
  let d = intent.difficulty;
  for (const [axis, w] of Object.entries(intent.personality))
    d += ((w ?? 0) * (heart.profile.axes[axis] ?? 0)) / 100;
  for (const [axis, w] of Object.entries(intent.feelings))
    d += (w ?? 0) * axisValue(data, theirs, axis as RelAxis, tick);
  for (const v of heart.profile.values) d += intent.values[v] ?? 0;
  const mood = moodOf(heart, tick);
  d += (intent.moods[mood] ?? 0) + (data.heart.moods[mood]?.difficulty ?? 0);
  // What they remember of the player: favours ease it, grudges harden it.
  d -= Math.max(-15, Math.min(15, memoryWeight(heart, p.entity.id) * 0.25));
  if (opts.remote) d += data.heart.talk.remoteDifficulty;
  const amount = opts.amount ?? 0;
  if (intent.topic === 'amount' && amount > 0) {
    const scale = 100 * priceMult(state, data, p.place.location?.id ?? '');
    d +=
      intent.id === 'int_ask_loan'
        ? Math.min(30, amount / (scale * 5))
        : -Math.min(25, amount / scale);
  }
  const stat = intent.stat;
  const base = (STAT_IDS as readonly string[]).includes(stat)
    ? statTotal(p.entity, stat, tick)
    : stat === 'combatPower'
      ? combatPowerOf(data, p.entity, tick) / 10
      : statTotal(p.entity, 'intellect', tick);
  const value = base + checkBonus(data, p.c, stat);
  const chance = successChance(value, d);
  return { chance, words: chanceWords(data, chance), value, difficulty: Math.round(d) };
}

function noteTalk(p: Person, otherId: string, intentId: string, tick: number): void {
  const heart = p.c.heart;
  if (!heart) return;
  const talk = (heart.talk ??= {});
  for (const key of Object.keys(talk)) if (!key.startsWith(`${tick}:`)) delete talk[key];
  talk[monthKey(tick, otherId)] = (talk[monthKey(tick, otherId)] ?? 0) + 1;
  talk[monthKey(tick, otherId, intentId)] = 1;
}

export interface TalkResult {
  band: Band;
  text: string;
  seq: number;
}

/**
 * The band's lines in their voice, logged; then its effects, every change traced to that record.
 * A remote talk does a share of it; a fact asked for is told before the line is written.
 */
export function playBand(
  env: LifeEnv,
  other: Entity,
  pair: Pair,
  intent: TalkIntent,
  bandId: Band,
  opts: TalkOptions,
): TalkResult {
  const { state, data, p } = env;
  const band: HeartBand = intent[bandId];
  const rng = Rng.root(state.seed).fork('talk', intent.id, other.id, state.counters.logSeq);
  const told =
    band.effects.special === 'fact'
      ? tellFact(
          state,
          data,
          p.entity,
          other,
          factKindOf(intent.id) ?? 'rumour',
          opts.topic,
          rng.fork('fact'),
          bandId === 'criticalSuccess' && intent.id === 'int_interrogate',
        )
      : null;
  const parts: string[] = [];
  if (opts.remote)
    parts.push(renderHeart(state, data, other, data.heart.lines.remoteTalk, rng.fork('remote')));
  const opener = moodOpener(state, data, other, rng.fork('mood'));
  if (opener) parts.push(opener);
  // Now and then they bring up what they remember of the player.
  const memory = strongestMemory(heartOf(other), p.entity.id);
  if (memory && rng.fork('memory?').chance(0.35)) {
    const template = memoryLine(data, memory, rng.fork('memoryLine'));
    if (template)
      parts.push(
        `“${renderHeart(state, data, other, template, rng.fork('memoryText'), { memory: memory.where })}”`,
      );
  }
  parts.push(
    renderHeart(state, data, other, rng.fork('line').pick(band.lines), rng.fork('voice'), {
      fact: told?.text ?? 'nothing worth repeating',
      ...(opts.amount !== undefined ? { amount: formatBerries(opts.amount) } : {}),
    }),
  );
  const text = parts.join(' ');
  const good = bandId === 'criticalSuccess' || bandId === 'success';
  const record = lifeLog(env, text, {
    kind:
      band.effects.special || intent.group === 'bonds' || intent.group === 'conflict'
        ? 'event'
        : 'life',
    tags: ['personal', 'relationship', 'talk', intent.group, `int:${intent.id}`, bandId],
    others: [other.id],
  });
  reportLine(env, text, good ? 'good' : bandId === 'criticalFailure' ? 'bad' : 'plain');
  const scale = opts.remote ? data.heart.talk.remoteEffect : 1;
  applyHeartEffect(
    {
      env,
      other,
      pair,
      seq: record.seq,
      source: intent.name,
      scale,
      rng: rng.fork('effects'),
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
      origin: intent.id,
    },
    { ...band.effects, deed: [...intent.deed, ...band.effects.deed] },
  );
  pair.mine.lastSeen = state.tick;
  pair.theirs.lastSeen = state.tick;
  // What talking has taught the player about them (the person page shows what is known).
  const theirHeart = ensureHeart(state, data, other);
  theirHeart.reached ??= {};
  theirHeart.reached['talks'] = (theirHeart.reached['talks'] ?? 0) + 1;
  if (good && intent.id === 'int_ask_dream') theirHeart.reached['dreamTold'] = state.tick;
  return { band: bandId, text, seq: record.seq };
}

/** Talk to someone: check, or fight, and play the band. Throws TalkError with the reason. */
export function talk(
  env: LifeEnv,
  otherId: string,
  intentId: string,
  opts: TalkOptions = {},
): TalkResult | null {
  const { state, data, p } = env;
  const intent = data.intents[intentId];
  if (!intent) throw new TalkError(`There is no intent "${intentId}"`);
  const other = state.entities[otherId];
  if (!other?.character) throw new TalkError('There is nobody by that name');
  const lock = talkLock(state, data, p, other, intent, opts);
  if (lock) throw new TalkError(lock);
  if (
    (intent.topic === 'person' || intent.topic === 'place') &&
    opts.topic === undefined &&
    intent.id !== 'int_ask_place'
  )
    throw new TalkError(intent.topic === 'person' ? 'Ask about whom?' : 'Ask about where?');
  ensureHeart(state, data, p.entity);
  ensureHeart(state, data, other);
  const pair = pairOf(p.entity, other) as Pair;
  const cost = costOf(state, data, p, intent);
  if (cost > 0) pay(env, -cost);
  const amount =
    intent.topic === 'amount' ? Math.max(1, Math.round(opts.amount ?? 500)) : undefined;
  // A gift or a bribe is handed over whatever comes of it; a loan is what is asked for.
  if (amount !== undefined && intent.id !== 'int_ask_loan') {
    pay(env, -amount);
    other.character.berries += amount;
  }
  noteTalk(p, other.id, intent.id, state.tick);
  // Phase 8: a crewmate's arc may need talking.
  crewHooks.talked?.(state, other.id);
  const withAmount: TalkOptions = { ...opts, ...(amount !== undefined ? { amount } : {}) };
  if (intent.fight) {
    startHeartFight(
      env,
      other,
      intent.fight,
      intent.id,
      `${intent.name} with ${other.name}`,
      'intent',
    );
    return null;
  }
  const odds = talkOdds(state, data, p, other, intent, withAmount);
  const roll = Rng.root(state.seed)
    .fork('talkRoll', intent.id, other.id, state.counters.logSeq)
    .next();
  return playBand(env, other, pair, intent, bandFor(roll, odds.chance), withAmount);
}

/** A fight a talk started (a spar, a duel) is over: its result is the talk's band. */
export function fightBandOf(battle: BattleState): Band {
  const r = battle.result;
  if (!r) return 'failure';
  if (r.how === 'won') return r.decisive ? 'criticalSuccess' : 'success';
  if (r.how === 'draw') return 'success';
  return r.decisive ? 'criticalFailure' : 'failure';
}

onFightFinished('heart', (state, data, battle) => {
  const otherId = battle.source.roles?.['other'];
  const intent = data.intents[battle.source.id];
  const other = otherId ? state.entities[otherId] : undefined;
  if (!other?.character || !state.playerId) return;
  const player = state.entities[state.playerId];
  if (!player?.character?.alive) return;
  const pair = player ? pairOf(player, other) : null;
  if (!pair || !intent) return;
  const env = heartEnv(state, data, `heart:${intent.id}`);
  if (!env) return;
  const band = fightBandOf(battle);
  if (battle.source.choice === 'intent') {
    playBand(env, other, pair, intent, band, {});
    return;
  }
  // A fight an effect started: what it leaves between the two of them, and nothing more.
  const won = band === 'criticalSuccess' || band === 'success';
  const text = won ? `You beat ${other.name}.` : `${other.name} beat you.`;
  const record = lifeLog(env, text, {
    kind: 'event',
    tags: ['personal', 'relationship', 'combat'],
    others: [other.id],
  });
  moveAxis(
    data,
    pair.theirs,
    won ? 'respect' : 'rivalry',
    won ? 6 : 4,
    'A fight between you',
    record.seq,
    state.tick,
  );
  moveAxis(data, pair.theirs, 'affection', -4, 'A fight between you', record.seq, state.tick);
});

/** The player's month, for something the heart does between months (a talk, a decision). */
export function heartEnv(state: WorldState, data: GameData, cause: string): LifeEnv | null {
  const p = ensureLife(state, data);
  if (!p?.c.life || !p.c.alive) return null;
  ensureHands(p.entity);
  return {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('heart', cause, state.counters.logSeq),
    p,
    life: p.c.life,
    cause,
  };
}
