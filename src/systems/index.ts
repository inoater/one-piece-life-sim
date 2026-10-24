import { autosave } from '../engine/autosave';
import { PIPELINE_ORDER, type TickStep } from '../engine/pipeline';
import { aging } from './aging';
import { resolveActions } from './actions';
import { rollEvents } from './events';
import { compileNews } from './news';
import { npcDecisions } from './population';
import { advanceVoyages } from './travel';
import { updateWorld } from './world';
import { setHistoryPipeline } from './places/history';

/**
 * The tick pipeline, in order. A new system is one line added here (and, if it needs a new slot,
 * one entry in PIPELINE_ORDER in engine/pipeline.ts; a test keeps the two in step).
 */
export const PIPELINE: readonly TickStep[] = [
  resolveActions,
  advanceVoyages,
  npcDecisions,
  updateWorld,
  rollEvents,
  compileNews,
  aging,
  autosave,
];

export const PIPELINE_IDS: readonly string[] = PIPELINE.map((s) => s.id);

/**
 * The world's past (Phase 3, places/history.ts): the same steps without the player's actions,
 * voyages, aging or autosaves, played from Year 0 up to the month a life begins.
 */
export const HISTORY_PIPELINE: readonly TickStep[] = [
  npcDecisions,
  updateWorld,
  rollEvents,
  compileNews,
];
setHistoryPipeline(HISTORY_PIPELINE);
export { PIPELINE_ORDER };
