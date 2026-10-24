import type { DateInfo } from '../engine/calendar';
import { shortHash } from '../engine/hash';
import type { AdvanceReport, Snapshot } from '../worker/protocol';

export { shortHash };

/** "March 1497 SC": the month and the Sea Circle year (the engine counts game years from 0). */
export function dateLabel(date: Pick<DateInfo, 'monthName' | 'canonYear' | 'era'>): string {
  return `${date.monthName} ${date.canonYear} ${date.era}`;
}

/** A game year as people read it: 11 -> "1497 SC". */
export function yearLabel(year: number, calendar: Snapshot['calendar']): string {
  return `${year + calendar.yearOffset} ${calendar.era}`;
}

/** The year the present begins, written the same way ("1525 SC"). */
export function presentYearLabel(s: Pick<Snapshot, 'presentTick' | 'calendar'>): string {
  return yearLabel(Math.floor(s.presentTick / 12), s.calendar);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** 1234567 -> "1,234,567"; -500 -> "-500" (with a true minus sign). Independent of locale. */
export function formatInteger(n: number): string {
  const digits = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return n < 0 && out !== '0' ? `−${out}` : out;
}

/** A number for display: whole numbers plain, otherwise up to two decimals. */
export function formatValue(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * The footer status line after a time skip.
 *
 * The engine reports why it stopped ("completed" when it did everything asked). The page also
 * knows where the clock ended up, and landing on the present is worth saying even when that is
 * also exactly what was asked for.
 */
export function describeAdvance(
  report: Pick<AdvanceReport, 'ticksRun' | 'stop'> & {
    snapshot: Pick<AdvanceReport['snapshot'], 'atPresent'>;
  },
  presentYear: string,
): string {
  const moved = report.ticksRun;
  const reachedPresent = `Reached the present (${presentYear}) after ${plural(moved, 'month')}.`;
  switch (report.stop) {
    case 'completed':
      return report.snapshot.atPresent && moved > 0
        ? reachedPresent
        : `Advanced ${plural(moved, 'month')}.`;
    case 'decision':
      return moved === 0
        ? 'A decision is waiting. Choose how to respond first.'
        : `Stopped after ${plural(moved, 'month')}: a decision is waiting.`;
    case 'event':
      return `Stopped at an event after ${plural(moved, 'month')}.`;
    case 'present':
      return moved === 0 ? `Already at the present (${presentYear}).` : reachedPresent;
    case 'cancelled':
      return `Cancelled after ${plural(moved, 'month')}.`;
    case 'ended':
      return moved === 0
        ? 'This life has ended. Choose who to continue as.'
        : `This life ended after ${plural(moved, 'month')}.`;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
