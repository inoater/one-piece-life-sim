import type { LoadInfo, SavesState } from '../worker/protocol';
import type { SlotSummary } from '../engine/saves/store';
import type { App } from './app';
import { confirmButton } from './components/confirm-button';
import { openModal, type ModalHandle } from './components/modal';
import { h } from './dom';
import { errorMessage, formatBytes, relativeTime, shortHash } from './format';
import type { Status, Theme } from './store';

/**
 * The Menu: save slots (three autosaves that rotate, ten manual), export and import of `.opsim`
 * files, and appearance. Loading a slot, overwriting one and deleting one ask for a second press
 * first. Import does not: choosing a file in the system picker is already the deliberate step.
 */

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatic', hint: 'follows your device' },
  { value: 'light', label: 'Light', hint: '' },
  { value: 'dark', label: 'Dark', hint: '' },
];

/** What to tell the player after a load or import. */
export function describeLoad(load: LoadInfo): Status {
  const { report } = load;
  const parts = [`Loaded ${report.label || load.source}.`];
  if (report.hashMatches)
    parts.push(`The state hash ${shortHash(report.actualHash, 10)} matches the save.`);
  else if (report.migratedFrom !== null)
    parts.push(`Upgraded from save format ${report.migratedFrom}.`);
  else parts.push('The state hash differs from the save.');
  if (!report.dataHashMatches) {
    parts.push(
      'The game content has changed since this save was made, so the world may not play out as it would have.',
    );
  }
  const clean = (report.hashMatches || report.migratedFrom !== null) && report.dataHashMatches;
  return { kind: clean ? 'info' : 'warn', text: parts.join(' ') };
}

function download(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openMenu(app: App): ModalHandle {
  const body = h('div', { class: 'menu' });
  const modal = openModal({
    title: 'Menu',
    body,
    className: 'modal--menu',
    onClose: () => app.setMenuOpen(false),
  });
  app.setMenuOpen(true);

  let saves: SavesState | null = null;
  let message: Status | null = null;
  let working = false;

  const say = (status: Status | null) => {
    message = status;
    render();
  };

  /** Run a save operation with the buttons disabled and errors shown in the menu. */
  async function perform(work: () => Promise<void>): Promise<void> {
    if (working) return;
    working = true;
    render();
    try {
      await work();
    } catch (error) {
      message = { kind: 'error', text: errorMessage(error) };
    } finally {
      working = false;
      render();
    }
  }

  const refreshList = async () => {
    saves = await app.host.call('saves/list', {});
  };

  function renderSlot(
    kind: 'auto' | 'manual',
    index: number,
    found: SlotSummary | undefined,
  ): HTMLElement {
    const slot = `${kind}-${index}`;
    const name = kind === 'auto' ? `Autosave ${index}` : `Slot ${index}`;
    const actions: HTMLElement[] = [];

    if (kind === 'manual') {
      const save = async () =>
        perform(async () => {
          saves = await app.host.call('saves/save', { slot });
          message = { kind: 'info', text: `Saved to ${name}.` };
        });
      actions.push(
        found
          ? confirmButton({
              label: 'Overwrite',
              confirmLabel: 'Press again to overwrite',
              disabled: working,
              onConfirm: () => void save(),
            })
          : h(
              'button',
              { class: 'button', type: 'button', disabled: working, onclick: () => void save() },
              'Save here',
            ),
      );
    }
    if (found) {
      actions.push(
        confirmButton({
          label: 'Load',
          confirmLabel: 'Press again to replace this world',
          disabled: working,
          onConfirm: () =>
            void perform(async () => {
              const { snapshot, load } = await app.host.call('saves/load', {
                slot,
                view: app.view(),
              });
              app.adopt(snapshot, describeLoad(load));
              modal.close();
            }),
        }),
        confirmButton({
          label: 'Delete',
          confirmLabel: 'Press again to delete',
          disabled: working,
          onConfirm: () =>
            void perform(async () => {
              saves = await app.host.call('saves/delete', { slot });
              message = { kind: 'info', text: `Deleted ${name}.` };
            }),
        }),
      );
    }

    return h(
      'li',
      { class: 'slot', dataset: { kind, filled: String(Boolean(found)) } },
      h(
        'div',
        { class: 'slot__main' },
        h('strong', { class: 'slot__name' }, name),
        found
          ? [
              h('span', { class: 'slot__label' }, found.label),
              h(
                'span',
                { class: 'slot__meta' },
                `Saved ${relativeTime(found.savedAt, Date.now())}, seed ${found.seed}, hash ${shortHash(found.stateHash, 8)}, ${formatBytes(found.size)}`,
              ),
            ]
          : h('span', { class: 'slot__label slot__label--empty' }, 'Empty'),
      ),
      h('div', { class: 'slot__actions' }, actions),
    );
  }

  function renderSaves(): HTMLElement {
    if (!saves)
      return h(
        'section',
        { class: 'menu__section' },
        h('h3', null, 'Saves'),
        h('p', { class: 'muted' }, 'Loading saves...'),
      );
    const byId = new Map(saves.slots.map((s) => [s.slot, s]));
    const fileInput = h('input', {
      type: 'file',
      accept: '.opsim',
      hidden: true,
      'aria-label': 'Choose a .opsim save file',
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      void perform(async () => {
        if (file.size > (saves?.limits.maxImportBytes ?? Infinity)) {
          throw new Error(
            `That file is ${formatBytes(file.size)}, which is over the ${formatBytes(saves?.limits.maxImportBytes ?? 0)} limit for a save.`,
          );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { snapshot, load } = await app.host.call('saves/import', { bytes, view: app.view() });
        app.adopt(snapshot, describeLoad(load));
        modal.close();
      });
    });

    return h(
      'section',
      { class: 'menu__section' },
      h('h3', null, 'Saves'),
      saves.persistent
        ? null
        : h(
            'p',
            { class: 'menu__warning', role: 'alert' },
            'Saves are not kept between visits in this browser, because its storage is unavailable. Export a file to keep your world.',
          ),
      message
        ? h(
            'p',
            { class: 'menu__message', role: 'status', dataset: { kind: message.kind } },
            message.text,
          )
        : null,
      h(
        'p',
        { class: 'muted' },
        'The game saves by itself after time passes, rotating through three slots.',
      ),
      h('ul', { class: 'slots' }, [
        ...Array.from({ length: saves.counts.autosaveSlots }, (_, i) =>
          renderSlot('auto', i + 1, byId.get(`auto-${i + 1}`)),
        ),
        ...Array.from({ length: saves.counts.manualSlots }, (_, i) =>
          renderSlot('manual', i + 1, byId.get(`manual-${i + 1}`)),
        ),
      ]),
      h(
        'div',
        { class: 'menu__files' },
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            disabled: working,
            onclick: () =>
              void perform(async () => {
                const { filename, bytes } = await app.host.call('saves/export', {});
                download(filename, bytes);
                message = {
                  kind: 'info',
                  text: `Exported ${filename} (${formatBytes(bytes.byteLength)}).`,
                };
              }),
          },
          'Export this world',
        ),
        h(
          'button',
          { class: 'button', type: 'button', disabled: working, onclick: () => fileInput.click() },
          'Import a save file',
        ),
        fileInput,
      ),
    );
  }

  function renderAppearance(): HTMLElement {
    const current = app.store.get().theme;
    return h(
      'section',
      { class: 'menu__section' },
      h('h3', null, 'Appearance'),
      h(
        'div',
        { class: 'choices', role: 'radiogroup', 'aria-label': 'Colour theme' },
        THEMES.map((theme) => {
          const input = h('input', {
            type: 'radio',
            name: 'theme',
            value: theme.value,
            checked: theme.value === current,
          });
          input.addEventListener('change', () => app.setTheme(theme.value));
          return h(
            'label',
            { class: 'choices__item' },
            input,
            h('span', null, theme.label),
            theme.hint ? h('span', { class: 'muted' }, ` (${theme.hint})`) : null,
          );
        }),
      ),
    );
  }

  function render(): void {
    body.replaceChildren(renderSaves(), renderAppearance());
  }

  render();
  void refreshList().then(render, (error) => say({ kind: 'error', text: errorMessage(error) }));
  return modal;
}
