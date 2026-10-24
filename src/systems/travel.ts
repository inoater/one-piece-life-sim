import type { TickStep } from '../engine/pipeline';
import { ensureLife } from './life/body';
import type { LifeEnv } from './life/env';
import { harbourMonth, sailMonth } from './voyage/sea';

/**
 * Step 2: advance voyages (Phase 3).
 *
 * Every trip between map nodes is a voyage that takes whole months, locks most actions and rolls
 * sea events (step 5) until arrival. This step moves the player's voyage on by a month: the
 * captain's order, progress, stores, wages and fares, sickness, the stowaway's luck, a wreck, or
 * landfall (voyage/sea.ts). Ashore, a captain's moored ship still has hands to pay.
 *
 * Other people do not sail month by month: the canon cast moves by its keyframes and Tier 2
 * people move a lane a quarter when they choose to.
 */
export const advanceVoyages: TickStep = {
  id: 'advanceVoyages',
  run(state, ctx) {
    const p = ensureLife(state, ctx.data);
    if (!p?.c.life) return;
    const env: LifeEnv = {
      state,
      data: ctx.data,
      tick: ctx.tick,
      rng: ctx.rng.fork('voyage', p.entity.id),
      p,
      life: p.c.life,
      cause: 'sys:voyage',
    };
    if (p.c.travel?.voyage) sailMonth(env);
    else harbourMonth(env);
  },
};
