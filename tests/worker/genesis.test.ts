import { describe, expect, it } from 'vitest';
import { hashValue } from '../../src/engine/canonical';
import { MemorySaveStore } from '../../src/engine/saves/store';
import type { ViewOptions } from '../../src/worker/protocol';
import { SimCore, type SimCoreDeps } from '../../src/worker/sim-core';
import { data, dataHash } from '../helpers/data';

const VIEW: ViewOptions = { omniscient: false, hash: false };

function makeCore(overrides: Partial<SimCoreDeps> = {}) {
  let seeds = 0;
  const store = new MemorySaveStore();
  const core = new SimCore({
    data,
    dataHash,
    store,
    debug: true,
    newSeed: () => `seed-${++seeds}`,
    yieldToHost: async () => {},
    ...overrides,
  });
  return { core, store };
}

const options = (over: Record<string, unknown> = {}) => ({
  seed: 'worker-life',
  canonMode: 'canon',
  difficulty: 'normal',
  entryYear: 14,
  entryAge: 16,
  pronouns: 'they',
  ...over,
});

describe('New Life through the simulation host', () => {
  it('lists what can be chosen', async () => {
    const { core } = makeCore();
    const setup = await core.handle('genesis/setup', {});
    expect(setup.races.map((r) => r.id)).toEqual(Object.keys(data.races).sort());
    expect(setup.races.find((r) => r.id === 'race_giant')?.birthplaces).toContain(
      'bp_elbaf_highlands',
    );
    expect(setup.races.find((r) => r.id === 'race_giant')?.birthplaces).not.toContain(
      'bp_sky_island',
    );
    expect(setup.entry).toMatchObject({ minYear: 0, maxYear: 38, minAge: 0, maxAge: 80 });
    expect(setup.defaults.seed).toBe('seed-1');
    expect(setup.presentYear).toBe(39);
  });

  it('previews a character, filling in a blank seed so the start makes the same one', async () => {
    const { core } = makeCore();
    const preview = await core.handle('genesis/preview', {
      options: options({ seed: '  ' }),
      view: VIEW,
    });
    expect(preview.options.seed).toBe('seed-1');
    expect(preview.sheet?.name).toBeTruthy();
    expect(preview.canStart).toBe(true);
    expect(preview.appearance).toHaveLength(data.appearance.fields.length);
    expect(preview.ms).toBeGreaterThanOrEqual(0);

    const { snapshot } = await core.handle('genesis/start', {
      options: preview.options,
      view: VIEW,
    });
    expect(snapshot.player?.name).toBe(preview.sheet?.name);
    expect(snapshot.sheet?.backstory).toBe(preview.sheet?.backstory);
    expect(snapshot.tick).toBe(preview.entry?.tick);
  });

  it('a preview never changes the world being played', async () => {
    const { core } = makeCore();
    await core.handle('boot', { autoResume: false, view: VIEW });
    const before = hashValue(core.peekState());
    await core.handle('genesis/preview', { options: options(), view: VIEW });
    expect(hashValue(core.peekState())).toBe(before);
  });

  it('explains choices that cannot make a character instead of failing', async () => {
    const { core } = makeCore();
    const preview = await core.handle('genesis/preview', {
      options: options({ race: 'race_giant', birthplace: 'bp_sky_island' }),
      view: VIEW,
    });
    expect(preview.sheet).toBeNull();
    expect(preview.canStart).toBe(false);
    expect(preview.error).toMatch(/cannot be born/);
    await expect(
      core.handle('genesis/start', {
        options: options({ race: 'race_giant', birthplace: 'bp_sky_island' }),
        view: VIEW,
      }),
    ).rejects.toThrow(/cannot be born/);
    await expect(
      core.handle('genesis/preview', { options: { seed: 1 }, view: VIEW }),
    ).rejects.toThrow(/Invalid New Life options/);
  });

  it('starting a life saves it at once, and loading it gives the same world', async () => {
    const { core } = makeCore();
    await core.handle('genesis/start', { options: options({ entryAge: 30 }), view: VIEW });
    const started = hashValue(core.peekState());
    const { slots } = await core.handle('saves/list', {});
    expect(slots.map((s) => s.slot)).toEqual(['auto-1']);
    await core.handle('newWorld', { seed: 'something else', view: VIEW });
    await core.handle('saves/load', { slot: 'auto-1', view: VIEW });
    expect(hashValue(core.peekState())).toBe(started);
  });

  it('shows hidden facts only to an omniscient viewer', async () => {
    const { core } = makeCore();
    await core.handle('genesis/start', { options: options(), view: VIEW });
    const plain = (await core.handle('snapshot', { view: VIEW })).snapshot;
    const all = (await core.handle('snapshot', { view: { omniscient: true, hash: false } }))
      .snapshot;
    expect(plain.sheet?.hidden).toBeNull();
    expect(all.sheet?.hidden?.talent.id).toBeTruthy();
    expect(plain.player).toMatchObject({ age: 16, location: expect.any(String) });
  });

  it('builds the debug histogram, and only in debug builds', async () => {
    const { core } = makeCore();
    const stats = await core.handle('debug/genesisStats', { raceId: 'race_fishman', rolls: 500 });
    expect(stats.rolls).toBe(500);
    expect(stats.stats.find((s) => s.stat === 'strength')?.raceCap).toBe(130);
    const { core: production } = makeCore({ debug: false });
    await expect(production.handle('debug/genesisStats', { raceId: 'race_human' })).rejects.toThrow(
      /disabled/,
    );
  });
});
