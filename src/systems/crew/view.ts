import { dateOf, formatDate } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import { CREW_SITUATIONS } from '../../engine/crew-state';
import { Rng } from '../../engine/rng';
import { STAT_IDS, statLabel } from '../../engine/stats';
import type { CrewSituation, Entity, WorldState } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { storyVars } from '../events';
import { axisValue, pairOf, readBar, relOf, together } from '../heart/bonds';
import { axisWords, dreamText, heartOrRoll } from '../heart/profile';
import { combatPowerOf, humanAgeOf, personOf, reputationValue, statTotal } from '../life/body';
import { fruitDefOf } from '../powers/catalogue';
import { chemistry } from './growth';
import { prisonRoom } from './holdings';
import { effectWords, lineupOf, situationNow } from './posts';
import { questActs, questMet, questText } from './quests';
import {
  npcCrewLoyalty,
  objectionsFor,
  openObjections,
  pitchChance,
  pitchLock,
  pitchParts,
} from './recruit';
import { roleFits } from './roles';
import { missionLock } from './missions';
import { exportCrew, fixedReason } from './creator';
import {
  hereOf,
  byId,
  bountyOf,
  crewLedBy,
  crewLimit,
  kindOf,
  memberRecord,
  placeName,
  renderCrew,
  roleName,
  withBody,
} from './state';
import { bailOf, listingsAt, priceOf } from './world';

/**
 * What the Crew page and a recruit's profile show (Phase 8). Views read and never write (rule 7,
 * and Phase 7's lesson): hearts are read with `heartOrRoll`, ties with `pairOf(..., false)`. A
 * recruit's profile shows only what the player has learned (rule 4): a stranger's stats are
 * estimates in words, sharpened by the player's Perception, Intellect and Observation and by time
 * together; a crewmate's are exact. Omniscient views show everything.
 */

const words = (n: number, bands: readonly [number, string][]): string =>
  bands.find(([min]) => n >= min)?.[1] ?? bands[bands.length - 1]?.[1] ?? '';

const BAR_WORDS: [number, string][] = [
  [85, 'unshakable'],
  [65, 'steadfast'],
  [45, 'solid'],
  [25, 'wavering'],
  [-1000, 'ready to go'],
];
const MORALE_WORDS: [number, string][] = [
  [80, 'high spirits'],
  [60, 'in good heart'],
  [40, 'getting by'],
  [22, 'grumbling'],
  [-1000, 'close to breaking'],
];
const STAT_WORDS: [number, string][] = [
  [90, 'extraordinary'],
  [70, 'formidable'],
  [55, 'strong'],
  [40, 'able'],
  [25, 'ordinary'],
  [-1000, 'weak'],
];

function date(data: GameData, tick: number): string {
  return formatDate(dateOf(data.calendar, tick));
}

// ---- A recruit's profile -------------------------------------------------------------------------

export interface StatGuess {
  id: string;
  label: string;
  /** Exact (crewmates, omniscient), or null for a stranger. */
  value: number | null;
  words: string;
}

export interface RecruitProfile {
  id: string;
  name: string;
  known: 'stranger' | 'acquaintance' | 'crewmate';
  /** How sharp the player's read of them is (0 to 100). */
  read: number;
  background: {
    born: string;
    age: number;
    race: string;
    job: string | null;
    family: string[];
    history: string | null;
    source: string | null;
  };
  stats: StatGuess[];
  combat: string;
  potential: string;
  traits: string[];
  nature: string[];
  values: string[];
  dream: string | null;
  fits: { role: string; name: string; score: number; words: string; reasons: string[] }[];
  powers: string[];
  status: {
    bounty: number;
    epithet: string | null;
    crew: string | null;
    captain: string | null;
    debt: boolean;
    hunted: boolean;
    loyalty: number | null;
  };
  ties: { name: string; how: string }[];
  secret: string | null;
  joining: {
    lock: string | null;
    listening: boolean;
    refused: string | null;
    pitches: {
      id: string;
      name: string;
      text: string;
      chance: number;
      words: string;
      tried: boolean;
      berries: number;
    }[];
    objections: {
      id: string;
      line: string;
      answers: { id: string; label: string; kind: string; amount: number }[];
    }[];
    quest: {
      name: string;
      tracker: string;
      met: boolean;
      acts: { id: string; label: string; lock: string | null }[];
    } | null;
    inCrew: boolean;
  };
}

/** How well the player reads people: Perception, Intellect, Observation, and months known. */
function readOf(player: Entity, monthsKnown: number, tick: number): number {
  const obs = player.character?.powers?.tracks['track_observation'];
  return Math.max(
    0,
    Math.min(
      100,
      statTotal(player, 'perception', tick) * 0.5 +
        statTotal(player, 'intellect', tick) * 0.25 +
        (obs ? (obs.stage + 1) * 8 : 0) +
        Math.min(30, monthsKnown * 2),
    ),
  );
}

function chanceWords(chance: number): string {
  return chance >= 0.85
    ? 'almost certain'
    : chance >= 0.65
      ? 'likely'
      : chance >= 0.4
        ? 'even odds'
        : chance >= 0.2
          ? 'unlikely'
          : 'a long shot';
}

export function recruitView(
  state: WorldState,
  data: GameData,
  id: string,
  omniscient: boolean,
): RecruitProfile | null {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const stored = state.entities[id];
  const c = stored?.character;
  if (!player?.character || !stored || !c) return null;
  const tick = state.tick;
  const other = withBody(data, stored, tick);
  const crewEnt = crewLedBy(state, player);
  const member = crewEnt?.crew ? memberRecord(crewEnt.crew, id) : undefined;
  const mine = relOf(player, id);
  const monthsKnown = mine ? Math.max(0, tick - mine.sinceTick) : 0;
  const known: RecruitProfile['known'] = member ? 'crewmate' : mine ? 'acquaintance' : 'stranger';
  const exact = omniscient || known === 'crewmate';
  const read = exact ? 100 : readOf(player, monthsKnown, tick);
  const rng = Rng.root(`read:${id}`);
  const heart = heartOrRoll(state, data, other);
  const person = personOf(data, other);
  const occupation = c.occupation ? (data.occupations[c.occupation]?.name ?? null) : null;
  const stats: StatGuess[] = STAT_IDS.filter((s) => s !== 'luck' || omniscient).map((s) => {
    const v = statTotal(other, s, tick);
    if (exact)
      return { id: s, label: statLabel(s), value: Math.round(v), words: words(v, STAT_WORDS) };
    // A stranger's numbers are a guess: the sharper the read, the closer.
    const margin = Math.max(3, 28 - read * 0.25);
    const guess = v + rng.fork(s).float(-1, 1) * margin;
    const w = words(guess, STAT_WORDS);
    return {
      id: s,
      label: statLabel(s),
      value: null,
      words:
        occupation && (w === 'strong' || w === 'able')
          ? `${w}, for ${/^[aeiou]/i.test(occupation) ? 'an' : 'a'} ${occupation.toLowerCase()}`
          : w,
    };
  });
  const cp = combatPowerOf(data, other, tick);
  const myCp = combatPowerOf(data, player, tick);
  const ratio = cp / Math.max(1, myCp);
  const combat = exact
    ? `Combat Power ${Math.round(cp)}`
    : ratio > 1.6
      ? 'far stronger than you'
      : ratio > 1.15
        ? 'stronger than you'
        : ratio > 0.85
          ? 'about your match'
          : ratio > 0.5
            ? 'weaker than you'
            : 'no match for you';
  const talent = c.hidden?.talent;
  const tier = data.character.talentTiers.find((t) => t.id === talent);
  const potential =
    omniscient && tier
      ? `${tier.name} (hidden)`
      : tier && tier.id !== 'ordinary' && read >= 45
        ? (tier.hints.older[0] ?? 'There is something more in them.')
        : other.flags['legend'] !== undefined
          ? 'Your gut says this one is like nobody you have met.'
          : 'Your gut says nothing either way.';
  const traits =
    known === 'stranger' && !omniscient
      ? c.traits
          .filter((t) => data.traits[t]?.kind === 'innate' || data.traits[t]?.kind === 'scar')
          .map((t) => data.traits[t]?.name ?? t)
      : monthsKnown >= 2 || exact
        ? c.traits.map((t) => data.traits[t]?.name ?? t)
        : c.traits.slice(0, 2).map((t) => data.traits[t]?.name ?? t);
  const family: string[] = [];
  const ties: { name: string; how: string }[] = [];
  for (const r of c.relationships) {
    const e = state.entities[r.id];
    if (!e || e.id === player.id) continue;
    if (r.kind === 'parent' || r.kind === 'child' || r.kind === 'sibling')
      family.push(`${e.name} (${r.kind}${e.character?.alive === false ? ', dead' : ''})`);
    else if (
      (r.kind === 'rival' ||
        r.kind === 'sweetheart' ||
        r.kind === 'mentor' ||
        r.kind === 'former') &&
      (exact || monthsKnown >= 3)
    )
      ties.push({
        name: e.name,
        how:
          r.kind === 'sweetheart'
            ? 'their love'
            : r.kind === 'former'
              ? 'a former love'
              : `their ${r.kind}`,
      });
  }
  const npcCrew = c.npc?.crewId ? state.entities[c.npc.crewId] : undefined;
  if (npcCrew) ties.push({ name: npcCrew.name, how: 'their crew' });
  const powers: string[] = [];
  const seen = exact || player.character.fights?.against[id] !== undefined;
  if (seen)
    for (const [tid, ts] of Object.entries(c.powers?.tracks ?? {}).sort()) {
      const t = data.tracks[tid];
      if (t) powers.push(`${t.name}: ${t.stages[ts.stage]?.name ?? ''}`);
    }
  const fruit = c.powers?.fruit ? state.entities[c.powers.fruit.id] : undefined;
  if (fruit && (exact || fruit.knownBy.includes('*') || fruit.knownBy.includes(player.id)))
    powers.push(`Ate the ${fruitDefOf(data, fruit)?.name ?? 'a Devil Fruit'}`);
  const secretDef = c.secret
    ? data.crew.recruit.secrets.find((s) => s.id === c.secret?.id)
    : undefined;
  const secret =
    c.secret && secretDef
      ? c.secret.found || omniscient
        ? renderCrew(state, data, crewEnt, other, secretDef.text, rng.fork('secret'))
        : read >= 60 && monthsKnown >= 6
          ? 'There is more to them than they say.'
          : null
      : null;
  const r = c.recruit;
  const lock = member ? 'In your crew' : pitchLock(state, data, player, other);
  const pitches = data.crew.recruit.pitches.map((pd) => {
    const chance = pitchChance(data, pitchParts(state, data, player, other, pd.id));
    return {
      id: pd.id,
      name: pd.name,
      text: pd.text,
      chance,
      words: chanceWords(chance),
      tried: r?.pitched.includes(pd.id) ?? false,
      berries: pd.berries,
    };
  });
  const objections = r?.listening
    ? openObjections(state, data, player, other).map((oid) => {
        const def = byId(data.crew.recruit.objections, oid);
        return {
          id: oid,
          line: def
            ? renderCrew(state, data, crewEnt, other, def.line, rng.fork('objection', oid))
            : oid,
          answers: (def?.answers ?? []).map((a) => ({
            id: a.id,
            label: a.label,
            kind: a.kind,
            amount: a.amount,
          })),
        };
      })
    : [];
  const cond = r?.quest ? data.conditions[r.quest.id] : undefined;
  const age = person ? humanAgeOf(data, person, tick) : 0;
  const theirs = relOf(other, player.id);
  return {
    id,
    name: other.name,
    known,
    read: Math.round(read),
    background: {
      born: data.birthplaces[c.birthplace]?.name ?? c.birthplace,
      age: Math.max(0, Math.floor((tick - c.birthTick) / 12)),
      race: data.races[c.race]?.name ?? c.race,
      job: occupation,
      family: exact || monthsKnown >= 2 ? family : family.slice(0, 1),
      history: c.backstory ?? null,
      source:
        typeof other.flags['recruit.source'] === 'string'
          ? (other.flags['recruit.source'] as string)
          : null,
    },
    stats,
    combat,
    potential,
    traits,
    nature: axisWords(data, heart.profile),
    values: heart.profile.values.map((v) => data.heart.values.find((x) => x.id === v)?.name ?? v),
    dream: exact || monthsKnown >= 4 ? dreamText(data, heart.profile) : null,
    fits: roleFits(data, other, tick, member?.mastery ?? {})
      .slice(0, 5)
      .map((f) => ({
        role: f.role,
        name: roleName(data, f.role),
        score: exact ? f.score : Math.round(f.score / 10) * 10,
        words: f.words,
        reasons: f.reasons,
      })),
    powers,
    status: {
      bounty: bountyOf(other),
      epithet:
        typeof other.flags['epithet'] === 'string' ? (other.flags['epithet'] as string) : null,
      crew: npcCrew?.name ?? (member ? (crewEnt?.name ?? null) : null),
      captain: npcCrew?.org?.leaderId ? (state.entities[npcCrew.org.leaderId]?.name ?? null) : null,
      debt: other.flags['recruit.debt'] === true,
      hunted: bountyOf(other) > 0,
      loyalty:
        member && theirs
          ? Math.round(readBar(data, theirs, 'crewmate', 'loyalty', tick))
          : npcCrew && (exact || monthsKnown >= 3)
            ? npcCrewLoyalty(other)
            : null,
    },
    ties,
    secret,
    joining: {
      lock,
      listening: r?.listening ?? false,
      refused: r?.refused !== null && r?.refused !== undefined ? date(data, r.refused) : null,
      pitches,
      objections,
      quest:
        r?.quest && cond
          ? {
              name: cond.name,
              tracker: questText(state, data, other) ?? cond.name,
              met: questMet(state, data, player, other),
              acts: questActs(state, data, player, other),
            }
          : null,
      inCrew: member !== undefined,
    },
  };
  void age;
  void together;
  void pairOf;
  void axisValue;
  void objectionsFor;
}

// ---- The crew page -------------------------------------------------------------------------------

export interface PostView {
  situation: CrewSituation;
  id: string;
  name: string;
  role: string;
  roleName: string;
  who: string | null;
  whoName: string | null;
  hands: boolean;
  score: number;
  words: string;
  share: number;
  double: boolean;
  empty: boolean;
  locked: boolean;
  problem: string | null;
  effects: string[];
  emptyText: string;
  x: number;
  y: number;
  /** Everyone who could stand it, with their fit (best first), for the picker. */
  options: { id: string; name: string; score: number; words: string }[];
}

export interface CrewMemberView {
  id: string;
  name: string;
  role: string;
  roleName: string;
  officer: boolean;
  rank: string | null;
  division: number | null;
  joined: string;
  months: number;
  loyalty: number;
  morale: number;
  belonging: number;
  respect: number;
  loyaltyWords: string;
  hurt: boolean;
  away: string | null;
  bound: string | null;
  bounty: number;
  epithet: string | null;
  titles: string[];
  pinned: boolean;
  stats: Record<string, number>;
  cp: number;
  fits: { role: string; name: string; score: number; words: string }[];
  mastery: Record<string, number>;
  plan: {
    focus: string;
    focusName: string;
    effort: string;
    partner: string | null;
    partnerName: string | null;
  };
  arcs: { name: string; step: number; steps: number; done: boolean }[];
  taught: string[];
  chemistry: { id: string; name: string; score: number; words: string }[];
  fruitRefusal: string | null;
  spy: string | null;
  missions: { id: string; lock: string | null }[];
}

export interface CandidateBrief {
  id: string;
  name: string;
  age: number;
  race: string;
  job: string | null;
  source: string;
  estimate: string;
  best: string;
  price: number | null;
  lock: string | null;
}

export interface CrewView {
  /** The creator's choices, whether or not a crew exists yet. */
  options: {
    kinds: {
      id: string;
      name: string;
      noun: string;
      mark: string;
      leader: string;
      outlaw: boolean;
      defaultName: string;
      fixed: { command: string | null; structure: string | null; pay: string | null };
      defaults: { command: string; structure: string; pay: string; creed: Record<string, string> };
    }[];
    creed: { id: string; name: string; options: { id: string; name: string; text: string }[] }[];
    commands: { id: string; name: string; text: string }[];
    structures: { id: string; name: string; text: string }[];
    pays: { id: string; name: string; text: string }[];
    missions: { id: string; name: string; text: string; target: string; months: string }[];
    baseKinds: { id: string; name: string; text: string; cost: number; lock: string | null }[];
    rooms: { id: string; name: string; text: string; cost: number; upkeep: number }[];
    orders: { id: string; name: string; text: string; target: string }[];
    pitches: { id: string; name: string; text: string }[];
    focuses: { id: string; name: string }[];
  };
  crew: {
    id: string;
    name: string;
    kind: string;
    kindName: string;
    noun: string;
    mark: string;
    leader: string;
    symbol: string;
    colours: string;
    dress: string;
    creed: { rule: string; ruleName: string; option: string; optionName: string; text: string }[];
    command: string;
    commandName: string;
    structure: string;
    structureName: string;
    pay: string;
    payName: string;
    home: string;
    founded: string;
    morale: number;
    moraleWords: string;
    treasury: number;
    unpaid: number;
    limit: number;
    limitParts: { source: string; value: number }[];
    size: number;
    totalBounty: number;
    tally: Record<string, number>;
    traditions: { name: string; since: string }[];
    log: { date: string; text: string }[];
    members: CrewMemberView[];
    former: { name: string; date: string; why: string }[];
    posts: Record<CrewSituation, PostView[]>;
    situationNow: CrewSituation;
    auto: boolean;
    fleet: {
      crew: string;
      name: string;
      captain: string;
      loyalty: number;
      ambition: number;
      order: string;
      target: string | null;
    }[];
    alliances: { captain: string; goal: string; status: string; since: string }[];
    bases: {
      id: string;
      name: string;
      kind: string;
      place: string;
      defence: number;
      rooms: { id: string; name: string; level: number }[];
      lastRaid: string | null;
    }[];
    prisoners: {
      id: string;
      name: string;
      since: string;
      where: string;
      ransom: number;
      interrogated: boolean;
    }[];
    prisonRoom: number;
    divisions: { name: string; commander: string | null }[];
    fixed: { command: string | null; structure: string | null; pay: string | null };
  } | null;
  recruits: {
    here: string | null;
    /** The place's id (for orders that point at it). */
    hereId: string | null;
    board: CandidateBrief[];
    prison: CandidateBrief[];
    auction: CandidateBrief[];
    /** Pitched and listening, or with a quest open. */
    open: { id: string; name: string; state: string; tracker: string | null }[];
    legends: { id: string; name: string; where: string; found: boolean }[];
  };
  people: { date: string; text: string }[];
  ships: { id: string; name: string }[];
  captains: { id: string; name: string; lock: string | null }[];
}

function brief(
  state: WorldState,
  data: GameData,
  player: Entity,
  id: string,
  source: string,
  price: number | null,
): CandidateBrief | null {
  const e = state.entities[id];
  const c = e?.character;
  if (!e || !c) return null;
  const fits = roleFits(data, e, state.tick);
  const ratio =
    combatPowerOf(data, e, state.tick) / Math.max(1, combatPowerOf(data, player, state.tick));
  return {
    id,
    name: e.name,
    age: Math.max(0, Math.floor((state.tick - c.birthTick) / 12)),
    race: data.races[c.race]?.name ?? c.race,
    job: c.occupation ? (data.occupations[c.occupation]?.name ?? null) : null,
    source,
    estimate:
      ratio > 1.15
        ? 'looks stronger than you'
        : ratio > 0.85
          ? 'looks your match'
          : 'looks weaker than you',
    best: `${roleName(data, fits.find((f) => f.role !== 'captain')?.role ?? 'hand')} (${fits.find((f) => f.role !== 'captain')?.words ?? ''})`,
    price,
    lock: pitchLock(state, data, player, e),
  };
}

export function crewView(state: WorldState, data: GameData, omniscient: boolean): CrewView | null {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const pc = player?.character;
  if (!player || !pc?.alive) return null;
  const tick = state.tick;
  const vars = { ...storyVars(state, data), 'player.familyName': pc.familyName || pc.givenName };
  const crewEnt = crewLedBy(state, player);
  const crew = crewEnt?.crew;
  const options: CrewView['options'] = {
    kinds: data.crew.kinds.map((k) => ({
      id: k.id,
      name: k.name,
      noun: k.noun,
      mark: k.mark,
      leader: k.leader,
      outlaw: k.outlaw,
      defaultName: renderTemplate(k.defaultName, vars),
      fixed: {
        command: k.fixed.command ?? null,
        structure: k.fixed.structure ?? null,
        pay: k.fixed.pay ?? null,
      },
      defaults: { ...k.defaults, creed: { ...k.defaults.creed } },
    })),
    creed: data.crew.creed.map((r) => ({
      id: r.id,
      name: r.name,
      options: r.options.map((o) => ({ id: o.id, name: o.name, text: o.text })),
    })),
    commands: data.crew.commands.map((x) => ({ id: x.id, name: x.name, text: x.text })),
    structures: data.crew.structures.map((x) => ({ id: x.id, name: x.name, text: x.text })),
    pays: data.crew.pays.map((x) => ({ id: x.id, name: x.name, text: x.text })),
    missions: data.crew.missions.map((m) => ({
      id: m.id,
      name: m.name,
      text: m.text,
      target: m.target,
      months:
        m.months.min === m.months.max ? `${m.months.min}` : `${m.months.min} to ${m.months.max}`,
    })),
    baseKinds: data.crew.bases.kinds.map((k) => ({
      id: k.id,
      name: k.name,
      text: k.text,
      cost: k.cost,
      lock: crew ? null : 'You lead no crew',
    })),
    rooms: data.crew.bases.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      text: r.text,
      cost: r.cost,
      upkeep: r.upkeep,
    })),
    orders: data.crew.fleet.orders.map((o) => ({
      id: o.id,
      name: o.name,
      text: o.text,
      target: o.target,
    })),
    pitches: data.crew.recruit.pitches.map((p) => ({ id: p.id, name: p.name, text: p.text })),
    focuses: [
      ...STAT_IDS.filter((s) => s !== 'luck').map((s) => ({ id: s, name: statLabel(s) })),
      ...Object.values(data.tracks)
        .filter((t) => t.family === 'style' || t.family === 'sword' || t.family === 'six_powers')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id, name: t.name })),
    ],
  };
  // Base kinds' locks need the place (computed here so the page shows why).
  if (crew) {
    const place = hereOf(data, player);
    const loc = place ? data.locations[place] : undefined;
    for (const k of options.baseKinds) {
      const def = byId(data.crew.bases.kinds, k.id);
      k.lock = !loc
        ? 'Claim a base ashore'
        : crew.bases.some((b) => b.place === place)
          ? 'You have a base here already'
          : def?.needs.find((f) => !loc.features.includes(f))
            ? `It needs ${def.needs.find((f) => !loc.features.includes(f))?.replace(/_/g, ' ')} here`
            : pc.berries < (def?.cost ?? 0)
              ? `It costs ${(def?.cost ?? 0).toLocaleString('en-GB')} Berries`
              : null;
    }
  }
  const here = hereOf(data, player);
  const lists = here ? listingsAt(state, here) : { board: [], prison: [], auction: [] };
  const recruits: CrewView['recruits'] = {
    here: here ? placeName(data, here) : null,
    hereId: here,
    board: lists.board
      .map((id) =>
        brief(
          state,
          data,
          player,
          id,
          String(state.entities[id]?.flags['recruit.source'] ?? 'board'),
          null,
        ),
      )
      .filter((x): x is CandidateBrief => x !== null),
    prison: lists.prison
      .map((id) => {
        const e = state.entities[id];
        return e ? brief(state, data, player, id, 'prison', bailOf(data, e, tick)) : null;
      })
      .filter((x): x is CandidateBrief => x !== null),
    auction: lists.auction
      .map((id) => {
        const e = state.entities[id];
        return e ? brief(state, data, player, id, 'auction', priceOf(data, e, tick)) : null;
      })
      .filter((x): x is CandidateBrief => x !== null),
    open: pc.relationships
      .map((r) => state.entities[r.id])
      .filter(
        (e): e is Entity =>
          e?.character?.alive === true &&
          (e.character.recruit?.listening === true ||
            e.character.recruit?.quest?.status === 'open') &&
          e.flags['crew.of'] !== player.id,
      )
      .map((e) => ({
        id: e.id,
        name: e.name,
        state: e.character?.recruit?.quest?.status === 'open' ? 'asked for something' : 'listening',
        tracker: questText(state, data, e),
      })),
    legends: (state.crews?.legends ?? [])
      .map((id) => state.entities[id])
      .filter(
        (e): e is Entity =>
          e !== undefined &&
          (omniscient || e.flags['legend.heard'] === true || e.flags['legend.found'] === true),
      )
      .map((e) => ({
        id: e.id,
        name:
          e.flags['legend.found'] === true || omniscient
            ? e.name
            : (data.crew.recruit.legends.kinds.find((k) => k.id === e.flags['legend'])?.name ??
              'Someone'),
        where: placeName(data, e.character?.place ?? null),
        found: e.flags['legend.found'] === true,
      })),
  };
  const known = new Set(pc.relationships.map((r) => r.id));
  const people = state.log
    .filter(
      (r) =>
        (r.tags.includes('people') || r.kind === 'death' || r.tags.includes('marriage')) &&
        (r.knownBy.includes(player.id) || r.knownBy.includes('*') || omniscient) &&
        r.actorIds.some((a) => known.has(a)),
    )
    .slice(-30)
    .reverse()
    .map((r) => ({ date: date(data, r.tick), text: r.summary }));
  const ships = Object.values(state.entities)
    .filter((e) => e.ship?.ownerId === player.id && !e.ship.sunk)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({ id: e.id, name: e.name }));
  const captains = pc.relationships
    .map((r) => state.entities[r.id])
    .filter(
      (e): e is Entity =>
        e?.character?.alive === true &&
        Object.values(state.entities).some(
          (o) => o.org?.active && o.org.leaderId === e.id && !o.crew,
        ),
    )
    .map((e) => ({ id: e.id, name: e.name, lock: null as string | null }));
  if (!crew || !crewEnt) return { options, crew: null, recruits, people, ships, captains };

  const kind = kindOf(data, crew);
  const { limit, parts } = crewLimit(state, data, player, crew);
  const membersView: CrewMemberView[] = [];
  const crewEntities = crew.members
    .map((m) => state.entities[m.id])
    .filter((e): e is Entity => e?.character?.alive === true);
  for (const m of crew.members) {
    const e = state.entities[m.id];
    if (!e?.character?.alive) continue;
    const theirs = relOf(e, player.id);
    const bar = (id: string) =>
      theirs ? Math.round(readBar(data, theirs, 'crewmate', id, tick)) : 0;
    const plan = m.plan ?? {
      focus:
        Object.entries(byId(data.crew.roles, m.role)?.stats ?? {}).sort(
          (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
        )[0]?.[0] ?? 'strength',
      effort: 'normal' as const,
      partner: null,
    };
    const stats: Record<string, number> = {};
    for (const s of STAT_IDS) if (s !== 'luck') stats[s] = Math.round(statTotal(e, s, tick));
    membersView.push({
      id: m.id,
      name: e.name,
      role: m.role,
      roleName: roleName(data, m.role),
      officer: m.officer,
      rank: kind.ranks.length > 0 ? (kind.ranks[m.rank] ?? null) : null,
      division: m.division,
      joined: date(data, m.joined),
      months: tick - m.joined,
      loyalty: bar('loyalty'),
      morale: bar('morale'),
      belonging: bar('belonging'),
      respect: bar('respect'),
      loyaltyWords: words(bar('loyalty'), BAR_WORDS),
      hurt: m.hurtUntil !== null && m.hurtUntil > tick,
      away: m.away
        ? `${byId(data.crew.missions, m.away.mission)?.name ?? m.away.mission} (back ${date(data, m.away.until)})`
        : null,
      bound: m.bound ? placeName(data, m.bound) : null,
      bounty: bountyOf(e),
      epithet: typeof e.flags['epithet'] === 'string' ? (e.flags['epithet'] as string) : null,
      titles: m.titles,
      pinned: m.pinned,
      stats,
      cp: Math.round(combatPowerOf(data, e, tick)),
      fits: roleFits(data, e, tick, m.mastery)
        .slice(0, 4)
        .map((f) => ({
          role: f.role,
          name: roleName(data, f.role),
          score: f.score,
          words: f.words,
        })),
      mastery: Object.fromEntries(Object.entries(m.mastery).map(([k, v]) => [k, Math.round(v)])),
      plan: {
        focus: plan.focus,
        focusName: data.tracks[plan.focus]?.name ?? statLabel(plan.focus),
        effort: plan.effort,
        partner: plan.partner,
        partnerName: plan.partner ? (state.entities[plan.partner]?.name ?? null) : null,
      },
      arcs: m.arcs.map((a) => ({
        name: data.arcs[a.id]?.name ?? a.id,
        step: a.step,
        steps: data.arcs[a.id]?.steps.length ?? 0,
        done: a.done,
      })),
      taught: Object.entries(m.taught).map(
        ([t, by]) =>
          `${data.tracks[t]?.name ?? t} (from ${state.entities[by]?.name ?? 'a crewmate'})`,
      ),
      chemistry: crewEntities
        .filter((o) => o.id !== m.id)
        .map((o) => {
          const score = chemistry(state, data, e, o);
          return {
            id: o.id,
            name: o.name,
            score,
            words:
              score >= data.crew.chemistry.synergy
                ? 'synergy'
                : score <= data.crew.chemistry.friction
                  ? 'friction'
                  : 'easy',
          };
        }),
      fruitRefusal: null,
      spy:
        omniscient && typeof e.flags['spy.for'] === 'string'
          ? (state.entities[e.flags['spy.for'] as string]?.name ?? String(e.flags['spy.for']))
          : e.flags['spy.found'] === true
            ? 'caught spying'
            : null,
      missions: data.crew.missions.map((mi) => ({
        id: mi.id,
        lock:
          missionLock(
            state,
            data,
            player,
            m.id,
            mi.id,
            mi.target === 'none' ? null : 'needs-target',
          ) === 'Choose a place' ||
          missionLock(
            state,
            data,
            player,
            m.id,
            mi.id,
            mi.target === 'none' ? null : 'needs-target',
          ) === 'Choose someone'
            ? null
            : missionLock(
                state,
                data,
                player,
                m.id,
                mi.id,
                mi.target === 'none' ? null : 'needs-target',
              ),
      })),
    });
  }
  const posts = {} as Record<CrewSituation, PostView[]>;
  const candidates = [
    player,
    ...crewEntities.filter((e) => {
      const m = memberRecord(crew, e.id);
      return m && m.away === null;
    }),
  ];
  for (const situation of CREW_SITUATIONS) {
    posts[situation] = lineupOf(state, data, crew, player, situation).map((fill) => ({
      situation,
      id: fill.post.id,
      name: fill.post.name,
      role: fill.post.role,
      roleName: roleName(data, fill.post.role),
      who: fill.who,
      whoName: fill.who
        ? fill.who === player.id
          ? 'You'
          : (state.entities[fill.who]?.name ?? null)
        : null,
      hands: fill.hands,
      score: fill.score,
      words: fill.words,
      share: Math.round(fill.share * 100) / 100,
      double: fill.double,
      empty: fill.empty,
      locked: crew.locks[`${situation}:${fill.post.id}`] === true,
      problem: fill.problem,
      effects: fill.post.effects.map((e) =>
        effectWords(e.key, fill.empty ? e.empty : e.full * fill.share),
      ),
      emptyText: fill.post.emptyText,
      x: fill.post.x,
      y: fill.post.y,
      options: candidates
        .map((e) => {
          const role = byId(data.crew.roles, fill.post.role);
          const m = memberRecord(crew, e.id);
          const f = role
            ? roleFits(data, e, tick, m?.mastery ?? {}).find((x) => x.role === role.id)
            : undefined;
          return {
            id: e.id,
            name: e.id === player.id ? 'You' : e.name,
            score: f?.score ?? 0,
            words: f?.words ?? '',
          };
        })
        .sort((a, b) => b.score - a.score),
    }));
  }
  const pays = byId(data.crew.pays, crew.pay);
  const home =
    crew.home.kind === 'ship'
      ? (state.entities[crew.home.id ?? '']?.name ?? 'a ship')
      : crew.home.kind === 'base'
        ? (crew.bases.find((b) => b.id === crew.home.id)?.name ?? 'a base')
        : 'none';
  return {
    options,
    recruits,
    people,
    ships,
    captains,
    crew: {
      id: crewEnt.id,
      name: crewEnt.name,
      kind: crew.kind,
      kindName: kind.name,
      noun: kind.noun,
      mark: kind.mark,
      leader: kind.leader,
      symbol: crew.symbol,
      colours: crew.colours,
      dress: crew.dress,
      creed: data.crew.creed.map((rule) => {
        const o = rule.options.find((x) => x.id === crew.creed[rule.id]);
        return {
          rule: rule.id,
          ruleName: rule.name,
          option: o?.id ?? '',
          optionName: o?.name ?? '',
          text: o?.text ?? '',
        };
      }),
      command: crew.command,
      commandName: byId(data.crew.commands, crew.command)?.name ?? crew.command,
      structure: crew.structure,
      structureName: byId(data.crew.structures, crew.structure)?.name ?? crew.structure,
      pay: crew.pay,
      payName: pays?.name ?? crew.pay,
      home,
      founded: date(data, crew.foundedTick),
      morale: Math.round(crew.morale),
      moraleWords: words(crew.morale, MORALE_WORDS),
      treasury: crew.treasury,
      unpaid: crew.unpaid,
      limit,
      limitParts: parts,
      size: crew.members.length,
      totalBounty: crewEntities.reduce((n, e) => n + bountyOf(e), 0) + bountyOf(player),
      tally: { ...crew.tally },
      traditions: crew.traditions.map((t) => ({
        name: data.crew.traditions.find((x) => x.id === t.id)?.name ?? t.id,
        since: date(data, t.since),
      })),
      log: crew.log
        .slice(-40)
        .reverse()
        .map((l) => ({ date: date(data, l.tick), text: l.text })),
      members: membersView,
      former: crew.former
        .slice(-20)
        .reverse()
        .map((f) => ({ name: f.name, date: date(data, f.tick), why: f.why })),
      posts,
      situationNow: situationNow(player),
      auto: crew.auto,
      fleet: crew.fleet.map((f) => ({
        crew: f.crewId,
        name: state.entities[f.crewId]?.name ?? f.crewId,
        captain: state.entities[f.captainId]?.name ?? f.captainId,
        loyalty: Math.round(f.loyalty),
        ambition: Math.round(f.ambition),
        order: byId(data.crew.fleet.orders, f.order)?.name ?? f.order,
        target: f.target ? placeName(data, f.target) : null,
      })),
      alliances: crew.alliances.map((a) => ({
        captain: state.entities[a.captainId]?.name ?? a.captainId,
        goal:
          a.goal === 'reach'
            ? `reach ${placeName(data, a.target)}`
            : a.goal === 'defeat'
              ? `bring down ${state.entities[a.target ?? '']?.name ?? 'someone'}`
              : 'hold together',
        status: a.status,
        since: date(data, a.since),
      })),
      bases: crew.bases.map((b) => ({
        id: b.id,
        name: b.name,
        kind: byId(data.crew.bases.kinds, b.kind)?.name ?? b.kind,
        place: placeName(data, b.place),
        defence: Math.round(b.defence),
        rooms: Object.entries(b.rooms).map(([id, level]) => ({
          id,
          name: byId(data.crew.bases.rooms, id)?.name ?? id,
          level,
        })),
        lastRaid: b.lastRaid !== null ? date(data, b.lastRaid) : null,
      })),
      prisoners: crew.prisoners.map((x) => ({
        id: x.id,
        name: state.entities[x.id]?.name ?? x.id,
        since: date(data, x.since),
        where: x.where,
        ransom: x.ransom,
        interrogated: x.interrogated,
      })),
      prisonRoom: prisonRoom(state, data, player),
      divisions: crew.divisions.map((d) => ({
        name: d.name,
        commander: d.commanderId ? (state.entities[d.commanderId]?.name ?? null) : null,
      })),
      fixed: {
        command: fixedReason(data, crew.kind, 'command'),
        structure: fixedReason(data, crew.kind, 'structure'),
        pay: fixedReason(data, crew.kind, 'pay'),
      },
    },
  };
}

/** The crew file to save (the creator's export). */
export function crewExportText(state: WorldState): string | null {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const crewEnt = crewLedBy(state, player);
  if (!crewEnt?.crew) return null;
  return exportCrewText(state, crewEnt);
}

function exportCrewText(state: WorldState, crewEnt: Entity): string {
  const members = (crewEnt.crew?.members ?? [])
    .map((m) => state.entities[m.id])
    .filter((e): e is Entity => e !== undefined);
  return exportCrew(crewEnt, members);
}

/** A small summary for the masthead and the snapshot. */
export interface CrewBrief {
  name: string;
  size: number;
  morale: number;
  listening: number;
}

export function crewBrief(state: WorldState): CrewBrief | null {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const crewEnt = crewLedBy(state, player);
  if (!player?.character || !crewEnt?.crew) return null;
  return {
    name: crewEnt.name,
    size: crewEnt.crew.members.length,
    morale: Math.round(crewEnt.crew.morale),
    listening: player.character.relationships.filter(
      (r) => state.entities[r.id]?.character?.recruit?.quest?.status === 'open',
    ).length,
  };
}

export { reputationValue, situationNow };
