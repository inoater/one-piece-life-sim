import type { TickContext } from '../../engine/pipeline';
import type { WorldState } from '../../engine/state';
import { ensureLife } from './body';
import type { LifeEnv } from './env';
import { resolveRoutine } from './activities';
import { liveMonth } from './upkeep';

/**
 * The life loop's two places in the tick (Phase 2):
 *
 *   step 1, resolve actions: the player's routine for the month (activities, work, outcomes);
 *   step 7, aging:           growth, birthdays, healing, illness, money, births and deaths.
 *
 * Both draw from the step's own stream forked by the player's id, so the dice of a life never
 * depend on what the rest of the world rolled.
 */

function envFor(state: WorldState, ctx: TickContext): LifeEnv | null {
  const p = ensureLife(state, ctx.data);
  if (!p || !p.c.life) return null;
  return {
    state,
    data: ctx.data,
    tick: ctx.tick,
    rng: ctx.rng.fork('life', p.entity.id),
    p,
    life: p.c.life,
    cause: 'sys:life',
  };
}

export function livePlayerRoutine(state: WorldState, ctx: TickContext): void {
  const env = envFor(state, ctx);
  if (env) resolveRoutine(env);
}

export function livePlayerMonth(state: WorldState, ctx: TickContext): void {
  const env = envFor(state, ctx);
  if (env) liveMonth(env);
}

export { playerHasDied } from './upkeep';
