// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, until, type Mounted } from '../helpers/ui';

/**
 * Phase 7 in the page: Morale in the masthead, the People page (the player's heart, contacts, the
 * web) and a person page whose talk changes how they feel, with the change traced in its tooltip.
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
    seed: 'ui-heart',
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

describe('the People pages', () => {
  it('shows morale, the player, their contacts and the web', async () => {
    await startLife();
    expect(text(q('.masthead'))).toMatch(/Morale\s*\d+/);
    navigate('people');
    await until(() => q('#people-title') !== null);
    await settle(10);
    expect(text(q('#people-title'))).toBe('People');
    expect(text(q('.heart-self'))).toMatch(/Conscience/);
    expect(qa('.contact').length).toBeGreaterThan(0);
    expect(q('.web svg')).not.toBeNull();
  });

  it('a talk on a person page moves them, and the tooltip names the talk', async () => {
    await startLife();
    const id = ui.app.store.get().snapshot!.heart!.contacts.find((c) => c.here)!.id;
    window.location.hash = `#/person/${id}`;
    await until(() => q('#person-title') !== null);
    await settle(10);
    const chat = qa('.heart-intent').find((li) => text(li).startsWith('Chat')) as HTMLElement;
    expect(chat).toBeDefined();
    button(chat, 'Chat').click();
    await until(() => qa('.heart-intent').some((li) => text(li).includes('Already this month')));
    await settle(10);
    const affection = q('.heart-meter') as HTMLElement;
    affection.dispatchEvent(new Event('mouseenter'));
    const tip = document.querySelector('.tooltip');
    expect(tip?.textContent).toMatch(/Chat/);
    affection.dispatchEvent(new Event('mouseleave'));
  });
});
