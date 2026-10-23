import type { TickStep } from '../engine/pipeline';

/**
 * Step 2: advance voyages.
 *
 * Phase 3 fills this in: every trip between map nodes is a voyage that takes whole months, rolls
 * sea events and locks most actions until arrival. Registered now so the pipeline order is fixed
 * from the start and Phase 3 adds behaviour without touching the engine.
 */
export const advanceVoyages: TickStep = {
  id: 'advanceVoyages',
  run() {
    // Nothing sails in an empty world.
  },
};
