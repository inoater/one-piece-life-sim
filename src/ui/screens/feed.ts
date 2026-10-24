import type { Category, DecisionView, FeedEntry } from '../../worker/protocol';
import type { App } from '../app';
import { h, srOnly } from '../dom';
import { dateLabel, formatInteger } from '../format';
import { FEED_THEMES, type FeedFilter, type UiState } from '../store';

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

const FILTER_LABEL: Record<FeedFilter, string> = {
  all: 'All',
  ...CATEGORY_LABEL,
  relationship: 'Relationships',
  combat: 'Combat',
  money: 'Money',
};

/** Whether a line belongs under a filter chip: its category, or (for themes) one of its tags. */
export function matchesFeedFilter(entry: FeedEntry, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  if ((FEED_THEMES as readonly string[]).includes(filter)) return entry.tags.includes(filter);
  return entry.category === filter;
}

/**
 * "Age 7 · March 1497 SC": the plan's life log reads by age first. Lines from the backstory
 * already begin "Age 7:", so a month made only of those keeps its plain date.
 */
function monthLabel(
  label: string,
  tick: number,
  birthTick: number | null,
  entries: readonly FeedEntry[],
): string {
  if (birthTick === null || tick < birthTick) return label;
  if (entries.every((e) => /^Age \d+:/.test(e.summary))) return label;
  return `Age ${Math.floor((tick - birthTick) / 12)} · ${label}`;
}

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

const FILTERS: FeedFilter[] = [
  'all',
  'personal',
  'family',
  'relationship',
  'combat',
  'money',
  'world',
  'news',
  'system',
];

/** Chips that narrow the chronicle to one kind of line, with how many of each there are. */
function renderFilters(state: UiState, entries: readonly FeedEntry[], app: App): HTMLElement {
  const counts = new Map<FeedFilter, number>();
  for (const f of FILTERS) counts.set(f, entries.filter((e) => matchesFeedFilter(e, f)).length);
  return h(
    'div',
    { class: 'feed-filters', role: 'group', 'aria-label': 'Show in the chronicle' },
    FILTERS.filter((f) => f === 'all' || (counts.get(f) ?? 0) > 0 || state.feedFilter === f).map(
      (f) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            dataset: { filter: f },
            'aria-pressed': String(state.feedFilter === f),
            onclick: () => app.store.update({ feedFilter: state.feedFilter === f ? 'all' : f }),
          },
          FILTER_LABEL[f],
          h('span', { class: 'chip__count' }, String(counts.get(f) ?? 0)),
        ),
    ),
  );
}

/** At the present: the epilogue, the world in a few lines, and the way on into open-ended play. */
function renderEpilogue(state: UiState, app: App): HTMLElement | null {
  const s = state.snapshot;
  if (!s?.epilogue) return null;
  const life = s.life;
  return h(
    'section',
    { class: 'epilogue', 'aria-labelledby': 'epilogue-title' },
    h('h3', { class: 'epilogue__title', id: 'epilogue-title' }, s.epilogue.title),
    h('p', { class: 'epilogue__text' }, s.epilogue.text),
    h(
      'ul',
      { class: 'epilogue__facts' },
      h('li', null, `${dateLabel(s.date)}, ${s.date.year} years after God Valley.`),
      life
        ? h(
            'li',
            null,
            life.alive
              ? `${life.name} is ${life.age}${life.job ? `, working as ${life.job.name.toLowerCase()}` : ''}, with fame ${life.fame} and ${formatInteger(life.money.berries)} Berries.`
              : `${life.name} did not live to see it.`,
          )
        : null,
      h(
        'li',
        null,
        `${s.counts.entities} people and things in the world; ${s.counts.log} moments recorded; ${s.counts.news} headlines.`,
      ),
    ),
    h(
      'button',
      {
        class: 'button button--primary',
        type: 'button',
        disabled: state.busy !== null,
        onclick: () =>
          void app.dispatch({ type: 'life/openEnded' }, 'Open-ended play: the seas go on.'),
      },
      'Sail on past the present',
    ),
  );
}

function renderEnded(state: UiState): HTMLElement | null {
  const life = state.snapshot?.life;
  if (!life || life.alive) return null;
  const cause = life.recap?.cause ? ` of ${life.recap.cause}` : '';
  return h(
    'section',
    { class: 'epilogue epilogue--death', 'aria-label': 'This life has ended' },
    h('h3', { class: 'epilogue__title' }, `${life.name}, ${life.recap?.age ?? life.age}`),
    h(
      'p',
      { class: 'epilogue__text' },
      `Died ${life.recap?.died ?? ''}${cause}. Time stands still until someone carries on.`,
    ),
    h('a', { class: 'button button--primary', href: '#/end' }, 'Read the recap and carry on'),
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
  const visible = snapshot.feed.filter((e) => matchesFeedFilter(e, filter));
  const birthTick = snapshot.sheet?.born.tick ?? null;
  let freshIndex = 0;
  const months = groupByMonth(visible).map((group) =>
    h(
      'li',
      { class: 'month', dataset: { tick: String(group.tick) } },
      h(
        'h3',
        { class: 'month__title' },
        monthLabel(group.label, group.tick, birthTick, group.entries),
      ),
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
      ? h('p', { class: 'feed__hint' }, `No ${FILTER_LABEL[filter].toLowerCase()} lines yet.`)
      : null,
    snapshot.pending.map((d) =>
      renderDecision(d, state.busy !== null, !shown.has(d.recordSeq), app),
    ),
    waiting
      ? h(
          'p',
          { class: 'feed__hint' },
          'Nothing has happened yet. Press Next month to start the clock in January 1486 SC.',
        )
      : null,
    renderEnded(state),
    renderEpilogue(state, app),
  );
}
