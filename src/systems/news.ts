import type { GameData } from '../engine/data/schemas';
import type { TickStep } from '../engine/pipeline';
import type { NewsItem, WorldState } from '../engine/state';
import { newsDelay } from './places/graph';
import { locationIdOf } from './places/place';

/**
 * Step 6: compile news.
 *
 * Events raise news drafts while they fire (step 5); this step turns them into news items in the
 * order they were raised. Since Phase 3 news has a place, and reaches each place 0 to 3 months
 * late depending on how far it is (world.json `news.delay`): the player hears it when it reaches
 * where they are. At sea it reaches nobody; the headlines wait in port (`deliverWaitingNews`).
 * News without a place (a life's own news) is heard at once.
 */

/** Where the player is now (null at sea, or nobody being played). */
function listenerPlace(state: WorldState, data: GameData): string | null | undefined {
  const c = state.playerId ? state.entities[state.playerId]?.character : undefined;
  if (!c) return undefined;
  return locationIdOf(data, c);
}

export function reachTickFor(
  state: WorldState,
  data: GameData,
  place: string | null | undefined,
  tick: number,
): number | null {
  if (!place) return tick;
  const listener = listenerPlace(state, data);
  if (listener === undefined) return tick + newsDelay(data, place, place);
  if (listener === null) return null;
  return tick + newsDelay(data, place, listener);
}

export const compileNews: TickStep = {
  id: 'compileNews',
  run(state, ctx) {
    for (const draft of ctx.newsDrafts) {
      state.counters.newsSeq += 1;
      const item: NewsItem = {
        id: state.counters.newsSeq,
        tick: ctx.tick,
        text: draft.text,
        tags: draft.tags,
        ...(draft.sourceSeq !== undefined ? { sourceSeq: draft.sourceSeq } : {}),
      };
      if (draft.place !== undefined) {
        item.place = draft.place;
        item.reachTick = reachTickFor(state, ctx.data, draft.place, ctx.tick);
      }
      state.news.push(item);
    }
  },
};

/**
 * The player has landed: every headline that could not reach them at sea reaches them now (or
 * when it would have reached this place, if that is later). Returns how many were waiting.
 */
export function deliverWaitingNews(
  state: WorldState,
  data: GameData,
  place: string,
  tick: number,
): number {
  let count = 0;
  for (const item of state.news) {
    if (item.reachTick !== null) continue;
    item.reachTick = Math.max(tick, item.tick + newsDelay(data, item.place, place));
    if (item.reachTick <= tick) count += 1;
  }
  return count;
}

/** Whether the player has heard this headline by `tick`. */
export function newsHeard(item: NewsItem, tick: number): boolean {
  if (item.reachTick === undefined) return true;
  return item.reachTick !== null && item.reachTick <= tick;
}
