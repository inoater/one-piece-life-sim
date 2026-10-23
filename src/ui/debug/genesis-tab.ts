import type { App } from '../app';
import { h, svg } from '../dom';
import { errorMessage, formatValue } from '../format';
import type { UiState } from '../store';
import type { GenesisStats } from '../../worker/protocol';
import type { DebugTab } from './tab';

/**
 * Genesis: "1,000 rolls per race match the cap table in a debug histogram" (Phase 1, done-when).
 *
 * Rolls the hidden potential of many characters of one race with the generator's own formula and
 * shows, per stat, the race cap the table promises next to what came out, plus a histogram of
 * potential / (race cap x birthplace modifier), which is talent x random and the same shape for
 * every race.
 */
export function createGenesisTab(app: App): DebugTab {
  const raceSelect = h('select', { class: 'debug__input', 'aria-label': 'Race' });
  const rollsInput = h('input', {
    class: 'debug__input debug__input--short',
    type: 'number',
    min: '100',
    max: '20000',
    step: '100',
    value: '1000',
    'aria-label': 'Rolls',
  });
  const statSelect = h('select', { class: 'debug__input', 'aria-label': 'Histogram stat' });
  const runButton = h('button', { class: 'button button--tiny', type: 'button' }, 'Roll');
  const allButton = h(
    'button',
    { class: 'button button--tiny', type: 'button' },
    'Check every race',
  );
  const verdict = h('p', { class: 'debug__note' });
  const output = h('div', { class: 'debug__genesis' });
  let last: GenesisStats | null = null;
  let loaded = false;

  const rolls = () => Math.min(20000, Math.max(100, Math.round(Number(rollsInput.value) || 1000)));

  function histogram(stats: GenesisStats, statId: string): SVGSVGElement | null {
    const row = stats.stats.find((s) => s.stat === statId);
    if (!row) return null;
    const max = Math.max(1, ...row.histogram);
    const width = 280;
    const height = 90;
    const barWidth = width / row.histogram.length;
    const label = (i: number) => formatValue(stats.bins.from + i * stats.bins.width);
    return svg(
      'svg',
      {
        class: 'debug__histogram',
        viewBox: `0 0 ${width} ${height + 14}`,
        role: 'img',
        'aria-label': `Histogram of ${statId} potential divided by the race cap, ${stats.rolls} rolls`,
      },
      row.histogram.map((count, i) =>
        svg(
          'rect',
          {
            x: (i * barWidth + 0.5).toFixed(2),
            y: (height - (count / max) * height).toFixed(2),
            width: Math.max(1, barWidth - 1).toFixed(2),
            height: ((count / max) * height).toFixed(2),
          },
          svg('title', null, `${label(i)} to ${label(i + 1)}: ${count}`),
        ),
      ),
      [0, 8, 16, 24].map((i) =>
        svg('text', { x: (i * barWidth).toFixed(1), y: String(height + 12) }, `x${label(i)}`),
      ),
    );
  }

  function render(stats: GenesisStats): void {
    last = stats;
    verdict.textContent = stats.ok
      ? `${stats.raceName}: ${stats.rolls} rolls match the cap table (within ${stats.tolerancePct}%).`
      : `${stats.raceName}: ${stats.problems.join('; ')}`;
    verdict.dataset['kind'] = stats.ok ? 'ok' : 'bad';
    if (statSelect.options.length === 0) {
      for (const row of stats.stats) statSelect.append(h('option', { value: row.stat }, row.stat));
    }
    const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
    output.replaceChildren(
      h('h4', null, 'Potential per stat'),
      h(
        'table',
        { class: 'debug__table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ['Stat', 'Race cap', 'Ordinary mean', 'Mean', 'Expected', 'Min-max'].map((t) =>
              h('th', { scope: 'col' }, t),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          stats.stats.map((r) =>
            h(
              'tr',
              { dataset: { stat: r.stat } },
              h('th', { scope: 'row' }, r.stat),
              h('td', null, `${formatValue(r.raceCap)} (${pct(r.capMod)})`),
              h('td', null, `${r.ordinaryMean.toFixed(1)} (${pct(r.capDeviationPct)})`),
              h('td', null, r.observedMean.toFixed(1)),
              h('td', null, `${r.expectedMean.toFixed(1)} (${pct(r.deviationPct)})`),
              h('td', null, `${r.min.toFixed(0)}-${r.max.toFixed(0)}`),
            ),
          ),
        ),
      ),
      h('h4', null, 'Talent tiers'),
      h(
        'table',
        { class: 'debug__table' },
        h(
          'tbody',
          null,
          stats.talent.map((t) =>
            h(
              'tr',
              null,
              h('th', { scope: 'row' }, t.name),
              h('td', null, `${t.observedPct.toFixed(1)}%`),
              h('td', null, `expected ${t.expectedPct}%`),
            ),
          ),
        ),
      ),
      h('h4', null, 'Histogram: potential / (race cap x birthplace)'),
      h('div', { class: 'debug__inline' }, statSelect),
      histogram(stats, statSelect.value || stats.stats[0]?.stat || '') ?? '',
    );
  }

  async function run(): Promise<void> {
    const raceId = raceSelect.value;
    if (!raceId) return;
    runButton.disabled = true;
    try {
      render(await app.host.call('debug/genesisStats', { raceId, rolls: rolls() }));
    } catch (error) {
      verdict.textContent = errorMessage(error);
      verdict.dataset['kind'] = 'bad';
    } finally {
      runButton.disabled = false;
    }
  }

  async function runAll(): Promise<void> {
    allButton.disabled = true;
    const lines: string[] = [];
    let ok = true;
    try {
      for (const option of [...raceSelect.options]) {
        const stats = await app.host.call('debug/genesisStats', {
          raceId: option.value,
          rolls: rolls(),
        });
        ok &&= stats.ok;
        lines.push(`${stats.raceName} ${stats.ok ? 'ok' : 'off'}`);
      }
      verdict.textContent = `${ok ? 'Every race matches' : 'Some races do not match'} the cap table over ${rolls()} rolls: ${lines.join(', ')}.`;
      verdict.dataset['kind'] = ok ? 'ok' : 'bad';
    } catch (error) {
      verdict.textContent = errorMessage(error);
      verdict.dataset['kind'] = 'bad';
    } finally {
      allButton.disabled = false;
    }
  }

  runButton.addEventListener('click', () => void run());
  allButton.addEventListener('click', () => void runAll());
  raceSelect.addEventListener('change', () => void run());
  statSelect.addEventListener('change', () => {
    if (last) render(last);
  });

  const el = h(
    'div',
    { class: 'debug__section-stack' },
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Potential by race'),
      h('div', { class: 'debug__inline' }, raceSelect, rollsInput, runButton, allButton),
      verdict,
      output,
    ),
  );

  return {
    el,
    async refresh() {
      if (loaded) return;
      loaded = true;
      try {
        const setup = await app.host.call('genesis/setup', {});
        raceSelect.replaceChildren(...setup.races.map((r) => h('option', { value: r.id }, r.name)));
        await run();
      } catch (error) {
        loaded = false;
        verdict.textContent = errorMessage(error);
      }
    },
    sync(state: UiState) {
      void state;
    },
  };
}
