import type { StopReason } from '../engine/advance';
import type { AdvancePlan, DecisionPolicy } from '../engine/advance';
import type { DateInfo } from '../engine/calendar';
import type { DataIssue } from '../engine/data/issues';
import type { LogFilter } from '../engine/log';
import type { LoadReport } from '../engine/saves/manager';
import type { SlotSummary } from '../engine/saves/store';
import type { BreakdownLine } from '../engine/stats';
import type { GenesisOptions } from '../systems/genesis/options';
import type { CharacterSheet } from '../systems/genesis/sheet';
import type { GenesisStats } from '../systems/genesis/stats-report';
import type { EntryWarning } from '../systems/genesis/warnings';
import type { ContinueOption, LifeRecap } from '../systems/life/death';
import type { CurvePoint } from '../systems/life/training';
import type { ActivityView, JobView, LifeView } from '../systems/life/view';
import type {
  CanonView,
  FactionView,
  MapView,
  PlaceDetailView,
  WorldSummary,
} from '../systems/places/view';
import type { TravelView } from '../systems/voyage/view';
import type { FruitsView, PowersView } from '../systems/powers/view';

export type {
  FruitsView,
  PowersView,
  CanonView,
  FactionView,
  MapView,
  PlaceDetailView,
  TravelView,
  WorldSummary,
  ActivityView,
  CharacterSheet,
  ContinueOption,
  CurvePoint,
  EntryWarning,
  GenesisOptions,
  GenesisStats,
  JobView,
  LifeRecap,
  LifeView,
};

/**
 * What the page and the simulation say to each other (rule 7: the UI reads state and sends
 * actions; it never reaches into the engine).
 *
 * The same protocol runs over a Web Worker (the normal case) and over a direct in-page call (the
 * fallback when workers are unavailable, and the way tests drive the UI). Everything crossing it
 * is plain data that survives structured cloning.
 */

// ---- Views of state (what the UI is allowed to see) ----------------------------------------

export type Category = 'personal' | 'family' | 'world' | 'news' | 'system';

export interface FeedEntry {
  seq: number;
  tick: number;
  dateLabel: string;
  kind: string;
  category: Category;
  summary: string;
  tags: string[];
  /** Visible only because omniscient mode is on: nobody in the world knows this. */
  hidden: boolean;
}

export interface NewsEntry {
  id: number;
  tick: number;
  dateLabel: string;
  text: string;
  /** Where it happened (Phase 3), and how many months late it reached the player. */
  place: string | null;
  late: number;
  /** Shown only because omniscient mode is on: it has not reached the player yet. */
  hidden: boolean;
}

export interface DecisionView {
  id: number;
  /** The log record the event produced, so the page can tell whether its text is already in the chronicle. */
  recordSeq: number;
  title: string;
  text: string;
  dateLabel: string;
  choices: { id: string; label: string; text?: string }[];
}

export interface LoadInfo {
  /** Slot id, or "import". */
  source: string;
  report: LoadReport;
}

export interface Snapshot {
  tick: number;
  date: DateInfo;
  presentTick: number;
  /** How a game year is written (Phase 4: Sea Circle years, "1497 SC"). */
  calendar: { yearOffset: number; era: string };
  /** 0 to 1 along the way to the present. */
  progress: number;
  /** True when the clock has reached the present and play is not open-ended. */
  atPresent: boolean;
  openEnded: boolean;
  seed: string;
  /** Null in a world nobody lives in (a debug world, or before New Life). */
  player: null | {
    id: string;
    name: string;
    age: number;
    /** Life stage name ("Adolescent"). */
    stage: string;
    /** Where they are (Phase 3): a place on the map, or at sea. */
    location: string;
    berries: number;
    alive: boolean;
  };
  /** The life loop (Phase 2): health, routine, jobs, money; the recap once the life has ended. */
  life: LifeView | null;
  /** Travel (Phase 3): where the player is, their voyage, the routes from here, the harbour. */
  travel: TravelView | null;
  /** The world (Phase 3): factions, the canon layer's progress, the population. */
  world: WorldSummary;
  /** Powers (Phase 4): tracks, techniques, the fruit, gear. Null with nobody alive to play. */
  powers: PowersView | null;
  /** At the present, before open-ended play: the epilogue to show. */
  epilogue: null | { title: string; text: string };
  /** The player's character sheet. Hidden facts are included only in omniscient views. */
  sheet: CharacterSheet | null;
  pending: DecisionView[];
  feed: FeedEntry[];
  news: NewsEntry[];
  counts: {
    entities: number;
    byType: Record<string, number>;
    byOrigin: Record<string, number>;
    log: number;
    news: number;
    scheduled: number;
    pending: number;
  };
  /** Present only when requested (hashing is O(state size)). */
  stateHash?: string;
  skip: { shortMonths: number };
  lastLoad: LoadInfo | null;
  autosave:
    { at: number; slot: string; ok: true } | { at: number; ok: false; error: string } | null;
  info: {
    engineVersion: string;
    saveVersion: number;
    dataHash: string;
    dataWarnings: number;
    debug: boolean;
    /** False when saves will not survive a reload (storage unavailable). */
    persistentSaves: boolean;
  };
}

export interface ViewOptions {
  /** Show facts nobody in the world knows (rule 4 debug toggle). */
  omniscient: boolean;
  /** Include the state hash (costs a pass over the state). */
  hash: boolean;
}

export interface LogView {
  seq: number;
  tick: number;
  dateLabel: string;
  kind: string;
  summary: string;
  tags: string[];
  actorIds: string[];
  targetIds: string[];
  place: string | null;
  cause?: string;
  causeSeq?: number;
  knownBy: string[];
  /** False for records the player would not know about (shown only in omniscient mode). */
  known: boolean;
}

export interface StatView {
  id: string;
  label: string;
  base: number;
  total: number;
  flatTotal: number;
  pctTotal: number;
  subtotal: number;
  /** "Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)" */
  description: string;
  lines: BreakdownLine[];
}

export interface EntityView {
  id: string;
  name: string;
  type: string;
  origin: string;
  tier: 1 | 2;
  createdTick: number;
  createdLabel: string;
  isPlayer: boolean;
  flags: Record<string, boolean | number | string>;
  knownBy: string[];
  stats: StatView[];
  /** Recent log records involving this entity (any visibility: this is a debug view). */
  recent: LogView[];
}

export interface EntityListItem {
  id: string;
  name: string;
  type: string;
  origin: string;
  tier: 1 | 2;
}

export interface EventListItem {
  id: string;
  title: string;
  type: string;
  visibility: string;
  choices: number;
  tags: string[];
}

export interface LogQueryRequest {
  filter: LogFilter;
  omniscient: boolean;
  offset?: number;
  limit?: number;
}

export interface LogQueryResult {
  /** Records matching the filter and visible to the viewer. */
  total: number;
  /** Newest first. */
  records: LogView[];
  /** Every tag and kind in the whole log, for filter dropdowns. */
  tags: string[];
  kinds: string[];
}

export interface SavesState {
  slots: SlotSummary[];
  persistent: boolean;
  counts: { autosaveSlots: number; manualSlots: number };
  /** Lets the page refuse an oversized file before reading it into memory. */
  limits: { maxImportBytes: number };
}

/** The fixed lists the New Life screens choose from. */
export interface GenesisSetup {
  races: {
    id: string;
    name: string;
    description: string;
    rare: boolean;
    capMods: Record<string, number>;
    anchors: { childEnds: number; primeStarts: number; elderStarts: number };
    lifespan: { min: number; max: number };
    traits: { name: string; description: string }[];
    birthplaces: string[];
  }[];
  birthplaces: {
    id: string;
    name: string;
    shortName: string;
    description: string;
    opens: string;
    wealth: string;
    safety: string;
    region: string;
    races: string[];
    traits: string[];
    map: { x: number; y: number } | null;
  }[];
  legacies: { id: string; name: string; description: string; traits: string[] }[];
  foci: { id: string; name: string; description: string }[];
  difficulties: { id: string; name: string; summary: string }[];
  canonModes: { id: string; name: string; summary: string }[];
  entry: {
    minYear: number;
    maxYear: number;
    minAge: number;
    maxAge: number;
    focusAboveAge: number;
  };
  defaults: GenesisOptions;
  presentYear: number;
  canonYearOffset: number;
  era: string;
  appearanceFields: { id: string; label: string }[];
  /** Month names, for writing dates. */
  months: string[];
}

export interface GenesisPreview {
  /** The options as understood (a blank seed filled in, defaults applied). */
  options: GenesisOptions;
  /** What "random" turned into. */
  resolved: null | {
    race: string;
    birthplace: string;
    legacy: string;
    focus: string | null;
    random: { race: boolean; birthplace: boolean; legacy: boolean; focus: boolean };
  };
  /** Whether a backstory focus applies at this entry age. */
  focusApplies: boolean;
  warnings: EntryWarning[];
  notes: string[];
  /** Null when these options cannot make a character; `error` says why. */
  sheet: CharacterSheet | null;
  error: string | null;
  /** True when the character could start (no blocking problem). */
  canStart: boolean;
  appearance: {
    field: string;
    label: string;
    optionId: string;
    locked: boolean;
    options: { id: string; label: string }[];
  }[];
  entry: null | {
    tick: number;
    label: string;
    canonYear: number;
    birthLabel: string;
    ageAtPresent: number;
  };
  /** How long generating took, in milliseconds (the plan's target is under 200). */
  ms: number;
}

export interface AdvanceReport {
  ticksRun: number;
  stop: StopReason | 'cancelled';
  snapshot: Snapshot;
}

export interface Progress {
  ticksRun: number;
  target: number;
  tick: number;
}

// ---- Requests -------------------------------------------------------------------------------

export interface Protocol {
  boot: {
    req: { autoResume: boolean; view: ViewOptions };
    res: { snapshot: Snapshot; resumed: LoadInfo | null; notice: string | null };
  };
  newWorld: {
    req: { seed?: string; probe?: boolean; fixtures?: boolean; view: ViewOptions };
    res: { snapshot: Snapshot };
  };
  snapshot: { req: { view: ViewOptions }; res: { snapshot: Snapshot } };
  advance: {
    req: { plan: AdvancePlan; decisions?: DecisionPolicy; view: ViewOptions };
    res: AdvanceReport;
  };
  dispatch: { req: { action: unknown; view: ViewOptions }; res: { snapshot: Snapshot } };
  inspect: { req: { entityId: string }; res: EntityView | null };
  listEntities: {
    req: { type?: string; origin?: string; text?: string; limit?: number };
    res: { items: EntityListItem[]; total: number };
  };
  queryLog: { req: LogQueryRequest; res: LogQueryResult };
  listEvents: { req: Record<string, never>; res: EventListItem[] };
  'saves/list': { req: Record<string, never>; res: SavesState };
  'saves/save': { req: { slot: string; label?: string }; res: SavesState };
  'saves/load': {
    req: { slot: string; view: ViewOptions };
    res: { snapshot: Snapshot; load: LoadInfo };
  };
  'saves/delete': { req: { slot: string }; res: SavesState };
  'saves/export': { req: Record<string, never>; res: { filename: string; bytes: Uint8Array } };
  'saves/import': {
    req: { bytes: Uint8Array; view: ViewOptions };
    res: { snapshot: Snapshot; load: LoadInfo };
  };
  hash: { req: Record<string, never>; res: { stateHash: string; dataHash: string } };
  'genesis/setup': { req: Record<string, never>; res: GenesisSetup };
  'genesis/preview': { req: { options: unknown; view: ViewOptions }; res: GenesisPreview };
  'genesis/start': { req: { options: unknown; view: ViewOptions }; res: { snapshot: Snapshot } };
  'debug/genesisStats': { req: { raceId: string; rolls?: number }; res: GenesisStats };
  'debug/trainingCurve': {
    req: { potential: number; start: number; months: number; points: number };
    res: { points: CurvePoint[]; softCap: number };
  };
  'debug/lives': { req: { raceId: string; lives: number; seed?: string }; res: LivesReport };
  // ---- The world (Phase 3)
  'world/map': { req: Record<string, never>; res: MapView };
  'world/place': { req: { id: string; view: ViewOptions }; res: PlaceDetailView | null };
  'world/canon': { req: Record<string, never>; res: CanonView };
  'world/factions': { req: { generated?: boolean }; res: FactionView[] };
  // ---- Powers (Phase 4)
  'powers/fruits': { req: { view: ViewOptions }; res: FruitsView | null };
}

/** A handful of headless lives of one race, for the debug panel's lifespan chart. */
export interface LivesReport {
  race: string;
  raceName: string;
  lifespan: { min: number; max: number };
  lives: {
    seed: string;
    age: number;
    cause: string | null;
    outcomes: number;
    job: string | null;
  }[];
  mean: number;
  ms: number;
}

export type Op = keyof Protocol;

export interface RequestHooks {
  onProgress?: (progress: Progress) => void;
}

// ---- Wire messages --------------------------------------------------------------------------

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  issues?: DataIssue[];
}

export type ToWorker =
  | { type: 'init'; debug: boolean }
  | { type: 'request'; id: number; op: Op; payload: unknown }
  | { type: 'cancel' };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'fatal'; error: SerializedError }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: SerializedError }
  | ({ type: 'progress'; id: number } & Progress);
