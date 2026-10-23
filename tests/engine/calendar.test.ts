import { describe, expect, it } from 'vitest';
import {
  dateOf,
  formatDate,
  hasReachedPresent,
  progressToPresent,
  templateVarsFor,
  tickOf,
} from '../../src/engine/calendar';
import { data } from '../helpers/data';

const cal = data.calendar;

describe('calendar', () => {
  it('tick 0 is Year 0, month 1', () => {
    const d = dateOf(cal, 0);
    expect(d).toMatchObject({ year: 0, month: 1, monthName: 'January', seasonId: 'winter' });
  });

  it('there are 468 months from Year 0 to the end of Year 38, and the present starts at Year 39', () => {
    expect(cal.presentTick).toBe(468);
    expect(dateOf(cal, 467)).toMatchObject({ year: 38, month: 12, monthName: 'December' });
    expect(dateOf(cal, 468)).toMatchObject({ year: 39, month: 1 });
    expect(tickOf(39)).toBe(468);
    expect(tickOf(38, 12)).toBe(467);
  });

  it('rolls months and years correctly', () => {
    expect(dateOf(cal, 11)).toMatchObject({ year: 0, month: 12 });
    expect(dateOf(cal, 12)).toMatchObject({ year: 1, month: 1 });
    expect(dateOf(cal, 12 * 7 + 4)).toMatchObject({ year: 7, month: 5, monthName: 'May' });
  });

  it('handles negative ticks (born before Year 0) with floor division', () => {
    expect(dateOf(cal, -1)).toMatchObject({ year: -1, month: 12 });
    expect(dateOf(cal, -12)).toMatchObject({ year: -1, month: 1 });
    expect(dateOf(cal, -13)).toMatchObject({ year: -2, month: 12 });
  });

  it('round-trips tickOf and dateOf for a wide range', () => {
    for (let tick = -50; tick <= 600; tick++) {
      const d = dateOf(cal, tick);
      expect(tickOf(d.year, d.month)).toBe(tick);
    }
  });

  it('assigns every month a season from the data', () => {
    const seasons = Array.from({ length: 12 }, (_, i) => dateOf(cal, i).seasonId);
    expect(seasons).toEqual([
      'winter',
      'winter',
      'spring',
      'spring',
      'spring',
      'summer',
      'summer',
      'summer',
      'autumn',
      'autumn',
      'autumn',
      'winter',
    ]);
  });

  it('derives the canon year from canonYearOffset', () => {
    expect(dateOf(cal, 0).canonYear).toBe(cal.canonYearOffset);
    expect(dateOf(cal, 24).canonYear).toBe(cal.canonYearOffset + 2);
  });

  it('rejects non-integer ticks', () => {
    expect(() => dateOf(cal, 1.5)).toThrow(RangeError);
  });

  it('formats dates and template variables', () => {
    const d = dateOf(cal, tickOf(12, 3));
    expect(formatDate(d)).toBe('March, Year 12');
    expect(templateVarsFor(d)).toEqual({
      date: 'March, Year 12',
      year: '12',
      month: '3',
      monthName: 'March',
      season: 'Spring',
    });
  });

  it('measures progress to the present and clamps it', () => {
    expect(progressToPresent(cal, 0)).toBe(0);
    expect(progressToPresent(cal, 234)).toBe(0.5);
    expect(progressToPresent(cal, 468)).toBe(1);
    expect(progressToPresent(cal, 900)).toBe(1);
    expect(progressToPresent(cal, -5)).toBe(0);
    expect(hasReachedPresent(cal, 467)).toBe(false);
    expect(hasReachedPresent(cal, 468)).toBe(true);
  });
});
