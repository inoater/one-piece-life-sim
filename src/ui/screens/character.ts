import type { App } from '../app';
import { h } from '../dom';
import type { UiState } from '../store';

export function renderCharacter(state: UiState, app: App): HTMLElement {
  return h(
    'div',
    { class: 'side-screen' },
    h('h2', { class: 'side-screen__title' }, 'No life yet'),
    h('p', null, 'Character creation arrives in Phase 1. Until then the world runs on its own.'),
    __DEBUG_PANEL__ && !state.debugOpen
      ? h(
          'p',
          { class: 'muted' },
          'To see how stats explain themselves, ',
          h(
            'button',
            { class: 'link-button', type: 'button', onclick: () => void app.setDebugOpen(true) },
            'open the debug panel',
          ),
          ' and spawn a test entity.',
        )
      : null,
    state.snapshot?.player ? h('p', null, `Playing as ${state.snapshot.player.name}.`) : null,
  );
}
