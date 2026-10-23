// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadInfo } from '../../src/worker/protocol';
import { describeLoad } from '../../src/ui/menu';
import { button, mountUi, settle, text, type Mounted } from '../helpers/ui';

let ui: Mounted;
beforeEach(async () => {
  ui = await mountUi();
});
afterEach(() => {
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  ui.unroute();
  ui.shell.destroy();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const dialog = () => document.querySelector('.modal') as HTMLElement | null;
const slots = () => [...document.querySelectorAll('.slot')] as HTMLElement[];
const slot = (name: string) =>
  slots().find((s) => text(s.querySelector('.slot__name')) === name) as HTMLElement;
const open = async () => {
  button(ui.root, 'Menu').click();
  await settle(10);
};
const press = async (scope: ParentNode, label: string | RegExp) => {
  button(scope, label).click();
  await settle(10);
};
const advance = (months: number) => ui.app.advance({ kind: 'months', count: months }, 'test');
const closeMenu = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

describe('the menu dialog', () => {
  it('opens as a labelled modal dialog', async () => {
    await open();
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog()?.getAttribute('aria-labelledby') as string;
    expect(text(document.getElementById(labelledBy))).toBe('Menu');
    expect(ui.app.store.get().menuOpen).toBe(true);
  });

  it('closes with Escape, returns focus to the Menu button, and clears its state', async () => {
    const menu = button(ui.root, 'Menu');
    menu.focus();
    await open();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(menu);
    expect(ui.app.store.get().menuOpen).toBe(false);
  });

  it('closes from its Close button and from a click on the backdrop', async () => {
    await open();
    button(dialog() as HTMLElement, 'Close').click();
    expect(dialog()).toBeNull();
    await open();
    document
      .querySelector('.modal-backdrop')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(dialog()).toBeNull();
  });

  it('keeps Tab inside the dialog', async () => {
    await open();
    const focusable = [
      ...(dialog() as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      ),
    ].filter((el) => !el.closest('[hidden]'));
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(backward);
    expect(document.activeElement).toBe(last);
  });
});

describe('save slots', () => {
  it('lists three autosave slots and ten manual slots, all empty at first', async () => {
    await open();
    expect(slots()).toHaveLength(13);
    expect(
      slots()
        .slice(0, 3)
        .map((s) => text(s.querySelector('.slot__name'))),
    ).toEqual(['Autosave 1', 'Autosave 2', 'Autosave 3']);
    expect(text(slot('Slot 10').querySelector('.slot__name'))).toBe('Slot 10');
    expect(slots().every((s) => s.getAttribute('data-filled') === 'false')).toBe(true);
  });

  it('warns that saves will not survive a reload when storage is not persistent', async () => {
    await open();
    expect(text(document.querySelector('.menu__warning'))).toContain('not kept between visits');
  });

  it('shows autosaves that appeared as time passed, with their date, seed and hash', async () => {
    await advance(14);
    await open();
    const first = slot('Autosave 1');
    expect(first.getAttribute('data-filled')).toBe('true');
    expect(text(first.querySelector('.slot__label'))).toBe('March, Year 1 (autosave)');
    expect(text(first.querySelector('.slot__meta'))).toMatch(
      /^Saved just now, seed ui-seed, hash [0-9a-f]{8}, \d/,
    );
  });

  it('saves to a manual slot', async () => {
    await advance(5);
    await open();
    await press(slot('Slot 3'), 'Save here');
    expect(text(document.querySelector('.menu__message'))).toBe('Saved to Slot 3.');
    expect(slot('Slot 3').getAttribute('data-filled')).toBe('true');
    expect(text(slot('Slot 3').querySelector('.slot__label'))).toBe('June, Year 0');
    expect(slot('Slot 1').getAttribute('data-filled')).toBe('false');
  });

  it('asks twice before replacing the world with a load, then restores that moment', async () => {
    await advance(5);
    await open();
    await press(slot('Slot 1'), 'Save here');
    closeMenu(); // a player cannot reach the page behind an open dialog
    await advance(7);
    expect(ui.core.peekState().tick).toBe(12);

    await open();
    await press(slot('Slot 1'), 'Load'); // first press only arms
    expect(ui.core.peekState().tick).toBe(12);
    expect(text(slot('Slot 1').querySelector('.is-armed'))).toBe(
      'Press again to replace this world',
    );

    await press(slot('Slot 1'), /Press again to replace this world/);
    expect(ui.core.peekState().tick).toBe(5);
    expect(dialog()).toBeNull(); // the menu closes after a load
    expect(text(ui.root.querySelector('.masthead__title'))).toBe('June, Year 0');
    expect(text(ui.root.querySelector('.controls__status'))).toMatch(
      /^Loaded June, Year 0\. The state hash [0-9a-f]{10} matches the save\.$/,
    );
  });

  it('asks twice before overwriting or deleting', async () => {
    await advance(2);
    await open();
    await press(slot('Slot 2'), 'Save here');
    closeMenu();
    await advance(2);
    await open();

    await press(slot('Slot 2'), 'Overwrite');
    expect(text(slot('Slot 2').querySelector('.slot__label'))).toBe('March, Year 0'); // not yet
    await press(slot('Slot 2'), /Press again to overwrite/);
    expect(text(slot('Slot 2').querySelector('.slot__label'))).toBe('May, Year 0');

    await press(slot('Slot 2'), 'Delete');
    expect(slot('Slot 2').getAttribute('data-filled')).toBe('true');
    await press(slot('Slot 2'), /Press again to delete/);
    expect(slot('Slot 2').getAttribute('data-filled')).toBe('false');
    expect(text(document.querySelector('.menu__message'))).toBe('Deleted Slot 2.');
  });

  it('loads an autosave too, and cannot save into one by hand', async () => {
    await advance(3);
    await open();
    expect(() => button(slot('Autosave 1'), 'Save here')).toThrow(); // only Load and Delete
    expect(() => button(slot('Autosave 1'), 'Overwrite')).toThrow();
    await advance(0);
  });

  it('shows a failure inside the menu instead of breaking, when a slot holds a damaged save', async () => {
    await advance(3);
    const [summary] = await ui.store.list();
    await ui.store.put(
      { ...summary!, slot: 'manual-1', kind: 'manual' },
      new TextEncoder().encode('not a save'),
    );
    await open();
    await press(slot('Slot 1'), 'Load');
    await press(slot('Slot 1'), /Press again/);
    const message = document.querySelector('.menu__message') as HTMLElement;
    expect(message.getAttribute('data-kind')).toBe('error');
    expect(text(message)).toContain('not an .opsim save file');
    expect(dialog()).not.toBeNull();
    expect(ui.core.peekState().tick).toBe(3); // untouched
  });
});

describe('export', () => {
  it('downloads the world as a .opsim file named for its seed and moment', async () => {
    await advance(5);
    const urls: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => (urls.push(blob), 'blob:test'));
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.getAttribute('download') ?? '');
    });

    await open();
    await press(dialog() as HTMLElement, 'Export this world');
    expect(downloads).toEqual(['opsim-ui-seed-tick5.opsim']);
    expect(urls[0]?.size).toBeGreaterThan(100);
    expect(text(document.querySelector('.menu__message'))).toMatch(
      /^Exported opsim-ui-seed-tick5\.opsim \(\d/,
    );
  });
});

describe('appearance', () => {
  it('offers automatic, light and dark, with the current one selected', async () => {
    await open();
    const radios = [
      ...(dialog() as HTMLElement).querySelectorAll<HTMLInputElement>('input[name="theme"]'),
    ];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ['auto', true],
      ['light', false],
      ['dark', false],
    ]);
  });

  it('applies and remembers the choice', async () => {
    await open();
    const choose = (value: string) => {
      const radio = (dialog() as HTMLElement).querySelector<HTMLInputElement>(
        `input[value="${value}"]`,
      ) as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    };
    choose('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('opsim.theme')).toBe('dark');
    choose('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    choose('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(ui.app.store.get().theme).toBe('auto');
  });
});

describe('describing a load', () => {
  const load = (report: Partial<LoadInfo['report']>): LoadInfo => ({
    source: 'manual-1',
    report: {
      label: 'March, Year 3',
      seed: 's',
      tick: 39,
      savedAt: 0,
      saveVersion: 1,
      migratedFrom: null,
      engineVersion: '0.1.0',
      storedHash: 'a'.repeat(32),
      actualHash: 'a'.repeat(32),
      hashMatches: true,
      savedDataHash: 'd',
      dataHashMatches: true,
      ...report,
    },
  });

  it('is plain good news when everything matches', () => {
    expect(describeLoad(load({}))).toEqual({
      kind: 'info',
      text: 'Loaded March, Year 3. The state hash aaaaaaaaaa matches the save.',
    });
  });

  it('warns when the game content changed since the save', () => {
    const status = describeLoad(load({ dataHashMatches: false }));
    expect(status.kind).toBe('warn');
    expect(status.text).toContain('game content has changed');
  });

  it('explains a migration instead of calling it a mismatch', () => {
    const status = describeLoad(
      load({ hashMatches: false, migratedFrom: 1, actualHash: 'b'.repeat(32) }),
    );
    expect(status).toMatchObject({ kind: 'info' });
    expect(status.text).toContain('Upgraded from save format 1.');
  });

  it('flags a real mismatch', () => {
    const status = describeLoad(load({ hashMatches: false, actualHash: 'b'.repeat(32) }));
    expect(status.kind).toBe('warn');
    expect(status.text).toContain('differs from the save');
  });
});
