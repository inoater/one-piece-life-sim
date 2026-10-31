// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../../src/ui/router';
import { button, mountUi, settle, text, until, type Mounted } from '../helpers/ui';

/**
 * Phase 8 in the page: the crew creator, then the crew's tabs (the roster, the positions screen
 * with its empty posts' costs, recruits), and a recruit's profile with its pitches.
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
    seed: 'ui-crew',
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

describe('the Crew page', () => {
  it('founds a crew in the creator, then shows its posts and what an empty one costs', async () => {
    await startLife();
    navigate('crew');
    await until(() => q('#crew-title') !== null);
    await settle(10);
    expect(text(q('.crew-page'))).toMatch(/Found a crew/);
    const name = q<HTMLInputElement>('.crew-page input[aria-label="Name"]') as HTMLInputElement;
    name.value = 'The Gull Pirates';
    button(q('.crew-page') as HTMLElement, 'Found it').click();
    await until(() => text(q('#crew-title')) === 'The Gull Pirates');
    await settle(10);
    expect(ui.app.store.get().snapshot?.crew?.name).toBe('The Gull Pirates');
    button(q('.crew-tabs') as HTMLElement, 'Positions').click();
    await until(() => q('.crew-ship') !== null);
    expect(qa('.crew-station').length).toBeGreaterThan(3);
    // Nobody aboard but the captain: some posts stand empty, and say what that costs.
    expect(qa('.crew-posts tr.is-empty').length).toBeGreaterThan(0);
    expect(text(q('.crew-posts'))).toMatch(/Nobody/);
    button(q('.crew-tabs') as HTMLElement, 'Roster').click();
    await until(() => text(q('.crew-page')).includes('The roster'));
  });

  it('a recruit profile shows what is known and the pitches with their odds in words', async () => {
    await startLife();
    const contact = ui.app.store.get().snapshot!.heart!.contacts.find((c) => c.here)!;
    window.location.hash = `#/recruit/${contact.id}`;
    await until(() => q('#recruit-title') !== null);
    await settle(10);
    expect(text(q('#recruit-title'))).toBe(contact.name);
    expect(text(q('.recruit-page'))).toMatch(/Role fit/);
    expect(qa('.crew-pitches li').length).toBe(8);
    expect(text(q('.crew-pitches'))).toMatch(/odds|likely|certain|long shot/);
  });
});
