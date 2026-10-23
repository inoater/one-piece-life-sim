import { svg } from '../dom';

/** Nine small bars comparing a race's caps with a human's (the dashed line). */
export function renderCapBars(capMods: Readonly<Record<string, number>>): SVGSVGElement {
  const stats = [
    'strength',
    'speed',
    'endurance',
    'durability',
    'dexterity',
    'intellect',
    'willpower',
    'charisma',
    'perception',
  ];
  const short = ['S', 'Sp', 'E', 'Du', 'De', 'I', 'W', 'C', 'P'];
  const max = 170;
  const height = 26;
  const bar = 7;
  const gap = 3;
  const baseline = height - (100 / max) * height;
  return svg(
    'svg',
    {
      class: 'caps',
      viewBox: `0 0 ${stats.length * (bar + gap)} ${height + 9}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    stats.map((stat, i) => {
      const value = 100 + (capMods[stat] ?? 0);
      const h = (Math.min(max, value) / max) * height;
      const cls =
        value > 100
          ? 'caps__bar caps__bar--up'
          : value < 100
            ? 'caps__bar caps__bar--down'
            : 'caps__bar';
      return svg(
        'g',
        null,
        svg('rect', {
          class: cls,
          x: i * (bar + gap),
          y: (height - h).toFixed(1),
          width: bar,
          height: h.toFixed(1),
          rx: 1,
        }),
        svg(
          'text',
          {
            class: 'caps__label',
            x: i * (bar + gap) + bar / 2,
            y: height + 8,
            'text-anchor': 'middle',
          },
          short[i] ?? '',
        ),
      );
    }),
    svg('line', {
      class: 'caps__human',
      x1: 0,
      y1: baseline.toFixed(1),
      x2: stats.length * (bar + gap) - gap,
      y2: baseline.toFixed(1),
    }),
  );
}
