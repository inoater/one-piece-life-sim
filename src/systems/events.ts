import { dateOf, templateVarsFor, type DateInfo } from '../engine/calendar';
import type { GameData, Effect, EventDef, Location } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import type { NewsDraft, TickStep } from '../engine/pipeline';
import { PUBLIC_KNOWLEDGE, type EventRecord, type WorldState } from '../engine/state';
import { Rng } from '../engine/rng';
import { renderTemplate } from '../engine/template';
import { orderedBeats, resolveBeatChoice, runBeats, type BeatSite } from './canon/beats';
import type { BattleState } from '../engine/battle-state';
import type { CheckBand, FightSpec } from '../engine/data/schemas';
import { beginContest, beginFight, buildFight, resolveBattleDecision } from './battle/player';
import { onFightFinished } from './battle/finish-hooks';
import { ensureLife, isJailed, livingRelations, relationKind } from './life/body';
import { applyLifeEffect } from './life/effects';
import { firstImpressions } from './life/traits';
import type { LifeEnv } from './life/env';
import { relate } from './life/people';
import { locations, withDevFixtures } from './places/graph';
import { worldBuilt } from './places/setup';
import { locationIdOf, placeOf } from './places/place';
import { checkWhere } from './story/where';
import { playerStory, worldStory, type StoryCtx } from './story/context';
import { allHold } from './story/conditions';
import { rollCheck } from './story/checks';
import { castRoles, roleVars } from './story/roles';
import { candidates, pickEvents, rollCount, voyageRolls } from './story/select';
import {
  factionChange,
  localFlagActive,
  populationChange,
  prosperityChange,
  setControl,
  setLocalFlag,
} from './story/world-effects';

/**
 * Values for {player.*}, {legacy.*}, {place}, {destination} and {ship} in event text. A world with
 * no player (a debug world, or one made before Phase 1) still renders: the variables fall back to
 * neutral words.
 */
export function storyVars(state: WorldState, data: GameData): Record<string, string> {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const c = player?.character;
  const parentId = c?.family?.parentIds.find((id) => {
    const parent = state.entities[id];
    return parent !== undefined && typeof parent.flags['family.title'] === 'string';
  });
  const parent = parentId ? state.entities[parentId] : undefined;
  const pronouns = parent?.character?.pronouns;
  const birthplace = c ? data.birthplaces[c.birthplace] : undefined;
  const place = c && birthplace ? placeOf(data, c, birthplace) : null;
  const voyage = c?.travel?.voyage;
  const destination = voyage ? data.locations[voyage.to] : place?.location;
  const ship =
    voyage?.vessel?.name ??
    (voyage?.shipId ? state.entities[voyage.shipId]?.name : undefined) ??
    c?.travel?.lastShip ??
    'the ship';
  return {
    'player.name': player?.name ?? 'someone',
    'player.givenName': c?.givenName ?? player?.name ?? 'someone',
    'player.familyName': c?.familyName || c?.givenName || player?.name || 'someone',
    'player.race': c ? (data.races[c.race]?.name ?? c.race) : 'person',
    'player.home': birthplace?.home ?? 'home',
    'legacy.parent':
      pronouns === 'he' ? 'your father' : pronouns === 'she' ? 'your mother' : 'your parent',
    'legacy.parentName': parent?.name ?? 'your parent',
    place: place?.location?.name ?? place?.home ?? 'home',
    destination: destination?.home ?? destination?.name ?? 'somewhere',
    ship: ship.replace(/^the /, ''),
  };
}

/** Event text starts a sentence even when its first word comes from a variable ("your father ..."). */
function sentence(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Step 5: roll events. Canon beats first, then random events (Phase 3, the event engine).
 *
 *  1. Canon beats (canon/beats.ts): the famous events, pushed by the canon mode.
 *  2. Scheduled events that are due (chains, legacies, the debt collector, forced events).
 *  3. The player's events: arrival events the month they land; at sea, the voyage's events
 *     (1 roll plus the sea's danger modifier); ashore, 0 to 3 random events.
 *  4. World events: 0 to 3 a month, somewhere in the world, for the news.
 *
 * Events are chosen by `story/select.ts`; a choice can carry a skill check (`story/checks.ts`);
 * events cast people in roles (`story/roles.ts`). An event with choices stops every time skip
 * until the player decides.
 */

/** Remove repeats, keeping first-seen order: an event whose type is also one of its tags lists it once. */
function unique(tags: readonly string[]): string[] {
  return [...new Set(tags)];
}

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

export function scheduleEvent(
  state: WorldState,
  eventId: string,
  tick: number,
  source: string,
  causeSeq?: number,
): void {
  state.scheduled.push({ eventId, tick, source, ...(causeSeq !== undefined ? { causeSeq } : {}) });
}

interface EffectSite {
  tick: number;
  date: DateInfo;
  /** The event that caused these effects. */
  cause: string;
  /** The log record that caused them. */
  causeSeq: number;
  knownBy: string[];
  /** Where it happened (world effects default to here). */
  place: string | null;
  roles: Readonly<Record<string, string>>;
  newsDrafts?: NewsDraft[];
}

function textVars(
  state: WorldState,
  data: GameData,
  site: Pick<EffectSite, 'date' | 'place' | 'roles'>,
) {
  const vars = {
    ...templateVarsFor(site.date),
    ...storyVars(state, data),
    ...roleVars(state, data, site.roles),
  };
  if (site.place) {
    const loc = data.locations[site.place];
    if (loc) vars['place'] = loc.name;
  }
  return vars;
}

/**
 * Effects available to events and choices: log, setFlag, schedule; everything a month of life can
 * do to the player (money, injuries, traits, opinions, the vessel they are aboard...), applied
 * through the life loop; and (Phase 3) what an event does to the world: factions, territory,
 * prosperity, people, and the people it cast. Applied in order. Life effects need someone alive
 * to happen to; without a living player they are skipped. Their randomness is keyed to the
 * record that caused them.
 */
function applyEffects(
  state: WorldState,
  data: GameData,
  effects: readonly Effect[],
  site: EffectSite,
): void {
  const vars = textVars(state, data, site);
  effects.forEach((effect, index) => {
    switch (effect.kind) {
      case 'log':
        appendLog(state, site.tick, {
          kind: 'effect',
          summary: sentence(renderTemplate(effect.text, vars)),
          tags: unique(['effect', ...effect.tags]),
          cause: site.cause,
          causeSeq: site.causeSeq,
          knownBy: site.knownBy,
        });
        break;
      case 'setFlag':
        state.flags[effect.flag] = effect.value;
        break;
      case 'schedule':
        scheduleEvent(
          state,
          effect.eventId,
          site.tick + effect.afterMonths,
          `chain:${site.cause}`,
          site.causeSeq,
        );
        break;
      case 'faction':
        factionChange(
          state,
          effect.org,
          { strength: effect.strength, opinion: effect.opinion },
          effect.source,
          site.tick,
          effect.months,
        );
        break;
      case 'control': {
        const place = effect.location ?? site.place;
        if (place) setControl(state, place, effect.org);
        break;
      }
      case 'prosperity': {
        const place = effect.location ?? site.place;
        if (place)
          prosperityChange(state, place, effect.value, effect.source, site.tick, effect.months);
        break;
      }
      case 'population':
        if (site.place) populationChange(state, site.place, effect.pct);
        break;
      case 'localFlag':
        if (site.place)
          setLocalFlag(state, site.place, effect.flag, effect.value, site.tick, effect.months);
        break;
      case 'news':
        site.newsDrafts?.push({
          text: sentence(renderTemplate(effect.text, vars)),
          tags: ['news'],
          sourceSeq: site.causeSeq,
          ...(site.place ? { place: site.place } : {}),
        });
        break;
      case 'meet': {
        const p = ensureLife(state, data);
        const other = state.entities[site.roles[effect.role] ?? ''];
        if (!p || !other?.character || other.id === p.entity.id) break;
        const kind = relationKind(effect.as);
        if (livingRelations(state, p.c, kind).some((e) => e.id === other.id)) break;
        relate(
          p.entity,
          other,
          effect.as,
          effect.opinion,
          site.tick,
          Rng.root(state.seed).fork('meet', site.causeSeq, index),
        );
        firstImpressions(data, p.entity, other);
        break;
      }
      default: {
        const p = ensureLife(state, data);
        if (!p?.c.life) break;
        const env: LifeEnv = {
          state,
          data,
          tick: site.tick,
          rng: Rng.root(state.seed).fork('eventEffect', site.causeSeq, index),
          p,
          life: p.c.life,
          cause: site.cause,
          causeSeq: site.causeSeq,
        };
        applyLifeEffect(env, effect, { cast: {} });
      }
    }
  });
}

export interface FireContext {
  tick: number;
  date: DateInfo;
  newsDrafts: NewsDraft[];
  data: GameData;
}

export interface FireOptions {
  /** The story it happens in (defaults to the player's). */
  story?: StoryCtx;
  /** Who knows: defaults to everyone for public events (the player only for their own events). */
  knownBy?: string[];
  rng?: Rng;
}

function noteFired(state: WorldState, id: string, tick: number): void {
  const seen = state.eventState[id];
  state.eventState[id] = { last: tick, count: (seen?.count ?? 0) + 1 };
}

export function fireEvent(
  state: WorldState,
  def: EventDef,
  ctx: FireContext,
  causeSeq?: number,
  options: FireOptions = {},
): EventRecord {
  const story = options.story ?? playerStory(state, ctx.data, ctx.tick);
  const rng = options.rng ?? Rng.root(state.seed).fork('fire', def.id, ctx.tick);
  const roles = castRoles(story, def, rng.fork('roles'));
  const place = story.place?.location?.id ?? story.place?.id ?? null;
  const site = { date: ctx.date, place, roles };
  const vars = textVars(state, ctx.data, site);
  const knownBy = options.knownBy ?? (def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : []);
  noteFired(state, def.id, ctx.tick);
  const record = appendLog(state, ctx.tick, {
    kind: 'event',
    summary: sentence(renderTemplate(def.text, vars)),
    tags: unique([
      'event',
      def.type,
      ...(def.type === 'personal' || def.type === 'voyage' ? ['personal'] : []),
      ...def.tags,
    ]),
    actorIds: story.p ? [story.p.entity.id] : [],
    targetIds: Object.values(roles),
    place,
    cause: def.id,
    ...(causeSeq !== undefined ? { causeSeq } : {}),
    knownBy,
  });

  applyEffects(state, ctx.data, def.effects, {
    tick: ctx.tick,
    date: ctx.date,
    cause: def.id,
    causeSeq: record.seq,
    knownBy,
    place,
    roles,
    newsDrafts: ctx.newsDrafts,
  });

  if (def.news !== undefined) {
    ctx.newsDrafts.push({
      text: sentence(renderTemplate(def.news, vars)),
      tags: unique(['news', ...def.tags]),
      sourceSeq: record.seq,
      ...(place ? { place } : {}),
    });
  }

  const choices = def.choices.filter((c) => allHold(story, c.requires));
  if (choices.length > 0) {
    state.counters.decisionId += 1;
    state.pending.push({
      id: state.counters.decisionId,
      eventId: def.id,
      firedTick: ctx.tick,
      recordSeq: record.seq,
      title: def.title,
      text: record.summary,
      choices: choices.map((c) => ({
        id: c.id,
        label: sentence(renderTemplate(c.label, vars)),
        ...(c.text !== undefined ? { text: c.text } : {}),
      })),
      ...(Object.keys(roles).length > 0 ? { roles } : {}),
      ...(place ? { place } : {}),
    });
  }
  return record;
}

function dropDecision(
  state: WorldState,
  index: number,
  title: string,
  eventId: string,
  seq: number,
): void {
  state.pending.splice(index, 1);
  appendLog(state, state.tick, {
    kind: 'system',
    summary: `Decision "${title}" was dropped: "${eventId}" no longer exists in the data.`,
    tags: ['system', 'warning'],
    cause: 'sys:resolveDecision',
    causeSeq: seq,
  });
}

/**
 * Apply the player's choice to a pending decision. Effects count months from the current month
 * (`state.tick`, the month about to be lived). A choice with a check rolls it now; a canon beat's
 * choice also decides whether the beat happens.
 */
export function resolveDecision(
  state: WorldState,
  data: GameData,
  decisionId: number,
  choiceId: string,
): void {
  const index = state.pending.findIndex((d) => d.id === decisionId);
  const decision = state.pending[index];
  if (index === -1 || !decision) throw new EventError(`There is no pending decision ${decisionId}`);
  if (!decision.choices.some((c) => c.id === choiceId)) {
    const valid = decision.choices.map((c) => c.id).join(', ');
    throw new EventError(
      `"${choiceId}" is not a choice of ${decision.eventId} (choices: ${valid})`,
    );
  }
  // Phase 5: the player's fight in progress (play it out, or decide the fate of the beaten).
  if (decision.battle) {
    resolveBattleDecision(state, data, decision, choiceId);
    return;
  }
  const date = dateOf(data.calendar, state.tick);
  const roles = decision.roles ?? {};
  const place = decision.place ?? null;

  if (decision.beat) {
    const beat = data.canon[decision.eventId];
    if (!beat) {
      dropDecision(state, index, decision.title, decision.eventId, decision.recordSeq);
      return;
    }
    const choice = beat.choices.find((c) => c.id === choiceId);
    state.pending.splice(index, 1);
    const record = appendLog(state, state.tick, {
      kind: 'decision',
      summary: `Chose "${choice?.label ?? choiceId}" (${decision.title}).`,
      tags: ['decision', 'canon'],
      cause: beat.id,
      causeSeq: decision.recordSeq,
      knownBy: state.playerId ? [state.playerId] : [],
    });
    const site: EffectSite = {
      tick: state.tick,
      date,
      cause: beat.id,
      causeSeq: record.seq,
      knownBy: record.knownBy,
      place,
      roles,
    };
    if (choice?.text) {
      appendLog(state, state.tick, {
        kind: 'event',
        summary: sentence(renderTemplate(choice.text, textVars(state, data, site))),
        tags: ['personal', 'canon'],
        cause: beat.id,
        causeSeq: record.seq,
        knownBy: record.knownBy,
      });
    }
    applyEffects(state, data, choice?.effects ?? [], site);
    if (choice?.fight) {
      // The beat's outcome waits on the fight (a war at Marineford): see the finisher below.
      startFight(
        state,
        data,
        choice.fight,
        {
          kind: 'beat',
          id: beat.id,
          choice: choice.id,
          roles: { ...roles },
          causeSeq: record.seq,
        },
        place,
        decision.title,
      );
      return;
    }
    const beatSite: BeatSite = {
      state,
      data,
      tick: state.tick,
      rng: Rng.root(state.seed).fork('beatChoice', record.seq),
      newsDrafts: [],
    };
    resolveBeatChoice(beatSite, beat, roles, choice?.diverge ?? false, record.seq);
    flushNews(state, beatSite.newsDrafts, state.tick);
    return;
  }

  const def = data.events[decision.eventId];
  if (!def) {
    // The content was removed after the save was made. Drop the decision rather than leave the
    // world stuck on a choice nobody can resolve.
    dropDecision(state, index, decision.title, decision.eventId, decision.recordSeq);
    return;
  }
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) {
    const valid = def.choices.map((c) => c.id).join(', ');
    throw new EventError(`"${choiceId}" is not a choice of ${def.id} (choices: ${valid})`);
  }

  state.pending.splice(index, 1);
  const knownBy = def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : [];
  const record = appendLog(state, state.tick, {
    kind: 'decision',
    summary: `Chose "${decision.choices.find((c) => c.id === choiceId)?.label ?? choice.label}" (${decision.title}).`,
    // What the player chose, and how it went, is theirs (the chronicle's Personal filter).
    tags: unique(['decision', ...(def.type === 'world' ? [] : ['personal']), ...def.tags]),
    cause: def.id,
    causeSeq: decision.recordSeq,
    knownBy,
  });
  const newsDrafts: NewsDraft[] = [];
  const site: EffectSite = {
    tick: state.tick,
    date,
    cause: def.id,
    causeSeq: record.seq,
    knownBy,
    place,
    roles,
    newsDrafts,
  };
  applyEffects(state, data, choice.effects, site);
  if (choice.fight) {
    flushNews(state, newsDrafts, state.tick);
    startFight(
      state,
      data,
      choice.fight,
      {
        kind: 'event',
        id: def.id,
        choice: choice.id,
        roles: { ...roles },
        causeSeq: record.seq,
      },
      place,
      def.title,
    );
    return;
  }
  if (choice.check) {
    const story = playerStory(state, data, state.tick);
    const result = rollCheck(story, choice.check, Rng.root(state.seed).fork('check', decision.id));
    const band = appendLog(state, state.tick, {
      kind: 'event',
      summary: sentence(renderTemplate(result.result.text, textVars(state, data, site))),
      tags: unique([
        'check',
        result.band,
        ...(def.type === 'world' ? [] : ['personal']),
        ...def.tags,
      ]),
      cause: def.id,
      causeSeq: record.seq,
      knownBy,
    });
    applyEffects(state, data, result.result.effects, { ...site, causeSeq: band.seq });
  }
  flushNews(state, newsDrafts, state.tick);
}

// ---- Fights (Phase 5) ------------------------------------------------------------------------

function startFight(
  state: WorldState,
  data: GameData,
  spec: FightSpec,
  source: BattleState['source'],
  place: string | null,
  title: string,
): void {
  const contest = spec.contest
    ? data.battle.contests.find((c) => c.id === spec.contest)
    : undefined;
  if (contest && contest.rounds > 1) {
    beginContest(state, data, contest, {
      tick: state.tick,
      place,
      roles: source.roles ?? {},
      source,
    });
    return;
  }
  const battle = buildFight(state, data, spec, {
    tick: state.tick,
    place,
    roles: source.roles ?? {},
    source,
  });
  beginFight(state, data, battle, title);
}

/** The result band a fight lands in: a decisive win, a win, a loss, a heavy loss, or getting away. */
export function fightBand(spec: FightSpec, battle: BattleState): CheckBand {
  const r = battle.result;
  if (!r) return spec.failure;
  if (r.how === 'won') return r.decisive ? (spec.criticalSuccess ?? spec.success) : spec.success;
  if (r.how === 'fled') return spec.fled ?? spec.failure;
  if (r.how === 'draw') return spec.fled ?? spec.success;
  return r.decisive ? (spec.criticalFailure ?? spec.failure) : spec.failure;
}

onFightFinished('event', (state, data, battle) => {
  const def = data.events[battle.source.id];
  const choice = def?.choices.find((c) => c.id === battle.source.choice);
  if (!def || !choice?.fight) return;
  const band = fightBand(choice.fight, battle);
  const knownBy = def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : [];
  const date = dateOf(data.calendar, state.tick);
  const newsDrafts: NewsDraft[] = [];
  const site: EffectSite = {
    tick: state.tick,
    date,
    cause: def.id,
    causeSeq: battle.source.causeSeq ?? 0,
    knownBy,
    place: battle.place,
    roles: battle.source.roles ?? {},
    newsDrafts,
  };
  const record = appendLog(state, state.tick, {
    kind: 'event',
    summary: sentence(renderTemplate(band.text, textVars(state, data, site))),
    tags: unique(['check', 'fight', ...(def.type === 'world' ? [] : ['personal']), ...def.tags]),
    cause: def.id,
    ...(battle.source.causeSeq !== undefined ? { causeSeq: battle.source.causeSeq } : {}),
    knownBy,
  });
  applyEffects(state, data, band.effects, { ...site, causeSeq: record.seq });
  flushNews(state, newsDrafts, state.tick);
});

onFightFinished('beat', (state, data, battle) => {
  const beat = data.canon[battle.source.id];
  const choice = beat?.choices.find((c) => c.id === battle.source.choice);
  if (!beat || !choice) return;
  const won = battle.result?.how === 'won';
  const beatSite: BeatSite = {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('beatChoice', battle.source.causeSeq ?? battle.id),
    newsDrafts: [],
  };
  // The story breaks only if the player's side won what they fought for.
  resolveBeatChoice(
    beatSite,
    beat,
    battle.source.roles ?? {},
    choice.diverge && won,
    battle.source.causeSeq ?? 0,
  );
  if (choice.fight) {
    const band = fightBand(choice.fight, battle);
    const site: EffectSite = {
      tick: state.tick,
      date: dateOf(data.calendar, state.tick),
      cause: beat.id,
      causeSeq: battle.source.causeSeq ?? 0,
      knownBy: state.playerId ? [state.playerId] : [],
      place: battle.place,
      roles: battle.source.roles ?? {},
      newsDrafts: beatSite.newsDrafts,
    };
    const record = appendLog(state, state.tick, {
      kind: 'event',
      summary: sentence(renderTemplate(band.text, textVars(state, data, site))),
      tags: ['personal', 'canon', 'fight'],
      cause: beat.id,
      knownBy: site.knownBy,
    });
    applyEffects(state, data, band.effects, { ...site, causeSeq: record.seq });
  }
  flushNews(state, beatSite.newsDrafts, state.tick);
});

/** News raised between ticks (a decision's effects) goes out at once, the way step 6 would. */
export function flushNews(state: WorldState, drafts: readonly NewsDraft[], tick: number): void {
  if (drafts.length === 0) return;
  for (const draft of drafts) {
    state.counters.newsSeq += 1;
    state.news.push({
      id: state.counters.newsSeq,
      tick,
      text: draft.text,
      tags: draft.tags,
      ...(draft.sourceSeq !== undefined ? { sourceSeq: draft.sourceSeq } : {}),
      ...(draft.place !== undefined ? { place: draft.place, reachTick: tick } : {}),
    });
  }
}

/** Turn beats that need the player into decisions. */
function askAboutBeats(
  state: WorldState,
  data: GameData,
  tick: number,
  waiting: ReturnType<typeof runBeats>,
): void {
  for (const { beat, cast, instigator } of waiting) {
    const place = data.locations[beat.place];
    const record = appendLog(state, tick, {
      kind: 'event',
      summary: `${beat.name}: it is happening, here, in front of you.`,
      tags: ['personal', 'canon', 'beat'],
      place: beat.place,
      cause: beat.id,
      knownBy: state.playerId ? [state.playerId] : [],
    });
    const vars = {
      ...templateVarsFor(dateOf(data.calendar, tick)),
      ...storyVars(state, data),
      ...roleVars(state, data, cast),
      place: place?.home ?? beat.place,
    };
    state.counters.decisionId += 1;
    state.pending.push({
      id: state.counters.decisionId,
      eventId: beat.id,
      firedTick: tick,
      recordSeq: record.seq,
      title: beat.name,
      text: sentence(renderTemplate(beat.text, vars)),
      choices: beat.choices
        .filter((c) => instigator || !c.instigator)
        .map((c) => ({ id: c.id, label: c.label })),
      roles: cast,
      place: beat.place,
      beat: true,
    });
  }
}

/** Months before the same world event can strike the same place again. */
const WORLD_EVENT_REST = 36;

/** World events: somewhere in the world that matches, for nobody in particular. */
function rollWorldEvents(
  state: WorldState,
  ctx: { data: GameData; tick: number; rng: Rng; date: DateInfo; newsDrafts: NewsDraft[] },
): void {
  const { data, tick, rng } = ctx;
  const count = rollCount(rng.fork('worldCount'), data.world.events.worldPerMonth);
  if (count === 0) return;
  const places = locations(data, withDevFixtures(state));
  const anywhere = worldStory(state, data, tick, places[0] as Location);
  const pool = candidates({ ...anywhere, place: null }, 'world');
  const picked = pickEvents({ ...anywhere, place: null }, rng.fork('worldPick'), pool, count);
  const listener = state.playerId ? state.entities[state.playerId]?.character : undefined;
  const here =
    listener && data.birthplaces[listener.birthplace] ? locationIdOf(data, listener) : null;
  picked.forEach((def, i) => {
    const where = def.where;
    const recent = `recent.${def.id}`;
    const matches = where
      ? places.filter(
          (loc) => checkWhere(state, where, loc) && !localFlagActive(state, loc.id, recent, tick),
        )
      : [];
    if (matches.length === 0) return;
    const loc = rng.fork('where', i).pick(matches);
    const story = worldStory(state, data, tick, loc);
    if (!allHold(story, def.conditions)) return;
    const knownBy = here === loc.id && state.playerId ? [state.playerId] : [];
    fireEvent(state, def, ctx, undefined, { story, knownBy, rng: rng.fork('world', i) });
    setLocalFlag(state, loc.id, recent, true, tick, WORLD_EVENT_REST);
  });
}

/**
 * A dev switch, like the entropy probe: a world with `dev.quiet` set rolls no random events for
 * the player (tests of other systems that need a month to pass without a decision).
 */
export const QUIET = 'dev.quiet';

/** The player's events this month: arriving, at sea, or ashore. */
function rollPlayerEvents(
  state: WorldState,
  ctx: { data: GameData; tick: number; rng: Rng; date: DateInfo; newsDrafts: NewsDraft[] },
): void {
  const { data, tick, rng } = ctx;
  if (state.flags[QUIET] === true) return;
  const story = playerStory(state, data, tick);
  const p = story.p;
  if (!p?.c.life || isJailed(p.c.life, tick)) return;
  const mine = [p.entity.id];
  const fire = (defs: readonly EventDef[], label: string) =>
    defs.forEach((def, i) =>
      fireEvent(state, def, ctx, undefined, {
        story,
        knownBy: def.type === 'local' && def.visibility === 'public' ? [PUBLIC_KNOWLEDGE] : mine,
        rng: rng.fork(label, i),
      }),
    );
  if (p.entity.flags['travel.arrived'] === tick) {
    fire(pickEvents(story, rng.fork('arrival'), candidates(story, 'arrival'), 1, 3), 'arrival');
  }
  if (story.voyage) {
    const rolls = voyageRolls(story, rng.fork('voyageRolls'));
    const pool = candidates(story, 'voyage');
    fire(pickEvents(story, rng.fork('voyage'), pool, rolls, data.travel.quietWeight), 'voyage');
    return;
  }
  const count = rollCount(rng.fork('count'), data.world.events.playerPerMonth);
  if (count > 0)
    fire(pickEvents(story, rng.fork('random'), candidates(story, 'random'), count), 'random');
}

export const rollEvents: TickStep = {
  id: 'rollEvents',
  run(state, ctx) {
    // A bare world (no map built: the Phase 0 tools and tests) has scheduled events only.
    const built = worldBuilt(state);
    // 1. Canon beats.
    const beatSite: BeatSite = {
      state,
      data: ctx.data,
      tick: ctx.tick,
      rng: ctx.rng.fork('beats'),
      newsDrafts: ctx.newsDrafts,
    };
    if (built && orderedBeats(state, ctx.data).length > 0) {
      askAboutBeats(state, ctx.data, ctx.tick, runBeats(beatSite));
    }

    // 2. Scheduled events that are due. Events scheduled while these fire are at least a month
    //    away, so they are not picked up in the same tick.
    const due = state.scheduled.filter((s) => s.tick <= ctx.tick);
    if (due.length > 0) {
      state.scheduled = state.scheduled.filter((s) => s.tick > ctx.tick);
      for (const scheduled of due) {
        const def = ctx.data.events[scheduled.eventId];
        if (!def) {
          appendLog(state, ctx.tick, {
            kind: 'system',
            summary: `Scheduled event "${scheduled.eventId}" no longer exists in the data and was skipped.`,
            tags: ['system', 'warning'],
            cause: 'sys:scheduler',
          });
          continue;
        }
        fireEvent(state, def, ctx, scheduled.causeSeq);
      }
    }

    if (!built) return;
    // 3. The player's random events.
    rollPlayerEvents(state, { ...ctx, rng: ctx.rng.fork('player') });

    // 4. The world's.
    rollWorldEvents(state, { ...ctx, rng: ctx.rng.fork('world') });
  },
};
