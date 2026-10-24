import { h, type Child } from '../dom';
import { copyButton } from '../components/copy-button';
import {
  dateLabel,
  formatInteger,
  formatPercent,
  plural,
  presentYearLabel,
  shortHash,
} from '../format';
import type { UiState } from '../store';
import type { Snapshot } from '../../worker/protocol';

const KIND_LABEL: Record<string, string> = {
  government: 'Government',
  marines: 'Navy',
  pirates: 'Pirates',
  revolutionary: 'Revolution',
  kingdom: 'Kingdom',
  underworld: 'Underworld',
  merchants: 'Trade',
  crew: 'Crew',
};

/** The powers of the world (Phase 3): strength as a bar, with the reasons in its tooltip (rule 3). */
function powers(world: Snapshot['world']): HTMLElement | null {
  if (!world.built || world.factions.length === 0) return null;
  const top = world.factions.filter((f) => f.kind !== 'crew' || f.strength >= 20).slice(0, 18);
  const max = Math.max(100, ...top.map((f) => f.strength));
  return h(
    'section',
    { class: 'powers', 'aria-labelledby': 'powers-title' },
    h('h2', { class: 'side-screen__title', id: 'powers-title' }, 'The powers'),
    h(
      'ul',
      { class: 'powers__list' },
      top.map((f) =>
        h(
          'li',
          {
            class: 'power',
            title: f.breakdown,
            dataset: { active: String(f.active), kind: f.kind },
          },
          h(
            'div',
            { class: 'power__head' },
            h('span', { class: 'power__name' }, f.shortName),
            h('span', { class: 'power__kind' }, KIND_LABEL[f.kind] ?? f.kind),
            h(
              'span',
              { class: 'power__value' },
              f.active ? String(Math.round(f.strength)) : 'gone',
            ),
          ),
          h(
            'span',
            { class: 'power__bar', 'aria-hidden': 'true' },
            h('span', {
              class: 'power__fill',
              style: `width: ${((f.strength / max) * 100).toFixed(1)}%`,
            }),
          ),
          f.places > 0 || f.leader
            ? h(
                'span',
                { class: 'power__meta' },
                [
                  f.leader ? `Led by ${f.leader}` : null,
                  f.places > 0 ? `holds ${plural(f.places, 'place')}` : null,
                ]
                  .filter(Boolean)
                  .join('; '),
              )
            : null,
        ),
      ),
    ),
  );
}

/** How the story is going (Phase 3): the canon mode, and what has happened, diverged or waits. */
function story(world: Snapshot['world']): HTMLElement | null {
  if (!world.built) return null;
  const c = world.canon;
  return h(
    'section',
    { 'aria-labelledby': 'story-title' },
    h('h2', { class: 'side-screen__title', id: 'story-title' }, 'The story'),
    facts([
      ['Canon mode', c.mode],
      ['Happened', plural(c.fired, 'famous event')],
      ['Never came to pass', String(c.diverged)],
      ['Still to come', String(c.pending)],
      ['Divergences logged', String(c.divergences)],
      ['The story is known to', c.cutoff],
    ]),
    h('p', null, h('a', { class: 'button', href: '#/canon' }, 'Canon and the Divergence Log')),
  );
}

function people(world: Snapshot['world']): HTMLElement | null {
  if (!world.built) return null;
  const p = world.population;
  return h(
    'section',
    { 'aria-labelledby': 'people-title' },
    h('h2', { class: 'side-screen__title', id: 'people-title' }, 'The people'),
    facts([
      ['Places on the map', String(p.places)],
      ['Named people', formatInteger(p.named)],
      ['Everyone else', formatInteger(p.residents)],
      ['Crews at sea', String(p.crews)],
    ]),
  );
}

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
    h(
      'p',
      { class: 'clock-line' },
      h('strong', null, dateLabel(s.date)),
      ` (year ${s.date.year} of ${presentYear} since God Valley)`,
    ),
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
      ['Era', `Sea Circle (${s.date.era}); the present begins in ${presentYearLabel(s)}`],
    ]),

    powers(s.world),
    story(s.world),
    people(s.world),

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
