// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { MemorySaveStore } from '../../src/engine/saves/store';
import { button, link, mountUi, settle, text, until, type Mounted } from '../helpers/ui';

let ui: Mounted;
beforeEach(async () => {
  ui = await mountUi();
});
afterEach(() => {
  ui.unroute();
  ui.shell.destroy();
});

const q = (selector: string) => ui.root.querySelector(selector);
const qa = (selector: string) => [...ui.root.querySelectorAll(selector)];
const status = () => text(q('.controls__status'));
const click = async (label: string | RegExp) => {
  button(ui.root, label).click();
  await settle(10);
};

describe('the masthead', () => {
  it('shows the date, the season and the dial', () => {
    expect(text(q('.masthead__title'))).toBe('January 1486 SC');
    expect(text(q('.masthead__season'))).toBe('Winter');
    expect(q('.dial')).not.toBeNull();
  });

  it('holds age, location and Berries, marked as empty until a life has started', () => {
    expect(qa('.vital__label').map(text)).toEqual([
      'Age',
      'Health',
      'Vigor',
      'Location',
      'Berries',
      'Morale',
    ]);
    expect(qa('.vital__value.is-empty')).toHaveLength(6);
    expect(q('.vital__value')?.getAttribute('title')).toContain('Appears once a life has started');
  });

  it('follows the clock', async () => {
    await click('Next month');
    await until(() => text(q('.masthead__title')) === 'February 1486 SC');
    expect(text(q('.masthead__title'))).toBe('February 1486 SC');
    await ui.app.advance({ kind: 'months', count: 14 }, 'test');
    expect(text(q('.masthead__title'))).toBe('April 1487 SC');
    expect(text(q('.masthead__season'))).toBe('Spring');
  });
});

describe('navigation', () => {
  it('has the five sections, the map, the Powers, Gear, Ship and People pages as real links, and Back-friendly hash URLs', () => {
    expect(qa('.tabs a').map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['Feed', '#/feed'],
      ['Character', '#/character'],
      ['Actions', '#/actions'],
      ['World', '#/world'],
      ['News', '#/news'],
      ['Map', '#/map'],
      ['Powers', '#/powers'],
      ['Gear', '#/gear'],
      ['Ship', '#/ship'],
      ['People', '#/people'],
    ]);
  });

  it('marks the current section, and starts on the chronicle with Character beside it', () => {
    expect(q('.shell')?.getAttribute('data-route')).toBe('feed');
    expect(q('.shell')?.getAttribute('data-side')).toBe('character');
    expect(q('.panel--side')?.getAttribute('data-screen')).toBe('character');
    expect(qa('.tabs [aria-current="page"]').map(text)).toEqual(['Character']);
  });

  it('switches the side panel when the route changes, and remembers it while on the feed', async () => {
    navigate('world');
    await settle();
    expect(q('.shell')?.getAttribute('data-route')).toBe('world');
    expect(q('.panel--side')?.getAttribute('data-screen')).toBe('world');
    expect(text(q('.panel--side'))).toContain('The clock');
    expect(qa('.tabs [aria-current="page"]').map(text)).toEqual(['World']);

    navigate('feed');
    await settle();
    expect(q('.shell')?.getAttribute('data-route')).toBe('feed');
    expect(q('.panel--side')?.getAttribute('data-screen')).toBe('world');
  });

  it('shows each screen', async () => {
    for (const [route, expected] of [
      ['character', 'No life yet'],
      ['actions', 'Nobody to plan for'],
      ['news', 'No headlines yet'],
      ['world', 'This build'],
    ] as const) {
      navigate(route);
      await settle();
      expect(text(q('.panel--side')), route).toContain(expected);
    }
  });

  it('the Actions tab shows how many decisions are waiting', async () => {
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    await click('Next month');
    expect(text(link(ui.root, /^Actions/))).toBe('Actions (1)');
    navigate('actions');
    await settle();
    expect(text(q('.panel--side'))).toContain('1 decision waiting in the chronicle');
  });
});

describe('the chronicle', () => {
  it('starts with the world beginning, plus a hint to press Next month', () => {
    expect(qa('.panel--feed .line').map(text)).toEqual([
      'System. A new world begins (seed "ui-seed").',
    ]);
    expect(text(q('.feed__hint'))).toContain('Press Next month');
  });

  it('groups lines under their month, oldest first, with a category on each', async () => {
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await click('Next month');
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_aftermath' });
    await click('Next month');
    expect(qa('.month__title').map(text)).toEqual(['January 1486 SC', 'February 1486 SC']);
    const lines = qa('.line');
    expect(lines.map((l) => l.getAttribute('data-category'))).toEqual([
      'system',
      'system',
      'world',
      'system',
      'family',
    ]);
    expect(text(lines[2])).toBe(
      'World. A test notice is posted in January 1486 SC. Nothing depends on it.',
    );
  });

  it('does not hide the colour meaning from screen readers', () => {
    expect(text(q('.line .sr-only'))).toBe('System.');
  });

  it('hides facts nobody knows, and shows them (flagged) in omniscient mode', async () => {
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    await click('Next month');
    expect(text(q('.panel--feed'))).not.toContain('nobody knows about yet');
    await ui.app.setOmniscient(true);
    const hidden = q('.line[data-hidden="true"]');
    expect(text(hidden)).toContain('Something happens in January that nobody knows about yet.');
    expect(text(hidden)).toContain('Nobody in the world knows this');
    await ui.app.setOmniscient(false);
    expect(q('.line[data-hidden="true"]')).toBeNull();
  });

  it('shows the present arriving', async () => {
    await ui.app.advance({ kind: 'months', count: 468 }, 'test');
    expect(text(q('.epilogue__title'))).toBe('The present');
    expect(text(q('.epilogue'))).toContain('Thirty-nine years after God Valley');
    expect(text(q('.epilogue button'))).toBe('Sail on past the present');
    expect(q('.shell')?.getAttribute('data-phase')).toBe('present');
    expect(q('.dial')?.classList.contains('is-present')).toBe(true);
    expect(text(q('.masthead__title'))).toBe('January 1525 SC');
  });
});

describe('time controls', () => {
  const timeButtons = () =>
    ['Next month', 'Skip 3 months', 'Skip to next event'].map((l) => button(ui.root, l));

  it('are enabled at the start', () => {
    expect(timeButtons().map((b) => b.disabled)).toEqual([false, false, false]);
  });

  it('Next month advances one month and says so', async () => {
    await click('Next month');
    expect(status()).toBe('Advanced 1 month.');
    expect(ui.core.peekState().tick).toBe(1);
  });

  it('Skip 3 months advances three (the number comes from settings.json)', async () => {
    await click('Skip 3 months');
    expect(status()).toBe('Advanced 3 months.');
    expect(ui.core.peekState().tick).toBe(3);
  });

  it('Skip to next event stops at the event, and says so', async () => {
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await click('Skip to next event');
    expect(status()).toBe('Stopped at an event after 1 month.');
  });

  it('Skip to next event says where it ended when nothing happens', async () => {
    await click('Skip to next event');
    expect(status()).toBe('Reached the present (1525 SC) after 468 months.');
    expect(timeButtons().every((b) => b.disabled)).toBe(true);
    expect(timeButtons()[0]?.getAttribute('title')).toBe('The present has arrived');
  });

  describe('decisions', () => {
    beforeEach(async () => {
      await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
      await click('Skip 3 months');
    });

    it('stop a skip, and say why', () => {
      expect(status()).toBe('Stopped after 1 month: a decision is waiting.');
      expect(ui.core.peekState().tick).toBe(1);
    });

    it('show the choices, without repeating the sentence already in the chronicle', () => {
      expect(text(q('.decision__title'))).toBe('A test crossroads');
      expect(qa('.choice').map((c) => text(c.querySelector('.choice__label')))).toEqual([
        'Take the left path',
        'Take the right path',
      ]);
      expect(q('.decision__text')).toBeNull();
      expect(text(q('.panel--feed'))).toContain('Two paths open in January');
    });

    it('lock the time controls, explaining why', () => {
      for (const label of ['Next month', 'Skip 3 months', 'Skip to next event']) {
        const b = button(ui.root, label);
        expect(b.disabled).toBe(true);
        expect(b.title).toBe('Choose how to respond to the decision first');
      }
    });

    it('are answered by pressing a choice: the card goes, its consequences appear, focus moves on', async () => {
      await click(/^Take the left path/);
      expect(q('.decision')).toBeNull();
      expect(text(q('.panel--feed'))).toContain('The left path was quiet.');
      expect(status()).toBe('Decision made.');
      expect(button(ui.root, 'Next month').disabled).toBe(false);
      expect(document.activeElement).toBe(button(ui.root, 'Next month'));
      expect(ui.core.peekState().flags['dev.crossroads']).toBe('left');
    });
  });

  it('long runs show progress and can be cancelled', async () => {
    let now = 0;
    let sawProgress = false;
    let sawCancel = false;
    // Replace the core with one that yields often and cancels when the page shows progress.
    ui.unroute();
    ui.shell.destroy();
    const holder: { current?: Mounted } = {};
    ui = await mountUi({
      core: {
        batchTicks: 10,
        clock: () => (now += 20),
        yieldToHost: async () => {
          const wrap = holder.current?.root.querySelector(
            '.controls__progress',
          ) as HTMLElement | null;
          sawProgress ||= wrap !== null && !wrap.hidden;
          sawCancel ||= Boolean(
            holder.current?.root.querySelector('.controls__progress button:not([hidden])'),
          );
          holder.current?.app.cancel();
        },
      },
    });
    holder.current = ui;
    await click('Skip to next event');
    expect(sawProgress).toBe(true);
    expect(sawCancel).toBe(true);
    expect(status()).toMatch(/^Cancelled after \d+ months\.$/);
    expect(q('.controls__progress')?.hasAttribute('hidden')).toBe(true);
    expect(button(ui.root, 'Next month').disabled).toBe(false);
  });
});

describe('status and errors', () => {
  it('shows an error from the simulation in the status line, in the error style', async () => {
    const ok = await ui.app.dispatch({ type: 'nonsense' });
    expect(ok).toBe(false);
    expect(status()).toContain('Invalid action');
    expect(q('.controls__status')?.getAttribute('data-kind')).toBe('error');
  });

  it('keeps working after an error', async () => {
    await ui.app.dispatch({ type: 'nonsense' });
    await click('Next month');
    expect(status()).toBe('Advanced 1 month.');
    expect(q('.controls__status')?.getAttribute('data-kind')).toBe('info');
  });
});

describe('resuming', () => {
  it('picks up the latest autosave and says the state hash matches', async () => {
    await ui.app.advance({ kind: 'months', count: 30 }, 'test');
    const store = ui.store;
    ui.unroute();
    ui.shell.destroy();

    ui = await mountUi({ store, autoResume: true });
    expect(text(q('.masthead__title'))).toBe('July 1488 SC');
    expect(status()).toContain('Resumed your saved world (auto-1, July 1488 SC)');
    expect(status()).toContain('state hash matches the save');
  });

  it('shows a dismissible notice when the save cannot be read, and starts a new world', async () => {
    await ui.app.advance({ kind: 'months', count: 3 }, 'test');
    const store = ui.store as MemorySaveStore;
    const [slot] = await store.list();
    await store.put(slot!, new TextEncoder().encode('garbage'));
    ui.unroute();
    ui.shell.destroy();

    ui = await mountUi({ store, autoResume: true });
    expect(text(q('.banner'))).toContain('Could not resume auto-1');
    expect(text(q('.masthead__title'))).toBe('January 1486 SC');
    button(q('.banner') as Element, 'Dismiss').click();
    await settle();
    expect(q('.banner')).toBeNull();
  });
});
