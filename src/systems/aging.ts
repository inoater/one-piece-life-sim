import { entityIds } from '../engine/entities';
import type { TickStep } from '../engine/pipeline';
import { pruneExpired } from '../engine/stats';
import { livePlayerMonth } from './life';

/**
 * Step 7: aging.
 *
 * Upkeep first: modifiers whose expiry has arrived are removed. The clock moves to `tick + 1` after
 * the pipeline, so a modifier with `expiresTick === tick + 1` is pruned now. (Readers ignore
 * expired modifiers anyway; pruning only keeps saves small.)
 *
 * Then the passing of a month for the person being played and the people around them (Phase 2,
 * src/systems/life/upkeep.ts): natural growth and decline, birthdays and stage changes, healing and
 * illness, money, births, and deaths.
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
    livePlayerMonth(state, ctx);
  },
};
