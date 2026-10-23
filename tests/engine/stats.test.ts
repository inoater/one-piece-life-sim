import { describe, expect, it } from 'vitest';
import type { Stat } from '../../src/engine/state';
import {
  addMod,
  describeBreakdown,
  formatNumber,
  isActive,
  makeStat,
  pruneExpired,
  removeModsBySource,
  statBreakdown,
  statLabel,
  statValue,
} from '../../src/engine/stats';

/** The plan's own example: Strength 74 = 50 base + 12 training + 8 Brawler trait + 4 weapon. */
const strength = (): Stat =>
  makeStat(50, [
    { source: 'training', value: 12, kind: 'flat' },
    { source: 'Brawler (trait)', value: 8, kind: 'flat' },
    { source: 'Cutlass (weapon)', value: 4, kind: 'flat' },
  ]);

describe('modifier stacks', () => {
  it("reproduces the plan's example: 50 + 12 + 8 + 4 = 74", () => {
    expect(statValue(strength(), 0)).toBe(74);
    const b = statBreakdown(strength(), 0);
    expect(b).toMatchObject({ base: 50, flatTotal: 24, pctTotal: 0, subtotal: 74, total: 74 });
    expect(b.lines.map((l) => [l.source, l.contribution])).toEqual([
      ['training', 12],
      ['Brawler (trait)', 8],
      ['Cutlass (weapon)', 4],
    ]);
  });

  it('applies percentages after flats, and adds percentages together', () => {
    const speed = makeStat(40, [
      { source: 'training', value: 6, kind: 'flat' },
      { source: 'Quick', value: 25, kind: 'pct' },
      { source: 'Lucky', value: 10, kind: 'pct' },
    ]);
    // (40 + 6) x (1 + 0.35) = 62.1, not 46 x 1.25 x 1.10 = 63.25
    expect(statValue(speed, 0)).toBeCloseTo(62.1, 10);
    const b = statBreakdown(speed, 0);
    expect(b.subtotal).toBe(46);
    expect(b.pctTotal).toBe(35);
    expect(b.lines.find((l) => l.source === 'Quick')?.contribution).toBeCloseTo(11.5, 10);
  });

  it('handles penalties', () => {
    expect(
      statValue(
        makeStat(50, [
          { source: 'injury', value: -20, kind: 'flat' },
          { source: 'curse', value: -50, kind: 'pct' },
        ]),
        0,
      ),
    ).toBe(15);
  });

  it('a modifier is active while tick < expiresTick, and permanent without one', () => {
    const mod = { source: 'x', value: 5, kind: 'flat' as const, expiresTick: 10 };
    expect(isActive(mod, 9)).toBe(true);
    expect(isActive(mod, 10)).toBe(false);
    expect(isActive({ source: 'x', value: 5, kind: 'flat' }, 1_000_000)).toBe(true);
  });

  it('readers ignore expired modifiers even before they are pruned', () => {
    const stat = makeStat(10, [{ source: 'temp', value: 5, kind: 'flat', expiresTick: 6 }]);
    expect(statValue(stat, 5)).toBe(15);
    expect(statValue(stat, 6)).toBe(10);
    expect(statBreakdown(stat, 6).lines).toHaveLength(0);
    expect(statBreakdown(stat, 6, { includeExpired: true }).lines).toMatchObject([
      { source: 'temp', active: false },
    ]);
  });

  it('pruneExpired removes only what has expired', () => {
    const stat = makeStat(10, [
      { source: 'old', value: 1, kind: 'flat', expiresTick: 3 },
      { source: 'new', value: 1, kind: 'flat', expiresTick: 9 },
      { source: 'forever', value: 1, kind: 'flat' },
    ]);
    expect(pruneExpired(stat, 5)).toBe(1);
    expect(stat.mods.map((m) => m.source)).toEqual(['new', 'forever']);
    expect(pruneExpired(stat, 5)).toBe(0);
  });

  it('adds and removes modifiers by source', () => {
    const stat = makeStat(1);
    addMod(stat, { source: 'a', value: 1, kind: 'flat' });
    addMod(stat, { source: 'a', value: 2, kind: 'flat' });
    addMod(stat, { source: 'b', value: 3, kind: 'flat' });
    expect(removeModsBySource(stat, 'a')).toBe(2);
    expect(stat.mods.map((m) => m.source)).toEqual(['b']);
  });

  it('refuses non-finite modifier values, which would poison the state hash', () => {
    expect(() => addMod(makeStat(1), { source: 'bad', value: Number.NaN, kind: 'flat' })).toThrow(
      RangeError,
    );
    expect(() => addMod(makeStat(1), { source: 'bad', value: Infinity, kind: 'pct' })).toThrow(
      RangeError,
    );
  });
});

describe('describing a stack for tooltips', () => {
  it('writes the plan example as one line', () => {
    expect(describeBreakdown('Strength', statBreakdown(strength(), 0))).toBe(
      'Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)',
    );
  });

  it('shows flats grouped under percentages', () => {
    const speed = makeStat(40, [
      { source: 'training', value: 6, kind: 'flat' },
      { source: 'Quick (trait)', value: 25, kind: 'pct' },
    ]);
    expect(describeBreakdown('Speed', statBreakdown(speed, 0))).toBe(
      'Speed 57.5 = (40 base + 6 training) x 1.25 (+25% Quick (trait))',
    );
  });

  it('shows negative lines with a minus sign', () => {
    const stat = makeStat(50, [
      { source: 'injury', value: -8, kind: 'flat' },
      { source: 'curse', value: -10, kind: 'pct' },
    ]);
    expect(describeBreakdown('Speed', statBreakdown(stat, 0))).toBe(
      'Speed 37.8 = (50 base - 8 injury) x 0.9 (-10% curse)',
    );
  });

  it('omits expired lines', () => {
    const stat = makeStat(10, [{ source: 'gone', value: 5, kind: 'flat', expiresTick: 1 }]);
    expect(describeBreakdown('Luck', statBreakdown(stat, 1))).toBe('Luck 10 = 10 base');
  });

  it('formats numbers and labels', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(57.5)).toBe('57.5');
    expect(formatNumber(0.33333)).toBe('0.33');
    expect(statLabel('strength')).toBe('Strength');
  });
});
