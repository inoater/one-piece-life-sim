import type { SheetStat } from '../../systems/genesis/sheet';
import { svg } from '../dom';
import { formatValue } from '../format';
import { tween } from '../motion';

/**
 * The stat compass: the nine trainable stats as a rose, one point per stat, drawn like the
 * compass rose on a chart. When the character changes (a reroll in New Life, a year of growth),
 * the shape moves to its new outline instead of jumping. In omniscient mode a dashed outline shows
 * the hidden potential, the shape the character could grow into.
 */

const SHORT: Record<string, string> = {
  strength: 'STR',
  speed: 'SPD',
  endurance: 'END',
  durability: 'DUR',
  dexterity: 'DEX',
  intellect: 'INT',
  willpower: 'WIL',
  charisma: 'CHA',
  perception: 'PER',
};

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 70;

/** The last values drawn under each key, so the next drawing can move from them. */
const remembered = new Map<string, number[]>();

function point(i: number, count: number, r: number): [number, number] {
  const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

function outline(values: readonly number[], scale: number): string {
  return values
    .map((v, i) =>
      point(i, values.length, (Math.max(0, v) / scale) * RADIUS)
        .map((n) => n.toFixed(1))
        .join(','),
    )
    .join(' ');
}

export function renderStatChart(stats: readonly SheetStat[], key: string): SVGSVGElement {
  const shown = stats.filter((s) => s.id in SHORT);
  const values = shown.map((s) => s.total);
  const potentials = shown.every((s) => s.potential)
    ? shown.map((s) => s.potential?.total ?? 0)
    : null;
  const scale = Math.max(100, ...values, ...(potentials ?? []));
  const count = shown.length;

  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    svg('polygon', {
      class: 'compass__ring',
      points: outline(
        shown.map(() => scale * f),
        scale,
      ),
    }),
  );
  const axes = shown.map((s, i) => {
    const [x, y] = point(i, count, RADIUS);
    const [lx, ly] = point(i, count, RADIUS + 16);
    return svg(
      'g',
      null,
      svg('line', {
        class: 'compass__axis',
        x1: CENTER,
        y1: CENTER,
        x2: x.toFixed(1),
        y2: y.toFixed(1),
      }),
      svg(
        'text',
        {
          class: 'compass__label',
          x: lx.toFixed(1),
          y: (ly + 3.5).toFixed(1),
          'text-anchor': 'middle',
        },
        SHORT[s.id] ?? s.id,
      ),
    );
  });
  const potential = potentials
    ? svg('polygon', { class: 'compass__potential', points: outline(potentials, scale) })
    : null;
  const shape = svg('polygon', { class: 'compass__shape' });
  const dots = shown.map(() => svg('circle', { class: 'compass__dot', r: 2.4 }));
  // North point of the rose: a small brass-free star, purely decorative.
  const star = svg('path', {
    class: 'compass__star',
    d: `M${CENTER} ${CENTER - 7} L${CENTER + 2.5} ${CENTER} L${CENTER} ${CENTER + 7} L${CENTER - 2.5} ${CENTER} Z`,
  });

  const draw = (current: readonly number[]) => {
    shape.setAttribute('points', outline(current, scale));
    current.forEach((v, i) => {
      const [x, y] = point(i, count, (Math.max(0, v) / scale) * RADIUS);
      dots[i]?.setAttribute('cx', x.toFixed(1));
      dots[i]?.setAttribute('cy', y.toFixed(1));
    });
  };

  const from = remembered.get(key);
  remembered.set(key, values);
  if (from && from.length === values.length) {
    draw(from);
    tween(0, 1, 700, (t) => draw(values.map((v, i) => (from[i] ?? v) + (v - (from[i] ?? v)) * t)));
  } else {
    draw(values);
  }

  return svg(
    'svg',
    {
      class: 'compass',
      viewBox: `0 0 ${SIZE} ${SIZE}`,
      role: 'img',
      'aria-label': `Stat compass: ${shown.map((s) => `${s.label} ${formatValue(s.total)}`).join(', ')}`,
    },
    rings,
    axes,
    potential,
    shape,
    dots,
    star,
  );
}
