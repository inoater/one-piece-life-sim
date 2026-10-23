import { entityIds } from '../engine/entities';
import type { TickStep } from '../engine/pipeline';
import { pruneExpired } from '../engine/stats';

/**
 * Step 7: aging.
 *
 * Phase 2 adds birthdays, births, deaths and stage changes. Today this step does the upkeep that
 * belongs to the passing of time: modifiers whose expiry has arrived are removed. The clock moves
 * to `tick + 1` after the pipeline, so a modifier with `expiresTick === tick + 1` is pruned now.
 * (Readers ignore expired modifiers anyway; pruning only keeps saves small.)
 */
export const aging: TickStep = {
  id: 'aging',
  run(state, ctx) {
    const next = ctx.tick + 1;
    for (const id of entityIds(state)) {
      const entity = state.entities[id];
      if (!entity) continue;
      for (const stat of Object.values(entity.stats)) pruneExpired(stat, next);
    }
  },
};
