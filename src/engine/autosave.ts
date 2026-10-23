import type { TickStep } from './pipeline';

/**
 * Step 8: autosave to a rotating slot.
 *
 * The engine never touches storage (rule 7), so this step only *requests* a save by adding an
 * effect. The host serialises the state after the tick and writes it to the least recently used of
 * the autosave slots. Keeping the request out of the state means saving never changes a hash.
 */
export const autosave: TickStep = {
  id: 'autosave',
  run(_state, ctx) {
    const every = ctx.data.settings.saves.autosaveEveryTicks;
    if ((ctx.tick + 1) % every === 0) ctx.effects.push({ kind: 'autosave' });
  },
};
