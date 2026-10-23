import { dateOf } from './calendar';
import type { GameData } from './data/schemas';
import {
  assertPipeline,
  type NewsDraft,
  type SideEffect,
  type TickContext,
  type TickStep,
} from './pipeline';
import type { Rng } from './rng';
import type { WorldState } from './state';

/**
 * Running the pipeline for one month.
 *
 *   runTick(state, data, rng, pipeline)         pure: returns a new state, input untouched
 *   runTickInPlace(state, data, rng, pipeline)  mutates `state`; used by bulk advances and
 *                                               headless sims to avoid copying every month
 *
 * Both give identical results (a test compares their hashes). The public
 * `tick(state, data, rng)` in `src/core.ts` is `runTick` with the default pipeline.
 *
 * Month semantics: `state.tick` is the month about to be lived. A tick processes that month (its
 * actions, events, news, aging) and then advances the clock by one. So 468 ticks starting at 0
 * process Years 0 to 38 and leave the clock on tick 468, the first month of the present.
 */

export interface TickOutput {
  effects: SideEffect[];
}

class StepContext implements TickContext {
  private cachedRng: Rng | null = null;

  constructor(
    readonly data: GameData,
    private readonly tickRng: () => Rng,
    private readonly stepId: string,
    readonly tick: number,
    readonly date: TickContext['date'],
    readonly tiers: TickContext['tiers'],
    readonly effects: SideEffect[],
    readonly newsDrafts: NewsDraft[],
  ) {}

  /** Created on first use: most steps in an empty world never need randomness. */
  get rng(): Rng {
    return (this.cachedRng ??= this.tickRng().fork(this.stepId));
  }
}

export function runTickInPlace(
  state: WorldState,
  data: GameData,
  rng: Rng,
  pipeline: readonly TickStep[],
): TickOutput {
  assertPipeline(pipeline);
  const tick = state.tick;
  const date = dateOf(data.calendar, tick);
  const { tier1Every, tier2Every } = data.settings.tiers;
  const tiers = { tier1Due: tick % tier1Every === 0, tier2Due: tick % tier2Every === 0 };
  const effects: SideEffect[] = [];
  const newsDrafts: NewsDraft[] = [];

  let tickRng: Rng | null = null;
  const getTickRng = () => (tickRng ??= rng.fork('tick', tick));

  for (const step of pipeline) {
    step.run(
      state,
      new StepContext(data, getTickRng, step.id, tick, date, tiers, effects, newsDrafts),
    );
  }

  state.tick = tick + 1;
  return { effects };
}

export function runTick(
  state: WorldState,
  data: GameData,
  rng: Rng,
  pipeline: readonly TickStep[],
): { state: WorldState; effects: SideEffect[] } {
  const next = structuredClone(state);
  const { effects } = runTickInPlace(next, data, rng, pipeline);
  return { state: next, effects };
}
