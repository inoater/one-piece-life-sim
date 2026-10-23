import type { StatView } from '../../worker/protocol';
import { formatNumber } from '../../engine/stats';
import { h } from '../dom';

/**
 * Rule 3 in the UI: every number can explain itself. `statBreakdownTable` lays out base plus each
 * modifier plus the total; `attachBreakdownTooltip` shows it on hover or keyboard focus. The
 * Character screen in Phase 1 uses the same component for every stat.
 */

function signed(value: number, kind: 'flat' | 'pct'): string {
  const sign = value < 0 ? '-' : '+';
  return `${sign}${formatNumber(Math.abs(value))}${kind === 'pct' ? '%' : ''}`;
}

export function expiryText(expiresTick: number | undefined, tick: number): string {
  if (expiresTick === undefined) return 'permanent';
  const left = expiresTick - tick;
  return left <= 0 ? 'expired' : `ends in ${left} ${left === 1 ? 'month' : 'months'}`;
}

export function statBreakdownTable(stat: StatView, tick: number): HTMLTableElement {
  const rows: HTMLElement[] = [
    h(
      'tr',
      { class: 'breakdown__row' },
      h('th', { scope: 'row' }, 'Base'),
      h('td', null, formatNumber(stat.base)),
      h('td', { class: 'breakdown__note' }, ''),
    ),
  ];
  for (const line of stat.lines) {
    rows.push(
      h(
        'tr',
        { class: 'breakdown__row', dataset: { kind: line.kind } },
        h('th', { scope: 'row' }, line.source),
        h('td', null, signed(line.value, line.kind)),
        h('td', { class: 'breakdown__note' }, expiryText(line.expiresTick, tick)),
      ),
    );
  }
  if (stat.pctTotal !== 0) {
    rows.push(
      h(
        'tr',
        { class: 'breakdown__row breakdown__row--sub' },
        h('th', { scope: 'row' }, 'Flat total, then percentages'),
        h('td', null, `${formatNumber(stat.subtotal)} x ${formatNumber(1 + stat.pctTotal / 100)}`),
        h('td', { class: 'breakdown__note' }, ''),
      ),
    );
  }
  rows.push(
    h(
      'tr',
      { class: 'breakdown__row breakdown__row--total' },
      h('th', { scope: 'row' }, 'Total'),
      h('td', null, formatNumber(stat.total)),
      h('td', { class: 'breakdown__note' }, ''),
    ),
  );
  return h('table', { class: 'breakdown' }, h('tbody', null, rows));
}

let tooltipCounter = 0;

/** Show `content` in a floating tooltip while the trigger is hovered or focused. Returns a cleanup. */
export function attachBreakdownTooltip(trigger: HTMLElement, content: () => Node): () => void {
  const id = `tooltip-${++tooltipCounter}`;
  let tip: HTMLElement | null = null;

  const show = () => {
    if (tip) return;
    tip = h('div', { class: 'tooltip', role: 'tooltip', id }, content());
    document.body.appendChild(tip);
    trigger.setAttribute('aria-describedby', id);
    const anchor = trigger.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 6;
    const top =
      below + box.height > window.innerHeight - 8
        ? Math.max(8, anchor.top - box.height - 6)
        : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    tip?.remove();
    tip = null;
    trigger.removeAttribute('aria-describedby');
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', hide);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', hide);
  trigger.addEventListener('keydown', onKey);
  return () => {
    hide();
    trigger.removeEventListener('mouseenter', show);
    trigger.removeEventListener('mouseleave', hide);
    trigger.removeEventListener('focus', show);
    trigger.removeEventListener('blur', hide);
    trigger.removeEventListener('keydown', onKey);
  };
}
