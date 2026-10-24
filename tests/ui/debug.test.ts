// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDebug } from '../../src/ui/debug/panel';
import { data } from '../helpers/data';
import { button, mountUi, settle, text, type Mounted } from '../helpers/ui';

let ui: Mounted;
beforeEach(async () => {
  ui = await mountUi();
  mountDebug(ui.root, ui.app);
});
afterEach(() => {
  document.documentElement.classList.remove('has-debug');
  ui.unroute();
  ui.shell.destroy();
});

const panel = () => ui.root.querySelector('.debug') as HTMLElement;
const tab = (name: string) =>
  [...panel().querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (t) => text(t) === name,
  ) as HTMLElement;
const section = (id: string) => panel().querySelector(`#debug-panel-${id}`) as HTMLElement;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const openPanel = async () => {
  await ui.app.setDebugOpen(true);
  await settle();
};
const showTab = async (name: string) => {
  tab(name).click();
  await settle(10);
};
const type = async (input: HTMLInputElement, value: string, debounce = 0) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (debounce) await wait(debounce);
};
const hit = async (scope: ParentNode, label: string | RegExp) => {
  button(scope, label).click();
  await settle(10);
};
const spawn = async () => {
  await showTab('Entities');
  await hit(section('entities'), 'Spawn test entity');
};

describe('the panel itself', () => {
  it('starts hidden, and opens and closes with the backtick key', async () => {
    expect(panel().hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', cancelable: true }));
    await settle();
    expect(panel().hidden).toBe(false);
    expect(document.documentElement.classList.contains('has-debug')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', cancelable: true }));
    await settle();
    expect(panel().hidden).toBe(true);
    expect(document.documentElement.classList.contains('has-debug')).toBe(false);
  });

  it('ignores the backtick while typing in a field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '`', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(panel().hidden).toBe(true);
    input.remove();
  });

  it('opens from the footer Debug button and closes from its own Close button', async () => {
    button(ui.root, 'Debug').click();
    await settle();
    expect(panel().hidden).toBe(false);
    expect(button(ui.root, 'Debug').getAttribute('aria-pressed')).toBe('true');
    await hit(panel(), 'Close');
    expect(panel().hidden).toBe(true);
  });

  it('has World, Entities, Log, Genesis and Life tabs that switch like proper tabs', async () => {
    await openPanel();
    expect([...panel().querySelectorAll('[role="tab"]')].map(text)).toEqual([
      'World',
      'Entities',
      'Log',
      'Genesis',
      'Life',
    ]);
    expect(tab('World').getAttribute('aria-selected')).toBe('true');
    expect(section('entities').hidden).toBe(true);
    await showTab('Entities');
    expect(tab('Entities').getAttribute('aria-selected')).toBe('true');
    expect(tab('World').getAttribute('aria-selected')).toBe('false');
    expect(section('entities').hidden).toBe(false);
    expect(section('world').hidden).toBe(true);
  });

  it('moves between tabs with the arrow keys', async () => {
    await openPanel();
    tab('World').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(tab('Entities').getAttribute('aria-selected')).toBe('true');
    tab('Entities').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    tab('World').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(tab('Life').getAttribute('aria-selected')).toBe('true');
  });
});

describe('World tab', () => {
  beforeEach(openPanel);

  it("shows the seed and the full state hash, and the hash is the engine's", async () => {
    expect(text(section('world'))).toContain('ui-seed');
    const hash = text(section('world').querySelectorAll('.debug__value')[1]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect((await ui.core.handle('hash', {})).stateHash).toBe(hash);
  });

  it('keeps the state hash current as time passes', async () => {
    const before = text(section('world').querySelectorAll('.debug__value')[1]);
    await hit(section('world'), 'Tick x1');
    const after = text(section('world').querySelectorAll('.debug__value')[1]);
    expect(after).toMatch(/^[0-9a-f]{32}$/);
    expect(after).not.toBe(before);
  });

  it('has tick buttons for 1, 12 and 468 months', async () => {
    await hit(section('world'), 'Tick x1');
    expect(ui.core.peekState().tick).toBe(1);
    await hit(section('world'), 'Tick x12');
    expect(ui.core.peekState().tick).toBe(13);
    await hit(section('world'), 'Tick x468');
    expect(ui.core.peekState().tick).toBe(468); // stops at the present
    expect(text(ui.root.querySelector('.controls__status'))).toBe(
      'Reached the present (1525 SC) after 455 months.',
    );
  });

  it('lists every event that can be forced, and forces the chosen one', async () => {
    const select = section('world').querySelector('select') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(Object.keys(data.events).sort());
    const option = (id: string) => [...select.options].find((o) => o.value === id);
    expect(text(option('evt_test_crossroads'))).toBe(
      'evt_test_crossroads: A test crossroads (personal, 2 choices)',
    );
    expect(text(option('evt_test_secret'))).toContain('secret');
    select.value = 'evt_test_notice';
    await hit(section('world'), 'Force event');
    expect(ui.core.peekState().scheduled).toMatchObject([
      { eventId: 'evt_test_notice', source: 'debug' },
    ]);
    await hit(ui.root, 'Next month');
    expect(text(ui.root.querySelector('.panel--feed'))).toContain(
      'A test notice is posted in January 1486 SC',
    );
  });

  it('toggles omniscient mode, revealing what nobody knows', async () => {
    const select = section('world').querySelector('select') as HTMLSelectElement;
    select.value = 'evt_test_secret';
    await hit(section('world'), 'Force event');
    await hit(ui.root, 'Next month');
    expect(ui.root.querySelector('.line[data-hidden="true"]')).toBeNull();

    const omniscient = section('world').querySelector('#dbg-omniscient') as HTMLInputElement;
    omniscient.checked = true;
    omniscient.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(10);
    expect(ui.app.store.get().omniscient).toBe(true);
    expect(ui.root.querySelector('.line[data-hidden="true"]')).not.toBeNull();
  });

  it('allows time past the present when open-ended is switched on', async () => {
    await hit(section('world'), 'Tick x468');
    expect(ui.core.peekState().tick).toBe(468);
    const openEnded = section('world').querySelector('#dbg-open-ended') as HTMLInputElement;
    openEnded.checked = true;
    openEnded.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(10);
    await hit(ui.root, 'Next month');
    expect(ui.core.peekState().tick).toBe(469);
  });

  it('rerolling the seed needs a second press, then replaces the world with a fresh one (probe and test entity on)', async () => {
    await hit(ui.root, 'Skip 3 months');
    expect(ui.core.peekState().tick).toBe(3);
    await hit(section('world'), 'Reroll seed');
    expect(ui.core.peekState().tick).toBe(3); // armed only
    await hit(section('world'), /Press again to replace this world/);
    const state = ui.core.peekState();
    expect(state.tick).toBe(0);
    expect(state.flags['dev.probe']).toBe(true);
    expect(Object.keys(state.entities)).toHaveLength(1);
  });

  it('starts a world from a typed seed, and the options can be switched off', async () => {
    await type(
      section('world').querySelector('input[type="text"]') as HTMLInputElement,
      'coral-1234',
    );
    (section('world').querySelector('#dbg-probe') as HTMLInputElement).checked = false;
    (section('world').querySelector('#dbg-fixtures') as HTMLInputElement).checked = false;
    await hit(section('world'), 'Start with this seed');
    await hit(section('world'), /Press again to replace this world/);
    const state = ui.core.peekState();
    expect(state.seed).toBe('coral-1234');
    expect(state.flags['dev.probe']).toBeUndefined();
    expect(state.entities).toEqual({});
    expect(text(section('world'))).toContain('coral-1234');
  });

  it('reports the simulation host', () => {
    expect(text(section('world'))).toContain('main thread (inline fallback)');
  });

  it('says plainly when no save has been loaded, and verifies hashes after one', async () => {
    expect(text(section('world'))).toContain('No save has been loaded in this session.');
    await ui.app.advance({ kind: 'months', count: 4 }, 'test');
    const store = ui.store;
    ui.unroute();
    ui.shell.destroy(); // clears the root, debug panel included
    ui = await mountUi({ store, autoResume: true });
    mountDebug(ui.root, ui.app);
    await openPanel();
    const note = section('world').querySelector('.debug__note[data-kind]') as HTMLElement;
    expect(note.getAttribute('data-kind')).toBe('ok');
    expect(text(note)).toMatch(
      /^Loaded from auto-1: the saved hash is [0-9a-f]{12}, the loaded state hashes to [0-9a-f]{12}\. They match\.$/,
    );
  });
});

describe('Entities tab', () => {
  beforeEach(async () => {
    await openPanel();
    await spawn();
  });

  it('lists entities and spawns more', async () => {
    expect(text(section('entities').querySelector('.debug__note'))).toBe('1 entity.');
    await hit(section('entities'), 'Spawn test entity');
    const names = [...section('entities').querySelectorAll('.debug__pick')].map((b) =>
      text(b.querySelector('span')),
    );
    expect(names).toEqual(['Test Dummy 1', 'Test Dummy 2']);
    expect(text(section('entities').querySelector('.inspector__name'))).toBe('Test Dummy 2'); // newest is selected
  });

  it('filters by name or id', async () => {
    await hit(section('entities'), 'Spawn test entity');
    await type(
      section('entities').querySelector('input[type="search"]') as HTMLInputElement,
      'dummy 1',
      260,
    );
    await settle();
    expect(
      [...section('entities').querySelectorAll('.debug__pick')].map((b) =>
        text(b.querySelector('code')),
      ),
    ).toEqual(['gen_000001']);
  });

  it("shows every stat with its full modifier stack: the plan's example, 50 + 12 + 8 + 4 = 74", () => {
    const strength = section('entities').querySelector(
      '.stat[data-stat="strength"]',
    ) as HTMLElement;
    expect(text(strength.querySelector('.stat__total'))).toBe('74');
    expect(text(strength.querySelector('.stat__description'))).toBe(
      'Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)',
    );
    const rows = [...strength.querySelectorAll('.breakdown__row')].map((r) =>
      [...r.children].map(text),
    );
    expect(rows).toEqual([
      ['Base', '50', ''],
      ['training', '+12', 'permanent'],
      ['Brawler (trait)', '+8', 'permanent'],
      ['Cutlass (weapon)', '+4', 'permanent'],
      ['Total', '74', ''],
    ]);
  });

  it('shows flat, percentage and temporary lines together, with the expiry', () => {
    const speed = section('entities').querySelector('.stat[data-stat="speed"]') as HTMLElement;
    expect(text(speed.querySelector('.stat__total'))).toBe('70');
    const rows = [...speed.querySelectorAll('.breakdown__row')].map((r) =>
      [...r.children].map(text),
    );
    expect(rows).toEqual([
      ['Base', '40', ''],
      ['training', '+6', 'permanent'],
      ['Tailwind (temporary)', '+10', 'ends in 6 months'],
      ['Quick (trait)', '+25%', 'permanent'],
      ['Flat total, then percentages', '56 x 1.25', ''],
      ['Total', '70', ''],
    ]);
  });

  it('shows the same breakdown in a tooltip on the total, and removes it again', () => {
    const total = section('entities').querySelector(
      '.stat[data-stat="strength"] .stat__total',
    ) as HTMLElement;
    total.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tip).not.toBeNull();
    expect(total.getAttribute('aria-describedby')).toBe(tip.id);
    expect(text(tip)).toContain('Brawler (trait)+8permanent');
    total.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(total.hasAttribute('aria-describedby')).toBe(false);
    total.dispatchEvent(new FocusEvent('focus'));
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    total.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('adds a modifier, and watches it expire as months pass', async () => {
    const form = section('entities').querySelector('form') as HTMLFormElement;
    const field = (label: string) =>
      form.querySelector(`[aria-label="${label}"]`) as HTMLInputElement & HTMLSelectElement;
    field('Stat').value = 'endurance';
    field('Value').value = '20';
    field('Kind').value = 'pct';
    field('Months it lasts').value = '3';
    field('Source label').value = 'Boost';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(10);
    const endurance = () =>
      text(section('entities').querySelector('.stat[data-stat="endurance"] .stat__description'));
    expect(endurance()).toBe('Endurance 42 = (35 base) x 1.2 (+20% Boost)');

    await ui.app.advance({ kind: 'months', count: 3 }, 'test');
    await settle(10);
    expect(endurance()).toBe('Endurance 35 = 35 base');
  });

  it('refuses a modifier with a bad value, saying so', async () => {
    const form = section('entities').querySelector('form') as HTMLFormElement;
    (form.querySelector('[aria-label="Value"]') as HTMLInputElement).value = '';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(text(ui.root.querySelector('.controls__status'))).toBe(
      'The modifier value must be a number.',
    );
  });

  it('shows flags, who knows about it, and its recent log', () => {
    expect(text(section('entities'))).toContain('dev.fixture = true');
    expect(text(section('entities'))).toContain('everyone');
    expect(text(section('entities'))).toContain('Debug: spawned Test Dummy 1');
  });

  it('shows a helpful empty state before anything exists', async () => {
    ui.unroute();
    ui.shell.destroy();
    ui = await mountUi();
    mountDebug(ui.root, ui.app);
    await openPanel();
    await showTab('Entities');
    expect(text(section('entities'))).toContain('No entities yet.');
    expect(text(section('entities'))).toContain('Spawn a test entity to see a modifier stack.');
  });
});

describe('Log tab', () => {
  beforeEach(async () => {
    await openPanel();
    await spawn();
    for (const id of ['evt_test_notice', 'evt_test_crossroads']) {
      await ui.app.dispatch({ type: 'debug/forceEvent', eventId: id });
    }
    await ui.app.advance({ kind: 'months', count: 5 }, 'test');
    await showTab('Log');
  });

  const rows = () => [...section('log').querySelectorAll('.logrow')];
  const summaryText = () => text(section('log').querySelector('[role="status"]'));
  const control = (label: string) =>
    section('log').querySelector(`[aria-label="${label}"]`) as HTMLInputElement & HTMLSelectElement;

  it('lists the records newest first, with kind, date, tags and cause', () => {
    expect(summaryText()).toMatch(/^Showing \d+ of \d+ records, newest first\.$/);
    const seqs = rows().map((r) => Number(text(r.querySelector('code')).slice(1)));
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    const event = rows().find((r) =>
      text(r.querySelector('.logrow__summary')).startsWith('A test notice'),
    );
    expect(text(event?.querySelector('.logrow__kind'))).toBe('event');
    expect(text(event?.querySelector('.logrow__meta'))).toContain(
      'cause: evt_test_notice (after #',
    );
    expect(text(event?.querySelector('.logrow__date'))).toBe('January 1486 SC');
  });

  it('filters by text, kind, tag, entity and tick range', async () => {
    await type(control('Search text'), 'crossroads', 260);
    await settle();
    expect(
      rows().every((r) =>
        text(r.querySelector('.logrow__summary')).toLowerCase().includes('crossroads'),
      ),
    ).toBe(true);
    expect(rows().length).toBeGreaterThan(0);
    await hit(section('log'), 'Clear filters');

    control('Kind').value = 'event';
    control('Kind').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(260);
    await settle();
    expect(rows().length).toBe(2);
    expect(rows().every((r) => text(r.querySelector('.logrow__kind')) === 'event')).toBe(true);
    await hit(section('log'), 'Clear filters');

    control('Tag').value = 'debug';
    control('Tag').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(260);
    await settle();
    expect(rows().length).toBeGreaterThanOrEqual(3);
    expect(rows().every((r) => text(r.querySelector('.logrow__meta')).includes('debug'))).toBe(
      true,
    );
    await hit(section('log'), 'Clear filters');

    await type(control('Entity id'), 'gen_000001', 260);
    await settle();
    expect(rows().length).toBeGreaterThanOrEqual(1);
    expect(rows().every((r) => text(r.querySelector('.logrow__meta')).includes('gen_000001'))).toBe(
      true,
    );
    await hit(section('log'), 'Clear filters');

    await type(control('To tick'), '0', 260);
    await settle();
    expect(rows().every((r) => text(r.querySelector('.logrow__date')) === 'January 1486 SC')).toBe(
      true,
    );
  });

  it('offers the tags and kinds that actually occur, and says when nothing matches', async () => {
    expect([...control('Tag').options].map((o) => o.value)).toEqual(
      expect.arrayContaining(['', 'debug', 'event', 'system', 'world']),
    );
    expect([...control('Kind').options].map((o) => o.value)).toEqual(
      ['', 'decision', 'event', 'system'].filter((k) => k !== 'decision'),
    );
    await type(control('Search text'), 'zzz-nothing-matches', 260);
    await settle();
    expect(summaryText()).toBe('No records match.');
    expect(rows()).toHaveLength(0);
  });

  it('marks records nobody knows about when omniscient, and pages with Show more', async () => {
    await ui.app.resolveDecision(1, 'right'); // the crossroads is still waiting from setup, and would block time
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    await ui.app.advance({ kind: 'months', count: 1 }, 'test');
    await ui.app.setOmniscient(true);
    await showTab('World');
    await showTab('Log');
    const hidden = rows().filter((r) => r.getAttribute('data-known') === 'false');
    expect(hidden).toHaveLength(1);
    expect(text(hidden[0]?.querySelector('.logrow__flag'))).toBe('nobody knows');

    // Enough records to need a second page (driven through the core: no UI re-render per record).
    const view = { omniscient: true, hash: false };
    for (let i = 0; i < 130; i++) {
      await ui.core.handle('dispatch', {
        action: { type: 'debug/forceEvent', eventId: 'evt_test_notice' },
        view,
      });
    }
    await showTab('World');
    await showTab('Log');
    expect(rows()).toHaveLength(100);
    const more = button(section('log'), 'Show more');
    expect(more.hidden).toBe(false);
    more.click();
    await settle(10);
    expect(rows().length).toBeGreaterThan(100);
  });
});
