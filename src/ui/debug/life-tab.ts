import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h, svg } from '../dom';
import { errorMessage, formatValue } from '../format';
import type { UiState } from '../store';
import type { CurvePoint, LivesReport } from '../../worker/protocol';
import type { DebugTab } from './tab';

/**
 * Life (Phase 2 "done when"):
 *  - "A debug chart shows diminishing returns on a stat near its potential": a stat trained every
 *    month with the real formula, its value climbing toward potential and its monthly gain falling
 *    away, with the soft cap (90%) marked where gains drop to a tenth.
 *  - Lifespans: whole headless lives of one race, as a histogram against the race's range
 *    (`npm run lives` does the full 1,000 per race).
 *  - Tools to hurt or end the current life, to look at injuries and the death screen quickly.
 */
export function createLifeTab(app: App): DebugTab {
  // Every place on the map, filled the first time the tab opens (debug/teleport).
  const placeSelect = h('select', { class: 'debug__input', 'aria-label': 'Place to go to' });
  const num = (value: string, label: string, step = '1') =>
    h('input', {
      class: 'debug__input debug__input--short',
      type: 'number',
      value,
      step,
      'aria-label': label,
    });
  const potentialInput = num('100', 'Potential');
  const startInput = num('10', 'Start value');
  const pointsInput = num('1', 'Points per month (base x effort x stage x teacher)', '0.1');
  const monthsInput = num('300', 'Months');
  const curveButton = h('button', { class: 'button button--tiny', type: 'button' }, 'Draw');
  const curveNote = h('p', { class: 'debug__note' });
  const curveOut = h('div');

  const raceSelect = h('select', { class: 'debug__input', 'aria-label': 'Race' });
  const livesInput = num('10', 'Lives');
  const livesButton = h('button', { class: 'button button--tiny', type: 'button' }, 'Live them');
  const livesNote = h('p', { class: 'debug__note' });
  const livesOut = h('div');
  const toolsNote = h('p', { class: 'debug__note' });
  let loaded = false;

  function curveChart(points: CurvePoint[], potential: number, softCap: number): SVGSVGElement {
    const w = 300;
    const hgt = 120;
    const maxMonth = Math.max(1, points[points.length - 1]?.month ?? 1);
    const maxGain = Math.max(1e-9, ...points.map((p) => p.gain));
    const x = (m: number) => ((m / maxMonth) * w).toFixed(1);
    const yValue = (v: number) => (hgt - (v / (potential * 1.05)) * hgt).toFixed(1);
    const yGain = (g: number) => (hgt - (g / maxGain) * hgt * 0.9).toFixed(1);
    const line = (f: (p: CurvePoint) => string) =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.month)},${f(p)}`).join(' ');
    return svg(
      'svg',
      {
        class: 'debug__curve',
        viewBox: `0 0 ${w} ${hgt + 14}`,
        role: 'img',
        'aria-label':
          'Value over months (solid) and monthly gain (dashed), with potential and the soft cap',
      },
      svg('line', {
        x1: 0,
        x2: w,
        y1: yValue(potential),
        y2: yValue(potential),
        class: 'debug__curve-cap',
      }),
      svg('line', {
        x1: 0,
        x2: w,
        y1: yValue(potential * softCap),
        y2: yValue(potential * softCap),
        class: 'debug__curve-soft',
      }),
      svg('path', { d: line((p) => yValue(p.value)), class: 'debug__curve-value' }),
      svg('path', { d: line((p) => yGain(p.gain)), class: 'debug__curve-gain' }),
      svg(
        'text',
        { x: 2, y: Number(yValue(potential)) - 2 },
        `potential ${formatValue(potential)}`,
      ),
      svg(
        'text',
        { x: 2, y: Number(yValue(potential * softCap)) + 9 },
        `soft cap ${Math.round(softCap * 100)}%`,
      ),
      svg('text', { x: 0, y: hgt + 12 }, '0'),
      svg('text', { x: w - 30, y: hgt + 12 }, `${maxMonth} mo`),
    );
  }

  async function drawCurve(): Promise<void> {
    curveButton.disabled = true;
    try {
      const potential = Math.max(1, Number(potentialInput.value) || 100);
      const res = await app.host.call('debug/trainingCurve', {
        potential,
        start: Math.max(0, Number(startInput.value) || 0),
        months: Math.max(1, Math.round(Number(monthsInput.value) || 300)),
        points: Math.max(0.01, Number(pointsInput.value) || 1),
      });
      const at = (ratio: number) => res.points.find((p) => p.ratio >= ratio);
      const half = at(0.5);
      const near = at(0.8);
      const soft = at(res.softCap);
      curveNote.textContent = [
        half
          ? `At 50% of potential: +${formatValue(half.gain)} a month (month ${half.month}).`
          : '',
        near ? `At 80%: +${formatValue(near.gain)}.` : '',
        soft
          ? `Past the soft cap: +${formatValue(soft.gain)} (a tenth).`
          : 'Never reaches the soft cap in this time.',
      ]
        .filter(Boolean)
        .join(' ');
      curveNote.dataset['kind'] = 'ok';
      curveOut.replaceChildren(curveChart(res.points, potential, res.softCap));
    } catch (error) {
      curveNote.textContent = errorMessage(error);
      curveNote.dataset['kind'] = 'bad';
    } finally {
      curveButton.disabled = false;
    }
  }

  function livesChart(report: LivesReport): SVGSVGElement {
    const w = 300;
    const hgt = 90;
    const top = Math.max(report.lifespan.max * 1.4, ...report.lives.map((l) => l.age)) || 1;
    const bins = 28;
    const width = top / bins;
    const counts = Array.from(
      { length: bins },
      (_, i) => report.lives.filter((l) => l.age >= i * width && l.age < (i + 1) * width).length,
    );
    const max = Math.max(1, ...counts);
    const bw = w / bins;
    return svg(
      'svg',
      {
        class: 'debug__histogram',
        viewBox: `0 0 ${w} ${hgt + 14}`,
        role: 'img',
        'aria-label': `Ages at death of ${report.lives.length} ${report.raceName} lives; the shaded band is the race's lifespan range`,
      },
      svg('rect', {
        x: ((report.lifespan.min / top) * w).toFixed(1),
        y: 0,
        width: (((report.lifespan.max - report.lifespan.min) / top) * w).toFixed(1),
        height: hgt,
        class: 'debug__band',
      }),
      counts.map((c, i) =>
        svg(
          'rect',
          {
            x: (i * bw + 0.5).toFixed(1),
            y: (hgt - (c / max) * hgt).toFixed(1),
            width: Math.max(1, bw - 1).toFixed(1),
            height: ((c / max) * hgt).toFixed(1),
          },
          svg('title', null, `${Math.round(i * width)} to ${Math.round((i + 1) * width)}: ${c}`),
        ),
      ),
      svg('text', { x: 0, y: hgt + 12 }, '0'),
      svg('text', { x: w - 24, y: hgt + 12 }, String(Math.round(top))),
    );
  }

  async function runLives(): Promise<void> {
    const raceId = raceSelect.value;
    if (!raceId) return;
    livesButton.disabled = true;
    livesNote.textContent = 'Living them...';
    try {
      const lives = Math.min(200, Math.max(1, Math.round(Number(livesInput.value) || 10)));
      const report = await app.host.call('debug/lives', { raceId, lives });
      const { min, max } = report.lifespan;
      const ok = report.mean >= ((min + max) / 2) * 0.9 && report.mean <= ((min + max) / 2) * 1.1;
      livesNote.textContent = `${report.lives.length} ${report.raceName} lives: mean age ${formatValue(report.mean)} against a range of ${min} to ${max} (${(report.ms / 1000).toFixed(1)} s). ${ok ? 'Within 10% of the middle.' : 'Outside 10% of the middle: try more lives, or npm run lives.'}`;
      livesNote.dataset['kind'] = ok ? 'ok' : 'bad';
      livesOut.replaceChildren(livesChart(report));
    } catch (error) {
      livesNote.textContent = errorMessage(error);
      livesNote.dataset['kind'] = 'bad';
    } finally {
      livesButton.disabled = false;
    }
  }

  const tool = (label: string, action: unknown, note: string) =>
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        onclick: () =>
          void app.dispatch(action, note).then((ok) => {
            toolsNote.textContent = ok ? note : 'Did not work: see the status line.';
          }),
      },
      label,
    );

  curveButton.addEventListener('click', () => void drawCurve());
  livesButton.addEventListener('click', () => void runLives());

  const el = h(
    'div',
    { class: 'debug__section-stack' },
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Diminishing returns'),
      h(
        'p',
        { class: 'debug__note' },
        'One stat trained every month with the game’s formula, nothing else happening.',
      ),
      h(
        'div',
        { class: 'debug__inline' },
        potentialInput,
        startInput,
        pointsInput,
        monthsInput,
        curveButton,
      ),
      curveNote,
      curveOut,
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Lifespans'),
      h('div', { class: 'debug__inline' }, raceSelect, livesInput, livesButton),
      livesNote,
      livesOut,
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'The current life'),
      h(
        'div',
        { class: 'debug__inline' },
        tool(
          'Minor injury',
          { type: 'debug/injure', severity: 'minor', area: 'roll' },
          'Debug: a minor injury.',
        ),
        tool(
          'Serious injury',
          { type: 'debug/injure', severity: 'serious', area: 'roll' },
          'Debug: a serious injury.',
        ),
        tool(
          'Severe injury',
          { type: 'debug/injure', severity: 'severe', area: 'roll' },
          'Debug: a severe injury.',
        ),
        confirmButton({
          label: 'End this life',
          confirmLabel: 'Press again to end it',
          className: 'button button--tiny',
          onConfirm: () =>
            void app.dispatch(
              { type: 'debug/kill', cause: 'a debug command' },
              'Debug: the life ended.',
            ),
        }),
      ),
      toolsNote,
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Go anywhere'),
      h(
        'div',
        { class: 'debug__inline' },
        placeSelect,
        h(
          'button',
          {
            class: 'button button--tiny',
            type: 'button',
            onclick: () =>
              void app.dispatch(
                { type: 'debug/teleport', location: placeSelect.value },
                'Debug: moved.',
              ),
          },
          'Go there',
        ),
      ),
      h('h3', null, 'Powers (Phase 4)'),
      h(
        'div',
        { class: 'debug__inline' },
        tool('Give a Devil Fruit', { type: 'debug/giveFruit' }, 'Debug: a Devil Fruit to carry.'),
        tool(
          'Wake Observation',
          { type: 'debug/wakeHaki', haki: 'observation' },
          'Debug: Observation Haki woke.',
        ),
        tool(
          'Wake Armament',
          { type: 'debug/wakeHaki', haki: 'armament' },
          'Debug: Armament Haki woke.',
        ),
      ),
      h('h3', null, 'Hands (Phase 6)'),
      h(
        'div',
        { class: 'debug__inline' },
        tool(
          'Give a cutlass',
          { type: 'debug/giveItem', item: 'weapon_sword' },
          'Debug: a cutlass.',
        ),
        tool(
          'Give a Skillful blade',
          { type: 'debug/giveItem', item: 'weapon_template_skillful' },
          'Debug: a Skillful Grade blade.',
        ),
        tool(
          'Give a flame dial',
          { type: 'debug/giveItem', item: 'item_flame_dial' },
          'Debug: a dial.',
        ),
        tool(
          'Give a Den Den Mushi',
          { type: 'debug/giveItem', item: 'item_den_den_mushi' },
          'Debug: a snail.',
        ),
        tool(
          'Shipbuilding 60',
          { type: 'debug/handSkill', skill: 'shipbuilding', value: 60 },
          'Debug: shipbuilding 60.',
        ),
        tool(
          'Smithing 60',
          { type: 'debug/handSkill', skill: 'smithing', value: 60 },
          'Debug: smithing 60.',
        ),
      ),
      h('h3', null, 'Fights (Phase 5)'),
      h(
        'p',
        { class: 'debug__note' },
        'Start a fight with nameless foes from data/battle.json: a tactical one shows the battle panel in the chronicle.',
      ),
      h(
        'div',
        { class: 'debug__inline' },
        tool(
          'Duel: a pirate',
          {
            type: 'debug/fight',
            foe: 'foe_pirate',
            count: 1,
            scale: 'duel',
            intent: 'capture',
            mode: 'tactical',
          },
          'Debug: a duel.',
        ),
        tool(
          'Skirmish: three thugs',
          {
            type: 'debug/fight',
            foe: 'foe_thug',
            count: 3,
            scale: 'skirmish',
            intent: 'capture',
            mode: 'tactical',
          },
          'Debug: a skirmish.',
        ),
        tool(
          'Crew battle',
          {
            type: 'debug/fight',
            foe: 'foe_pirate',
            count: 30,
            scale: 'crew',
            intent: 'capture',
            mode: 'tactical',
          },
          'Debug: a crew battle.',
        ),
        tool(
          'Sea fight',
          {
            type: 'debug/fight',
            foe: 'foe_pirate',
            count: 10,
            scale: 'naval',
            intent: 'capture',
            mode: 'tactical',
          },
          'Debug: a sea fight.',
        ),
        tool(
          'War',
          {
            type: 'debug/fight',
            foe: 'foe_marine',
            count: 2,
            scale: 'war',
            intent: 'kill',
            mode: 'tactical',
          },
          'Debug: a war.',
        ),
      ),
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
        raceSelect.value =
          setup.races.find((r) => r.id === 'race_human')?.id ?? setup.races[0]?.id ?? '';
        await drawCurve();
        const map = await app.host.call('world/map', {});
        placeSelect.replaceChildren(
          ...[...map.places]
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .map((p) => h('option', { value: p.id }, p.name)),
        );
      } catch (error) {
        loaded = false;
        curveNote.textContent = errorMessage(error);
      }
    },
    sync(state: UiState) {
      void state;
    },
  };
}
