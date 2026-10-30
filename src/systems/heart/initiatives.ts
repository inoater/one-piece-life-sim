import type { GameData, Initiative } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import { Rng } from '../../engine/rng';
import type { Entity, PendingDecision, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { humanAgeOf, reputationValue } from '../life/body';
import { lifeLog, pay, reportLine, type LifeEnv } from '../life/env';
import { meetPerson, relate } from '../life/people';
import { axisValue, circle, markMet, pairOf, requiresReason, together, type Pair } from './bonds';
import { applyHeartEffect, guiltHook, playerDeed } from './effects';
import { ensureHeart, heartOf } from './profile';
import { renderHeart } from './speech';
import { heartEnv } from './talk';
import { conscienceOf } from './deeds';
import { firstMeeting } from './meet';
import { QUIET } from '../events';

/**
 * People act on the player (Phase 7): a friend asks for help, a rival challenges, a lover is
 * jealous, a creditor wants paying, a crewmate wants out, an admirer wants to join, a student
 * wants a lesson, a parent writes from home. Each person close to the player rolls a chance each
 * month (canon, Tier 1) or quarter (everyone else, Tier 2), scaled by how strongly they feel;
 * what they do is picked by weight among the initiatives (data/initiatives) their tie allows.
 * One with choices is a decision the player answers; the rest just happen.
 */

const ini = (data: GameData) =>
  Object.keys(data.initiatives)
    .sort()
    .map((id) => data.initiatives[id] as Initiative);

/** Can this person do this now? */
export function initiativeFits(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
  def: Initiative,
): boolean {
  if (def.self || def.tags.includes('stranger')) return false;
  if (other.flags['animal'] !== undefined && !def.tags.includes('companion')) return false;
  const heart = heartOf(other);
  const last = heart?.reached?.[def.id];
  if (last !== undefined && state.tick - last < def.cooldown) return false;
  if (requiresReason(state, data, player, other, def.who) !== null) return false;
  const near = together(data, player, other);
  if (def.where === 'apart' && near) return false;
  if (def.where === 'together' && !near) return false;
  if (reputationValue(player, 'fame', state.tick) < def.minFame) return false;
  const pair = pairOf(player, other);
  const owed = heart?.owed ?? 0;
  if (def.owed === 'player' && owed <= 0) return false;
  if (def.owed === 'them' && !(owed < 0 || axisValue(data, pair?.theirs, 'debt', state.tick) >= 15))
    return false;
  if (
    def.memory &&
    !(heart?.memories ?? []).some((m) => m.about === player.id && m.kind === def.memory)
  )
    return false;
  return true;
}

/** How strongly someone feels about the player: the closer (or the angrier), the more they act. */
function intensity(data: GameData, pair: Pair, tick: number): number {
  const t = pair.theirs;
  const a = Math.abs(axisValue(data, t, 'affection', tick));
  const r = axisValue(data, t, 'rivalry', tick);
  return 0.5 + (a + r) / 100;
}

function nextDecisionId(state: WorldState): number {
  state.counters.decisionId += 1;
  return state.counters.decisionId;
}

/** Fire an initiative from `other` (the player, for one about their own conscience). */
export function fireInitiative(
  env: LifeEnv,
  def: Initiative,
  other: Entity,
  causeSeq?: number,
): void {
  const { state, data, tick, p } = env;
  const rng = Rng.root(state.seed).fork('initiative', def.id, other.id, tick);
  const heart = ensureHeart(state, data, other);
  heart.reached ??= {};
  heart.reached[def.id] = tick;
  const text = renderHeart(state, data, other, def.text, rng.fork('text'));
  const record = appendLog(state, tick, {
    kind: 'event',
    summary: text,
    tags: ['personal', 'relationship', 'heart', 'npc-act', `ini:${def.id}`, ...def.tags],
    actorIds: def.self ? [p.entity.id] : [other.id],
    targetIds: def.self ? [] : [p.entity.id],
    place: p.place.id,
    cause: def.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy: [p.entity.id],
  });
  const choices = def.choices.filter((c) => c.berries <= Math.max(0, p.c.berries));
  if (def.choices.length > 0 && choices.length > 0) {
    const decision: PendingDecision = {
      id: nextDecisionId(state),
      eventId: def.id,
      firedTick: tick,
      recordSeq: record.seq,
      title: renderHeart(state, data, other, def.title, rng.fork('title')),
      text,
      choices: choices.map((c) => ({
        id: c.id,
        label: renderHeart(state, data, other, c.label, rng.fork('label', c.id)),
      })),
      roles: { other: other.id },
      heart: true,
    };
    if (p.place.location) decision.place = p.place.location.id;
    state.pending.push(decision);
    reportLine(env, text, 'alert');
    return;
  }
  reportLine(env, text, 'plain');
  const pair = def.self ? null : pairOf(p.entity, other);
  if (pair)
    applyHeartEffect(
      {
        env,
        other,
        pair,
        seq: record.seq,
        source: def.name,
        scale: 1,
        rng: rng.fork('effects'),
        origin: def.id,
      },
      def.effects,
    );
}

/** An admirer: someone who has heard of the player, and is met for the first time. */
function fireStranger(env: LifeEnv, def: Initiative, rng: Rng): void {
  const { state, data, tick, p } = env;
  const other = meetPerson(state, data, p, rng.fork('meet'), tick, humanAgeOf(data, p, tick), {
    ageOffset: { min: -6, max: 4 },
  });
  relate(p.entity, other, 'friend', 20, tick, rng.fork('relate'));
  const pair = pairOf(p.entity, other);
  if (pair) pair.theirs.opinion.base = 45;
  firstMeeting(env, other, undefined);
  fireInitiative(env, def, other);
  const seq = state.log[state.log.length - 1]?.seq;
  if (seq !== undefined) markMet(p.entity, other, seq);
}

/**
 * The month's initiatives (step 7): who reaches out, at most a few a month. Canon people may act
 * every month; everyone else once a quarter.
 */
export function initiativesMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  const rules = data.heart.initiatives;
  // A quiet world (tests of other systems) has no one reaching out, as it has no random events.
  if (state.flags[QUIET] === true) return;
  if (rules.perMonth <= 0 || state.pending.some((d) => d.heart)) return;
  const rng = env.rng.fork('initiatives');
  const all = ini(data);
  let fired = 0;
  for (const { other, pair } of circle(state, p.entity)) {
    if (fired >= rules.perMonth) break;
    if (other.tier !== 1 && (tick + other.createdTick) % 3 !== 0) continue;
    const r = rng.fork('person', other.id);
    if (!r.chance(Math.min(0.9, rules.chance * intensity(data, pair, tick)))) continue;
    const fits = all.filter((def) => initiativeFits(state, data, p.entity, other, def));
    const def = r.fork('pick').weightedPick(fits, (d) => d.weight);
    if (!def) continue;
    fireInitiative(env, def, other);
    fired += 1;
  }
  // Strangers who have heard of the player: once a quarter at most.
  if (fired < rules.perMonth && tick % 3 === 1) {
    const fame = reputationValue(p.entity, 'fame', tick);
    const r = rng.fork('stranger');
    const fits = all.filter((d) => d.tags.includes('stranger') && fame >= d.minFame);
    const heart = ensureHeart(state, data, p.entity);
    for (const def of fits) {
      const last = heart.reached?.[def.id];
      if (last !== undefined && tick - last < def.cooldown) continue;
      if (!r.fork(def.id).chance(rules.chance * Math.min(3, fame / 20))) continue;
      heart.reached ??= {};
      heart.reached[def.id] = tick;
      fireStranger(env, def, r.fork('meet', def.id));
      break;
    }
  }
}

/** The player's own guilt: a decision they must answer. */
function fireGuilt(env: LifeEnv, seq: number): void {
  const def = ini(env.data).find((d) => d.self);
  if (!def) return;
  const heart = ensureHeart(env.state, env.data, env.p.entity);
  const last = heart.reached?.[def.id];
  if (last !== undefined && env.tick - last < def.cooldown) return;
  fireInitiative(env, def, env.p.entity, seq);
}
guiltHook.fire = fireGuilt;

/** The player answers someone who reached out. */
export function resolveHeartDecision(
  state: WorldState,
  data: GameData,
  decision: PendingDecision,
  choiceId: string,
): void {
  const index = state.pending.indexOf(decision);
  if (index !== -1) state.pending.splice(index, 1);
  const def = data.initiatives[decision.eventId];
  const choice = def?.choices.find((c) => c.id === choiceId);
  const env = heartEnv(state, data, decision.eventId);
  const otherId = decision.roles?.['other'];
  const other = otherId ? state.entities[otherId] : undefined;
  const record = appendLog(state, state.tick, {
    kind: 'decision',
    summary: `Chose "${decision.choices.find((c) => c.id === choiceId)?.label ?? choiceId}" (${decision.title}).`,
    tags: ['decision', 'personal', 'heart'],
    cause: decision.eventId,
    causeSeq: decision.recordSeq,
    knownBy: state.playerId ? [state.playerId] : [],
  });
  if (!def || !choice || !env || !other?.character) return;
  const rng = Rng.root(state.seed).fork('heartChoice', decision.id);
  if (choice.berries > 0) {
    if (env.p.c.berries < choice.berries) {
      const text = `You could not find the ${formatBerries(choice.berries)} Berries.`;
      lifeLog({ ...env, causeSeq: record.seq }, text, { tags: ['personal', 'money'] });
      return;
    }
    pay(env, -choice.berries);
    other.character.berries += def.self ? 0 : choice.berries;
  }
  const text = renderHeart(state, data, other, rng.pick(choice.lines), rng.fork('line'));
  const line = lifeLog({ ...env, causeSeq: record.seq, cause: def.id }, text, {
    kind: 'event',
    tags: ['personal', 'relationship', 'heart'],
    others: def.self ? [] : [other.id],
  });
  reportLine(env, text, 'plain');
  if (def.self) {
    // Guilt answered: owning up or making amends eases the conscience; burying it does not.
    playerDeed(env, choice.effects.deed, line.seq);
    const heart = ensureHeart(state, data, env.p.entity);
    if (!choice.effects.deed.includes('cruel')) {
      const rules = data.heart.conscience;
      const now = conscienceOf(heart, state.tick);
      const lift = Math.min(100 - now, rules.rise * 3);
      if (lift > 0) {
        const mod = heart.conscience.mods.find((m) => m.source === 'Making peace with it');
        if (mod) {
          mod.value += lift;
          mod.seq = line.seq;
        } else
          heart.conscience.mods.push({
            source: 'Making peace with it',
            value: lift,
            kind: 'flat',
            seq: line.seq,
          });
      }
    }
    heart.morale = Math.max(0, Math.min(100, heart.morale + choice.effects.myMorale));
    return;
  }
  const pair = pairOf(env.p.entity, other);
  if (!pair) return;
  applyHeartEffect(
    {
      env: { ...env, causeSeq: line.seq },
      other,
      pair,
      seq: line.seq,
      source: def.name,
      scale: 1,
      rng: rng.fork('effects'),
      origin: def.id,
    },
    choice.effects,
  );
}
