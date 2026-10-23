import { h, type Child } from '../dom';
import { copyButton } from '../components/copy-button';
import { formatPercent, plural, shortHash } from '../format';
import type { UiState } from '../store';

function facts(rows: readonly [string, Child | readonly Child[]][]): HTMLElement {
  return h(
    'dl',
    { class: 'facts' },
    rows.map(([label, value]) =>
      h('div', { class: 'facts__row' }, h('dt', null, label), h('dd', null, value)),
    ),
  );
}

function breakdown(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => plural(n, name));
  return parts.length > 0 ? parts.join(', ') : 'none';
}

export function renderWorld(state: UiState): HTMLElement {
  const s = state.snapshot;
  if (!s)
    return h('div', { class: 'side-screen' }, h('p', { class: 'muted' }, 'Loading the world...'));

  const presentYear = Math.floor(s.presentTick / 12);
  const tide = h('div', {
    class: 'tide',
    role: 'img',
    'aria-label': `${formatPercent(s.progress)} of the way to the present`,
    style: `--progress: ${s.progress}; --years: ${presentYear}`,
  });

  return h(
    'div',
    { class: 'side-screen' },
    h('h2', { class: 'side-screen__title' }, 'The clock'),
    h('p', { class: 'clock-line' }, h('strong', null, `Year ${s.date.year}`), ` of ${presentYear}`),
    tide,
    h(
      'p',
      { class: 'muted' },
      s.atPresent
        ? `The present has arrived: all ${s.presentTick} months have passed.`
        : `${plural(s.tick, 'month')} of ${s.presentTick} have passed, ${formatPercent(s.progress)} of the way to the present.`,
    ),
    facts([
      ['Calendar', `${s.date.monthName}, ${s.date.seasonName.toLowerCase()}`],
      ['Canon year', String(s.date.canonYear)],
    ]),

    h('h2', { class: 'side-screen__title' }, 'The world'),
    h('p', null, h('a', { class: 'button', href: '#/map' }, 'Open the world map')),
    facts([
      ['Seed', [h('code', null, s.seed), ' ', copyButton(s.seed)]],
      ['Entities', s.counts.entities === 0 ? 'none yet' : breakdown(s.counts.byType)],
      ['Origins', s.counts.entities === 0 ? 'none yet' : breakdown(s.counts.byOrigin)],
      ['Recorded events', String(s.counts.log)],
      ['Headlines', String(s.counts.news)],
      ['Scheduled', String(s.counts.scheduled)],
      ['Decisions waiting', String(s.counts.pending)],
    ]),

    h('h2', { class: 'side-screen__title' }, 'This build'),
    facts([
      ['Engine', s.info.engineVersion],
      ['Save format', `version ${s.info.saveVersion}`],
      [
        'Game content',
        [
          h('code', null, shortHash(s.info.dataHash, 10)),
          s.info.dataWarnings > 0 ? ` (${plural(s.info.dataWarnings, 'warning')})` : '',
        ],
      ],
      [
        'Simulation runs in',
        state.hostMode === 'worker'
          ? 'a Web Worker'
          : state.hostMode === 'inline'
            ? 'the main thread'
            : 'unknown',
      ],
      [
        'Saves',
        s.info.persistentSaves
          ? 'kept in this browser'
          : 'not kept between visits (storage unavailable)',
      ],
    ]),
  );
}
