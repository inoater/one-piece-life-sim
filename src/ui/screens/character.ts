import { renderPowerSummary } from '../components/power-summary';
import type { CharacterSheet } from '../../worker/protocol';
import type { App } from '../app';
import { renderSheet, type SheetHandle } from '../components/sheet';
import { h } from '../dom';
import type { UiState } from '../store';

/**
 * The Character tab: the full sheet of the life being played, or, before there is one, the way to
 * start it. The sheet's tooltips are cleaned up whenever it is replaced.
 */

let current: SheetHandle | null = null;
/** The sheet last shown, so the next one can show what changed (same person only). */
let lastSheet: CharacterSheet | null = null;

export function renderCharacter(state: UiState, app: App): HTMLElement {
  current?.destroy();
  current = null;
  const snapshot = state.snapshot;
  if (snapshot?.sheet) {
    const previous =
      lastSheet?.id === snapshot.sheet.id && lastSheet.name === snapshot.sheet.name
        ? lastSheet
        : null;
    current = renderSheet(snapshot.sheet, { tick: snapshot.tick, previous, place: 'character' });
    lastSheet = snapshot.sheet;
    return h(
      'div',
      { class: 'side-screen side-screen--sheet' },
      renderPowerSummary(snapshot.powers, snapshot.fight, { link: true }),
      current.el,
    );
  }
  return h(
    'div',
    { class: 'side-screen' },
    h('h2', { class: 'side-screen__title' }, 'No life yet'),
    h(
      'p',
      null,
      'Nobody lives in this world yet: the clock runs, but nothing happens to anyone. Choose a race, a birthplace, a family and a year to begin.',
    ),
    h('p', null, h('a', { class: 'button button--primary', href: '#/new' }, 'Start a new life')),
    __DEBUG_PANEL__ && !state.debugOpen
      ? h(
          'p',
          { class: 'muted' },
          'To see how stats explain themselves without starting a life, ',
          h(
            'button',
            { class: 'link-button', type: 'button', onclick: () => void app.setDebugOpen(true) },
            'open the debug panel',
          ),
          ' and spawn a test entity.',
        )
      : null,
  );
}
