import type { Snapshot } from '../../worker/protocol';
import { h } from '../dom';
import { formatInteger, formatValue, plural } from '../format';

/**
 * The log card: after time moves, a short entry in the ship's log saying what changed. Months
 * passed, a birthday, a new stage of life, stats that moved, money in or out, new lines in the
 * chronicle, a decision waiting. Mostly worked out by comparing the snapshot before with the one
 * after; since Phase 2 it also reads the life loop's month-end report (what the last month did to
 * the body and the purse: injuries, illness, Vigor spent, wages and costs).
 */

export interface LogCardSummary {
  title: string;
  span: string;
  lines: { text: string; tone: 'good' | 'bad' | 'plain' | 'alert' }[];
}

export function summarizeAdvance(before: Snapshot, after: Snapshot): LogCardSummary | null {
  const months = after.tick - before.tick;
  if (months <= 0 || before.seed !== after.seed) return null;
  const lines: LogCardSummary['lines'] = [];
  const from = before.date;
  const to = after.date;
  const span =
    months === 1
      ? `${to.monthName}, Year ${to.year}`
      : `${from.monthName}${from.year !== to.year ? `, Year ${from.year}` : ''} to ${to.monthName}, Year ${to.year}`;

  const was = before.player;
  const now = after.player;
  if (was && now && was.id === now.id) {
    if (now.age > was.age) {
      lines.push({ text: `You turned ${now.age}.`, tone: 'good' });
      if (now.stage !== was.stage)
        lines.push({ text: `You are now: ${now.stage.toLowerCase()}.`, tone: 'good' });
    }
    const diff = now.berries - was.berries;
    if (diff !== 0) {
      lines.push({
        text: `${diff > 0 ? '+' : '−'}${formatInteger(Math.abs(diff))} Berries`,
        tone: diff > 0 ? 'good' : 'bad',
      });
    }
  }
  const report = after.life?.report;
  if (report && after.life?.alive !== false) {
    const last = months === 1 ? '' : ' last month';
    if (report.vigor.pool > 0 || report.vigor.spent > 0) {
      lines.push({
        text: `Vigor ${report.vigor.spent} of ${report.vigor.pool} used${last}`,
        tone: report.vigor.spent > report.vigor.pool ? 'bad' : 'plain',
      });
    }
    if (months === 1 && (report.berries.income > 0 || report.berries.costs > 0)) {
      lines.push({
        text: `Earned ${formatInteger(report.berries.income)}, spent ${formatInteger(report.berries.costs)}`,
        tone: 'plain',
      });
    }
    for (const line of report.lines.filter((l) => l.tone !== 'plain').slice(0, 4)) {
      lines.push({ text: line.text, tone: line.tone });
    }
  }
  if (after.life && !after.life.alive && before.life?.alive) {
    lines.push({ text: 'This life has ended', tone: 'alert' });
  }
  const beforeStats = new Map((before.sheet?.stats ?? []).map((s) => [s.id, s.total]));
  const moved = (after.sheet?.stats ?? [])
    .map((s) => ({ label: s.label, delta: s.total - (beforeStats.get(s.id) ?? s.total) }))
    .filter((s) => Math.abs(s.delta) >= 0.05)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);
  for (const s of moved) {
    lines.push({
      text: `${s.label} ${s.delta > 0 ? '+' : '−'}${formatValue(Math.abs(s.delta))}`,
      tone: s.delta > 0 ? 'good' : 'bad',
    });
  }

  const lastSeq = before.feed[before.feed.length - 1]?.seq ?? -1;
  const fresh = after.feed.filter((e) => e.seq > lastSeq && e.category !== 'system').length;
  if (fresh > 0)
    lines.push({
      text: `${plural(fresh, 'new entry', 'new entries')} in the chronicle`,
      tone: 'plain',
    });
  if (after.news.length > 0 && after.news[0]?.id !== before.news[0]?.id) {
    lines.push({ text: 'New headlines in the News tab', tone: 'plain' });
  }
  if (after.pending.length > before.pending.length) {
    lines.push({ text: 'A decision is waiting for you', tone: 'alert' });
  }
  if (after.atPresent && !before.atPresent) {
    lines.push({ text: 'The present has arrived', tone: 'alert' });
  }
  if (lines.length === 0) lines.push({ text: 'Quiet seas. Nothing to report.', tone: 'plain' });

  return { title: months === 1 ? 'A month passes' : `${months} months pass`, span, lines };
}

export function renderLogCard(summary: LogCardSummary, onClose: () => void): HTMLElement {
  return h(
    'section',
    { class: 'log-card', 'aria-label': `Log: ${summary.title}` },
    h(
      'header',
      { class: 'log-card__header' },
      h('h2', { class: 'log-card__title' }, summary.title),
      h('span', { class: 'log-card__span' }, summary.span),
      h(
        'button',
        {
          class: 'log-card__close',
          type: 'button',
          'aria-label': 'Dismiss the log card',
          onclick: onClose,
        },
        '×',
      ),
    ),
    h(
      'ul',
      { class: 'log-card__lines' },
      summary.lines.map((line) =>
        h('li', { class: 'log-card__line', dataset: { tone: line.tone } }, line.text),
      ),
    ),
  );
}
