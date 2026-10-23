import type { LogFilter } from '../../engine/log';
import type { LogQueryResult, LogView } from '../../worker/protocol';
import type { App } from '../app';
import { h } from '../dom';
import { errorMessage, plural } from '../format';
import type { UiState } from '../store';
import type { DebugTab } from './tab';

/** The event log, filterable by tick, entity, tag, kind and text (rule 6: every change is recorded with its cause). */
export function createLogTab(app: App): DebugTab {
  const PAGE = 100;
  let limit = PAGE;

  const input = (label: string, extra: Record<string, unknown> = {}) =>
    h('input', { class: 'debug__input', 'aria-label': label, placeholder: label, ...extra });
  const fromTick = input('From tick', { type: 'number', step: '1' });
  const toTick = input('To tick', { type: 'number', step: '1' });
  const entity = input('Entity id', { type: 'text', placeholder: 'Entity id, e.g. gen_000001' });
  const text = input('Search text', { type: 'search' });
  const tagSelect = h(
    'select',
    { class: 'debug__input', 'aria-label': 'Tag' },
    h('option', { value: '' }, 'any tag'),
  );
  const kindSelect = h(
    'select',
    { class: 'debug__input', 'aria-label': 'Kind' },
    h('option', { value: '' }, 'any kind'),
  );
  const clearButton = h(
    'button',
    { class: 'button button--tiny', type: 'button' },
    'Clear filters',
  );
  const summary = h('p', { class: 'debug__note', role: 'status' }, '');
  const results = h('ol', { class: 'logrows', reversed: true });
  const more = h(
    'button',
    { class: 'button button--tiny', type: 'button', hidden: true },
    'Show more',
  );

  const filterFromUi = (): LogFilter => {
    const filter: LogFilter = {};
    if (fromTick.value !== '') filter.fromTick = Number(fromTick.value);
    if (toTick.value !== '') filter.toTick = Number(toTick.value);
    if (entity.value.trim()) filter.entityId = entity.value.trim();
    if (tagSelect.value) filter.tag = tagSelect.value;
    if (kindSelect.value) filter.kind = kindSelect.value;
    if (text.value.trim()) filter.text = text.value.trim();
    return filter;
  };

  function fillSelect(select: HTMLSelectElement, any: string, values: readonly string[]): void {
    const current = select.value;
    const have = [...select.options].slice(1).map((o) => o.value);
    if (have.join('|') === values.join('|')) return;
    select.replaceChildren(
      h('option', { value: '' }, any),
      ...values.map((v) => h('option', { value: v }, v)),
    );
    if (values.includes(current)) select.value = current;
  }

  function row(record: LogView): HTMLElement {
    const bits = [`tags: ${record.tags.join(', ') || 'none'}`];
    if (record.cause)
      bits.push(
        `cause: ${record.cause}${record.causeSeq !== undefined ? ` (after #${record.causeSeq})` : ''}`,
      );
    if (record.actorIds.length) bits.push(`actors: ${record.actorIds.join(', ')}`);
    if (record.targetIds.length) bits.push(`targets: ${record.targetIds.join(', ')}`);
    return h(
      'li',
      { class: 'logrow', dataset: { known: String(record.known), kind: record.kind } },
      h(
        'div',
        { class: 'logrow__head' },
        h('code', null, `#${record.seq}`),
        h('span', { class: 'logrow__date' }, record.dateLabel),
        h('span', { class: 'logrow__kind' }, record.kind),
        record.known ? null : h('span', { class: 'logrow__flag' }, 'nobody knows'),
      ),
      h('p', { class: 'logrow__summary' }, record.summary),
      h('p', { class: 'logrow__meta' }, bits.join('; ')),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const result: LogQueryResult = await app.host.call('queryLog', {
        filter: filterFromUi(),
        omniscient: app.store.get().omniscient,
        limit,
      });
      fillSelect(tagSelect, 'any tag', result.tags);
      fillSelect(kindSelect, 'any kind', result.kinds);
      summary.textContent =
        result.total === 0
          ? 'No records match.'
          : `Showing ${result.records.length} of ${plural(result.total, 'record')}, newest first.`;
      results.replaceChildren(...result.records.map(row));
      more.hidden = result.records.length >= result.total;
    } catch (error) {
      summary.textContent = errorMessage(error);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    limit = PAGE;
    timer = setTimeout(() => void refresh(), 200);
  };
  for (const control of [fromTick, toTick, entity, text])
    control.addEventListener('input', schedule);
  for (const control of [tagSelect, kindSelect]) control.addEventListener('change', schedule);
  clearButton.addEventListener('click', () => {
    for (const control of [fromTick, toTick, entity, text]) control.value = '';
    tagSelect.value = '';
    kindSelect.value = '';
    limit = PAGE;
    void refresh();
  });
  more.addEventListener('click', () => {
    limit += PAGE;
    void refresh();
  });

  const el = h(
    'div',
    { class: 'debug__section-stack' },
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Event log'),
      h('div', { class: 'debug__inline' }, fromTick, toTick),
      h('div', { class: 'debug__inline' }, entity),
      h('div', { class: 'debug__inline' }, tagSelect, kindSelect),
      h('div', { class: 'debug__inline' }, text, clearButton),
      summary,
      results,
      more,
    ),
  );

  return {
    el,
    refresh,
    sync(_state: UiState) {
      /* the omniscient setting is read at query time */
    },
  };
}
