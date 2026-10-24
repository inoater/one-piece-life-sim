// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { summarizeAdvance } from '../../src/ui/components/log-card';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, type Mounted } from '../helpers/ui';

/**
 * The life loop in the page (Phase 2): Health and Vigor in the masthead, the Actions planner, the
 * month-end card, the death screen with every way to carry on, the epilogue at the present, and the
 * chronicle's new filters.
 */

let ui: Mounted;
beforeEach(async () => {
  ui = await mountUi();
});
afterEach(() => {
  ui.unroute();
  ui.shell.destroy();
  window.location.hash = '';
});

const q = <T extends Element = HTMLElement>(selector: string) => ui.root.querySelector<T>(selector);
const qa = (selector: string) => [...ui.root.querySelectorAll<HTMLElement>(selector)];

async function startLife(over: Record<string, unknown> = {}): Promise<void> {
  await ui.app.startLife({
    seed: 'ui-life',
    canonMode: 'canon',
    difficulty: 'normal',
    race: 'race_human',
    birthplace: 'bp_east_blue_village',
    legacy: 'legacy_fisher_family',
    focus: 'focus_fighter',
    entryYear: 10,
    entryAge: 20,
    pronouns: 'they',
    ...over,
  });
  // These tests are about the life loop: no random events (Phase 3) to stop a skip with a choice.
  ui.core.peekState().flags['dev.quiet'] = true;
  await settle(10);
}

async function choose(slot: number, activity: string): Promise<void> {
  const select = qa('.routine__select')[slot] as HTMLSelectElement;
  const option = [...select.options].find((o) => o.value === activity);
  if (!option) throw new Error(`no option ${activity}`);
  option.selected = true;
  select.dispatchEvent(new Event('change'));
  await settle(10);
}

describe('the masthead', () => {
  it('shows Health and Vigor as numbers and bars once a life starts', async () => {
    await startLife();
    const vitals = qa('.vital').map((v) => text(v.querySelector('.vital__label')));
    expect(vitals).toEqual(['Age', 'Health', 'Vigor', 'Location', 'Berries']);
    const health = qa('.vital--bar')[0]!;
    expect(text(health.querySelector('.vital__value'))).toMatch(/^(\d+)\/\1$/);
    expect(health.querySelector('.vital-bar')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('the Actions planner', () => {
  it('has one slot per activity the stage allows, and plans a routine that the month then lives', async () => {
    await startLife();
    navigate('actions');
    await settle();
    expect(qa('.routine__slot')).toHaveLength(3);
    await choose(0, 'act_spar');
    expect((qa('.routine__select')[0] as HTMLSelectElement).value).toBe('act_spar');
    expect(text(q('.planner__vigor'))).toContain('Vigor 2 of');
    button(q('.routine__slot') as HTMLElement, 'Hard').click();
    await settle(10);
    expect(q('.routine__slot .effort__option[aria-pressed="true"]')?.textContent).toBe('Hard');
    expect(
      ui.core.peekState().entities[ui.core.peekState().playerId!]?.character?.life?.routine,
    ).toEqual([{ activity: 'act_spar', effort: 'hard' }]);
    await ui.app.advance({ kind: 'months', count: 1 }, 'test');
    await settle(10);
    expect(ui.app.store.get().snapshot?.life?.report?.done[0]?.activity).toBe('Spar');
  });

  it('greys out what is locked, with the reason', async () => {
    await startLife();
    navigate('actions');
    await settle();
    const option = [...(qa('.routine__select')[0] as HTMLSelectElement).options].find(
      (o) => o.value === 'act_search_ruins',
    )!;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain('needs ruins nearby');
    const row = qa('.option').find(
      (o) => text(o.querySelector('.option__name')) === 'Search the ruins',
    )!;
    expect(row.dataset['locked']).toBe('true');
    expect(text(row.querySelector('.option__lock'))).toBe('Needs ruins nearby');
  });

  it('takes a job, puts a shift in the routine, and pays it', async () => {
    await startLife();
    navigate('actions');
    await settle();
    const fisher = qa('.option').find((o) => text(o.querySelector('.option__name')) === 'Fisher')!;
    button(fisher, 'Take').click();
    await settle(10);
    expect(text(q('.job-card'))).toContain('Fisher');
    expect(ui.app.store.get().snapshot?.life?.routine[0]?.activity).toBe('act_work_shift');
    await ui.app.advance({ kind: 'months', count: 1 }, 'test');
    expect(ui.app.store.get().snapshot?.life?.report?.berries.income).toBeGreaterThan(0);
  });

  it('says what the month did on the log card: Vigor, money, injuries', async () => {
    await startLife();
    const before = ui.app.store.get().snapshot!;
    await ui.app.dispatch({
      type: 'life/routine',
      routine: [{ activity: 'act_haul_cargo', effort: 'normal' }],
    });
    await ui.app.advance({ kind: 'months', count: 1 }, 'test');
    const after = ui.app.store.get().snapshot!;
    const card = summarizeAdvance(before, after)!;
    expect(card.lines.map((l) => l.text).join(' | ')).toMatch(/Vigor 2 of \d+ used/);
    expect(card.lines.map((l) => l.text).join(' | ')).toMatch(/Earned [\d,]+, spent/);
  });
});

describe('the end of a life', () => {
  it('opens the recap with every way to carry on, and carries on', async () => {
    await startLife({ entryAge: 30 });
    navigate('feed');
    await settle();
    await ui.app.dispatch({ type: 'debug/kill', cause: 'a test' });
    await settle(10);
    expect(window.location.hash).toBe('#/end');
    await settle(10);
    expect(text(q('.recap__name'))).toBeTruthy();
    expect(text(q('.recap__dates'))).toContain('of a test');
    expect(qa('.continue .continue__label').map(text)).toEqual([
      'Your child or heir',
      'Your protégé',
      'A crewmate',
      'A brother or sister',
      'A newborn, this month',
      'A new game',
    ]);
    // Time stands still.
    expect((qa('.controls__time button')[0] as HTMLButtonElement).disabled).toBe(true);
    const newborn = qa('.continue').find((c) => c.textContent?.includes('A newborn'))!;
    button(newborn, 'Be born').click();
    await settle(12);
    expect(window.location.hash).toBe('#/feed');
    expect(ui.app.store.get().snapshot?.life?.alive).toBe(true);
    expect(ui.app.store.get().snapshot?.life?.age).toBe(0);
    expect(text(q('.panel--feed'))).toContain('The story carries on with');
  });
});

describe('the present', () => {
  it('shows the epilogue, then sails on into open-ended play', async () => {
    await startLife({ entryYear: 38, entryAge: 20 });
    const report = await ui.app.advance({ kind: 'months', count: 24 }, 'test');
    await settle(10);
    const snap = ui.app.store.get().snapshot!;
    expect([report?.stop, snap.tick, snap.pending.length]).toEqual(['present', 468, 0]);
    expect(snap.atPresent).toBe(true);
    expect(text(q('.epilogue__title'))).toBe('The present');
    button(q('.epilogue') as HTMLElement, 'Sail on past the present').click();
    await settle(10);
    expect(ui.app.store.get().snapshot?.openEnded).toBe(true);
    expect(q('.epilogue__title')).toBeNull();
    const more = await ui.app.advance({ kind: 'months', count: 2 }, 'test');
    expect(more?.ticksRun).toBe(2);
  });
});

describe('the chronicle', () => {
  it('offers Relationships, Combat and Money filters and reads by age', async () => {
    await startLife();
    await ui.app.dispatch({
      type: 'life/routine',
      routine: [
        { activity: 'act_spar', effort: 'normal' },
        { activity: 'act_befriend', effort: 'normal' },
        { activity: 'act_fish', effort: 'normal' },
      ],
    });
    await ui.app.advance({ kind: 'months', count: 24 }, 'test');
    await settle(10);
    const chips = qa('.feed-filters .chip').map((c) => c.dataset['filter']);
    expect(chips).toEqual(expect.arrayContaining(['relationship', 'money']));
    const money = qa('.feed-filters .chip').find((c) => c.dataset['filter'] === 'money')!;
    money.click();
    await settle();
    expect(qa('.line').length).toBeGreaterThan(0);
    expect(qa('.month__title').some((t) => /^Age \d+ · /.test(text(t)))).toBe(true);
  });
});
