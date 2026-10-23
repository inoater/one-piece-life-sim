import type { Calendar } from './data/schemas';

/**
 * Clock and calendar. One tick is one month.
 *
 * Tick 0 is Year 0, month 1. The last tick inside the canon span closes Year 38 (tick 467) and
 * "the present" begins at tick 468 (Year 39). `presentTick` and `canonYearOffset` live in
 * data/calendar.json so the endpoint can move when the manga advances.
 *
 * Negative ticks are valid (characters can be born before Year 0) and use floor division, so
 * tick -1 is Year -1, month 12.
 */

export const MONTHS_PER_YEAR = 12;

export interface DateInfo {
  tick: number;
  year: number;
  /** 1 to 12 */
  month: number;
  monthName: string;
  seasonId: string;
  seasonName: string;
  /** In-universe calendar year (Year + canonYearOffset). Display only. */
  canonYear: number;
}

const seasonLookups = new WeakMap<Calendar, Map<number, { id: string; name: string }>>();

function seasonOf(cal: Calendar, month: number): { id: string; name: string } {
  let lookup = seasonLookups.get(cal);
  if (!lookup) {
    lookup = new Map();
    for (const season of cal.seasons) {
      for (const m of season.months) lookup.set(m, { id: season.id, name: season.name });
    }
    seasonLookups.set(cal, lookup);
  }
  const found = lookup.get(month);
  if (!found) throw new Error(`calendar.json assigns no season to month ${month}`);
  return found;
}

export function dateOf(cal: Calendar, tick: number): DateInfo {
  if (!Number.isInteger(tick)) throw new RangeError(`tick must be an integer, got ${tick}`);
  const year = Math.floor(tick / MONTHS_PER_YEAR);
  const month = (((tick % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) + 1;
  const season = seasonOf(cal, month);
  return {
    tick,
    year,
    month,
    monthName: cal.months[month - 1] ?? `Month ${month}`,
    seasonId: season.id,
    seasonName: season.name,
    canonYear: year + cal.canonYearOffset,
  };
}

/** The tick for a given year and month (month defaults to 1). */
export function tickOf(year: number, month = 1): number {
  return year * MONTHS_PER_YEAR + (month - 1);
}

/** "March, Year 12" */
export function formatDate(date: DateInfo): string {
  return `${date.monthName}, Year ${date.year}`;
}

/** Values for text templates (see template.ts). */
export function templateVarsFor(date: DateInfo): Record<string, string> {
  return {
    date: formatDate(date),
    year: String(date.year),
    month: String(date.month),
    monthName: date.monthName,
    season: date.seasonName,
  };
}

/** 0 at tick 0, 1 at the present (clamped). */
export function progressToPresent(cal: Calendar, tick: number): number {
  return Math.min(1, Math.max(0, tick / cal.presentTick));
}

export function hasReachedPresent(cal: Calendar, tick: number): boolean {
  return tick >= cal.presentTick;
}
