import type { EntityView, StatView } from '../../worker/protocol';
import type { App } from '../app';
import { attachBreakdownTooltip, statBreakdownTable } from '../components/breakdown';
import { append, h } from '../dom';
import { errorMessage, formatValue, plural } from '../format';
import type { UiState } from '../store';
import type { DebugTab } from './tab';

/**
 * Every entity, and for the selected one every stat with its full modifier stack (rule 3: base
 * plus modifiers, nothing hidden). Modifiers can be added here to watch stacks change and expire.
 */
export function createEntitiesTab(app: App): DebugTab {
  let selectedId: string | null = null;
  let filter = '';
  let selectNewest = false;
  let cleanups: (() => void)[] = [];
  const collapsed = new Set<string>();

  const filterInput = h('input', {
    class: 'debug__input',
    type: 'search',
    placeholder: 'Filter by name or id',
    'aria-label': 'Filter entities',
  });
  const spawn = h('button', { class: 'button button--tiny', type: 'button' }, 'Spawn test entity');
  const count = h('p', { class: 'debug__note' }, '');
  const list = h('ul', { class: 'debug__list', 'aria-label': 'Entities' });
  const inspector = h('div', { class: 'debug__inspector', 'aria-live': 'polite' });

  // The "add a modifier" form is built once so typing is not lost when the world changes.
  const statSelect = h('select', { class: 'debug__input', 'aria-label': 'Stat' });
  const valueInput = h('input', {
    class: 'debug__input debug__input--short',
    type: 'number',
    value: '20',
    step: 'any',
    'aria-label': 'Value',
  });
  const kindSelect = h(
    'select',
    { class: 'debug__input', 'aria-label': 'Kind' },
    h('option', { value: 'flat' }, 'flat'),
    h('option', { value: 'pct' }, 'percent'),
  );
  const monthsInput = h('input', {
    class: 'debug__input debug__input--short',
    type: 'number',
    min: '1',
    step: '1',
    placeholder: 'forever',
    'aria-label': 'Months it lasts',
  });
  const sourceInput = h('input', {
    class: 'debug__input',
    type: 'text',
    placeholder: 'Debug modifier',
    'aria-label': 'Source label',
    maxlength: 60,
  });
  const addButton = h('button', { class: 'button button--tiny', type: 'submit' }, 'Add modifier');
  const form = h(
    'form',
    { class: 'debug__form' },
    h('div', { class: 'debug__inline' }, statSelect, valueInput, kindSelect),
    h('div', { class: 'debug__inline' }, monthsInput, sourceInput),
    addButton,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selectedId || !statSelect.value) return;
    // Number('') is 0, so an empty field must be refused explicitly rather than becoming a no-op modifier.
    const value = valueInput.value.trim() === '' ? Number.NaN : Number(valueInput.value);
    if (!Number.isFinite(value)) {
      app.say({ kind: 'error', text: 'The modifier value must be a number.' });
      return;
    }
    const months = monthsInput.value.trim() === '' ? undefined : Number(monthsInput.value);
    void app.dispatch(
      {
        type: 'debug/addModifier',
        entityId: selectedId,
        stat: statSelect.value,
        value,
        modKind: kindSelect.value,
        ...(months !== undefined ? { months } : {}),
        ...(sourceInput.value.trim() ? { source: sourceInput.value.trim() } : {}),
      },
      'Modifier added.',
    );
  });

  spawn.addEventListener('click', () => {
    selectNewest = true;
    void app.dispatch({ type: 'debug/spawnTestEntity' }, 'Spawned a test entity.');
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  filterInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filter = filterInput.value;
      void refresh();
    }, 200);
  });

  function statBlock(stat: StatView, tick: number): HTMLElement {
    const total = h('strong', { class: 'stat__total', tabindex: '0' }, formatValue(stat.total));
    cleanups.push(attachBreakdownTooltip(total, () => statBreakdownTable(stat, tick)));
    const details = h(
      'details',
      { class: 'stat', open: !collapsed.has(stat.id), dataset: { stat: stat.id } },
      h(
        'summary',
        { class: 'stat__summary' },
        h('span', { class: 'stat__label' }, stat.label),
        total,
      ),
      h('p', { class: 'stat__description' }, stat.description),
      statBreakdownTable(stat, tick),
    );
    details.addEventListener('toggle', () => {
      if (details.open) collapsed.delete(stat.id);
      else collapsed.add(stat.id);
    });
    return details;
  }

  function renderInspector(view: EntityView, tick: number): void {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];

    const wanted = view.stats.map((s) => s.id);
    const have = [...statSelect.options].map((o) => o.value);
    if (wanted.join() !== have.join()) {
      const previous = statSelect.value;
      statSelect.replaceChildren(...wanted.map((id) => h('option', { value: id }, id)));
      if (wanted.includes(previous)) statSelect.value = previous;
    }
    addButton.disabled = wanted.length === 0;

    const flags = Object.entries(view.flags);
    const content = document.createDocumentFragment();
    append(content, [
      h('h3', { class: 'inspector__name' }, view.name, view.isPlayer ? ' (the player)' : ''),
      h(
        'p',
        { class: 'debug__meta' },
        h('code', null, view.id),
        ` ${view.type}, ${view.origin}, tier ${view.tier}, created ${view.createdLabel}`,
      ),
      h('h4', null, 'Stats and modifier stacks'),
      view.stats.length === 0
        ? h('p', { class: 'debug__note' }, 'This entity has no stats.')
        : view.stats.map((s) => statBlock(s, tick)),
      h('h4', null, 'Add a modifier'),
      form,
      h('h4', null, 'Flags'),
      flags.length === 0
        ? h('p', { class: 'debug__note' }, 'none')
        : h(
            'ul',
            { class: 'debug__kv' },
            flags.map(([k, v]) =>
              h('li', null, h('code', null, k), ' = ', h('code', null, String(v))),
            ),
          ),
      h('h4', null, 'Known by'),
      h(
        'p',
        { class: 'debug__note' },
        view.knownBy.includes('*') ? 'everyone' : view.knownBy.join(', ') || 'nobody',
      ),
      h('h4', null, 'Recent log'),
      view.recent.length === 0
        ? h('p', { class: 'debug__note' }, 'nothing recorded about this entity')
        : h(
            'ul',
            { class: 'debug__kv' },
            view.recent.map((r) =>
              h('li', null, h('code', null, `#${r.seq}`), ` ${r.dateLabel}: ${r.summary}`),
            ),
          ),
    ]);
    inspector.replaceChildren(content);
  }

  async function inspect(): Promise<void> {
    if (!selectedId) {
      for (const cleanup of cleanups) cleanup();
      cleanups = [];
      inspector.replaceChildren(
        h(
          'p',
          { class: 'debug__note' },
          'No entity selected. Spawn a test entity to see a modifier stack.',
        ),
      );
      return;
    }
    try {
      const view = await app.host.call('inspect', { entityId: selectedId });
      if (!view) {
        selectedId = null;
        await inspect();
        return;
      }
      renderInspector(view, app.store.get().snapshot?.tick ?? 0);
    } catch (error) {
      inspector.replaceChildren(h('p', { class: 'debug__error' }, errorMessage(error)));
    }
  }

  async function refresh(): Promise<void> {
    try {
      const { items, total } = await app.host.call('listEntities', { text: filter });
      if (selectNewest && items.length > 0) {
        selectedId = (items[items.length - 1] as { id: string }).id;
        selectNewest = false;
      } else if (!selectedId && items[0]) {
        selectedId = items[0].id;
      }
      count.textContent =
        total === 0
          ? 'No entities yet.'
          : `${plural(total, 'entity', 'entities')}${total > items.length ? `, showing ${items.length}` : ''}.`;
      list.replaceChildren(
        ...items.map((item) =>
          h(
            'li',
            null,
            h(
              'button',
              {
                class: 'debug__pick',
                type: 'button',
                'aria-pressed': String(item.id === selectedId),
                onclick: () => {
                  selectedId = item.id;
                  void refresh();
                },
              },
              h('span', null, item.name),
              h('code', null, item.id),
              h('span', { class: 'debug__note' }, `${item.type}, ${item.origin}`),
            ),
          ),
        ),
      );
      await inspect();
    } catch (error) {
      app.say({ kind: 'error', text: errorMessage(error) });
    }
  }

  const el = h(
    'div',
    { class: 'debug__section-stack' },
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Entities'),
      h('div', { class: 'debug__inline' }, filterInput, spawn),
      count,
      list,
    ),
    h('section', { class: 'debug__section' }, inspector),
  );

  return {
    el,
    refresh,
    sync(_state: UiState) {
      /* nothing to mirror: everything here is read from the simulation on refresh */
    },
  };
}
