import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { copyButton } from '../components/copy-button';
import { h } from '../dom';
import { errorMessage, shortHash } from '../format';
import type { UiState } from '../store';
import type { EventListItem } from '../../worker/protocol';
import type { DebugTab } from './tab';

/** Seed, state hash, tick controls, omniscient toggle, force-event dropdown. */
export function createWorldTab(app: App): DebugTab {
  // ---- Seed and new worlds
  const seedCode = h('code', { class: 'debug__value', id: 'dbg-seed' }, '');
  const seedCopy = h('span', null);
  const seedInput = h('input', {
    class: 'debug__input',
    type: 'text',
    placeholder: 'any text, e.g. coral-1234',
    'aria-label': 'Seed for a new world',
    maxlength: 80,
  });
  const probeBox = h('input', { type: 'checkbox', checked: true, id: 'dbg-probe' });
  const fixturesBox = h('input', { type: 'checkbox', checked: true, id: 'dbg-fixtures' });
  const options = () => ({ probe: probeBox.checked, fixtures: fixturesBox.checked });
  const reroll = confirmButton({
    label: 'Reroll seed',
    confirmLabel: 'Press again to replace this world',
    className: 'button button--tiny',
    onConfirm: () => void app.newWorld(options()),
  });
  const startSeed = confirmButton({
    label: 'Start with this seed',
    confirmLabel: 'Press again to replace this world',
    className: 'button button--tiny',
    onConfirm: () => void app.newWorld({ seed: seedInput.value, ...options() }),
  });

  // ---- Hashes and the last load
  const hashCode = h('code', { class: 'debug__value', id: 'dbg-hash' }, '');
  const hashCopy = h('span', null);
  const dataCode = h('code', { class: 'debug__value' }, '');
  const loadLine = h('p', { class: 'debug__note' }, '');

  // ---- Time
  const tick = (months: number) =>
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        onclick: () => void app.advance({ kind: 'months', count: months }, `Ticking x${months}`),
      },
      `Tick x${months}`,
    );

  // ---- View
  const omniscient = h('input', { type: 'checkbox', id: 'dbg-omniscient' });
  omniscient.addEventListener('change', () => void app.setOmniscient(omniscient.checked));
  const openEnded = h('input', { type: 'checkbox', id: 'dbg-open-ended' });
  openEnded.addEventListener('change', () => {
    const wanted = openEnded.checked;
    void app.dispatch({ type: 'debug/setOpenEnded', value: wanted });
  });

  // ---- Force an event
  const eventSelect = h('select', { class: 'debug__input', 'aria-label': 'Event to force' });
  const forceButton = h('button', { class: 'button button--tiny', type: 'button' }, 'Force event');
  const forceNote = h(
    'p',
    { class: 'debug__note' },
    'A forced event fires during the next month processed, ignoring its conditions.',
  );
  let loadedEvents = false;
  forceButton.addEventListener('click', () => {
    if (!eventSelect.value) return;
    void app.dispatch(
      { type: 'debug/forceEvent', eventId: eventSelect.value },
      `Forced ${eventSelect.value}. It fires in the next month processed.`,
    );
  });

  const hostLine = h('code', { class: 'debug__value' }, '');

  const row = (label: string, ...value: (Node | string)[]) =>
    h(
      'div',
      { class: 'debug__row' },
      h('span', { class: 'debug__label' }, label),
      h('span', { class: 'debug__cell' }, value),
    );
  const check = (input: HTMLInputElement, text: string) =>
    h('label', { class: 'debug__check', for: input.id }, input, h('span', null, text));

  const el = h(
    'div',
    { class: 'debug__section-stack' },
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Seed'),
      row('Seed', seedCode, seedCopy),
      h('div', { class: 'debug__inline' }, reroll),
      h('div', { class: 'debug__inline' }, seedInput, startSeed),
      h(
        'div',
        { class: 'debug__inline' },
        check(probeBox, 'Entropy probe'),
        check(fixturesBox, 'Test entity'),
      ),
      h(
        'p',
        { class: 'debug__note' },
        'Options apply to the next new world. The probe draws random numbers every tick so determinism checks are meaningful.',
      ),
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'State'),
      row('State hash', hashCode, hashCopy),
      row('Content hash', dataCode),
      loadLine,
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Time'),
      h('div', { class: 'debug__inline' }, tick(1), tick(12), tick(468)),
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'View'),
      check(omniscient, 'Omniscient: show facts nobody in the world knows'),
      check(openEnded, 'Open-ended: allow time past the present'),
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Events'),
      h('div', { class: 'debug__inline' }, eventSelect, forceButton),
      forceNote,
    ),
    h(
      'section',
      { class: 'debug__section' },
      h('h3', null, 'Host'),
      row('Simulation runs in', hostLine),
    ),
  );

  let lastHash = '';
  let lastSeed = '';

  return {
    el,
    sync(state: UiState) {
      const s = state.snapshot;
      omniscient.checked = state.omniscient;
      hostLine.textContent =
        state.hostMode === 'worker'
          ? 'Web Worker'
          : state.hostMode === 'inline'
            ? 'main thread (inline fallback)'
            : 'unknown';
      if (!s) return;
      openEnded.checked = s.openEnded;
      if (s.seed !== lastSeed) {
        lastSeed = s.seed;
        seedCode.textContent = s.seed;
        seedCopy.replaceChildren(copyButton(s.seed));
      }
      if (s.stateHash && s.stateHash !== lastHash) {
        lastHash = s.stateHash;
        hashCode.textContent = s.stateHash;
        hashCopy.replaceChildren(copyButton(s.stateHash));
      }
      dataCode.textContent = shortHash(s.info.dataHash, 16);
      const load = s.lastLoad;
      if (!load) {
        loadLine.textContent = 'No save has been loaded in this session.';
        loadLine.dataset['kind'] = 'info';
      } else {
        const { report } = load;
        const verdict = report.hashMatches
          ? 'matches'
          : report.migratedFrom !== null
            ? `differs after migration from format ${report.migratedFrom}`
            : 'DIFFERS';
        loadLine.textContent = `Loaded from ${load.source}: the saved hash is ${shortHash(report.storedHash, 12)}, the loaded state hashes to ${shortHash(report.actualHash, 12)}. ${verdict === 'matches' ? 'They match.' : `They ${verdict}.`}${report.dataHashMatches ? '' : ' The game content has changed since this save.'}`;
        loadLine.dataset['kind'] = report.hashMatches ? 'ok' : 'bad';
      }
    },
    async refresh() {
      if (loadedEvents) return;
      try {
        const events: EventListItem[] = await app.host.call('listEvents', {});
        loadedEvents = true;
        eventSelect.replaceChildren(
          ...events.map((e) =>
            h(
              'option',
              { value: e.id },
              `${e.id}: ${e.title} (${e.type}${e.choices ? `, ${e.choices} choices` : ''}${e.visibility === 'secret' ? ', secret' : ''})`,
            ),
          ),
        );
      } catch (error) {
        app.say({ kind: 'error', text: errorMessage(error) });
      }
    },
  };
}
