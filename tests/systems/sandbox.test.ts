import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core';
import { statValue } from '../../src/engine/stats';
import { humanAgeOf, reputation, slotsOf, vigorPoolOf } from '../../src/systems/life/body';
import { meetPerson, relate } from '../../src/systems/life/people';
import { overtimeSlots, commitMax } from '../../src/systems/life/drive';
import { lifeView } from '../../src/systems/life/view';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { personSheet } from '../../src/systems/heart/sheet';
import { playerCrew } from '../../src/systems/crew/state';
import { sandboxCatalog } from '../../src/systems/sandbox';
import { data } from '../helpers/data';
import { startLife } from '../helpers/life';

/**
 * The debug sandbox (everything by type, numbers to set), anyone's character sheet (estimates for
 * strangers, the truth for the close), and a month whose budget is the Vigor pool.
 */

function adult(seed: string) {
  const t = startLife({ seed, entryYear: 20, entryAge: 22 });
  ensureWorldLayer(t.state, data);
  return t;
}

describe('the debug sandbox', () => {
  it('lists everything by type, and sets numbers, traits and crewmates', () => {
    const t = adult('sandbox');
    const c = sandboxCatalog(t.state, data);
    expect(c.weapons.length).toBeGreaterThan(3);
    expect(c.items.some((g) => g.group === 'Dial')).toBe(true);
    expect(c.fruits.flatMap((g) => g.entries).length).toBeGreaterThan(50);
    expect(c.traits.length).toBeGreaterThan(3);
    expect(c.tracks.length).toBeGreaterThan(3);
    const id = t.player().id;
    t.act({ type: 'debug/setStat', entityId: id, stat: 'strength', value: 123 });
    expect(Math.round(statValue(t.player().stats['strength']!, t.state.tick))).toBe(123);
    t.act({ type: 'debug/money', field: 'berries', value: 77777 });
    t.act({ type: 'debug/money', field: 'fame', value: 40 });
    t.act({ type: 'debug/money', field: 'bounty', value: 3000000 });
    expect(t.player().character?.berries).toBe(77777);
    expect(Math.round(statValue(reputation(t.player(), 'fame'), t.state.tick))).toBe(40);
    expect(t.player().flags['bounty']).toBe(3000000);
    t.act({ type: 'debug/trait', trait: 'trait_lucky', remove: false });
    expect(t.player().character?.traits).toContain('trait_lucky');
    t.act({ type: 'debug/trait', trait: 'trait_lucky', remove: true });
    expect(t.player().character?.traits).not.toContain('trait_lucky');
    t.act({ type: 'debug/addCrewmate', strength: 2 });
    expect(playerCrew(t.state)?.crew?.members.length).toBe(1);
    // Debug actions are refused outside a debug build.
    expect(() =>
      applyAction(
        t.state,
        data,
        { type: 'debug/money', field: 'berries', value: 1 },
        { debug: false },
      ),
    ).toThrow(/disabled/);
  });
});

describe("anyone's character sheet", () => {
  it('shows a stranger in rounded guesses, someone close as they are, and never changes the world', () => {
    const t = adult('person-sheet');
    const env = t.env('meet');
    const stranger = meetPerson(
      t.state,
      data,
      env.p,
      env.rng.fork('a'),
      t.state.tick,
      humanAgeOf(data, env.p, t.state.tick),
      { ageOffset: { min: 0, max: 2 } },
    );
    relate(env.p.entity, stranger, 'friend', 10, t.state.tick, env.rng.fork('r'));
    const before = JSON.stringify(t.state);
    const guess = personSheet(t.state, data, stranger.id, false);
    expect(JSON.stringify(t.state)).toBe(before);
    expect(guess?.estimated).toBe(true);
    expect(guess?.sheet.appearance.sentence.length).toBeGreaterThan(20);
    for (const s of guess?.sheet.stats ?? []) expect(s.total % 10).toBe(0);
    // A sibling is family: the truth.
    const sibling = meetPerson(
      t.state,
      data,
      env.p,
      env.rng.fork('b'),
      t.state.tick,
      humanAgeOf(data, env.p, t.state.tick),
      { ageOffset: { min: 0, max: 2 } },
    );
    relate(env.p.entity, sibling, 'sibling', 50, t.state.tick, env.rng.fork('s'));
    const truth = personSheet(t.state, data, sibling.id, false);
    expect(truth?.estimated).toBe(false);
    expect(truth?.sheet.talentHint).toBe('');
  });
});

describe('a month scaled by Vigor', () => {
  it('a 50-Vigor pool holds a month of 50', () => {
    const t = adult('vigor-50');
    t.act({ type: 'debug/setStat', entityId: t.player().id, stat: 'endurance', value: 1000 });
    const pool = vigorPoolOf(data, t.player(), t.state.tick);
    expect(pool).toBeGreaterThanOrEqual(50);
    const slots = slotsOf(data, t.person(), t.state.tick);
    const total = slots + overtimeSlots(data, pool, slots);
    expect(total).toBeGreaterThanOrEqual(12);
    expect(commitMax(data, pool)).toBeGreaterThanOrEqual(10);
    // A routine of Hard training in every slot, pushed, is accepted and plans past 50 Vigor.
    t.act({
      type: 'life/routine',
      routine: Array.from({ length: total }, () => ({
        activity: 'act_run_laps',
        effort: 'hard' as const,
        commit: 1,
      })),
    });
    expect(lifeView(t.state, data)?.vigor.planned).toBeGreaterThanOrEqual(50);
  });
});
