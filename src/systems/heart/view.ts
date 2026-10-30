import { dateOf, formatDate } from '../../engine/calendar';
import type { GameData, IntentGroup, RelAxis, RepDim } from '../../engine/data/schemas';
import { INTENT_GROUPS, REL_AXES, REP_DIMS } from '../../engine/data/schemas';
import { isKnownBy } from '../../engine/knowledge';
import type { EventRecord, HeartData, Relationship, Stat, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { ageYears, ensureLife, isMarried, type Person } from '../life/body';
import { locationIdOf } from '../places/place';
import { carried } from '../hands/items';
import {
  axisRange,
  axisValue,
  barsOf,
  bondOf,
  circle,
  labelOf,
  monthsKnown,
  pairOf,
  readBar,
  romanceAllowed,
  together,
  traceOf,
} from './bonds';
import { companionPrice, speciesHere, speciesOf } from './companions';
import { conscienceOf, repAt, repWords } from './deeds';
import { axisWords, dreamText, heartOrRoll, moodOf, tendencies } from './profile';
import { knowsNumber, talkLock, talkOdds, talksThisMonth } from './talk';

/**
 * What the page shows of the heart (Phase 7): the player's own (mood, morale, conscience,
 * tendencies, what is said of them, the facts they have been told), the Contacts list, a person
 * page (their portrait slot, what is known of who they are, every axis and bar with its breakdown
 * traced to the logged event behind each modifier, their memories of the player, the intent menu
 * with chances in words), and the web of family and crew. Rule 4: the truth of a fact, a profile
 * not yet learned, and records the player never knew are shown only in omniscient views.
 */

export interface TraceLine {
  source: string;
  value: number;
  /** The record behind it: what happened, and when. */
  seq: number | null;
  when: string | null;
  what: string | null;
}

export interface Breakdown {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  base: number;
  /** What the base traces to: the meeting, or the bond's resting point. */
  baseNote: string;
  lines: TraceLine[];
}

function recordOf(state: WorldState, seq: number): EventRecord | undefined {
  const log = state.log;
  let lo = 0;
  let hi = log.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = log[mid] as EventRecord;
    if (r.seq === seq) return r;
    if (r.seq < seq) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

function trace(
  state: WorldState,
  data: GameData,
  rel: Relationship,
  stat: Stat,
  omniscient: boolean,
): TraceLine[] {
  return stat.mods
    .filter((m) => m.expiresTick === undefined || m.expiresTick > state.tick)
    .map((m) => {
      const seq = traceOf(rel, m) ?? null;
      const record = seq !== null ? recordOf(state, seq) : undefined;
      const known = record ? isKnownBy(record.knownBy, state.playerId, omniscient) : false;
      return {
        source: m.source,
        value: Math.round(m.value * 10) / 10,
        seq,
        when: record ? formatDate(dateOf(data.calendar, record.tick)) : null,
        what: record ? (known ? record.summary : 'Something you never heard about.') : null,
      };
    });
}

function metNote(state: WorldState, data: GameData, rel: Relationship): string {
  const record = rel.metSeq !== undefined ? recordOf(state, rel.metSeq) : undefined;
  const when = formatDate(dateOf(data.calendar, record?.tick ?? rel.sinceTick));
  return record ? `Since you met (${when}): ${record.summary}` : `Since ${when}`;
}

export function axisBreakdown(
  state: WorldState,
  data: GameData,
  rel: Relationship,
  axis: RelAxis,
  omniscient: boolean,
): Breakdown {
  const stat = axis === 'affection' ? rel.opinion : rel.axes?.[axis];
  const range = axisRange(data, axis);
  return {
    id: axis,
    name: data.heart.relationship.axes[axis]?.name ?? axis,
    value: Math.round(axisValue(data, rel, axis, state.tick)),
    min: range.min,
    max: range.max,
    base: Math.round(stat?.base ?? 0),
    baseNote: stat ? metNote(state, data, rel) : 'At rest',
    lines: stat ? trace(state, data, rel, stat, omniscient) : [],
  };
}

export interface HeartSelfView {
  morale: number;
  mood: string;
  moodId: string;
  conscience: number;
  conscienceWords: string;
  tendencies: string[];
  values: string[];
  dream: string;
  voice: string;
  romance: boolean;
  /** What is said of the player here, and in the places that have heard most of them. */
  reputation: { place: string; words: string }[];
  repHere: { dim: string; name: string; value: number; high: string; low: string }[];
  facts: {
    id: number;
    text: string;
    from: string;
    fromId: string;
    when: string;
    kind: string;
    /** Rule 4: shown only when found out, or in omniscient views. */
    truth: boolean | null;
    checked: string | null;
  }[];
  contacts: ContactView[];
  companionsHere: { id: string; name: string; kind: string; price: number; description: string }[];
  canAdopt: boolean;
  heir: string | null;
  crewHere: number;
  guestsHere: number;
}

export interface ContactView {
  id: string;
  name: string;
  label: string;
  kind: string;
  bond: string;
  affection: number;
  here: boolean;
  lastSeen: string | null;
  number: boolean;
  vivre: boolean;
  where: string | null;
  animal: boolean;
}

function contacts(state: WorldState, data: GameData, p: Person): ContactView[] {
  const vivres = new Set(
    carried(state, p.entity)
      .filter((i) => i.item?.defId === 'item_vivre_card')
      .map((i) => i.item?.target ?? ''),
  );
  return circle(state, p.entity, false)
    .map(({ other, pair }) => {
      const label = labelOf(data, pair, state.tick);
      const seen = pair.mine.lastSeen;
      const where = other.character ? locationIdOf(data, other.character) : null;
      return {
        id: other.id,
        name: other.name,
        label: label.name,
        kind: pair.mine.kind,
        bond: data.heart.bonds[bondOf(data, pair.mine.kind)]?.name ?? '',
        affection: Math.round(axisValue(data, pair.theirs, 'affection', state.tick)),
        here: together(data, p.entity, other),
        lastSeen: seen !== undefined ? formatDate(dateOf(data.calendar, seen)) : null,
        number: knowsNumber(p, other),
        vivre: vivres.has(other.id),
        // Where they are is known only for someone seen this month, or whose card the player holds.
        where:
          seen === state.tick || vivres.has(other.id)
            ? where
              ? (data.locations[where]?.name ?? null)
              : 'at sea'
            : null,
        animal: other.flags['animal'] !== undefined,
      };
    })
    .sort(
      (a, b) =>
        Number(b.here) - Number(a.here) || b.affection - a.affection || (a.name < b.name ? -1 : 1),
    );
}

export function heartView(
  state: WorldState,
  data: GameData,
  omniscient = false,
): HeartSelfView | null {
  const p = ensureLife(state, data);
  if (!p || !p.c.alive) return null;
  // A save from before Phase 7 has no heart until its first month: show the one it will have.
  const heart: HeartData = heartOrRoll(state, data, p.entity);
  const tick = state.tick;
  const mood = moodOf(heart, tick);
  const conscience = Math.round(conscienceOf(heart, tick));
  const place = p.place.location?.id ?? null;
  const here = repAt(state, heart, p.entity, place);
  const reputation = Object.keys(heart.rep ?? {})
    .filter((s) => s in data.locations)
    .map((s) => ({ s, words: repWords(data, heart.rep?.[s] as Record<RepDim, number>) }))
    .filter((x): x is { s: string; words: string } => x.words !== null)
    .slice(0, 8)
    .map((x) => ({ place: data.locations[x.s]?.name ?? x.s, words: x.words }));
  const people = circle(state, p.entity, false);
  return {
    morale: Math.round(heart.morale),
    mood: data.heart.moods[mood]?.name ?? mood,
    moodId: mood,
    conscience,
    conscienceWords:
      conscience >= 80
        ? 'At peace'
        : conscience >= 60
          ? 'Mostly easy'
          : conscience >= 40
            ? 'Uneasy'
            : 'Haunted',
    tendencies: tendencies(data, heart.profile),
    values: heart.profile.values.map((v) => data.heart.values.find((x) => x.id === v)?.name ?? v),
    dream: dreamText(data, heart.profile),
    voice:
      data.heart.registers[heart.profile.voice.register as keyof typeof data.heart.registers]
        ?.name ?? '',
    romance: state.config.romance !== false,
    reputation,
    repHere: REP_DIMS.map((d) => ({
      dim: d,
      name: data.heart.reputation.dims[d]?.name ?? d,
      value: Math.round(here[d]),
      high: data.heart.reputation.dims[d]?.high ?? '',
      low: data.heart.reputation.dims[d]?.low ?? '',
    })),
    facts: (heart.facts ?? [])
      .slice()
      .reverse()
      .map((f) => ({
        id: f.id,
        text: f.text,
        from: state.entities[f.from]?.name ?? 'someone',
        fromId: f.from,
        when: formatDate(dateOf(data.calendar, f.tick)),
        kind: f.kind,
        truth: omniscient || f.checked ? f.truth : null,
        checked: f.checked ?? null,
      })),
    contacts: contacts(state, data, p),
    companionsHere: speciesHere(data, p).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      price: companionPrice({ state, data, p }, s),
      description: s.description,
    })),
    canAdopt:
      !p.place.atSea &&
      (state.entities[p.place.location?.id ?? '']?.place?.residents.children ?? 0) >= 1,
    heir: heart.heir ? (state.entities[heart.heir]?.name ?? null) : null,
    crewHere: people.filter(
      ({ other, pair }) => pair.mine.kind === 'crewmate' && together(data, p.entity, other),
    ).length,
    guestsHere: people.filter(({ other }) => together(data, p.entity, other)).length,
  };
}

// ---- A person -----------------------------------------------------------------------------------

export interface IntentChoice {
  id: string;
  name: string;
  group: IntentGroup;
  description: string;
  chance: string;
  percent: number;
  lock: string | null;
  remoteLock: string | null;
  topic: string;
  cost: number;
  fight: boolean;
}

export interface PersonView {
  id: string;
  name: string;
  initials: string;
  alive: boolean;
  age: number | null;
  pronouns: string;
  race: string;
  occupation: string | null;
  animal: string | null;
  label: string;
  kind: string;
  bond: string;
  here: boolean;
  where: string | null;
  sinceText: string;
  number: boolean;
  mood: string;
  morale: string;
  /** Who they are, as far as the player has learned it (everything in omniscient views). */
  profile: {
    known: boolean;
    personality: string[];
    values: string[];
    dream: string | null;
    likes: string[];
    dislikes: string[];
    voice: string | null;
    fear: string | null;
  };
  theirs: Breakdown[];
  mine: Breakdown[];
  bars: Breakdown[];
  milestones: { id: string; label: string; reached: boolean; needs: string }[];
  memories: {
    kind: string;
    name: string;
    where: string;
    when: string;
    feeling: string;
    heard: string | null;
  }[];
  facts: { text: string; from: string; when: string }[];
  intents: IntentChoice[];
  talksLeft: number;
  topics: { people: { id: string; name: string }[]; places: { id: string; name: string }[] };
  married: boolean;
  romance: string | null;
  sworn: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('');
}

function feeling(weight: number): string {
  const a = Math.abs(weight);
  const how = a >= 40 ? 'deeply' : a >= 15 ? '' : 'faintly';
  return `${how ? `${how} ` : ''}${weight >= 0 ? 'fondly' : 'bitterly'}`;
}

export function personView(
  state: WorldState,
  data: GameData,
  id: string,
  omniscient = false,
): PersonView | null {
  const p = ensureLife(state, data);
  const other = state.entities[id];
  const oc = other?.character;
  if (!p || !other || !oc) return null;
  const pair = pairOf(p.entity, other, false);
  if (!pair) return null;
  const tick = state.tick;
  const heart = heartOrRoll(state, data, other);
  const bond = bondOf(data, pair.mine.kind);
  const label = labelOf(data, pair, tick);
  const here = together(data, p.entity, other);
  const talks = heart?.reached?.['talks'] ?? 0;
  const known = omniscient || monthsKnown(pair.mine, tick) >= 6 || talks >= 3;
  const species = speciesOf(data, other);
  const profile = heart?.profile;
  const intents = Object.keys(data.intents)
    .sort()
    .map((iid) => data.intents[iid] as NonNullable<GameData['intents'][string]>)
    .filter((intent) => !species || intent.group === 'friendly')
    .map((intent) => {
      const lock = oc.alive ? talkLock(state, data, p, other, intent, {}) : 'They are gone';
      const remoteLock = oc.alive
        ? talkLock(state, data, p, other, intent, { remote: true })
        : 'They are gone';
      const odds = oc.alive ? talkOdds(state, data, p, other, intent, { remote: !here }) : null;
      return {
        id: intent.id,
        name: intent.name,
        group: intent.group,
        description: intent.description,
        chance: odds?.words ?? '',
        percent: Math.round((odds?.chance ?? 0) * 100),
        lock,
        remoteLock,
        topic: intent.topic,
        cost: intent.cost,
        fight: intent.fight !== undefined,
      };
    })
    .sort((a, b) => INTENT_GROUPS.indexOf(a.group) - INTENT_GROUPS.indexOf(b.group));
  const theirAxes = REL_AXES.filter(
    (a) =>
      a !== 'attraction' ||
      (romanceAllowed(state, data, p.entity, other) && axisValue(data, pair.theirs, a, tick) > 0),
  );
  const bars = barsOf(data, bond).map((def) => {
    if (def.axis)
      return {
        ...axisBreakdown(state, data, pair.theirs, def.axis, omniscient),
        id: def.id,
        name: def.name,
      };
    const stat = pair.theirs.bars?.[def.id];
    return {
      id: def.id,
      name: def.name,
      value: Math.round(readBar(data, pair.theirs, bond, def.id, tick)),
      min: 0,
      max: def.max,
      base: Math.round(stat?.base ?? def.rest),
      baseNote: 'Time together and apart',
      lines: stat ? trace(state, data, pair.theirs, stat, omniscient) : [],
    };
  });
  const reached = new Set(pair.theirs.milestones ?? []);
  const milestones = (data.heart.bonds[bond]?.milestones ?? []).map((m) => ({
    id: m.id,
    label: m.label,
    reached: reached.has(m.id),
    needs: [
      ...Object.entries(m.min).map(([k, v]) => `${k} ${v}+`),
      ...Object.entries(m.max).map(([k, v]) => `${k} ${v} or less`),
      ...(m.months > 0 ? [`${m.months} months known`] : []),
    ].join(', '),
  }));
  const people = circle(state, p.entity, false)
    .map(({ other: o }) => ({ id: o.id, name: o.name }))
    .filter((x) => x.id !== other.id);
  const visited = new Set([...(p.c.travel?.visited ?? []), p.place.location?.id ?? '']);
  const places = Object.values(data.locations)
    .filter((l) => visited.has(l.id) || !l.tags.includes('dev'))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((l) => ({ id: l.id, name: l.name }));
  const where = locationIdOf(data, oc);
  const vivre = carried(state, p.entity).some(
    (i) => i.item?.defId === 'item_vivre_card' && i.item.target === id,
  );
  return {
    id: other.id,
    name: other.name,
    initials: initials(other.name) || other.name.charAt(0),
    alive: oc.alive,
    age: oc.alive ? ageYears(oc, tick) : null,
    pronouns: oc.pronouns,
    race: species ? species.name : (data.races[oc.race]?.name ?? oc.race),
    occupation: oc.occupation ? (data.occupations[oc.occupation]?.name ?? null) : null,
    animal: species?.kind ?? null,
    label: label.name,
    kind: pair.mine.kind,
    bond: data.heart.bonds[bond]?.name ?? bond,
    here,
    where: here || vivre ? (where ? (data.locations[where]?.name ?? null) : 'at sea') : null,
    sinceText: formatDate(dateOf(data.calendar, pair.mine.sinceTick)),
    number: knowsNumber(p, other),
    mood: data.heart.moods[moodOf(heart, tick)]?.name ?? 'Content',
    morale: !heart
      ? ''
      : heart.morale >= 70
        ? 'In good spirits'
        : heart.morale >= 40
          ? 'Getting by'
          : 'Low',
    profile: {
      known,
      personality: known && profile ? axisWords(data, profile) : [],
      values:
        known && profile
          ? profile.values.map((v) => data.heart.values.find((x) => x.id === v)?.name ?? v)
          : [],
      dream:
        profile && (omniscient || heart?.reached?.['dreamTold'] !== undefined)
          ? dreamText(data, profile)
          : null,
      likes: known && profile ? profile.likes : [],
      dislikes: known && profile ? profile.dislikes : [],
      voice: profile
        ? (data.heart.registers[profile.voice.register as keyof typeof data.heart.registers]
            ?.name ?? null)
        : null,
      fear: omniscient && profile ? profile.fear : null,
    },
    theirs: theirAxes.map((a) => axisBreakdown(state, data, pair.theirs, a, omniscient)),
    mine: (['affection', 'trust', 'respect', 'rivalry'] as const).map((a) =>
      axisBreakdown(state, data, pair.mine, a, omniscient),
    ),
    bars,
    milestones,
    memories: (heart?.memories ?? [])
      .filter((m) => m.about === p.entity.id)
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .map((m) => ({
        kind: m.kind,
        name: data.heart.memories[m.kind]?.name ?? m.kind,
        where: m.where,
        when: formatDate(dateOf(data.calendar, m.tick)),
        feeling: feeling(m.weight),
        heard: m.heardFrom ? (state.entities[m.heardFrom]?.name ?? 'someone') : null,
      })),
    facts: (p.c.heart?.facts ?? [])
      .filter((f) => f.about === other.id || f.from === other.id)
      .map((f) => ({
        text: f.text,
        from: state.entities[f.from]?.name ?? 'someone',
        when: formatDate(dateOf(data.calendar, f.tick)),
      })),
    intents,
    talksLeft: Math.max(0, data.heart.talk.perMonth - talksThisMonth(p, other.id, tick)),
    topics: { people, places },
    married: isMarried(other) && pair.mine.romance === 'married',
    romance: pair.mine.romance ?? null,
    sworn: pair.mine.sworn === true,
  };
}

// ---- The web ------------------------------------------------------------------------------------

export interface WebView {
  nodes: {
    id: string;
    name: string;
    group: 'you' | 'family' | 'crew' | 'love' | 'friends' | 'other';
    label: string;
  }[];
  edges: { a: string; b: string; affection: number; label: string }[];
}

/** The player's family, crew and closest, and how they stand with each other. */
export function webView(state: WorldState, data: GameData): WebView | null {
  const p = ensureLife(state, data);
  if (!p) return null;
  const tick = state.tick;
  const groupOf = (kind: string): WebView['nodes'][number]['group'] =>
    ['parent', 'child', 'sibling', 'guardian', 'ward'].includes(kind)
      ? 'family'
      : kind === 'crewmate'
        ? 'crew'
        : kind === 'sweetheart'
          ? 'love'
          : ['friend', 'mentor', 'protege', 'companion'].includes(kind)
            ? 'friends'
            : 'other';
  const close = circle(state, p.entity, false)
    .filter(
      ({ pair }) =>
        groupOf(pair.mine.kind) !== 'other' ||
        axisValue(data, pair.theirs, 'affection', tick) >= 40,
    )
    .slice(0, 24);
  const nodes: WebView['nodes'] = [
    { id: p.entity.id, name: p.entity.name, group: 'you', label: 'You' },
  ];
  const edges: WebView['edges'] = [];
  for (const { other, pair } of close) {
    nodes.push({
      id: other.id,
      name: other.name,
      group: groupOf(pair.mine.kind),
      label: labelOf(data, pair, tick).name,
    });
    edges.push({
      a: p.entity.id,
      b: other.id,
      affection: Math.round(axisValue(data, pair.theirs, 'affection', tick)),
      label: labelOf(data, pair, tick).name,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const { other } of close) {
    for (const rel of other.character?.relationships ?? []) {
      if (!ids.has(rel.id) || rel.id === p.entity.id || rel.id < other.id) continue;
      edges.push({
        a: other.id,
        b: rel.id,
        affection: Math.round(statValue(rel.opinion, tick)),
        label: rel.kind,
      });
    }
  }
  return { nodes, edges };
}
