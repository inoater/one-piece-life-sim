import { h } from '../dom';
import { plural } from '../format';
import type { UiState } from '../store';

export function renderActions(state: UiState): HTMLElement {
  const waiting = state.snapshot?.pending.length ?? 0;
  return h(
    'div',
    { class: 'side-screen' },
    h('h2', { class: 'side-screen__title' }, 'Nothing to do yet'),
    h('p', null, 'Choosing how to spend each month arrives in Phase 2.'),
    waiting > 0
      ? h(
          'p',
          { class: 'side-screen__alert' },
          `${plural(waiting, 'decision')} waiting in the chronicle. Time will not move until you choose.`,
        )
      : null,
  );
}
