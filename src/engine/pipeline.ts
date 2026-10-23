import type { DateInfo } from './calendar';
import type { GameData } from './data/schemas';
import type { Rng } from './rng';
import type { WorldState } from './state';

/**
 * The tick pipeline: a fixed, ordered list of registered steps.
 *
 * A step is a function `(state, ctx) => void` that mutates the draft state it is given. `runTick`
 * clones the input first, so callers still see `tick(state, data, rng) -> state` as a pure
 * function. Because steps are plain mutations of a draft, swapping the cloning strategy later
 * (for example to structural sharing) changes no system code.
 *
 * Adding a system is one line in `src/systems/index.ts`.
 */

/** The order from the plan. A test pins the default pipeline to exactly this. */
export const PIPELINE_ORDER = [
  'resolveActions', // 1. resolve the player's chosen actions
  'advanceVoyages', // 2. advance voyages (Phase 3)
  'npcDecisions', //   3. Tier 1 every tick, Tier 2 every third tick
  'updateWorld', //    4. factions, territory, economy
  'rollEvents', //     5. canon beats first, then random events
  'compileNews', //    6. compile news
  'aging', //          7. birthdays, births, deaths, stage changes
  'autosave', //       8. autosave to a rotating slot
] as const;
export type StepId = (typeof PIPELINE_ORDER)[number];

/**
 * Requests the engine hands to its host instead of performing itself. The engine never touches
 * storage or the page (rule 7); the host decides how to honour these.
 */
export type SideEffect = { kind: 'autosave' };

/** News raised by events this tick, turned into news items by the compile-news step. */
export interface NewsDraft {
  text: string;
  tags: string[];
  sourceSeq?: number;
}

export interface TickContext {
  readonly data: GameData;
  /** A stream reserved for this step and tick (see rng.ts). Fork it per entity or purpose. */
  readonly rng: Rng;
  /** The month being processed. Equals `state.tick` until the pipeline finishes. */
  readonly tick: number;
  readonly date: DateInfo;
  readonly tiers: { readonly tier1Due: boolean; readonly tier2Due: boolean };
  readonly effects: SideEffect[];
  readonly newsDrafts: NewsDraft[];
}

export interface TickStep {
  readonly id: string;
  run(state: WorldState, ctx: TickContext): void;
}

export function assertPipeline(pipeline: readonly TickStep[]): void {
  const seen = new Set<string>();
  for (const step of pipeline) {
    if (seen.has(step.id)) throw new Error(`Pipeline has two steps with id "${step.id}"`);
    seen.add(step.id);
  }
}
