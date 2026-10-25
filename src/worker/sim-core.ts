import { advanceBatch, newCursor, type StopReason } from '../engine/advance';
import { dateOf, formatDate, hasReachedPresent, progressToPresent } from '../engine/calendar';
import { hashValue } from '../engine/canonical';
import type { GameData } from '../engine/data/schemas';
import { entityIds } from '../engine/entities';
import { isKnownBy } from '../engine/knowledge';
import { matchesFilter } from '../engine/log';
import { Rng } from '../engine/rng';
import { SaveManager } from '../engine/saves/manager';
import type { SaveStore } from '../engine/saves/store';
import type { Entity, EventRecord, WorldState } from '../engine/state';
import { describeBreakdown, statBreakdown, statLabel } from '../engine/stats';
import { ENGINE_VERSION, SAVE_VERSION } from '../engine/version';
import {
  ActionError,
  ActionSchema,
  advanceOptions,
  applyAction,
  characterSheet,
  createLife,
  createWorld,
  defaultOptions,
  genesisStats,
  GenesisError,
  playerSummary,
} from '../core';
import { optionsFor } from '../systems/genesis/appearance';
import { GenesisOptionsSchema, type GenesisOptions } from '../systems/genesis/options';
import { ageAt } from '../systems/genesis/stages';
import { runHeadlessLife } from '../systems/life/headless';
import { trainingCurve } from '../systems/life/training';
import { lifeView } from '../systems/life/view';
import { newsHeard } from '../systems/news';
import { ensureWorldLayer } from '../systems/places/history';
import { canonView, factionViews, mapView, placeView, worldSummary } from '../systems/places/view';
import { travelView } from '../systems/voyage/view';
import { fruitsView, powersView } from '../systems/powers/view';
import { designPreview, handsView } from '../systems/hands/view';
import { battleView, fightSelfView } from '../systems/battle/view';
import { entryWarnings } from '../systems/genesis/warnings';
import type {
  AdvanceReport,
  Category,
  DecisionView,
  EntityListItem,
  EntityView,
  EventListItem,
  FeedEntry,
  GenesisPreview,
  GenesisSetup,
  LoadInfo,
  LogQueryRequest,
  LogQueryResult,
  LivesReport,
  LogView,
  Op,
  Protocol,
  RequestHooks,
  SavesState,
  Snapshot,
  StatView,
  ViewOptions,
} from './protocol';
import { randomSeed } from './seed';

/**
 * SimCore owns one world and everything done to it: advancing time, applying actions, answering
 * queries, saving and loading. It knows nothing about workers or the page, so the same class runs
 * inside the Web Worker, inline on the main thread (fallback), and in Node tests.
 *
 * Requests run one at a time. Only `cancel` may arrive while a long advance is in progress; the
 * advance loop yields between chunks so that message can be handled.
 */

export interface SimCoreDeps {
  data: GameData;
  dataHash: string;
  dataWarnings?: number;
  store: SaveStore;
  /** Allows debug actions and dev worlds. False in production builds. */
  debug: boolean;
  /** Wall-clock ms; only ever used for save metadata. */
  now?: () => number;
  /** Monotonic ms for pacing long advances (injected so tests can control it). */
  clock?: () => number;
  /** Lets other work run between chunks of a long advance. */
  yieldToHost?: () => Promise<void>;
  newSeed?: () => string;
  /** Ticks per chunk of a long advance. */
  batchTicks?: number;
  /**
   * How full a new life's world is (Phase 3): "full" (the default) has ~2,000 named Tier 2
   * people; tests of the page use "none" to keep every save small and quick.
   */
  population?: 'full' | 'none';
}

type Handlers = {
  [K in Op]: (
    req: Protocol[K]['req'],
    hooks: RequestHooks,
  ) => Promise<Protocol[K]['res']> | Protocol[K]['res'];
};

const MAX_SEED_LENGTH = 80;

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function categoryOf(record: EventRecord): Category {
  const { tags } = record;
  if (tags.includes('family')) return 'family';
  if (tags.includes('personal')) return 'personal';
  if (tags.includes('news')) return 'news';
  if (record.kind === 'system' || tags.includes('system')) return 'system';
  return 'world';
}

export class SimCore {
  private state: WorldState;
  private rng: Rng;
  private lastLoad: LoadInfo | null = null;
  private lastAutosave: Snapshot['autosave'] = null;
  private cancelRequested = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly saves: SaveManager;
  private readonly handlers: Handlers;
  private readonly now: () => number;
  private readonly clock: () => number;
  private readonly yieldToHost: () => Promise<void>;
  private readonly newSeed: () => string;
  private readonly batchTicks: number;

  constructor(private readonly deps: SimCoreDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.clock = deps.clock ?? defaultClock;
    this.yieldToHost =
      deps.yieldToHost ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    this.newSeed = deps.newSeed ?? (() => randomSeed());
    this.batchTicks = deps.batchTicks ?? 12;
    const { saves } = deps.data.settings;
    this.saves = new SaveManager(deps.store, {
      counts: { autosaveSlots: saves.autosaveSlots, manualSlots: saves.manualSlots },
      limits: {
        maxCompressedBytes: saves.maxImportBytes,
        maxDecompressedBytes: saves.maxDecompressedBytes,
      },
      dataHash: deps.dataHash,
      now: this.now,
    });

    // A placeholder world until boot() or newWorld() runs, so every query has something to read.
    this.state = createWorld({ seed: 'unstarted' });
    this.rng = Rng.root(this.state.seed);

    this.handlers = {
      boot: (req) => this.boot(req),
      newWorld: (req) => this.newWorld(req),
      snapshot: (req) => ({ snapshot: this.snapshot(req.view) }),
      advance: (req, hooks) => this.advance(req, hooks),
      dispatch: (req) => this.dispatch(req),
      inspect: (req) => this.inspect(req.entityId),
      listEntities: (req) => this.listEntities(req),
      queryLog: (req) => this.queryLog(req),
      listEvents: () => this.listEvents(),
      'saves/list': () => this.savesState(),
      'saves/save': (req) => this.saveManual(req),
      'saves/load': (req) => this.loadSlot(req),
      'saves/delete': (req) => this.deleteSlot(req),
      'saves/export': () => this.exportSave(),
      'saves/import': (req) => this.importSave(req),
      hash: () => ({ stateHash: hashValue(this.state), dataHash: this.deps.dataHash }),
      'genesis/setup': () => this.genesisSetup(),
      'genesis/preview': (req) => this.genesisPreview(req),
      'genesis/start': (req) => this.genesisStart(req),
      'debug/genesisStats': (req) => {
        if (!this.deps.debug) throw new ActionError('Debug tools are disabled in this build');
        const rolls = Math.min(20000, Math.max(1, Math.floor(req.rolls ?? 1000)));
        return genesisStats(this.deps.data, req.raceId, rolls);
      },
      'debug/trainingCurve': (req) => {
        if (!this.deps.debug) throw new ActionError('Debug tools are disabled in this build');
        const months = Math.min(1200, Math.max(1, Math.floor(req.months)));
        return {
          points: trainingCurve(this.deps.data, { ...req, months }),
          softCap: this.deps.data.character.softCap.above,
        };
      },
      'debug/lives': (req) => this.debugLives(req),
      'world/map': () => mapView(this.state, this.deps.data),
      'world/place': (req) => placeView(this.state, this.deps.data, req.id, req.view.omniscient),
      'world/canon': () => canonView(this.state, this.deps.data),
      'world/factions': (req) => factionViews(this.state, this.deps.data, req.generated ?? false),
      'powers/fruits': (req) => fruitsView(this.state, this.deps.data, req.view.omniscient),
      'hands/design': (req) => designPreview(this.state, this.deps.data, req.design),
    };
  }

  // ---- Request plumbing ---------------------------------------------------------------------

  /** Run a request. Requests are serialised; errors reject without blocking later requests. */
  handle<K extends Op>(
    op: K,
    payload: Protocol[K]['req'],
    hooks: RequestHooks = {},
  ): Promise<Protocol[K]['res']> {
    const handler = this.handlers[op] as
      ((req: unknown, hooks: RequestHooks) => unknown) | undefined;
    if (!handler) return Promise.reject(new Error(`Unknown operation "${String(op)}"`));
    const run = this.tail.then(
      () => handler(payload, hooks),
      () => handler(payload, hooks),
    ) as Promise<Protocol[K]['res']>;
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Ask a running advance to stop at the next chunk boundary. Not queued: it must get through. */
  cancel(): void {
    this.cancelRequested = true;
  }

  /** The live state. For tests and tools only; the UI goes through requests. */
  peekState(): WorldState {
    return this.state;
  }

  // ---- World lifecycle ----------------------------------------------------------------------

  private adopt(state: WorldState, load: LoadInfo | null): void {
    // A world someone lives in gets its map, factions and people now (a save from before Phase 3
    // gets them, and its past, on loading), so the first snapshot already shows them.
    if (state.playerId !== null) ensureWorldLayer(state, this.deps.data);
    this.state = state;
    this.rng = Rng.root(state.seed);
    this.lastLoad = load;
    this.lastAutosave = null;
  }

  async boot(req: Protocol['boot']['req']): Promise<Protocol['boot']['res']> {
    let notice: string | null = null;
    if (req.autoResume) {
      try {
        const newest = await this.saves.newest();
        if (newest) {
          try {
            const { state, report } = await this.saves.load(newest.slot);
            const load: LoadInfo = { source: newest.slot, report };
            this.adopt(state, load);
            return { snapshot: this.snapshot(req.view), resumed: load, notice: null };
          } catch (error) {
            notice = `Could not resume ${newest.slot} (${error instanceof Error ? error.message : String(error)}). Started a new world instead.`;
          }
        }
      } catch (error) {
        notice = `Saved games could not be read (${error instanceof Error ? error.message : String(error)}). Started a new world.`;
      }
    }
    this.createFresh({});
    return { snapshot: this.snapshot(req.view), resumed: null, notice };
  }

  private createFresh(req: { seed?: string; probe?: boolean; fixtures?: boolean }): void {
    if ((req.probe || req.fixtures) && !this.deps.debug) {
      throw new ActionError('Dev worlds are disabled in this build');
    }
    const seed = (req.seed ?? '').trim() || this.newSeed();
    if (seed.length > MAX_SEED_LENGTH)
      throw new ActionError(`A seed can be at most ${MAX_SEED_LENGTH} characters`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(seed))
      throw new ActionError('A seed cannot contain control characters');
    const state = createWorld({ seed, ...(req.probe ? { probe: true } : {}) });
    if (req.fixtures)
      applyAction(state, this.deps.data, { type: 'debug/spawnTestEntity' }, { debug: true });
    this.adopt(state, null);
  }

  newWorld(req: Protocol['newWorld']['req']): Protocol['newWorld']['res'] {
    this.createFresh(req);
    return { snapshot: this.snapshot(req.view) };
  }

  // ---- Time and actions ---------------------------------------------------------------------

  async advance(req: Protocol['advance']['req'], hooks: RequestHooks): Promise<AdvanceReport> {
    const { data } = this.deps;
    const options = advanceOptions(req.decisions ?? 'stop');
    const cursor = newCursor(req.plan, data);
    const target = req.plan.kind === 'months' ? req.plan.count : data.settings.time.untilEventCap;
    this.cancelRequested = false;

    let ticksRun = 0;
    let stop: StopReason | 'cancelled';
    let autosaveRequested = false;
    let lastYield = this.clock();

    // A skip is all-or-nothing, like an action. Systems mutate the state in place, so a step that
    // throws part-way through a month would otherwise leave a half-ticked world that the next skip
    // (and the next autosave) carries on from. One checkpoint per request, not per month, keeps
    // this cheap; the same trade `dispatch` makes. A cancelled skip is not a failure: it keeps
    // every month it finished.
    const checkpoint = structuredClone(this.state);
    try {
      for (;;) {
        const batch = advanceBatch(
          this.state,
          data,
          this.rng,
          req.plan,
          cursor,
          options,
          this.batchTicks,
        );
        ticksRun += batch.ticksRun;
        if (batch.effects.some((e) => e.kind === 'autosave')) autosaveRequested = true;
        if (batch.stop !== null) {
          stop = batch.stop;
          break;
        }
        if (this.cancelRequested) {
          stop = 'cancelled';
          break;
        }
        if (this.clock() - lastYield > 16) {
          hooks.onProgress?.({ ticksRun, target, tick: this.state.tick });
          await this.yieldToHost();
          lastYield = this.clock();
          if (this.cancelRequested) {
            stop = 'cancelled';
            break;
          }
        }
      }
    } catch (error) {
      this.state = checkpoint;
      throw error;
    }

    // One autosave per advance, however many months it covered.
    if (autosaveRequested && ticksRun > 0) await this.autosave();
    return { ticksRun, stop, snapshot: this.snapshot(req.view) };
  }

  /** Apply an action atomically: on any error the world is exactly as it was. */
  async dispatch(req: Protocol['dispatch']['req']): Promise<Protocol['dispatch']['res']> {
    const parsed = ActionSchema.safeParse(req.action);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ActionError(
        `Invalid action: ${first ? `${first.path.join('.') || '(action)'}: ${first.message}` : 'unrecognised'}`,
      );
    }
    const draft = structuredClone(this.state);
    const { effects } = applyAction(draft, this.deps.data, parsed.data, { debug: this.deps.debug });
    this.state = draft;
    if (effects.some((e) => e.kind === 'autosave')) await this.autosave();
    return { snapshot: this.snapshot(req.view) };
  }

  // ---- New Life (character genesis) --------------------------------------------------------

  private genesisSetup(): GenesisSetup {
    const { data } = this.deps;
    const byId = <T extends { id: string }>(r: Readonly<Record<string, T>>) =>
      Object.values(r).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const traitNames = (ids: readonly string[]) => ids.map((id) => data.traits[id]?.name ?? id);
    return {
      races: byId(data.races).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        rare: r.rare,
        capMods: { ...r.capMods } as Record<string, number>,
        anchors: { ...r.anchors },
        lifespan: { ...r.lifespan },
        traits: r.innateTraits.map((id) => ({
          name: data.traits[id]?.name ?? id,
          description: data.traits[id]?.description ?? '',
        })),
        birthplaces: byId(data.birthplaces)
          .filter((b) => b.races.includes(r.id))
          .map((b) => b.id),
      })),
      birthplaces: byId(data.birthplaces).map((b) => ({
        id: b.id,
        name: b.name,
        shortName: b.shortName,
        description: b.description,
        opens: b.opens,
        wealth: b.wealth,
        safety: b.safety,
        region: b.region,
        races: [...b.races],
        map: b.map ? { ...b.map } : null,
        traits: traitNames(b.traitPool),
      })),
      legacies: byId(data.legacies).map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        traits: traitNames(l.traitPool),
      })),
      foci: byId(data.foci).map((f) => ({ id: f.id, name: f.name, description: f.description })),
      difficulties: data.creation.difficulties.map((d) => ({
        id: d.id,
        name: d.name,
        summary: d.summary,
      })),
      canonModes: data.creation.canonModes.map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
      })),
      entry: { ...data.creation.entry },
      defaults: defaultOptions(data, this.newSeed()),
      presentYear: Math.floor(data.calendar.presentTick / 12),
      canonYearOffset: data.calendar.canonYearOffset,
      era: data.calendar.era,
      appearanceFields: data.appearance.fields.map((f) => ({ id: f.id, label: f.label })),
      months: [...data.calendar.months],
    };
  }

  /** Validate New Life options, filling a blank seed so a preview and its start agree. */
  private genesisOptions(raw: unknown): GenesisOptions {
    let input = raw;
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      const seed = typeof record['seed'] === 'string' ? record['seed'].trim() : '';
      input = { ...record, seed: seed === '' ? this.newSeed() : seed };
    }
    const parsed = GenesisOptionsSchema.safeParse(input);
    if (parsed.success) return parsed.data;
    const first = parsed.error.issues[0];
    throw new ActionError(
      `Invalid New Life options: ${first ? `${first.path.join('.') || '(options)'}: ${first.message}` : 'unrecognised'}`,
    );
  }

  private genesisPreview(req: Protocol['genesis/preview']['req']): GenesisPreview {
    const { data } = this.deps;
    const started = this.clock();
    const options = this.genesisOptions(req.options);
    try {
      const life = createLife(data, options, { allowBlocked: true });
      const { resolved, state, playerId } = life;
      const pc = state.entities[playerId]?.character;
      const date = dateOf(data.calendar, state.tick);
      return {
        options,
        resolved: {
          race: resolved.race.id,
          birthplace: resolved.birthplace.id,
          legacy: resolved.legacy.id,
          focus: resolved.focus?.id ?? null,
          random: resolved.random,
        },
        focusApplies: resolved.focus !== null,
        warnings: life.warnings,
        notes: life.notes,
        sheet: characterSheet(data, state, playerId, { omniscient: req.view.omniscient }),
        error: null,
        canStart: !life.warnings.some((w) => w.level === 'error'),
        appearance: data.appearance.fields.map((field) => ({
          field: field.id,
          label: field.label,
          optionId: pc?.appearance[field.id] ?? '',
          locked:
            options.locks[field.id] !== undefined &&
            options.locks[field.id] === pc?.appearance[field.id],
          options: optionsFor({ data, race: resolved.race, age: options.entryAge }, field.id).map(
            (o) => ({ id: o.id, label: o.label ?? o.text }),
          ),
        })),
        entry: {
          tick: state.tick,
          label: formatDate(date),
          canonYear: date.canonYear,
          birthLabel: pc ? this.dateLabel(pc.birthTick) : '',
          ageAtPresent: pc ? ageAt(pc.birthTick, data.calendar.presentTick) : 0,
        },
        ms: Math.max(0, this.clock() - started),
      };
    } catch (error) {
      if (!(error instanceof GenesisError)) throw error;
      const race = data.races[options.race];
      return {
        options,
        resolved: null,
        focusApplies: false,
        warnings: race ? entryWarnings(data, race, options.entryYear, options.entryAge) : [],
        notes: [],
        sheet: null,
        error: error.message,
        canStart: false,
        appearance: [],
        entry: null,
        ms: Math.max(0, this.clock() - started),
      };
    }
  }

  private async genesisStart(
    req: Protocol['genesis/start']['req'],
  ): Promise<Protocol['genesis/start']['res']> {
    const options = this.genesisOptions(req.options);
    let life;
    try {
      life = createLife(this.deps.data, options, { population: this.deps.population ?? 'full' });
    } catch (error) {
      if (error instanceof GenesisError) throw new ActionError(error.message);
      throw error;
    }
    this.adopt(life.state, null);
    // A new life is saved at once, so closing the tab before the first month loses nothing.
    await this.autosave();
    return { snapshot: this.snapshot(req.view) };
  }

  private debugLives(req: Protocol['debug/lives']['req']): LivesReport {
    if (!this.deps.debug) throw new ActionError('Debug tools are disabled in this build');
    const { data } = this.deps;
    const race = data.races[req.raceId];
    if (!race) throw new ActionError(`There is no race "${req.raceId}"`);
    const count = Math.min(200, Math.max(1, Math.floor(req.lives)));
    const started = this.clock();
    const base = req.seed?.trim() || 'debug-lives';
    const options = advanceOptions('auto-random');
    const lives = Array.from({ length: count }, (_, i) => {
      const life = runHeadlessLife(
        data,
        { seed: `${base}-${race.id}-${i + 1}`, race: race.id },
        options,
      );
      return {
        seed: life.seed,
        age: life.age,
        cause: life.cause,
        outcomes: life.outcomes.length,
        job: life.job ? (data.jobs[life.job]?.name ?? life.job) : null,
      };
    });
    return {
      race: race.id,
      raceName: race.name,
      lifespan: { ...race.lifespan },
      lives,
      mean: lives.reduce((sum, l) => sum + l.age, 0) / lives.length,
      ms: Math.max(0, this.clock() - started),
    };
  }

  // ---- Saves --------------------------------------------------------------------------------

  private dateLabel(tick: number): string {
    return formatDate(dateOf(this.deps.data.calendar, tick));
  }

  private async autosave(): Promise<void> {
    try {
      const summary = await this.saves.autosave(
        this.state,
        `${this.dateLabel(this.state.tick)} (autosave)`,
      );
      this.lastAutosave = { at: summary.savedAt, slot: summary.slot, ok: true };
    } catch (error) {
      // A failed autosave must never break play; it is reported in the snapshot instead.
      this.lastAutosave = {
        at: this.now(),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async savesState(): Promise<SavesState> {
    const { saves } = this.deps.data.settings;
    return {
      slots: await this.saves.list(),
      persistent: this.deps.store.persistent,
      counts: { autosaveSlots: saves.autosaveSlots, manualSlots: saves.manualSlots },
      limits: { maxImportBytes: saves.maxImportBytes },
    };
  }

  private async saveManual(req: Protocol['saves/save']['req']): Promise<SavesState> {
    await this.saves.saveManual(
      this.state,
      req.slot,
      req.label?.trim() || this.dateLabel(this.state.tick),
    );
    return this.savesState();
  }

  private async deleteSlot(req: Protocol['saves/delete']['req']): Promise<SavesState> {
    await this.saves.delete(req.slot);
    return this.savesState();
  }

  private async loadSlot(
    req: Protocol['saves/load']['req'],
  ): Promise<Protocol['saves/load']['res']> {
    const { state, report } = await this.saves.load(req.slot);
    const load: LoadInfo = { source: req.slot, report };
    this.adopt(state, load);
    return { snapshot: this.snapshot(req.view), load };
  }

  private async exportSave(): Promise<Protocol['saves/export']['res']> {
    return this.saves.exportBytes(this.state, this.dateLabel(this.state.tick));
  }

  private async importSave(
    req: Protocol['saves/import']['req'],
  ): Promise<Protocol['saves/import']['res']> {
    const { state, report } = await this.saves.decode(req.bytes);
    const load: LoadInfo = { source: 'import', report };
    this.adopt(state, load);
    return { snapshot: this.snapshot(req.view), load };
  }

  // ---- Views --------------------------------------------------------------------------------

  snapshot(view: ViewOptions): Snapshot {
    const { data } = this.deps;
    const { state } = this;
    const cal = data.calendar;
    const labels = new Map<number, string>();
    const label = (tick: number): string => {
      let found = labels.get(tick);
      if (found === undefined) {
        found = this.dateLabel(tick);
        labels.set(tick, found);
      }
      return found;
    };

    const feed: FeedEntry[] = [];
    for (let i = state.log.length - 1; i >= 0 && feed.length < data.settings.host.feedTail; i--) {
      const record = state.log[i];
      if (!record) continue;
      if (!isKnownBy(record.knownBy, state.playerId, view.omniscient)) continue;
      feed.push({
        seq: record.seq,
        tick: record.tick,
        dateLabel: label(record.tick),
        kind: record.kind,
        category: categoryOf(record),
        summary: record.summary,
        tags: record.tags,
        hidden: !isKnownBy(record.knownBy, state.playerId, false),
      });
    }
    feed.reverse();

    // News reaches the player late, or not at all at sea (Phase 3); omniscient views show it all.
    const news = state.news
      .filter((n) => view.omniscient || newsHeard(n, state.tick))
      .slice(-data.settings.host.newsTail)
      .map((n) => ({
        id: n.id,
        tick: n.tick,
        dateLabel: label(n.tick),
        text: n.text,
        place: n.place ? (data.locations[n.place]?.name ?? null) : null,
        late: typeof n.reachTick === 'number' ? Math.max(0, n.reachTick - n.tick) : 0,
        hidden: !newsHeard(n, state.tick),
      }))
      .reverse();

    const pending: DecisionView[] = state.pending.map((d) => ({
      id: d.id,
      recordSeq: d.recordSeq,
      title: d.title,
      text: d.text,
      dateLabel: label(d.firedTick),
      choices: d.choices.map((c) => ({ ...c })),
      ...(d.battle ? { battle: true } : {}),
    }));

    const byType: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    let entityCount = 0;
    for (const entity of Object.values(state.entities)) {
      entityCount += 1;
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
      byOrigin[entity.origin] = (byOrigin[entity.origin] ?? 0) + 1;
    }

    const player = state.playerId ? state.entities[state.playerId] : undefined;
    const snapshot: Snapshot = {
      tick: state.tick,
      date: dateOf(cal, state.tick),
      presentTick: cal.presentTick,
      calendar: { yearOffset: cal.canonYearOffset, era: cal.era },
      progress: progressToPresent(cal, state.tick),
      atPresent: !state.openEnded && hasReachedPresent(cal, state.tick),
      openEnded: state.openEnded,
      seed: state.seed,
      player: player ? playerSummary(data, state) : null,
      sheet: state.playerId
        ? characterSheet(data, state, state.playerId, { omniscient: view.omniscient })
        : null,
      life: lifeView(state, data),
      travel: travelView(state, data),
      powers: powersView(state, data),
      battle: battleView(state, data),
      fight: fightSelfView(state, data),
      hands: handsView(state, data),
      world: worldSummary(state, data),
      epilogue:
        !state.openEnded && hasReachedPresent(cal, state.tick)
          ? { title: data.life.epilogue.title, text: data.life.epilogue.text }
          : null,
      pending,
      feed,
      news,
      counts: {
        entities: entityCount,
        byType,
        byOrigin,
        log: state.log.length,
        news: state.news.length,
        scheduled: state.scheduled.length,
        pending: state.pending.length,
      },
      skip: { shortMonths: data.settings.time.shortSkipMonths },
      lastLoad: this.lastLoad,
      autosave: this.lastAutosave,
      info: {
        engineVersion: ENGINE_VERSION,
        saveVersion: SAVE_VERSION,
        dataHash: this.deps.dataHash,
        dataWarnings: this.deps.dataWarnings ?? 0,
        debug: this.deps.debug,
        persistentSaves: this.deps.store.persistent,
      },
    };
    if (view.hash) snapshot.stateHash = hashValue(state);
    return snapshot;
  }

  private logView(record: EventRecord): LogView {
    const view: LogView = {
      seq: record.seq,
      tick: record.tick,
      dateLabel: this.dateLabel(record.tick),
      kind: record.kind,
      summary: record.summary,
      tags: record.tags,
      actorIds: record.actorIds,
      targetIds: record.targetIds,
      place: record.place,
      knownBy: record.knownBy,
      known: isKnownBy(record.knownBy, this.state.playerId, false),
    };
    if (record.cause !== undefined) view.cause = record.cause;
    if (record.causeSeq !== undefined) view.causeSeq = record.causeSeq;
    return view;
  }

  inspect(entityId: string): EntityView | null {
    const entity: Entity | undefined = this.state.entities[entityId];
    if (!entity) return null;
    const tick = this.state.tick;
    const stats: StatView[] = Object.keys(entity.stats)
      .sort()
      .map((id) => {
        const stat = entity.stats[id];
        if (!stat) throw new Error(`stat ${id} vanished`);
        const breakdown = statBreakdown(stat, tick);
        return {
          id,
          label: statLabel(id),
          base: breakdown.base,
          total: breakdown.total,
          flatTotal: breakdown.flatTotal,
          pctTotal: breakdown.pctTotal,
          subtotal: breakdown.subtotal,
          description: describeBreakdown(statLabel(id), breakdown),
          lines: breakdown.lines,
        };
      });
    const recent = this.state.log
      .filter((r) => r.actorIds.includes(entity.id) || r.targetIds.includes(entity.id))
      .slice(-15)
      .reverse()
      .map((r) => this.logView(r));
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      origin: entity.origin,
      tier: entity.tier,
      createdTick: entity.createdTick,
      createdLabel: this.dateLabel(entity.createdTick),
      isPlayer: this.state.playerId === entity.id,
      flags: { ...entity.flags },
      knownBy: entity.knownBy,
      stats,
      recent,
    };
  }

  listEntities(req: Protocol['listEntities']['req']): Protocol['listEntities']['res'] {
    const limit = req.limit ?? 500;
    const text = req.text?.trim().toLowerCase();
    const items: EntityListItem[] = [];
    let total = 0;
    for (const id of entityIds(this.state)) {
      const entity = this.state.entities[id];
      if (!entity) continue;
      if (req.type && entity.type !== req.type) continue;
      if (req.origin && entity.origin !== req.origin) continue;
      if (
        text &&
        !entity.id.toLowerCase().includes(text) &&
        !entity.name.toLowerCase().includes(text)
      )
        continue;
      total += 1;
      if (items.length < limit) {
        items.push({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          origin: entity.origin,
          tier: entity.tier,
        });
      }
    }
    return { items, total };
  }

  queryLog(req: LogQueryRequest): LogQueryResult {
    const viewer = { playerId: this.state.playerId, omniscient: req.omniscient };
    const matching: EventRecord[] = [];
    const tags = new Set<string>();
    const kinds = new Set<string>();
    for (const record of this.state.log) {
      for (const tag of record.tags) tags.add(tag);
      kinds.add(record.kind);
      if (
        matchesFilter(record, req.filter) &&
        isKnownBy(record.knownBy, viewer.playerId, viewer.omniscient)
      ) {
        matching.push(record);
      }
    }
    const offset = req.offset ?? 0;
    const limit = req.limit ?? 200;
    const records = matching
      .reverse()
      .slice(offset, offset + limit)
      .map((r) => this.logView(r));
    return { total: matching.length, records, tags: [...tags].sort(), kinds: [...kinds].sort() };
  }

  listEvents(): EventListItem[] {
    return Object.values(this.deps.data.events)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        visibility: e.visibility,
        choices: e.choices.length,
        tags: e.tags,
      }));
  }
}
