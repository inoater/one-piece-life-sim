import type { FightSpec, HeartEffect, RelAxis } from '../../engine/data/schemas';
import { crewHooks } from '../crew/hooks';
import type { Rng } from '../../engine/rng';
import type { Entity, RelationKind } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { RECIPROCAL } from '../genesis/family';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { trainStat } from '../life/training';
import { injure } from '../life/health';
import { drift, driftCtxOf } from '../life/personality';
import { reputation } from '../life/body';
import { ensureHands, carried, giveItem } from '../hands/items';
import { breakthroughTrack, openTrack, powerCtxOf } from '../powers/tracks';
import { beginFight, buildFight } from '../battle/player';
import { axisValue, bondOf, moveAxis, moveBar, type Pair } from './bonds';
import { clampMorale, ensureHeart, setMood } from './profile';
import { forgiveWorst, remember } from './memory';
import { deedReputation, feelGuilt, weighDeed } from './deeds';
import { tellFact } from './facts';
import { renderHeart } from './speech';
import { deedHook } from './hooks';

/**
 * The heart's effect language (data/intents, data/initiatives, bond milestones): how the other
 * comes to feel ("axes"), how the player does ("mine"), the bond's own bars, moods, a memory, the
 * player's deed (personality, conscience, reputation), morale, Berries, training, and one special
 * (a loan, a recruit, a confession, a duel...). Every change to a relationship is a modifier named
 * for its source and traced to the log record of what happened (rule 3, rule 6).
 */

export interface HeartSite {
  env: LifeEnv;
  other: Entity;
  pair: Pair;
  /** The log record of what happened: every change traces to it. */
  seq: number;
  /** "Shared a meal", "A letter from home": the modifier's name. */
  source: string;
  /** Over a Den Den Mushi, effects are a share of the full. */
  scale: number;
  rng: Rng;
  /** For a loan or a gift: how much. */
  amount?: number;
  /** For a fact: what was asked about. */
  topic?: string;
  /** The intent (or initiative) behind it, for a fight's result. */
  origin: string;
}

/** Change the relation kind on both sides ("sweetheart" both ways, "mentor" and "protégé"). */
export function setKinds(pair: Pair, mine: RelationKind): void {
  pair.mine.kind = mine;
  pair.theirs.kind = RECIPROCAL[mine];
}

function line(env: LifeEnv, text: string, other: Entity, tone: 'good' | 'bad' | 'plain'): void {
  lifeLog(env, text, {
    kind: 'event',
    tags: ['personal', 'relationship', 'heart'],
    others: [other.id],
  });
  reportLine(env, text, tone);
}

/**
 * A deed of the player's: who they become (Phase 4's drift, which tells the heart through its
 * hook), how it sits with them, what people say.
 */
export function playerDeed(env: LifeEnv, tags: readonly string[], seq: number): void {
  if (tags.length === 0) return;
  drift(driftCtxOf({ ...env, causeSeq: seq }), tags);
}

/** The heart's side of a deed: conscience (and guilt) and reputation where it happened. */
export function heartDeed(env: LifeEnv, tags: readonly string[], seq: number | undefined): void {
  const { state, data, p } = env;
  if (p.entity.id !== state.playerId) return;
  const change = weighDeed(state, data, p.entity, tags, seq);
  deedReputation(state, data, p.entity, tags, p.place.location?.id ?? null);
  if (change.guilty) {
    const text = renderLife(env, data.heart.lines.guiltLine);
    const record = lifeLog(env, text, { kind: 'event', tags: ['personal', 'conscience', 'guilt'] });
    reportLine(env, text, 'bad');
    feelGuilt(state, data, p.entity, tags, record.seq);
    guiltHook.fire?.(env, record.seq);
  }
}
deedHook.fire = (env, tags, seq) => {
  heartDeed(env as LifeEnv, tags, seq);
  // Phase 8: the creed of the crew the player leads.
  crewHooks.deed?.(env, tags, seq);
};

/** Set by initiatives.ts (the guilt decision), so effects need not import the initiatives. */
export const guiltHook: { fire?: (env: LifeEnv, seq: number) => void } = {};

/**
 * A Phase 5 fight with someone: a duel (played the player's way) or a spar (a bout, quick).
 * `how`: a duel or spar intent replays its own bands when it ends; one an effect started (a
 * provocation, a blackmail gone wrong) only leaves respect or a grudge behind.
 */
export function startHeartFight(
  env: LifeEnv,
  other: Entity,
  kind: 'duel' | 'spar',
  origin: string,
  title: string,
  how: 'intent' | 'effect' = 'effect',
): void {
  const { state, data } = env;
  const band = { text: 'The fight is over.', effects: [] };
  const spec: FightSpec = {
    scale: 'duel',
    foes: [{ kind: 'role', role: 'other' }],
    intent: kind === 'spar' ? 'spare' : 'capture',
    mine: kind === 'spar' ? 'spare' : 'capture',
    allies: 'none',
    mode: kind === 'spar' ? 'quick' : 'prefer',
    ...(kind === 'spar' ? { stop: 'yield' as const } : {}),
    fronts: [],
    water: false,
    success: band,
    failure: band,
  };
  const battle = buildFight(state, data, spec, {
    tick: state.tick,
    place: env.p.place.location?.id ?? null,
    roles: { other: other.id },
    source: {
      kind: 'heart',
      id: origin,
      choice: how,
      roles: { other: other.id },
      ...(env.causeSeq !== undefined ? { causeSeq: env.causeSeq } : {}),
    },
  });
  beginFight(state, data, battle, title);
}

export function applyHeartEffect(site: HeartSite, effect: HeartEffect): void {
  const { env, other, pair, seq, source, scale } = site;
  const { state, data, tick, p } = env;
  const bond = bondOf(data, pair.mine.kind);
  for (const [axis, v] of Object.entries(effect.axes))
    moveAxis(data, pair.theirs, axis as RelAxis, (v ?? 0) * scale, source, seq, tick);
  for (const [axis, v] of Object.entries(effect.mine))
    moveAxis(data, pair.mine, axis as RelAxis, (v ?? 0) * scale, source, seq, tick);
  for (const [bar, v] of Object.entries(effect.bars))
    moveBar(data, pair.theirs, bond, bar, v * scale, source, seq, tick);
  const theirHeart = ensureHeart(state, data, other);
  const myHeart = ensureHeart(state, data, p.entity);
  if (effect.mood) setMood(data, theirHeart, effect.mood, tick);
  if (effect.myMood) setMood(data, myHeart, effect.myMood, tick);
  if (effect.memory)
    remember(state, data, other, {
      about: p.entity.id,
      kind: effect.memory.kind,
      weight: effect.memory.weight * scale,
      place: p.place.location?.id ?? null,
      seq,
    });
  if (effect.morale) theirHeart.morale = clampMorale(theirHeart.morale + effect.morale * scale);
  if (effect.myMorale) myHeart.morale = clampMorale(myHeart.morale + effect.myMorale * scale);
  if (effect.berries) pay(env, Math.round(effect.berries * scale));
  for (const [stat, points] of Object.entries(effect.train))
    trainStat(data, p.entity, p.c, stat, (points ?? 0) * scale, tick);
  if (effect.deed.length > 0) playerDeed(env, effect.deed, seq);
  if (effect.special) special(site, effect.special);
}

function special(site: HeartSite, what: NonNullable<HeartEffect['special']>): void {
  const { env, other, pair, seq } = site;
  const { state, data, tick, p } = env;
  const oc = other.character;
  if (!oc) return;
  const theirHeart = ensureHeart(state, data, other);
  switch (what) {
    case 'fact':
    case 'secret': {
      // Facts asked for are told by the talk itself; a secret here slips out of them.
      if (what === 'secret') {
        // A mentor's secret is a technique; anyone else's is something about them.
        if (bondOf(data, pair.mine.kind) === 'mentor') {
          const track = breakthroughTrack(powerCtxOf(env));
          if (track)
            line(env, `${other.name} showed you the way past where you were stuck.`, other, 'good');
        } else {
          const told = tellFact(
            state,
            data,
            p.entity,
            other,
            'secret',
            undefined,
            site.rng.fork('secret'),
          );
          line(env, `You learned something about ${other.name}: ${told.text}.`, other, 'plain');
        }
      }
      break;
    }
    case 'number': {
      const hands = ensureHands(p.entity);
      if (!hands.contacts.includes(other.id)) hands.contacts.push(other.id);
      break;
    }
    case 'loan': {
      const can = Math.max(500, Math.round(Math.max(oc.berries, 2000) * data.heart.talk.loanShare));
      const amount = Math.max(1, Math.min(site.amount ?? can, can));
      pay(env, amount);
      oc.berries = Math.max(0, oc.berries - amount);
      theirHeart.owed = (theirHeart.owed ?? 0) + amount;
      moveAxis(data, pair.theirs, 'debt', -Math.min(40, amount / 100), 'A loan', seq, tick);
      line(env, `${other.name} lent you ${formatBerries(amount)} Berries.`, other, 'good');
      break;
    }
    case 'repayLoan':
    case 'callDebt': {
      const owed = theirHeart.owed ?? 0;
      if (owed > 0) {
        // The player owes them: pay what can be paid.
        const paid = Math.min(owed, Math.max(0, p.c.berries));
        if (paid > 0) {
          pay(env, -paid);
          oc.berries += paid;
          theirHeart.owed = owed - paid;
          moveAxis(data, pair.theirs, 'debt', Math.min(40, paid / 100), 'Paid back', seq, tick);
          line(
            env,
            `You paid ${other.name} ${formatBerries(paid)} Berries of what you owed.`,
            other,
            'plain',
          );
        }
      } else if (owed < 0 || axisValue(data, pair.theirs, 'debt', tick) > 0) {
        // They owe the player: money, or a favour's worth.
        const amount = owed < 0 ? -owed : 300;
        pay(env, amount);
        oc.berries = Math.max(0, oc.berries - amount);
        theirHeart.owed = 0;
        const debt = axisValue(data, pair.theirs, 'debt', tick);
        if (debt > 0) moveAxis(data, pair.theirs, 'debt', -debt, 'Settled up', seq, tick);
        line(env, `${other.name} paid you ${formatBerries(amount)} Berries.`, other, 'good');
      }
      break;
    }
    case 'teach': {
      setKinds(pair, 'mentor');
      const ctx = powerCtxOf(env);
      const theirs = Object.keys(oc.powers?.tracks ?? {})
        .sort()
        .find((id) => {
          const t = data.tracks[id];
          return t && t.family !== 'haki' && t.family !== 'fruit' && !p.c.powers?.tracks[id];
        });
      if (theirs) {
        openTrack(ctx, theirs, {
          source: `Taught by ${other.name}`,
          teacherMult: 1.3,
          ...(p.place.location ? { taughtAt: p.place.location.id } : {}),
        });
      }
      break;
    }
    case 'takeStudent':
      setKinds(pair, 'protege');
      break;
    case 'passage':
      setKinds(pair, 'superior');
      break;
    case 'shelter': {
      const cost = data.life.money.livingCost[p.place.wealth] ?? 300;
      pay(env, cost * 2);
      break;
    }
    case 'recruit':
      // Phase 8: a yes to the Recruit intent is a pitch that landed: their doubts, then a crew.
      if (crewHooks.join) crewHooks.join(env, other, seq, 'intent');
      else {
        setKinds(pair, 'crewmate');
        other.flags['crew.of'] = p.entity.id;
      }
      break;
    case 'swear':
      pair.mine.sworn = true;
      pair.theirs.sworn = true;
      break;
    case 'confess': {
      setKinds(pair, 'sweetheart');
      pair.mine.romance = 'courting';
      pair.theirs.romance = 'courting';
      // Anyone else the player is with will hear of it.
      for (const rel of p.c.relationships) {
        if (rel.kind !== 'sweetheart' || rel.id === other.id) continue;
        const lover = state.entities[rel.id];
        const theirs = lover?.character?.alive
          ? lover.character.relationships.find((r) => r.id === p.entity.id)
          : undefined;
        if (theirs)
          moveBar(
            data,
            theirs,
            'romance',
            'jealousy',
            data.heart.romance.rivalJealousy,
            `You and ${other.name}`,
            seq,
            tick,
          );
      }
      break;
    }
    case 'together':
      pair.mine.romance = 'together';
      pair.theirs.romance = 'together';
      break;
    case 'propose':
      pair.mine.romance = 'engaged';
      pair.theirs.romance = 'engaged';
      break;
    case 'marry':
      pair.mine.romance = 'married';
      pair.theirs.romance = 'married';
      p.entity.flags['married'] = true;
      other.flags['married'] = true;
      p.c.life?.deeds.push({ tick, text: `Married ${other.name}.` });
      break;
    case 'breakup': {
      const kind = pair.mine.kind;
      if (kind === 'sweetheart') {
        const married = pair.mine.romance === 'married';
        setKinds(pair, 'former');
        delete pair.mine.romance;
        delete pair.theirs.romance;
        if (married) {
          p.entity.flags['married'] = false;
          other.flags['married'] = false;
          line(
            env,
            renderHeart(state, data, other, data.heart.lines.divorced, site.rng.fork('divorce')),
            other,
            'bad',
          );
        }
      } else if (kind === 'crewmate') {
        setKinds(pair, 'friend');
        delete other.flags['crew.of'];
        crewHooks.leave?.(state, data, other.id, 'parted ways');
      } else if (kind === 'protege') setKinds(pair, 'friend');
      break;
    }
    case 'leave':
    case 'mutiny':
      if (pair.mine.kind === 'crewmate' || pair.mine.kind === 'subordinate') {
        setKinds(pair, 'friend');
        delete other.flags['crew.of'];
        crewHooks.leave?.(state, data, other.id, what === 'mutiny' ? 'mutinied' : 'deserted');
      }
      break;
    case 'graduate':
      setKinds(pair, 'friend');
      remember(state, data, other, {
        about: p.entity.id,
        kind: 'favour',
        weight: 30,
        place: p.place.location?.id ?? null,
        seq,
      });
      break;
    case 'lesson':
      moveBar(data, pair.theirs, 'student', 'progress', 10, 'Lessons', seq, tick);
      trainStat(data, p.entity, p.c, 'intellect', 0.2, tick);
      break;
    case 'trainTogether':
      // Their side of it: the other grows too (stats live on the entity like the player's).
      for (const stat of ['endurance', 'strength']) {
        const s = other.stats[stat];
        if (s) s.base = Math.round((s.base + 0.2) * 100) / 100;
      }
      break;
    case 'betray':
      reputation(p.entity, 'infamy').base += 1;
      if (pair.mine.kind === 'crewmate') setKinds(pair, 'friend');
      break;
    case 'goodbye':
      theirHeart.reached ??= {};
      theirHeart.reached['goodbye'] = tick;
      pair.mine.lastSeen = tick;
      pair.theirs.lastSeen = tick;
      break;
    case 'reconcile':
      forgiveWorst(theirHeart, p.entity.id, false);
      break;
    case 'blessing': {
      const blade = carried(state, other).find((i) => i.item?.family);
      if (blade) {
        giveItem(state, data, blade, p.entity, tick, `Given by ${other.name} as a blessing.`);
        line(env, `${other.name} gave you ${blade.name}.`, other, 'good');
      }
      break;
    }
    case 'recommend':
      reputation(p.entity, 'fame').base += 2;
      break;
    case 'estrange':
      break;
    case 'collect':
      injure(env, { severity: 'minor', area: 'roll', cause: 'violence' });
      pay(env, -Math.min(Math.max(0, p.c.berries), theirHeart.owed ?? 0));
      break;
    case 'duel':
      startHeartFight(env, other, 'duel', site.origin, `${other.name} fights you`);
      break;
  }
}
