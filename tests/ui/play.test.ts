// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { summarizeAdvance } from '../../src/ui/components/log-card';
import { navigate } from '../../src/ui/router';
import type { Snapshot } from '../../src/worker/protocol';
import { button, mountUi, settle, text, type Mounted } from '../helpers/ui';

let ui: Mounted;
beforeEach(async () => {
  ui = await mountUi();
});
afterEach(() => {
  ui.unroute();
  ui.shell.destroy();
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  window.location.hash = '';
});

const q = <T extends Element = HTMLElement>(selector: string) => ui.root.querySelector<T>(selector);
const qa = (selector: string) => [...ui.root.querySelectorAll<HTMLElement>(selector)];
const key = (k: string, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

async function startLife(over: Record<string, unknown> = {}): Promise<void> {
  await ui.app.startLife({
    seed: 'play-test',
    canonMode: 'canon',
    difficulty: 'normal',
    race: 'race_human',
    birthplace: 'bp_east_blue_village',
    legacy: 'legacy_fisher_family',
    entryYear: 10,
    entryAge: 14,
    pronouns: 'they',
    ...over,
  });
  await settle(10);
}

describe('the log card', () => {
  it('appears after time moves, says how long and what changed, and can be dismissed', async () => {
    await startLife();
    await ui.app.advance({ kind: 'months', count: 12 }, 'test');
    await settle(10);
    const card = q('.log-card');
    expect(card).not.toBeNull();
    expect(text(card?.querySelector('.log-card__title'))).toBe('12 months pass');
    expect(text(card)).toMatch(/You turned 15\./);
    (card?.querySelector('.log-card__close') as HTMLButtonElement).click();
    expect(q('.log-card')).toBeNull();
  });

  it('does not appear for things that are not time passing', async () => {
    await startLife();
    expect(q('.log-card')).toBeNull();
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await settle();
    expect(q('.log-card')).toBeNull();
  });

  it('summarises from two snapshots alone', async () => {
    await startLife();
    const before = ui.app.store.get().snapshot as Snapshot;
    const after: Snapshot = {
      ...before,
      tick: before.tick + 3,
      date: { ...before.date, monthName: 'Later' },
      player: before.player ? { ...before.player, berries: before.player.berries - 500 } : null,
      pending: [
        {
          id: 1,
          recordSeq: 0,
          title: 't',
          text: 't',
          dateLabel: 'd',
          choices: [{ id: 'a', label: 'A' }],
        },
      ],
    };
    const summary = summarizeAdvance(before, after);
    expect(summary?.title).toBe('3 months pass');
    expect(summary?.lines.map((l) => [l.text, l.tone])).toEqual([
      ['−500 Berries', 'bad'],
      ['A decision is waiting for you', 'alert'],
    ]);
    expect(summarizeAdvance(after, before)).toBeNull(); // time never runs backwards
  });
});

describe('the chronicle', () => {
  it('filters by kind of line, with counts, and back to everything', async () => {
    await startLife({ seed: 'play-test-0' }); // a life with family lines (younger siblings born)
    const chips = () => qa('.feed-filters .chip');
    const all = q('[data-filter="all"]');
    expect(all?.getAttribute('aria-pressed')).toBe('true');
    const family = chips().find((c) => c.dataset['filter'] === 'family');
    expect(family, 'this life has family lines (births of brothers and sisters)').toBeDefined();
    expect(text(family?.querySelector('.chip__count'))).toBe('2');
    const everything = qa('.panel--feed .line').length;
    family?.click();
    await settle();
    const lines = qa('.panel--feed .line');
    expect(lines).toHaveLength(2);
    expect(lines.length).toBeLessThan(everything);
    expect(lines.every((l) => l.dataset['category'] === 'family')).toBe(true);
    expect(q('[data-filter="family"]')?.getAttribute('aria-pressed')).toBe('true');
    (q('[data-filter="family"]') as HTMLButtonElement).click();
    await settle();
    expect(q('[data-filter="all"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('inks in only the lines that arrived since it was last drawn', async () => {
    await startLife({ legacy: 'legacy_marine_veteran', entryAge: 15 });
    expect(qa('.line--new')).toHaveLength(0); // a new life just appears
    await ui.app.dispatch({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await ui.app.advance({ kind: 'months', count: 1 }, 'test');
    await settle();
    const fresh = qa('.line--new');
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((l) => text(l).includes('test notice'))).toBe(true);
  });

  it('has a year rail that is a real scrollbar for the chronicle', () => {
    const rail = q('.year-rail');
    expect(rail?.getAttribute('role')).toBe('scrollbar');
    expect(rail?.getAttribute('aria-controls')).toBe('panel-feed');
    expect(rail?.getAttribute('tabindex')).toBe('0');
  });
});

describe('keyboard shortcuts', () => {
  it('moves time, opens sections and the map, and lists itself', async () => {
    const start = ui.app.store.get().snapshot?.tick ?? 0;
    key('n');
    await settle(10);
    expect(ui.app.store.get().snapshot?.tick).toBe(start + 1);
    key('2');
    await settle();
    expect(window.location.hash).toBe('#/character');
    key('6');
    await settle();
    expect(window.location.hash).toBe('#/map');
    expect(q('.map-page-slot')?.hidden).toBe(false);
    expect(q('.tab--map')?.getAttribute('aria-current')).toBe('page');
    key('?');
    expect(document.querySelector('.modal__title')?.textContent).toBe('Keyboard shortcuts');
    expect(document.querySelectorAll('.keys__row').length).toBeGreaterThanOrEqual(7);
  });

  it('stays out of the way while typing, or with a dialog open', async () => {
    navigate('feed');
    await settle();
    const before = ui.app.store.get().snapshot?.tick;
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    key('n', input);
    await settle(10);
    expect(ui.app.store.get().snapshot?.tick).toBe(before);
    input.remove();
    button(ui.root, 'Keys').click();
    key('n');
    await settle(10);
    expect(ui.app.store.get().snapshot?.tick).toBe(before);
  });
});

describe('the Map page', () => {
  it('shows the world with home marked once a life has started', async () => {
    await startLife();
    navigate('map');
    await settle(10);
    expect(q('.map-page-slot')?.hidden).toBe(false);
    expect(q('.map-page svg.atlas')).not.toBeNull();
    await settle(10);
    const home = q('.atlas-pin[data-kind="home"]');
    expect(home?.getAttribute('aria-label')).toMatch(/home: A village on the East Blue/);
    expect(q('.map-page button[hidden]')).toBeNull(); // "Go home" is offered
    navigate('feed');
    await settle();
    expect(q('.map-page-slot')?.hidden).toBe(true);
  });
});
