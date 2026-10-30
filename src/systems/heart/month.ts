import type { GameData, RelAxis } from '../../engine/data/schemas';
import { REL_AXES } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Entity, Relationship, Stat } from '../../engine/state';
import { lifeLog, reportLine, type LifeEnv } from '../life/env';
import {
  barsOf,
  barStat,
  bondOf,
  circle,
  monthsKnown,
  moveAxis,
  readBar,
  romanceAllowed,
  axisStat,
  axisValue,
  together,
  type Pair,
} from './bonds';
import { applyHeartEffect } from './effects';
import { checkFacts } from './facts';
import { fadeMemories } from './memory';
import { clampMorale, ensureHeart, moodOf, syncPlayerProfile } from './profile';
import { gossipQuarter } from './scenes';
import { initiativesMonth } from './initiatives';
import { companionsAge } from './companions';
import { griefMonth } from './family';
import { renderHeart } from './speech';

/**
 * The heart's month for the player and everyone close to them (step 7, after the life loop's):
 * who they are now; time together or apart, which wears every relationship toward rest at its
 * bond's pace and fills or drains the bars that move with time; milestones reached; memories
 * fading; grief for the dead; lies found out; morale and conscience settling; people reaching
 * out; and each quarter, gossip and the player's name travelling.
 */

const isTraitMod = (source: string) => source.endsWith(' (trait)');

/** Wear a stat's event modifiers toward nothing by `share`; the base is where it rests. */
function wear(stat: Stat, share: number, prune: number): void {
  if (share <= 0 || stat.mods.length === 0) return;
  for (const m of stat.mods) {
    if (m.kind !== 'flat' || m.expiresTick !== undefined || isTraitMod(m.source)) continue;
    m.value = Math.round(m.value * (1 - share) * 100) / 100;
  }
  stat.mods = stat.mods.filter(
    (m) =>
      m.kind !== 'flat' ||
      m.expiresTick !== undefined ||
      isTraitMod(m.source) ||
      Math.abs(m.value) >= prune,
  );
}

/** `months` of time together or apart for one pair. */
function driftPair(
  data: GameData,
  pair: Pair,
  near: boolean,
  tick: number,
  goodbye: number | undefined,
  months: number,
): void {
  const rel = data.heart.relationship;
  const bond = bondOf(data, pair.mine.kind);
  const mult = rel.driftByBond[bond] ?? 1;
  for (const r of [pair.mine, pair.theirs]) {
    for (const axis of REL_AXES) {
      const stat = axis === 'affection' ? r.opinion : r.axes?.[axis];
      if (!stat) continue;
      const yearly = (rel.axes[axis]?.drift ?? 0.1) * mult * (near ? 0.35 : 1);
      wear(stat, Math.min(1, (yearly * months) / 12), rel.prune);
    }
  }
  for (const def of barsOf(data, bond)) {
    if (def.axis) continue;
    // A bar nothing has moved and time does not fill stays at rest without a record of its own.
    if (!pair.theirs.bars?.[def.id] && def.together === 0 && def.apart === 0) continue;
    const stat = barStat(pair.theirs, def);
    wear(stat, Math.min(1, ((near ? def.drift : def.driftApart) * months) / 12), rel.prune);
    // Time itself: a bar that fills together (shared history) or apart (a lover's jealousy).
    // A proper goodbye before a long voyage halves what absence does for a year.
    const kept = goodbye !== undefined && tick - goodbye < 12 ? 0.5 : 1;
    const by = (near ? def.together : def.apart * kept) * months;
    if (by !== 0)
      stat.base = Math.round(Math.max(0, Math.min(def.max, stat.base + by)) * 100) / 100;
    // ...and the base itself settles toward rest, slowly.
    const pull = Math.min(1, ((near ? def.drift : def.driftApart) * months) / 24);
    if (by === 0 && pull > 0)
      stat.base = Math.round((stat.base + (def.rest - stat.base) * pull) * 100) / 100;
  }
}

/** Milestones of a bond reached this month: at most one a pair. */
function milestonesPair(env: LifeEnv, other: Entity, pair: Pair): void {
  const { state, data, tick } = env;
  const bond = bondOf(data, pair.mine.kind);
  const def = data.heart.bonds[bond];
  if (!def) return;
  const reached = new Set(pair.theirs.milestones ?? []);
  const heart = ensureHeart(state, data, other);
  for (const m of def.milestones) {
    const last = heart.reached?.[`ms:${m.id}`];
    if (reached.has(m.id) && (m.repeat === 0 || (last !== undefined && tick - last < m.repeat)))
      continue;
    if (m.after && !reached.has(m.after)) continue;
    if (monthsKnown(pair.mine, tick) < m.months) continue;
    let ok = true;
    for (const [id, min] of Object.entries(m.min))
      if (readBar(data, pair.theirs, bond, id, tick) < min) ok = false;
    for (const [id, max] of Object.entries(m.max))
      if (readBar(data, pair.theirs, bond, id, tick) > max) ok = false;
    if (!ok) continue;
    pair.theirs.milestones = [...new Set([...(pair.theirs.milestones ?? []), m.id])];
    heart.reached ??= {};
    heart.reached[`ms:${m.id}`] = tick;
    const rng = env.rng.fork('milestone', other.id, m.id);
    const text = renderHeart(state, data, other, m.line, rng.fork('line'), { title: m.label });
    const record = lifeLog(env, text, {
      kind: 'event',
      tags: ['personal', 'relationship', 'milestone', `ms:${m.id}`],
      others: [other.id],
    });
    reportLine(env, text, m.repeat > 0 ? 'bad' : 'good');
    applyHeartEffect(
      {
        env,
        other,
        pair,
        seq: record.seq,
        source: m.label,
        scale: 1,
        rng: rng.fork('fx'),
        origin: `ms:${m.id}`,
      },
      m.effects,
    );
    return;
  }
}

/**
 * Rule 6 for every writer: a relationship modifier made by code that does not know its record (a
 * spar's aftermath, an old event's opinion) gets the latest record this month that names the
 * person, or one written now that says what changed.
 */
function stampUntraced(env: LifeEnv, other: Entity, rels: readonly Relationship[]): void {
  const { state, tick, p } = env;
  for (const rel of rels) {
    for (const axis of REL_AXES) {
      const stat = axis === 'affection' ? rel.opinion : rel.axes?.[axis as RelAxis];
      for (const mod of stat?.mods ?? []) {
        if (mod.seq !== undefined || isTraitMod(mod.source)) continue;
        let seq: number | undefined;
        for (let i = state.log.length - 1; i >= 0; i--) {
          const r = state.log[i];
          if (!r || r.tick < tick) break;
          if (r.targetIds.includes(other.id) || r.actorIds.includes(other.id)) {
            seq = r.seq;
            break;
          }
        }
        seq ??= appendLog(state, tick, {
          kind: 'life',
          summary: `${mod.source}: how you and ${other.name} stand has changed.`,
          tags: ['personal', 'relationship', 'quiet'],
          actorIds: [p.entity.id],
          targetIds: [other.id],
          place: p.place.id,
          cause: 'sys:heart',
          knownBy: [p.entity.id],
        }).seq;
        mod.seq = seq;
      }
    }
  }
}

/**
 * Time together between two people who like each other, both open to romance: attraction grows by
 * their chemistry (each pair has its own, from the world's seed), both ways.
 */
function attraction(env: LifeEnv, other: Entity, pair: Pair): void {
  const { state, data, tick, p } = env;
  const rules = data.heart.romance;
  if (FAMILY.has(pair.mine.kind) || !romanceAllowed(state, data, p.entity, other)) return;
  if (axisValue(data, pair.theirs, 'affection', tick) < rules.attractionAffection) return;
  const chemistry = chemistryOf(state.seed, p.entity.id, other.id);
  if (chemistry < 0.3) return;
  // Time works on the base, as it does on a bar that fills with time (rule 6: no event to name).
  const by = rules.attractionPerMonth * chemistry;
  for (const rel of [pair.theirs, pair.mine]) {
    const stat = axisStat(rel, 'attraction');
    stat.base = Math.round(Math.min(100, stat.base + by) * 100) / 100;
  }
}

/**
 * A pair's chemistry, 0 to 1: the same both ways and every month, from the world's seed. A plain
 * FNV-1a hash rather than a random stream, because it is asked for every month for everyone near.
 */
function chemistryOf(seed: string, x: string, y: string): number {
  const key = x < y ? `${seed}|${x}|${y}` : `${seed}|${y}|${x}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 0x100000000;
}

const FAMILY = new Set(['parent', 'child', 'sibling', 'guardian', 'ward', 'companion', 'owner']);

/**
 * A tie made before the heart kept meeting records (the family one is born into, an old save):
 * its base values trace to the first record naming them both, or the first the player knew of.
 */
function meetingRecord(env: LifeEnv, other: Entity, pair: Pair): void {
  if (pair.mine.metSeq !== undefined && pair.theirs.metSeq !== undefined) return;
  const { state, p } = env;
  const me = p.entity.id;
  let seq: number | undefined;
  let first: number | undefined;
  for (const r of state.log) {
    if (first === undefined && r.knownBy.includes(me)) first = r.seq;
    const both =
      (r.actorIds.includes(me) && r.targetIds.includes(other.id)) ||
      (r.actorIds.includes(other.id) && r.targetIds.includes(me));
    if (both) {
      seq = r.seq;
      break;
    }
  }
  seq ??= first;
  if (seq === undefined) return;
  pair.mine.metSeq ??= seq;
  pair.theirs.metSeq ??= seq;
}

function moraleMonth(
  data: GameData,
  heart: { morale: number; mood: { id: string; until: number } },
  mood: string,
  months = 1,
): void {
  const rules = data.heart.morale;
  const target = rules.rest + (rules.byMood[mood as keyof typeof rules.byMood] ?? 0);
  heart.morale = clampMorale(
    heart.morale + (target - heart.morale) * Math.min(1, rules.drift * months),
  );
}

export function heartMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  if (!p.c.alive) return;
  const me = ensureHeart(state, data, p.entity);
  syncPlayerProfile(data, p.entity);
  for (const { other, pair } of circle(state, p.entity)) {
    ensureHeart(state, data, other);
    const near = together(data, p.entity, other);
    if (near) {
      pair.mine.lastSeen = tick;
      pair.theirs.lastSeen = tick;
    }
    // Rule 5: the people beside the player change month by month; those apart, a quarter at a
    // time (three months' worth at once), on a month of their own.
    const months = near ? 1 : (tick + other.createdTick) % 3 === 0 ? 3 : 0;
    if (months > 0) {
      // Thresholds first (a bar that reached one counts), then time's wear.
      milestonesPair(env, other, pair);
      driftPair(data, pair, near, tick, other.character?.heart?.reached?.['goodbye'], months);
      if (near) attraction(env, other, pair);
      const heart = other.character?.heart;
      if (heart) {
        fadeMemories(data, heart, months);
        moraleMonth(data, heart, moodOf(heart, tick), months);
      }
    }
    meetingRecord(env, other, pair);
    stampUntraced(env, other, [pair.mine, pair.theirs]);
  }
  griefMonth(env);
  checkFacts(state, data, p.entity, (fact, teller, truthful) => {
    if (!teller) return;
    const line = truthful ? data.heart.lines.truthFound : data.heart.lines.lieFound;
    const text = renderHeart(state, data, teller, line, env.rng.fork('fact', fact.id), {
      fact: fact.text,
    });
    const record = lifeLog(env, text, {
      kind: 'event',
      tags: ['personal', 'relationship', 'knowledge'],
      others: [teller.id],
    });
    reportLine(env, text, truthful ? 'plain' : 'bad');
    const mine = p.c.relationships.find((r) => r.id === teller.id);
    if (mine)
      moveAxis(
        data,
        mine,
        'trust',
        truthful ? 3 : -15,
        truthful ? 'Told you the truth' : 'Lied to you',
        record.seq,
        tick,
      );
  });
  moraleMonth(data, me, moodOf(me, tick));
  // The past weighs less each year on the conscience.
  wear(me.conscience, data.heart.conscience.fade / 12, 0.5);
  companionsAge(env);
  initiativesMonth(env);
  if (tick % 3 === 2) gossipQuarter(env);
}
