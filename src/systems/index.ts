import { autosave } from '../engine/autosave';
import { PIPELINE_ORDER, type TickStep } from '../engine/pipeline';
import { aging } from './aging';
import { resolveActions } from './actions';
import { rollEvents } from './events';
import { compileNews } from './news';
import { npcDecisions } from './population';
import { advanceVoyages } from './travel';
import { updateWorld } from './world';

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
export { PIPELINE_ORDER };
