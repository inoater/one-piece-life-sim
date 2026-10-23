import type { Category, DecisionView, FeedEntry } from '../../worker/protocol';
import type { App } from '../app';
import { h, srOnly } from '../dom';
import type { UiState } from '../store';

/**
 * The chronicle: what has happened, oldest at the top, newest at the bottom, grouped by month.
 * Lines carry a category (personal, family, world, news, system) as a coloured rule plus hidden
 * text for screen readers, so colour is never the only signal.
 */

export const CATEGORY_LABEL: Record<Category, string> = {
  personal: 'Personal',
  family: 'Family',
  world: 'World',
  news: 'News',
  system: 'System',
};

function groupByMonth(
  entries: readonly FeedEntry[],
): { label: string; tick: number; entries: FeedEntry[] }[] {
  const groups: { label: string; tick: number; entries: FeedEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.tick === entry.tick) last.entries.push(entry);
    else groups.push({ label: entry.dateLabel, tick: entry.tick, entries: [entry] });
  }
  return groups;
}

function renderLine(entry: FeedEntry, fresh: boolean, index: number): HTMLElement {
  return h(
    'li',
    {
      class: fresh ? 'line line--new' : 'line',
      // New lines ink in one after another rather than all at once.
      style: fresh ? `--stagger: ${Math.min(index, 12) * 70}ms` : undefined,
      dataset: { category: entry.category, hidden: String(entry.hidden), seq: String(entry.seq) },
    },
    srOnly(`${CATEGORY_LABEL[entry.category]}. `),
    h('span', { class: 'line__text' }, entry.summary),
    entry.hidden ? h('span', { class: 'line__flag' }, 'Nobody in the world knows this') : null,
  );
}

function renderDecision(
  decision: DecisionView,
  busy: boolean,
  showText: boolean,
  app: App,
): HTMLElement {
  const titleId = `decision-${decision.id}`;
  return h(
    'section',
    { class: 'decision', 'aria-labelledby': titleId },
    h('h3', { class: 'decision__title', id: titleId }, decision.title),
    showText ? h('p', { class: 'decision__text' }, decision.text) : null,
    h(
      'ul',
      { class: 'decision__choices' },
      decision.choices.map((choice) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              class: 'choice',
              type: 'button',
              disabled: busy,
              onclick: () => void app.resolveDecision(decision.id, choice.id),
            },
            h('span', { class: 'choice__label' }, choice.label),
            choice.text ? h('span', { class: 'choice__text' }, choice.text) : null,
          ),
        ),
      ),
    ),
  );
}

const FILTERS: ('all' | Category)[] = ['all', 'personal', 'family', 'world', 'news', 'system'];

/** Chips that narrow the chronicle to one kind of line, with how many of each there are. */
function renderFilters(state: UiState, entries: readonly FeedEntry[], app: App): HTMLElement {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return h(
    'div',
    { class: 'feed-filters', role: 'group', 'aria-label': 'Show in the chronicle' },
    FILTERS.filter((f) => f === 'all' || (counts.get(f) ?? 0) > 0).map((f) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          dataset: { filter: f },
          'aria-pressed': String(state.feedFilter === f),
          onclick: () => app.store.update({ feedFilter: state.feedFilter === f ? 'all' : f }),
        },
        f === 'all' ? 'All' : CATEGORY_LABEL[f],
        h(
          'span',
          { class: 'chip__count' },
          String(f === 'all' ? entries.length : (counts.get(f) ?? 0)),
        ),
      ),
    ),
  );
}

export interface FeedOptions {
  /** Lines with a higher seq than this arrived since the chronicle was last drawn. */
  seenSeq: number;
}

export function renderFeed(
  state: UiState,
  app: App,
  options: FeedOptions = { seenSeq: Infinity },
): HTMLElement {
  const snapshot = state.snapshot;
  if (!snapshot)
    return h('div', { class: 'feed' }, h('p', { class: 'muted' }, 'Loading the world...'));

  const filter = state.feedFilter;
  const visible =
    filter === 'all' ? snapshot.feed : snapshot.feed.filter((e) => e.category === filter);
  let freshIndex = 0;
  const months = groupByMonth(visible).map((group) =>
    h(
      'li',
      { class: 'month', dataset: { tick: String(group.tick) } },
      h('h3', { class: 'month__title' }, group.label),
      h(
        'ul',
        { class: 'month__lines' },
        group.entries.map((entry) => {
          const fresh = entry.seq > options.seenSeq;
          return renderLine(entry, fresh, fresh ? freshIndex++ : 0);
        }),
      ),
    ),
  );

  // The event's sentence is already in the chronicle just above; repeat it only if it is not there.
  const shown = new Set(snapshot.feed.map((f) => f.seq));
  const waiting = snapshot.tick === 0 && snapshot.pending.length === 0;
  return h(
    'div',
    { class: 'feed' },
    snapshot.feed.length > 1 ? renderFilters(state, snapshot.feed, app) : null,
    h('ol', { class: 'chronicle', role: 'log', 'aria-label': 'Chronicle' }, months),
    filter !== 'all' && visible.length === 0
      ? h('p', { class: 'feed__hint' }, `No ${CATEGORY_LABEL[filter].toLowerCase()} lines yet.`)
      : null,
    snapshot.pending.map((d) =>
      renderDecision(d, state.busy !== null, !shown.has(d.recordSeq), app),
    ),
    waiting
      ? h(
          'p',
          { class: 'feed__hint' },
          'Nothing has happened yet. Press Next month to start the clock at Year 0.',
        )
      : null,
    snapshot.atPresent
      ? h(
          'p',
          { class: 'feed__hint' },
          `The present has arrived (Year ${Math.floor(snapshot.presentTick / 12)}). The epilogue and open-ended play come in Phase 2.`,
        )
      : null,
  );
}
