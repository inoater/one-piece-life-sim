// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, until, type Mounted } from '../helpers/ui';

/**
 * Phase 6 in the page: the Gear page (what is carried, the market, trade goods, the workshop), the
 * Ship page with the ship creator's live numbers, and the planner's overtime slots and pushing
 * past Hard.
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

async function startLife(): Promise<void> {
  await ui.app.startLife({
    seed: 'ui-hands',
    canonMode: 'canon',
    difficulty: 'normal',
    race: 'race_human',
    birthplace: 'bp_east_blue_village',
    legacy: 'legacy_fisher_family',
    focus: 'focus_fighter',
    entryYear: 20,
    entryAge: 20,
    pronouns: 'they',
  });
  ui.core.peekState().flags['dev.quiet'] = true;
  await ui.app.advance({ kind: 'months', count: 1 }, 'test');
  await settle(10);
}

describe('the Gear page', () => {
  it('buys a weapon in the market, shows it in hand, and takes trade goods into the pack', async () => {
    await startLife();
    const state = ui.core.peekState();
    state.entities[state.playerId!]!.character!.berries = 1_000_000;
    await ui.app.dispatch({ type: 'debug/teleport', location: 'loc_loguetown' });
    navigate('gear');
    await settle(10);
    expect(text(q('#gear-title'))).toBe('Gear');
    const cutlass = q('[data-stock="weapon_sword"]');
    expect(cutlass).not.toBeNull();
    button(cutlass as HTMLElement, /^Buy/).click();
    await until(() => (ui.app.store.get().snapshot?.hands?.carried.length ?? 0) > 0);
    await settle(10);
    expect(text(q('.gear-item .power-learn__name'))).toBe('Cutlass');
    expect(text(q('.powers-page__lead'))).toContain('In hand: Cutlass');
    const fish = q('[data-good="fish"]') as HTMLElement;
    button(fish, 'Buy 1').click();
    await until(() => (ui.app.store.get().snapshot?.hands?.goods.used ?? 0) === 1);
    expect(ui.app.store.get().snapshot?.hands?.goods.list.find((g) => g.id === 'fish')?.have).toBe(
      1,
    );
  });

  it('starts a project in the workshop', async () => {
    await startLife();
    const state = ui.core.peekState();
    state.entities[state.playerId!]!.character!.berries = 1_000_000;
    await ui.app.dispatch({ type: 'debug/teleport', location: 'loc_loguetown' });
    navigate('gear');
    await settle(10);
    const recipe = q('[data-recipe="recipe_dagger"]') as HTMLElement;
    button(recipe, 'Start').click();
    await until(() => ui.app.store.get().snapshot?.hands?.project !== null);
    await settle(10);
    expect(text(q('.gear-project'))).toContain('Forge a dagger');
  });
});

describe('the Ship page', () => {
  it('shows the creator with live numbers from the simulation', async () => {
    await startLife();
    navigate('ship');
    await settle(10);
    expect(text(q('#ship-title'))).toBe('Ship');
    await until(() => text(q('.ship-preview')).includes('Speed'));
    expect(text(q('.ship-preview'))).toMatch(/Cost [\d,]+ Berries/);
    const hull = q<HTMLSelectElement>('.ship-form select');
    hull!.value = 'galleon';
    hull!.dispatchEvent(new Event('change'));
    await until(() => text(q('.ship-preview')).includes('200 miles a month'));
  });
});

describe('the planner, scaled by Vigor', () => {
  it('offers pushing a Hard slot past Hard, and the month costs more Vigor', async () => {
    await startLife();
    navigate('actions');
    await settle(10);
    await ui.app.dispatch({
      type: 'life/routine',
      routine: [{ activity: 'act_run_laps', effort: 'hard' }],
    });
    await settle(10);
    const push = q('.push') as HTMLElement;
    expect(push).not.toBeNull();
    (push.querySelector('button[aria-label="More"]') as HTMLButtonElement).click();
    await until(() => ui.app.store.get().snapshot?.life?.routine[0]?.commit === 1);
    await settle(10);
    expect(text(q('.push__value'))).toBe('+1');
    expect(text(q('.planner__vigor'))).toContain('Vigor 4 of');
    // Planned within the stage's own slots: no overtime slot shows until they are full.
    expect(qa('.routine__slot--overtime').length).toBe(0);
  });
});
