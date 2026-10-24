import type { Calendar } from './data/schemas';

/**
 * Clock and calendar. One tick is one month.
 *
 * Tick 0 is Year 0, month 1: January 1486 SC (Sea Circle), the year of the God Valley incident.
 * The last tick inside the canon span closes Year 38 (1524 SC, tick 467) and "the present" begins
 * at tick 468 (1525 SC). `presentTick` and `canonYearOffset` live in data/calendar.json so the
 * endpoint can move when the manga advances.
 *
 * Saves, logs and the engine count ticks and game years; only the display uses Sea Circle years
 * (Phase 4: Phases 0 to 3 showed "Year 0" to "Year 38").
 *
 * Negative ticks are valid (characters can be born before Year 0) and use floor division, so
 * tick -1 is Year -1, month 12 (December 1485 SC).
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
  /** "SC". */
  era: string;
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
    era: cal.era,
  };
}

/** The tick for a given year and month (month defaults to 1). */
export function tickOf(year: number, month = 1): number {
  return year * MONTHS_PER_YEAR + (month - 1);
}

/** "March 1497 SC" */
export function formatDate(date: DateInfo): string {
  return `${date.monthName} ${date.canonYear} ${date.era}`;
}

/** A game year as people read it: Year 11 -> "1497 SC". */
export function formatYear(cal: Calendar, year: number): string {
  return `${year + cal.canonYearOffset} ${cal.era}`;
}

/** Values for text templates (see template.ts). */
export function templateVarsFor(date: DateInfo): Record<string, string> {
  return {
    date: formatDate(date),
    year: `${date.canonYear} ${date.era}`,
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
