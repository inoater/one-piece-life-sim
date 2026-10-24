import { dateOf, formatDate } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';

/**
 * The world's history as a readable timeline (Phase 3): every canon beat that happened or did not,
 * every early death of a famous character, and the headlines of the world, in order. This is what
 * `npm run world` prints after a 39-year run with nobody in it.
 */

export interface TimelineEntry {
  tick: number;
  date: string;
  kind: 'canon' | 'divergence' | 'news';
  text: string;
}

export function worldTimeline(
  state: WorldState,
  data: GameData,
  options: { news?: boolean } = {},
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const date = (tick: number) => formatDate(dateOf(data.calendar, tick));
  for (const record of state.log) {
    if (record.kind !== 'canon') continue;
    out.push({
      tick: record.tick,
      date: date(record.tick),
      kind: record.tags.includes('divergence') ? 'divergence' : 'canon',
      text: record.summary,
    });
  }
  for (const d of state.canon.divergences) {
    if (d.kind !== 'early-death') continue;
    out.push({ tick: d.tick, date: date(d.tick), kind: 'divergence', text: d.text });
  }
  if (options.news !== false) {
    for (const item of state.news) {
      out.push({ tick: item.tick, date: date(item.tick), kind: 'news', text: item.text });
    }
  }
  const order = { canon: 0, divergence: 1, news: 2 } as const;
  return out.sort((a, b) => a.tick - b.tick || order[a.kind] - order[b.kind]);
}
