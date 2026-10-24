// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDial } from '../../src/ui/components/dial';

const needle = (el: SVGSVGElement) => el.querySelector('.dial__needle') as SVGGElement;
const angle = (el: SVGSVGElement) =>
  Number(/rotate\((-?[\d.]+)deg\)/.exec(needle(el).getAttribute('style') ?? '')?.[1]);

describe('the Log Pose dial', () => {
  it('points the needle at the month, January at the top', () => {
    const dial = createDial();
    dial.update({ month: 1, year: 0, progress: 0, atPresent: false });
    expect(angle(dial.el)).toBe(0);
    dial.update({ month: 4, year: 0, progress: 0.1, atPresent: false });
    expect(angle(dial.el)).toBe(90);
    dial.update({ month: 7, year: 0, progress: 0.2, atPresent: false });
    expect(angle(dial.el)).toBe(180);
  });

  it('turns onward from December to January instead of spinning back', () => {
    const dial = createDial();
    dial.update({ month: 12, year: 3, progress: 0.3, atPresent: false });
    const december = angle(dial.el);
    dial.update({ month: 1, year: 4, progress: 0.32, atPresent: false });
    expect(angle(dial.el) - december).toBe(30);
  });

  it('snaps (no animated spin) when time jumps backward, then restores the animation', () => {
    const dial = createDial();
    dial.update({ month: 5, year: 20, progress: 0.5, atPresent: false });
    dial.update({ month: 1, year: 0, progress: 0, atPresent: false });
    expect(needle(dial.el).classList.contains('is-snapping')).toBe(false); // removed again after the snap
    expect(angle(dial.el)).toBe(0);
  });

  it('fills the ring in proportion to progress and clamps it', () => {
    const dial = createDial();
    const ring = dial.el.querySelector('.dial__progress') as SVGCircleElement;
    const circumference = Number(ring.getAttribute('stroke-dasharray'));
    dial.update({ month: 1, year: 0, progress: 0.25, atPresent: false });
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.75, 1);
    dial.update({ month: 1, year: 0, progress: 3, atPresent: false });
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBe(0);
    dial.update({ month: 1, year: 0, progress: -1, atPresent: false });
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference, 1);
  });

  it('marks the current month on the dial, and only that month', () => {
    const dial = createDial();
    dial.update({ month: 9, year: 1, progress: 0, atPresent: false });
    const ticks = [...dial.el.querySelectorAll('.dial__tick')];
    expect(ticks).toHaveLength(12);
    expect(
      ticks.map((t, i) => (t.classList.contains('is-current') ? i + 1 : 0)).filter(Boolean),
    ).toEqual([9]);
  });

  it('describes itself for screen readers, and says when the present has arrived', () => {
    const dial = createDial();
    expect(dial.el.getAttribute('role')).toBe('img');
    dial.update({ month: 3, year: 12, yearLabel: '1498 SC', progress: 0.31, atPresent: false });
    expect(dial.el.getAttribute('aria-label')).toBe(
      'Month 3 of 1498 SC. 31 percent of the way to the present.',
    );
    dial.update({ month: 1, year: 39, progress: 1, atPresent: true });
    expect(dial.el.getAttribute('aria-label')).toContain('The present has arrived');
    expect(dial.el.classList.contains('is-present')).toBe(true);
  });
});
