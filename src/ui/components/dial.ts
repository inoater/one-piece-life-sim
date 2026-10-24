import { svg } from '../dom';

/**
 * The Log Pose dial: the header's one distinctive element.
 *
 *   needle  points at the current month of the year (January at the top)
 *   ring    fills as the world travels the 39 years toward the present
 *   ticks   twelve month marks; the current month's is longer and brass
 *
 * The needle's angle only ever increases while time moves forward, so December to January turns
 * 30 degrees onward instead of spinning back 330.
 */

export interface DialInput {
  /** 1 to 12 */
  month: number;
  year: number;
  /** How the year is written ("1497 SC"); the game year when absent. */
  yearLabel?: string;
  /** 0 to 1 along the way to the present */
  progress: number;
  atPresent: boolean;
}

export interface Dial {
  el: SVGSVGElement;
  update(input: DialInput): void;
}

const RADIUS = 27;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = 32;

function polar(angleDegrees: number, radius: number): { x: number; y: number } {
  const angle = ((angleDegrees - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

export function createDial(): Dial {
  const root = svg('svg', { class: 'dial', viewBox: '0 0 64 64', role: 'img', focusable: 'false' });
  const track = svg('circle', { class: 'dial__track', cx: CENTER, cy: CENTER, r: RADIUS });
  const progress = svg('circle', {
    class: 'dial__progress',
    cx: CENTER,
    cy: CENTER,
    r: RADIUS,
    'stroke-dasharray': CIRCUMFERENCE.toFixed(2),
    'stroke-dashoffset': CIRCUMFERENCE.toFixed(2),
    transform: `rotate(-90 ${CENTER} ${CENTER})`,
  });

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const from = polar(i * 30, 19);
    const to = polar(i * 30, 22.5);
    return svg('line', {
      class: 'dial__tick',
      x1: from.x.toFixed(2),
      y1: from.y.toFixed(2),
      x2: to.x.toFixed(2),
      y2: to.y.toFixed(2),
    });
  });

  const needle = svg(
    'g',
    { class: 'dial__needle' },
    svg('line', {
      class: 'dial__needle-line',
      x1: CENTER,
      y1: CENTER + 5,
      x2: CENTER,
      y2: CENTER - 15,
    }),
    svg('circle', { class: 'dial__needle-tip', cx: CENTER, cy: CENTER - 15, r: 2 }),
  );
  const hub = svg('circle', { class: 'dial__hub', cx: CENTER, cy: CENTER, r: 2.6 });
  root.append(track, progress, ...ticks, needle, hub);

  let previousAngle = Number.NEGATIVE_INFINITY;

  return {
    el: root,
    update({ month, year, yearLabel, progress: fraction, atPresent }) {
      const angle = (month - 1) * 30 + year * 360;
      // Going backwards (a new world) should snap, not spin the whole way round.
      const jumpedBack = angle < previousAngle;
      if (jumpedBack) needle.classList.add('is-snapping');
      needle.setAttribute('style', `transform: rotate(${angle}deg)`);
      if (jumpedBack) {
        // force the browser to apply the snap before transitions come back
        void root.getBoundingClientRect();
        needle.classList.remove('is-snapping');
      }
      previousAngle = angle;

      const clamped = Math.min(1, Math.max(0, fraction));
      progress.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - clamped)).toFixed(2));
      ticks.forEach((tick, i) => tick.classList.toggle('is-current', i === month - 1));
      root.classList.toggle('is-present', atPresent);
      root.setAttribute(
        'aria-label',
        atPresent
          ? `Month ${month} of ${yearLabel ?? `Year ${year}`}. The present has arrived.`
          : `Month ${month} of ${yearLabel ?? `Year ${year}`}. ${Math.round(clamped * 100)} percent of the way to the present.`,
      );
    },
  };
}
