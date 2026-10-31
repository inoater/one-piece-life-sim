// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, type Mounted } from '../helpers/ui';

let ui: Mounted;

beforeEach(async () => {
  ui = await mountUi();
});
afterEach(() => {
  ui.shell.destroy();
  ui.unroute();
  window.location.hash = '';
});

const q = <T extends Element = HTMLElement>(selector: string) => ui.root.querySelector<T>(selector);
const qa = (selector: string) => [...ui.root.querySelectorAll<HTMLElement>(selector)];

/** Wait for something asynchronous (a debounced preview) to show up. */
async function until(check: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const previewName = () => text(q('.newlife__preview .sheet__name'));
const previewSettled = () =>
  !text(q('.newlife__status')).includes('Rolling') && previewName() !== '';

async function openNewLife(): Promise<void> {
  navigate('new');
  await settle();
  await until(previewSettled, 'the first preview');
}

async function goToStep(label: string): Promise<void> {
  button(ui.root, new RegExp(`^\\d${label}$`)).click();
  await settle();
}

function pick(value: string): void {
  const input = q<HTMLInputElement>(`.card[data-value="${value}"] input`);
  if (!input) throw new Error(`No card for ${value}`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function type(name: string, value: string): void {
  const input = q<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`No input ${name}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('New Life', () => {
  it('takes over the page, with seven steps and a live preview of the sheet', async () => {
    await openNewLife();
    expect(q('.shell')?.getAttribute('data-route')).toBe('new');
    expect(q('.newlife-page')?.hidden).toBe(false);
    expect(qa('.steps__item').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Step 1: World',
      'Step 2: Race',
      'Step 3: Birthplace',
      'Step 4: Family',
      'Step 5: Entry',
      'Step 6: Appearance',
      'Step 7: Review',
    ]);
    expect(previewName()).not.toBe('');
    expect(text(q('.newlife__preview'))).toContain('Backstory');
    expect(text(q('.newlife__status'))).toMatch(/Generated in \d+ ms/);
  });

  it('warns about a giant newborn, and the suggested age clears the warning', async () => {
    await openNewLife();
    await goToStep('Race');
    pick('race_giant');
    await goToStep('Entry');
    type('entryYear', '1486');
    type('entryAge', '0');
    await until(() => text(q('.warnings')).includes('child until 40'), 'the giant warning');
    const warning = q('.warning[data-id="child-at-present"]');
    expect(warning?.dataset['level']).toBe('warn');
    button(warning as HTMLElement, /young adult: enter at 55/).click();
    await until(() => !text(q('.warnings')).includes('child until 40'), 'the warning to clear');
    expect(q<HTMLInputElement>('input[name="entryAge"]')?.value).toBe('55');
    await until(
      () => text(q('.newlife__preview .sheet__identity')).startsWith('Age 55'),
      'the preview at 55',
    );
  });

  it('offers only the birthplaces the chosen race can be born in', async () => {
    await openNewLife();
    await goToStep('Race');
    pick('race_tontatta');
    await until(previewSettled, 'the preview');
    await goToStep('Birthplace');
    const values = qa('.card').map((c) => c.dataset['value']);
    expect(values).toEqual(['random', 'bp_green_bit']);
    expect(text(q('.step'))).toContain('Closed to a Dwarf (Tontatta)');
  });

  it('rerolls and locks appearance one field at a time', async () => {
    await openNewLife();
    await goToStep('Appearance');
    await until(() => qa('.appearance-row').length > 0, 'the appearance rows');
    const value = (field: string) =>
      q<HTMLSelectElement>(`select[name="appearance-${field}"]`)?.value;
    const before = Object.fromEntries(
      qa('.appearance-row').map((r) => [r.dataset['field'], value(r.dataset['field'] as string)]),
    );
    // Reroll the eye colour until it changes; nothing else may move.
    for (let i = 0; i < 8 && value('eyeColor') === before['eyeColor']; i++) {
      button(q('.appearance-row[data-field="eyeColor"]') as HTMLElement, 'Reroll').click();
      await until(previewSettled, 'a reroll');
    }
    expect(value('eyeColor')).not.toBe(before['eyeColor']);
    for (const [field, was] of Object.entries(before))
      if (field !== 'eyeColor') expect(value(field), field).toBe(was);

    // Pick a build outright: it is locked, and survives a change of entry age.
    const build = q<HTMLSelectElement>('select[name="appearance-build"]') as HTMLSelectElement;
    build.value = 'heavyset';
    build.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => q('.appearance-row[data-field="build"]')?.dataset['locked'] === 'true',
      'the lock',
    );
    await goToStep('Entry');
    type('entryAge', '40');
    await until(() => text(q('.newlife__preview .sheet__identity')).startsWith('Age 40'), 'age 40');
    expect(text(q('.newlife__preview .sheet__appearance'))).toContain('heavyset');
  });

  it('starts the life: the chronicle holds the past, the header and Character tab the person', async () => {
    await openNewLife();
    await goToStep('Family');
    type('givenName', 'Wren');
    type('familyName', 'Tidewell');
    await until(() => previewName() === 'Wren Tidewell', 'the typed name');
    await goToStep('Review');
    expect(text(q('.review'))).toContain('Seed');
    button(ui.root, 'Start this life').click();
    await until(
      () => ui.app.store.get().snapshot?.player?.name === 'Wren Tidewell',
      'the life to start',
    );
    await settle();
    expect(q('.shell')?.getAttribute('data-route')).toBe('feed');
    expect(q('.newlife-page')?.hidden).toBe(true);
    const vitals = qa('.vital__value').map(text);
    expect(qa('.vital__label').map(text)).toEqual([
      'Age',
      'Health',
      'Vigor',
      'Location',
      'Berries',
      'Morale',
      'Crew',
    ]);
    expect(vitals[0]).toBe('16');
    expect(vitals[1]).toMatch(/^\d+\/\d+$/); // full Health at the start
    expect(vitals[4]).toMatch(/^−?[\d,]+$/);
    expect(text(q('.panel--feed'))).toContain('Age 0: You were born');
    expect(text(q('.panel--feed'))).toContain("Wren Tidewell's story begins");
    navigate('character');
    await settle();
    expect(text(q('.panel--side .sheet__name'))).toBe('Wren Tidewell');
    expect(qa('.panel--side .stat-row').length).toBe(9); // Luck stays hidden
  });

  it('asks before replacing a life in progress', async () => {
    await openNewLife();
    await goToStep('Review');
    button(ui.root, 'Start this life').click();
    await until(() => ui.app.store.get().snapshot?.player !== null, 'the first life');
    await settle();
    const first = ui.app.store.get().snapshot;
    navigate('new');
    await settle();
    await until(previewSettled, 'a new preview');
    await goToStep('Review');
    const start = button(ui.root, 'Start this life');
    start.click();
    await settle();
    expect(text(start)).toMatch(/Press again/);
    expect(ui.app.store.get().snapshot).toBe(first); // one press changes nothing
    start.click();
    await until(() => ui.app.store.get().snapshot !== first, 'the replacement');
    expect(ui.app.store.get().snapshot?.player).not.toBeNull();
  });

  it('the Character tab points the way when nobody lives in the world', async () => {
    navigate('character');
    await settle();
    expect(text(q('.panel--side'))).toContain('No life yet');
    expect(q<HTMLAnchorElement>('.panel--side a[href="#/new"]')).not.toBeNull();
  });
});
