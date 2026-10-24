// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { DataIssue } from '../../src/engine/data/issues';
import {
  describeAdvance,
  formatBytes,
  formatPercent,
  formatValue,
  plural,
  relativeTime,
} from '../../src/ui/format';
import { renderFatal, renderLoading } from '../../src/ui/screens/boot';
import { text } from '../helpers/ui';

describe('formatting', () => {
  it('pluralises', () => {
    expect(plural(1, 'month')).toBe('1 month');
    expect(plural(0, 'month')).toBe('0 months');
    expect(plural(2, 'entity', 'entities')).toBe('2 entities');
  });

  it('describes elapsed time in plain words', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(relativeTime(now - 25 * 60_000, now)).toBe('25 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 72 * 3_600_000, now)).toBe('3 days ago');
    expect(relativeTime(now + 10_000, now)).toBe('just now'); // a clock that ran backwards
  });

  it('formats sizes, percentages and values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatPercent(0.314)).toBe('31%');
    expect(formatValue(57.5)).toBe('57.5');
    expect(formatValue(74)).toBe('74');
    expect(formatValue(0.33333)).toBe('0.33');
  });
});

describe('the status line after a time skip', () => {
  const atPresent = { atPresent: true };
  const notYet = { atPresent: false };
  const say = (
    ticksRun: number,
    stop: Parameters<typeof describeAdvance>[0]['stop'],
    snapshot = notYet,
  ) => describeAdvance({ ticksRun, stop, snapshot }, '1525 SC');

  it('says how far time moved', () => {
    expect(say(1, 'completed')).toBe('Advanced 1 month.');
    expect(say(3, 'completed')).toBe('Advanced 3 months.');
  });

  it('says why it stopped early', () => {
    expect(say(1, 'decision')).toBe('Stopped after 1 month: a decision is waiting.');
    expect(say(0, 'decision')).toBe('A decision is waiting. Choose how to respond first.');
    expect(say(4, 'event')).toBe('Stopped at an event after 4 months.');
    expect(say(2, 'cancelled')).toBe('Cancelled after 2 months.');
  });

  it('celebrates reaching the present, even when that was exactly what was asked for', () => {
    expect(say(8, 'present', atPresent)).toBe('Reached the present (1525 SC) after 8 months.');
    expect(say(468, 'completed', atPresent)).toBe(
      'Reached the present (1525 SC) after 468 months.',
    );
    expect(say(0, 'present', atPresent)).toBe('Already at the present (1525 SC).');
  });

  it('does not claim the present when no time passed', () => {
    expect(say(0, 'completed', atPresent)).toBe('Advanced 0 months.');
  });
});

describe('boot screens', () => {
  it('shows a loading message that screen readers announce', () => {
    const el = renderLoading();
    expect(text(el)).toBe('Starting the simulation...');
    expect(el.querySelector('[role="status"]')).not.toBeNull();
  });

  it('names every broken file and field when the data is invalid, grouped by file', () => {
    const issues: DataIssue[] = [
      {
        severity: 'error',
        file: 'data/events/a.json',
        field: 'conditions[0].trait',
        message: 'Unknown trait "trait_x"',
        hint: 'did you mean "trait_y"?',
      },
      {
        severity: 'error',
        file: 'data/events/a.json',
        field: 'text',
        message: 'Unknown template variable',
      },
      {
        severity: 'error',
        file: 'data/traits/b.json',
        field: 'statMods[0].value',
        message: 'Expected number',
      },
      {
        severity: 'warning',
        file: 'data/traits/c.json',
        field: 'id',
        message: 'does not match the file name',
      },
    ];
    const el = renderFatal({ message: 'Data validation failed', issues });
    expect(el.getAttribute('role')).toBe('alert');
    expect(text(el.querySelector('.boot__title'))).toBe('The game data has a problem');
    expect([...el.querySelectorAll('.issue-file__name')].map(text)).toEqual([
      'data/events/a.json',
      'data/traits/b.json',
    ]); // warnings are not shown
    const first = el.querySelector('.issue-file') as HTMLElement;
    expect([...first.querySelectorAll('li')].map(text)).toEqual([
      'conditions[0].trait Unknown trait "trait_x" (did you mean "trait_y"?)',
      'text Unknown template variable',
    ]);
    expect(text(el)).toContain('npm run validate');
  });

  it('shows a plain message for other failures', () => {
    const el = renderFatal({ message: 'IndexedDB exploded' });
    expect(text(el.querySelector('.boot__title'))).toBe('The game could not start');
    expect(text(el)).toContain('IndexedDB exploded');
    expect(el.querySelector('.issue-file')).toBeNull();
  });
});
