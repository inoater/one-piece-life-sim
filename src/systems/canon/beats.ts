import { dateOf, templateVarsFor } from '../../engine/calendar';
import {
  tickOfWhen,
  type Anchor,
  type Beat,
  type BeatEffect,
  type GameData,
} from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import { dpow } from '../../engine/dmath';
import type { BeatState, Divergence, Entity, WorldState } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { combatPowerOf, ensureLife } from '../life/body';
import { shortestMiles, withDevFixtures } from '../places/graph';
import { factionChange, prosperityChange, setControl } from '../story/world-effects';
import { roleVars } from '../story/roles';
import { canonLine, cutoffTick, divergeCharacter, keyframeAt, killCharacter } from './cast';
import { spawnDueFactions } from '../places/setup';

/**
 * Canon beats (Phase 3): the famous events of the story, from data/canon. Each month (step 5,
 * before any other event) every beat whose window has opened is considered:
 *
 *  1. If a beat it requires diverged, it diverges too (the cascade); if one has not happened yet,
 *     it waits.
 *  2. Its roles are filled: a dead role-holder is replaced by the first living substitute, or the
 *     beat is cancelled; one who is elsewhere travels to it if there is time (the beat is delayed,
 *     up to canon.json's `delayMonths`), or the beat is cancelled.
 *  3. The canon mode decides whether it happens this month: Canon fires hard (and soft) anchors on
 *     their date; Probable multiplies the ordinary chance by six; Random leaves it to chance.
 *  4. A player who is there can take part (the beat's choices; an instigator can stop it), or
 *     witnesses it; one sailing past sees it from the deck; everyone else reads the news.
 *
 * A beat that never comes to pass is a divergence: logged with its cause and tick in the Divergence
 * Log, its surviving role-holders leave the story (canon-diverged), and every beat that required
 * it is re-checked at once.
 */

export function windowOf(beat: Beat): { from: number; to: number } {
  return { from: tickOfWhen(beat.window.from), to: tickOfWhen(beat.window.to) };
}

export function beatState(state: WorldState, id: string): BeatState {
  return state.canon.beats[id] ?? { status: 'pending' };
}

export function modeRule(data: GameData, state: WorldState, anchor: Anchor) {
  const mode = data.canonRules.modes[state.config.canonMode] ?? data.canonRules.modes['canon'];
  return mode?.[anchor] ?? { certain: false, mult: 1 };
}

/**
 * The chance a month that a beat happens: its ordinary chance across the window, spread evenly
 * over the window's months, times the mode's multiplier.
 */
export function monthlyChance(data: GameData, state: WorldState, beat: Beat): number {
  const { from, to } = windowOf(beat);
  const months = to - from + 1;
  const total = beat.chance ?? data.canonRules.chance[beat.anchor];
  const base = total >= 1 ? 1 : 1 - dpow(1 - total, 1 / months);
  return Math.min(1, base * modeRule(data, state, beat.anchor).mult);
}

/** Beats in the order they are considered: by window, then id. Dev fixtures only in dev worlds. */
export function orderedBeats(state: WorldState, data: GameData): Beat[] {
  const dev = withDevFixtures(state);
  return Object.values(data.canon)
    .filter((b) => dev || !b.dev)
    .sort((a, b) => windowOf(a).from - windowOf(b).from || (a.id < b.id ? -1 : 1));
}

export interface BeatSite {
  state: WorldState;
  data: GameData;
  tick: number;
  rng: Rng;
  newsDrafts: NewsDraft[];
}

function vars(
  site: BeatSite,
  beat: Beat,
  cast: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const { data, state, tick } = site;
  const place = data.locations[beat.place];
  return {
    ...templateVarsFor(dateOf(data.calendar, tick)),
    'player.name': 'someone',
    'player.givenName': 'someone',
    'player.familyName': 'someone',
    'player.race': 'person',
    'player.home': 'home',
    'legacy.parent': 'a parent',
    'legacy.parentName': 'a parent',
    place: place?.name ?? beat.place,
    destination: place?.name ?? beat.place,
    ship: 'the ship',
    ...roleVars(state, data, cast),
    ...extra,
  };
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function render(site: BeatSite, beat: Beat, cast: Record<string, string>, text: string): string {
  return sentence(renderTemplate(text, vars(site, beat, cast)));
}

// ---- Effects ------------------------------------------------------------------------------------

function applyBeatEffects(
  site: BeatSite,
  effects: readonly BeatEffect[],
  cast: Record<string, string>,
  causeSeq: number,
): void {
  const { state, data, tick } = site;
  for (const effect of effects) {
    const holder = 'role' in effect ? state.entities[cast[effect.role] ?? ''] : undefined;
    switch (effect.kind) {
      case 'death':
        if (holder)
          killCharacter(state, data, holder, {
            tick,
            canon: true,
            cause: effect.cause,
            causeSeq,
            newsDrafts: site.newsDrafts,
          });
        break;
      case 'imprison':
        if (holder?.character) {
          holder.character.place = effect.place;
          holder.flags['status'] = 'imprisoned';
        }
        break;
      case 'move':
        if (holder?.character) holder.character.place = effect.place;
        break;
      case 'affiliation':
        if (holder) holder.flags['affiliation'] = effect.org;
        break;
      case 'bounty':
        if (holder) holder.flags['bounty'] = effect.value;
        break;
      case 'control':
        setControl(state, effect.place, effect.org);
        break;
      case 'faction':
        factionChange(
          state,
          effect.org,
          { strength: effect.strength, opinion: effect.opinion },
          effect.source,
          tick,
          effect.months,
        );
        break;
      case 'crew': {
        spawnDueFactions(state, data, tick);
        const org = state.entities[effect.org]?.org;
        if (org) {
          org.active = effect.active;
          org.endedTick = effect.active ? null : tick;
        }
        break;
      }
      case 'flag':
        state.flags[effect.flag] = effect.value;
        break;
      case 'prosperity':
        prosperityChange(state, effect.place, effect.value, effect.source, tick, effect.months);
        break;
    }
  }
}

// ---- Roles --------------------------------------------------------------------------------------

type RoleProblem =
  | { kind: 'dead'; role: string; char: string }
  | { kind: 'away'; role: string; char: string; months: number };

interface Casting {
  cast: Record<string, string>;
  substituted: { role: string; char: string; by: string }[];
  problem: RoleProblem | null;
  /** Role-holders who are elsewhere but can get there: the longest trip. */
  travel: { months: number; ids: string[] };
}

function alive(state: WorldState, id: string): Entity | null {
  const e = state.entities[id];
  return e?.character?.alive ? e : null;
}

function castBeat(site: BeatSite, beat: Beat): Casting {
  const { state, data } = site;
  const out: Casting = { cast: {}, substituted: [], problem: null, travel: { months: 0, ids: [] } };
  for (const [role, ref] of Object.entries(beat.roles).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const chain = [ref.char, ...ref.substitutes];
    const holder = chain.map((id) => alive(state, id)).find((e) => e !== null) ?? null;
    if (!holder) {
      out.problem ??= { kind: 'dead', role, char: ref.char };
      continue;
    }
    out.cast[role] = holder.id;
    if (holder.id !== ref.char) out.substituted.push({ role, char: ref.char, by: holder.id });
    if (!ref.present) continue;
    const at = holder.character?.place;
    if (at === beat.place) continue;
    // Keyframes tell the story after each beat, so later in a beat's window its people may have
    // moved on. Someone still on the story's path is there if the story had them there when the
    // window opened.
    const story = data.cast[holder.id];
    if (
      holder.origin === 'canon' &&
      story &&
      keyframeAt(story, windowOf(beat).from)?.place === beat.place
    ) {
      continue;
    }
    const miles = at ? shortestMiles(data, at, beat.place) : Infinity;
    const months = Math.ceil(miles / data.canonRules.travelSpeed);
    if (!Number.isFinite(months)) {
      out.problem ??= { kind: 'away', role, char: holder.id, months: Infinity };
      continue;
    }
    out.travel.months = Math.max(out.travel.months, months);
    out.travel.ids.push(holder.id);
  }
  return out;
}

// ---- Firing and diverging -----------------------------------------------------------------------

type Involvement = 'participant' | 'instigator' | 'witness' | 'far' | 'spectator';

function involvement(site: BeatSite, beat: Beat): Involvement {
  const { state, data, tick } = site;
  const p = ensureLife(state, data);
  if (!p) return 'spectator';
  const voyage = p.c.travel?.voyage;
  if (voyage) return voyage.from === beat.place || voyage.to === beat.place ? 'far' : 'spectator';
  if (p.place.location?.id !== beat.place) return 'spectator';
  if (beat.choices.length === 0 || !beat.participate) return 'witness';
  const power = combatPowerOf(data, p.entity, tick);
  if (beat.instigate && power >= beat.instigate.combatPower) return 'instigator';
  if (power >= beat.participate.combatPower) return 'participant';
  return 'witness';
}

function logDivergence(state: WorldState, entry: Divergence): void {
  state.canon.divergences.push(entry);
}

/** The beat happens. */
export function fireBeat(
  site: BeatSite,
  beat: Beat,
  cast: Record<string, string>,
  how: Involvement,
  causeSeq?: number,
): void {
  const { state, data, tick } = site;
  const player = state.playerId;
  const present = how !== 'spectator' && player !== null;
  const record = appendLog(state, tick, {
    kind: 'canon',
    summary: render(site, beat, cast, beat.text),
    tags: ['canon', 'beat', 'world', ...beat.tags],
    actorIds: Object.values(cast),
    place: beat.place,
    cause: beat.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy: present ? [player] : [],
  });
  applyBeatEffects(site, beat.outcomes, cast, record.seq);
  if (present && player) {
    const line =
      how === 'far'
        ? data.travel.lines.witnessedAtSea
        : how === 'witness'
          ? data.canonRules.lines.witnessed
          : data.canonRules.lines.participant;
    const text =
      how === 'far'
        ? sentence(renderTemplate(line, { ...vars(site, beat, cast), title: beat.name }))
        : canonLine(data, line, tick, { beat: beat.name, place: vars(site, beat, cast).place });
    appendLog(state, tick, {
      kind: 'event',
      summary: text,
      tags: ['personal', 'canon', 'witness'],
      actorIds: [player],
      place: beat.place,
      cause: beat.id,
      causeSeq: record.seq,
      knownBy: [player],
    });
  }
  if (beat.news) {
    site.newsDrafts.push({
      text: render(site, beat, cast, beat.news),
      tags: ['news', 'canon', ...beat.tags],
      sourceSeq: record.seq,
      place: beat.place,
    });
  }
  state.canon.beats[beat.id] = { status: 'fired', tick, seq: record.seq, cast };
}

export type DivergeKind = Divergence['kind'];

/** The beat will not happen. Its survivors leave the story, and what required it follows. */
export function divergeBeat(
  site: BeatSite,
  beat: Beat,
  kind: DivergeKind,
  cause: string,
  cast: Record<string, string> = {},
  causeSeq?: number,
): void {
  const { state, data, tick } = site;
  const player = state.playerId;
  const summary = beat.divergeText
    ? render(site, beat, cast, beat.divergeText)
    : canonLine(
        data,
        kind === 'missed' ? data.canonRules.lines.missed : data.canonRules.lines.diverged,
        tick,
        { beat: beat.name, cause },
      );
  const record = appendLog(state, tick, {
    kind: 'canon',
    summary,
    tags: ['canon', 'divergence', 'world', ...beat.tags],
    actorIds: Object.values(cast),
    place: beat.place,
    cause: beat.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy: kind === 'player' && player ? [player] : [],
  });
  state.canon.beats[beat.id] = { status: 'diverged', tick, seq: record.seq, cast };
  logDivergence(state, {
    tick,
    kind,
    beat: beat.id,
    text: `${beat.name}: ${cause}.`,
    causeSeq: record.seq,
  });
  applyBeatEffects(site, beat.onDiverge, cast, record.seq);
  // When the story was broken (a role-holder lost, or the player's doing), the survivors leave it:
  // the people it was about, and the people it should have been about. A beat that simply never
  // came by chance, or fell with another, leaves everyone on the path they were on.
  if (kind === 'cancelled' || kind === 'player') {
    const ids = new Set([...Object.values(cast), ...Object.values(beat.roles).map((r) => r.char)]);
    for (const id of [...ids].sort()) {
      if (alive(state, id)) divergeCharacter(state, id);
    }
  }
  if (beat.divergeNews) {
    site.newsDrafts.push({
      text: render(site, beat, cast, beat.divergeNews),
      tags: ['news', 'canon', 'divergence'],
      sourceSeq: record.seq,
      place: beat.place,
    });
  }
  // The cascade: every pending beat that needed this one cannot happen either.
  for (const other of orderedBeats(state, data)) {
    if (!other.requires.includes(beat.id)) continue;
    if (beatState(state, other.id).status !== 'pending') continue;
    divergeBeat(site, other, 'requirement', `${beat.name} never happened`, {}, record.seq);
  }
}

/** A beat waiting on the player's choice: what they chose decides whether it happens. */
export function resolveBeatChoice(
  site: BeatSite,
  beat: Beat,
  cast: Record<string, string>,
  diverge: boolean,
  causeSeq: number,
): void {
  const how: Involvement = diverge ? 'instigator' : 'participant';
  if (diverge) {
    divergeBeat(site, beat, 'player', site.data.canonRules.lines.playerDiverged, cast, causeSeq);
  } else {
    fireBeat(site, beat, cast, how, causeSeq);
  }
}

// ---- The month ----------------------------------------------------------------------------------

/**
 * Consider every beat this month. Returns a beat that needs the player's decision before it can
 * resolve (the caller turns it into a pending decision), or null.
 */
export function runBeats(
  site: BeatSite,
): { beat: Beat; cast: Record<string, string>; instigator: boolean }[] {
  const { state, data, tick, rng } = site;
  const cutoff = cutoffTick(data);
  const delayMonths = data.canonRules.delayMonths;
  const waiting: { beat: Beat; cast: Record<string, string>; instigator: boolean }[] = [];
  for (const beat of orderedBeats(state, data)) {
    const st = beatState(state, beat.id);
    if (st.status !== 'pending') continue;
    const { from, to } = windowOf(beat);
    if (from > cutoff || tick < from) continue;
    if (state.pending.some((d) => d.beat && d.eventId === beat.id)) continue;

    // 1. What must come first.
    const required = beat.requires.map((id) => beatState(state, id).status);
    if (required.includes('diverged')) {
      divergeBeat(site, beat, 'requirement', data.canonRules.lines.requirement);
      continue;
    }
    if (required.includes('pending')) {
      if (tick > to + delayMonths)
        divergeBeat(site, beat, 'requirement', data.canonRules.lines.requirement);
      continue;
    }
    if (st.delayedTo !== undefined && tick < st.delayedTo) continue;

    // 2. Who is in it.
    const casting = castBeat(site, beat);
    if (casting.problem?.kind === 'dead') {
      const who = data.cast[casting.problem.char]?.name ?? casting.problem.char;
      divergeBeat(
        site,
        beat,
        'cancelled',
        canonLine(data, data.canonRules.lines.roleDead, tick, { name: who }),
        casting.cast,
      );
      continue;
    }
    if (casting.problem?.kind === 'away') {
      const who = state.entities[casting.problem.char]?.name ?? casting.problem.char;
      divergeBeat(
        site,
        beat,
        'cancelled',
        canonLine(data, data.canonRules.lines.roleAway, tick, { name: who }),
        casting.cast,
      );
      continue;
    }
    if (casting.travel.months > 0) {
      const arrive = tick + casting.travel.months;
      if (arrive > to + delayMonths) {
        const who = state.entities[casting.travel.ids[0] ?? '']?.name ?? 'Someone';
        divergeBeat(
          site,
          beat,
          'cancelled',
          canonLine(data, data.canonRules.lines.roleAway, tick, { name: who }),
          casting.cast,
        );
        continue;
      }
      // They set out: the beat waits for them.
      for (const id of casting.travel.ids) {
        const traveller = state.entities[id];
        if (traveller?.character) {
          traveller.character.place = beat.place;
          divergeCharacter(state, id);
        }
      }
      state.canon.beats[beat.id] = { status: 'pending', delayedTo: arrive };
      logDivergence(state, {
        tick,
        kind: 'delayed',
        beat: beat.id,
        text: canonLine(data, data.canonRules.lines.delayed, tick, {
          name: state.entities[casting.travel.ids[0] ?? '']?.name ?? 'Someone',
          beat: beat.name,
        }),
      });
      continue;
    }

    // 3. Whether it happens this month.
    const rule = modeRule(data, state, beat.anchor);
    const happens =
      rule.certain || rng.fork('beat', beat.id).chance(monthlyChance(data, state, beat));
    if (!happens) {
      if (tick >= to) divergeBeat(site, beat, 'missed', 'its hour came and went', casting.cast);
      continue;
    }

    for (const sub of casting.substituted) {
      logDivergence(state, {
        tick,
        kind: 'substituted',
        beat: beat.id,
        entity: sub.by,
        text: canonLine(data, data.canonRules.lines.substituted, tick, {
          name: state.entities[sub.by]?.name ?? sub.by,
          beat: beat.name,
        }),
      });
    }

    // 4. Who sees it.
    const how = involvement(site, beat);
    if (how === 'participant' || how === 'instigator') {
      waiting.push({ beat, cast: casting.cast, instigator: how === 'instigator' });
      continue;
    }
    fireBeat(site, beat, casting.cast, how);
  }
  return waiting;
}
