import type { App } from '../app';
import { h, isTypingTarget } from '../dom';
import type { UiState } from '../store';
import { createEntitiesTab } from './entities-tab';
import { createLogTab } from './log-tab';
import type { DebugTab } from './tab';
import { createWorldTab } from './world-tab';

/**
 * The developer panel, toggled with the backtick key or the Debug button. It exists only in
 * development and preview builds (`__DEBUG_PANEL__`); the production build compiles it out.
 *
 *   World     seed, state hash, tick controls, omniscient toggle, force an event
 *   Entities  every entity, with each stat's full modifier stack
 *   Log       the event log, filterable by tick, entity, tag, kind and text
 */

interface TabDef {
  id: string;
  label: string;
  tab: DebugTab;
}

export function mountDebug(root: HTMLElement, app: App): void {
  const { store } = app;
  const tabs: TabDef[] = [
    { id: 'world', label: 'World', tab: createWorldTab(app) },
    { id: 'entities', label: 'Entities', tab: createEntitiesTab(app) },
    { id: 'log', label: 'Log', tab: createLogTab(app) },
  ];
  let active = 0;

  const buttons = tabs.map((def, index) => {
    const button = h(
      'button',
      {
        class: 'debug__tab',
        type: 'button',
        role: 'tab',
        id: `debug-tab-${def.id}`,
        'aria-controls': `debug-panel-${def.id}`,
        onclick: () => select(index),
      },
      def.label,
    );
    return button;
  });
  const panels = tabs.map((def) => {
    def.tab.el.id = `debug-panel-${def.id}`;
    def.tab.el.setAttribute('role', 'tabpanel');
    def.tab.el.setAttribute('aria-labelledby', `debug-tab-${def.id}`);
    return def.tab.el;
  });

  const tablist = h(
    'div',
    { class: 'debug__tabs', role: 'tablist', 'aria-label': 'Debug sections' },
    buttons,
  );
  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (active + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    select(next);
    buttons[next]?.focus();
  });

  const close = h(
    'button',
    {
      class: 'button button--quiet button--tiny',
      type: 'button',
      onclick: () => void app.setDebugOpen(false),
    },
    'Close',
  );
  const panel = h(
    'aside',
    { class: 'debug', 'aria-label': 'Debug panel', hidden: true },
    h(
      'header',
      { class: 'debug__header' },
      h('h2', { class: 'debug__title' }, 'Debug'),
      h('span', { class: 'debug__hint' }, 'toggle with the ` key'),
      close,
    ),
    tablist,
    h('div', { class: 'debug__body' }, panels),
  );
  root.appendChild(panel);

  function select(index: number): void {
    active = index;
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((el, i) => (el.hidden = i !== index));
    if (!panel.hidden) void tabs[index]?.tab.refresh();
  }

  function render(state: UiState, previous: UiState | null): void {
    const open = state.debugOpen;
    panel.hidden = !open;
    document.documentElement.classList.toggle('has-debug', open);
    for (const def of tabs) def.tab.sync(state);
    if (!open) return;
    const justOpened = !previous?.debugOpen;
    if (justOpened || state.snapshot !== previous?.snapshot) void tabs[active]?.tab.refresh();
  }

  select(0);
  store.subscribe(render);
  render(store.get(), null);

  window.addEventListener('keydown', (event) => {
    if (
      event.key === '`' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      void app.setDebugOpen(!store.get().debugOpen);
    } else if (
      event.key === 'Escape' &&
      store.get().debugOpen &&
      panel.contains(document.activeElement)
    ) {
      void app.setDebugOpen(false);
    }
  });
}
