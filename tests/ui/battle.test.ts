// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, until, type Mounted } from '../helpers/ui';

/**
 * The battle panel (Phase 5): a tactical fight shows in the chronicle with both sides, bars, the
 * actions with their chances in words, and the log; an action plays one exchange; "Let it play
 * out" ends it; the Powers page has the fighting settings.
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
    seed: 'ui-battle',
    canonMode: 'canon',
    difficulty: 'normal',
    race: 'race_human',
    birthplace: 'bp_east_blue_village',
    legacy: 'legacy_fisher_family',
    focus: 'focus_fighter',
    entryYear: 30,
    entryAge: 22,
    pronouns: 'they',
  });
  ui.core.peekState().flags['dev.quiet'] = true;
  await settle(10);
}

async function fight(): Promise<void> {
  await ui.app.dispatch({
    type: 'debug/fight',
    foe: 'foe_thug',
    count: 2,
    scale: 'skirmish',
    intent: 'capture',
    mode: 'tactical',
  });
  await until(
    () => ui.app.store.get().snapshot?.battle != null && ui.app.store.get().busy === null,
  );
  navigate('feed');
  await settle(10);
}

describe('the battle panel', () => {
  it('shows both sides, the actions with chances in words, and the log', async () => {
    await startLife();
    await fight();
    expect(q('.battle')).not.toBeNull();
    expect(qa('.battle-side')).toHaveLength(2);
    expect(qa('.battle-fighter').length).toBeGreaterThanOrEqual(3);
    expect(qa('.battle-bar').length).toBeGreaterThanOrEqual(6);
    const labels = qa('.battle-action__label').map(text);
    expect(labels).toEqual(
      expect.arrayContaining(['Strike', 'Guard', 'Evade', 'Feint', 'Grapple', 'Flee']),
    );
    const strike = qa('.battle-action__button').find(
      (b) => text(b.querySelector('.battle-action__label')) === 'Strike',
    )!;
    expect(strike.getAttribute('title')).toMatch(/\d+% to land/);
    expect(text(strike.querySelector('.battle-action__words'))).toMatch(
      /almost sure|likely|even|unlikely|a long shot/,
    );
    expect(text(q('.battle-log'))).toContain('against');
  });

  it('an action plays one exchange; letting it play out ends the fight', async () => {
    await startLife();
    await fight();
    const before = ui.app.store.get().snapshot!.battle!.exchange;
    const strike = qa('.battle-action__button').find(
      (b) => text(b.querySelector('.battle-action__label')) === 'Strike',
    )!;
    expect((strike as HTMLButtonElement).disabled).toBe(false);
    strike.click();
    await until(
      () =>
        (ui.app.store.get().snapshot?.battle?.exchange ?? 99) > before ||
        ui.app.store.get().snapshot?.battle == null,
    );
    const after = ui.app.store.get().snapshot?.battle;
    if (after && !after.result) {
      expect(after.exchange).toBe(before + 1);
      button(q('.battle') as HTMLElement, 'Let it play out').click();
      await until(
        () =>
          ui.app.store.get().snapshot?.battle?.result != null ||
          ui.app.store.get().snapshot?.battle == null,
      );
    }
    // Won: the fate of the beaten is the last choice; otherwise it is already over.
    const snap = ui.app.store.get().snapshot!;
    if (snap.battle) {
      expect(snap.battle.result).not.toBeNull();
      expect(q('.battle-card')).not.toBeNull();
      const first = q('.battle .decision__choices .choice') as HTMLButtonElement;
      first.click();
      await until(() => ui.app.store.get().snapshot?.battle == null);
    }
    expect(ui.app.store.get().snapshot?.battle).toBeNull();
    expect(ui.app.store.get().snapshot?.pending.some((d) => d.battle)).toBe(false);
  });

  it('the Powers page has the ladder, the record, tactical or quick, the stance and fight kit', async () => {
    await startLife();
    navigate('powers');
    await settle(10);
    expect(q('.fight-ladder')).not.toBeNull();
    expect(qa('.fight-ladder__rung--here')).toHaveLength(1);
    expect(text(q('.fight-settings'))).toMatch(/Fights won 0, lost 0/);
    button(q('.fight-settings') as HTMLElement, 'Quick, by your stance').click();
    await until(() => ui.app.store.get().snapshot?.fight?.mode === 'quick');
    expect(ui.app.store.get().snapshot?.fight?.mode).toBe('quick');
    expect(text(q('.fight-settings'))).toContain('Field medicine');
  });
});
