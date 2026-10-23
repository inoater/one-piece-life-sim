import { describe, expect, it } from 'vitest';
import { hashValue } from '../../src/engine/canonical';
import { EventSchema, type GameData } from '../../src/engine/data/schemas';
import { SaveError } from '../../src/engine/saves/codec';
import { MemorySaveStore, type SaveStore } from '../../src/engine/saves/store';
import { ActionError } from '../../src/systems/actions';
import type { ViewOptions } from '../../src/worker/protocol';
import { SimCore, type SimCoreDeps } from '../../src/worker/sim-core';
import { data, dataHash } from '../helpers/data';

const VIEW: ViewOptions = { omniscient: false, hash: false };
const HASHED: ViewOptions = { omniscient: false, hash: true };

function makeCore(overrides: Partial<SimCoreDeps> = {}, store: SaveStore = new MemorySaveStore()) {
  let wall = 1_700_000_000_000;
  const core = new SimCore({
    data,
    dataHash,
    store,
    debug: true,
    newSeed: () => 'fixed-seed',
    now: () => (wall += 1000),
    yieldToHost: async () => {},
    ...overrides,
  });
  return { core, store };
}

/** A booted core with a fresh world. */
async function started(
  overrides: Partial<SimCoreDeps> = {},
  store?: SaveStore,
  world: { seed?: string; probe?: boolean; fixtures?: boolean } = {},
) {
  const made = makeCore(overrides, store);
  await made.core.handle('boot', { autoResume: false, view: VIEW });
  await made.core.handle('newWorld', { seed: 'test-world', ...world, view: VIEW });
  return made;
}

const months = (count: number) => ({ plan: { kind: 'months', count } as const, view: VIEW });
const act = (core: SimCore, action: unknown) => core.handle('dispatch', { action, view: VIEW });
const snap = async (core: SimCore, view = VIEW) =>
  (await core.handle('snapshot', { view })).snapshot;
const stateHash = (core: SimCore) => hashValue(core.peekState());

describe('boot', () => {
  it('starts a fresh world from a generated seed when nothing is saved', async () => {
    const { core } = makeCore();
    const { snapshot, resumed, notice } = await core.handle('boot', {
      autoResume: true,
      view: VIEW,
    });
    expect(resumed).toBeNull();
    expect(notice).toBeNull();
    expect(snapshot).toMatchObject({
      seed: 'fixed-seed',
      tick: 0,
      atPresent: false,
      info: { debug: true, persistentSaves: false },
    });
    expect(snapshot.feed.map((f) => f.summary)).toEqual([
      'A new world begins (seed "fixed-seed").',
    ]);
  });

  it('ignores saved games when asked not to resume', async () => {
    const { core, store } = makeCore();
    await core.handle('boot', { autoResume: false, view: VIEW });
    await core.handle('advance', months(5));
    const second = makeCore({}, store).core;
    expect((await second.handle('boot', { autoResume: false, view: VIEW })).snapshot.tick).toBe(0);
  });

  it('resumes the newest autosave after a "reload", with the state hash intact', async () => {
    const first = await started({}, undefined, { probe: true, fixtures: true });
    await first.core.handle('advance', months(24));
    const before = stateHash(first.core);

    // A reload: a brand-new core (no memory of the old one) over the same saved games.
    const second = makeCore({}, first.store).core;
    const { snapshot, resumed } = await second.handle('boot', { autoResume: true, view: HASHED });
    expect(resumed).toMatchObject({
      source: 'auto-1',
      report: { hashMatches: true, dataHashMatches: true, tick: 24 },
    });
    expect(snapshot).toMatchObject({ tick: 24, seed: 'test-world', stateHash: before });
    expect(snapshot.lastLoad?.source).toBe('auto-1');
  });

  it('carries on after a resume exactly as if it had never stopped', async () => {
    const straight = await started({}, undefined, { probe: true, fixtures: true });
    await straight.core.handle('advance', months(100));

    const interrupted = await started({}, undefined, { probe: true, fixtures: true });
    await interrupted.core.handle('advance', months(40));
    const reloaded = makeCore({}, interrupted.store).core;
    await reloaded.handle('boot', { autoResume: true, view: VIEW });
    await reloaded.handle('advance', months(60));

    expect(stateHash(reloaded)).toBe(stateHash(straight.core));
  });

  it('falls back to a new world, with an explanation, if the newest save is damaged', async () => {
    const first = await started();
    await first.core.handle('advance', months(3));
    const [summary] = await first.store.list();
    await first.store.put(summary!, new TextEncoder().encode('definitely not a save'));

    const { snapshot, resumed, notice } = await makeCore({}, first.store).core.handle('boot', {
      autoResume: true,
      view: VIEW,
    });
    expect(resumed).toBeNull();
    expect(snapshot.tick).toBe(0);
    expect(notice).toContain('Could not resume auto-1');
    expect(notice).toContain('not an .opsim save file');
  });

  it('falls back to a new world if saved games cannot be read at all', async () => {
    const broken: SaveStore = {
      persistent: true,
      list: async () => {
        throw new Error('storage is disabled');
      },
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    };
    const { snapshot, notice } = await makeCore({}, broken).core.handle('boot', {
      autoResume: true,
      view: VIEW,
    });
    expect(snapshot.tick).toBe(0);
    expect(notice).toContain('storage is disabled');
  });
});

describe('new worlds', () => {
  it('use the seed given, trimmed, or generate one', async () => {
    const { core } = makeCore();
    expect(
      (await core.handle('newWorld', { seed: '  coral-1234  ', view: VIEW })).snapshot.seed,
    ).toBe('coral-1234');
    expect((await core.handle('newWorld', { seed: '   ', view: VIEW })).snapshot.seed).toBe(
      'fixed-seed',
    );
    expect((await core.handle('newWorld', { view: VIEW })).snapshot.seed).toBe('fixed-seed');
  });

  it('reject a seed that is too long or has control characters', async () => {
    const { core } = makeCore();
    await expect(core.handle('newWorld', { seed: 'x'.repeat(81), view: VIEW })).rejects.toThrow(
      ActionError,
    );
    await expect(core.handle('newWorld', { seed: 'bad\nseed', view: VIEW })).rejects.toThrow(
      /control characters/,
    );
  });

  it('give the same world for the same seed, every time', async () => {
    const a = makeCore().core;
    const b = makeCore().core;
    for (const core of [a, b]) {
      await core.handle('newWorld', { seed: 'twin', probe: true, view: VIEW });
      await core.handle('advance', months(468));
    }
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('only allow dev worlds in debug builds', async () => {
    const { core } = makeCore({ debug: false });
    await expect(core.handle('newWorld', { probe: true, view: VIEW })).rejects.toThrow(/disabled/);
    await expect(core.handle('newWorld', { fixtures: true, view: VIEW })).rejects.toThrow(
      /disabled/,
    );
    expect((await core.handle('newWorld', { seed: 'plain', view: VIEW })).snapshot.seed).toBe(
      'plain',
    );
  });

  it('start with the test entity when asked, and forget the previous load', async () => {
    const first = await started({}, undefined, {});
    await first.core.handle('advance', months(2));
    const second = makeCore({}, first.store).core;
    await second.handle('boot', { autoResume: true, view: VIEW });
    expect((await snap(second)).lastLoad).not.toBeNull();
    const fresh = (
      await second.handle('newWorld', { seed: 'with-dummy', fixtures: true, view: VIEW })
    ).snapshot;
    expect(fresh.lastLoad).toBeNull();
    expect(fresh.counts.entities).toBe(1);
  });
});

describe('advancing time', () => {
  it('advances the requested months and reports where it stopped', async () => {
    const { core } = await started();
    const report = await core.handle('advance', months(12));
    expect(report).toMatchObject({ ticksRun: 12, stop: 'completed' });
    expect(report.snapshot).toMatchObject({ tick: 12, progress: 12 / 468 });
    expect(report.snapshot.date).toMatchObject({ year: 1, month: 1 });
  });

  it('makes exactly one autosave per advance, however many months it covers', async () => {
    const { core, store } = await started();
    const report = await core.handle('advance', months(100));
    expect((await store.list()).map((s) => s.slot)).toEqual(['auto-1']);
    expect(report.snapshot.autosave).toMatchObject({ ok: true, slot: 'auto-1' });
    expect((await store.list())[0]).toMatchObject({ tick: 100, seed: 'test-world' });
  });

  it('rotates through three autosave slots', async () => {
    const { core, store } = await started();
    const slots: string[] = [];
    for (let i = 0; i < 4; i++) {
      const report = await core.handle('advance', months(1));
      slots.push(
        report.snapshot.autosave && report.snapshot.autosave.ok
          ? report.snapshot.autosave.slot
          : 'none',
      );
    }
    expect(slots).toEqual(['auto-1', 'auto-2', 'auto-3', 'auto-1']);
    expect((await store.list()).map((s) => [s.slot, s.tick])).toEqual([
      ['auto-1', 4],
      ['auto-2', 2],
      ['auto-3', 3],
    ]);
  });

  it('does not autosave when no time passed', async () => {
    const { core, store } = await started();
    await core.handle('advance', months(0));
    expect(await store.list()).toEqual([]);
  });

  it('gives the same world however the work is chunked', async () => {
    const hashes: string[] = [];
    for (const batchTicks of [1, 7, 12, 1000]) {
      const { core } = await started({ batchTicks }, undefined, { probe: true, fixtures: true });
      await core.handle('advance', months(468));
      hashes.push(stateHash(core));
    }
    expect(new Set(hashes).size).toBe(1);
  });

  it('keeps the page responsive: yields between chunks and reports progress', async () => {
    let yields = 0;
    let now = 0;
    const { core } = await started({
      batchTicks: 10,
      clock: () => (now += 20), // every check says "more than 16 ms have passed"
      yieldToHost: async () => void (yields += 1),
    });
    const seen: { ticksRun: number; target: number; tick: number }[] = [];
    await core.handle('advance', months(100), { onProgress: (p) => seen.push(p) });
    expect(yields).toBeGreaterThanOrEqual(9);
    expect(seen.at(0)).toEqual({ ticksRun: 10, target: 100, tick: 10 });
    expect(seen.at(-1)?.ticksRun).toBeLessThanOrEqual(100);
    expect(seen.map((p) => p.ticksRun)).toEqual(
      [...seen.map((p) => p.ticksRun)].sort((a, b) => a - b),
    );
  });

  describe('cancelling', () => {
    it('stops at the next chunk boundary, leaving a consistent world, and can resume', async () => {
      let now = 0;
      const holder: { core?: SimCore } = {};
      const made = await started({
        batchTicks: 5,
        clock: () => (now += 20),
        yieldToHost: async () => holder.core?.cancel(), // the "cancel" message arrives during the first yield
      });
      holder.core = made.core;
      const report = await made.core.handle('advance', months(468));
      expect(report).toMatchObject({ stop: 'cancelled', ticksRun: 5 });
      expect(report.snapshot.tick).toBe(5);
      expect(made.core.peekState().tick).toBe(5);

      holder.core = undefined; // no more cancelling
      expect(await made.core.handle('advance', months(5))).toMatchObject({
        stop: 'completed',
        ticksRun: 5,
      });
      expect(made.core.peekState().tick).toBe(10);
    });

    it('a cancel with nothing running does not poison the next advance', async () => {
      const { core } = await started();
      core.cancel();
      expect(await core.handle('advance', months(3))).toMatchObject({
        stop: 'completed',
        ticksRun: 3,
      });
    });

    it('still autosaves the months that did run', async () => {
      let now = 0;
      const holder: { core?: SimCore } = {};
      const { core, store } = await started({
        batchTicks: 4,
        clock: () => (now += 20),
        yieldToHost: async () => holder.core?.cancel(),
      });
      holder.core = core;
      await core.handle('advance', months(100));
      expect((await store.list())[0]).toMatchObject({ tick: 4 });
    });
  });

  describe('stop reasons', () => {
    it('stops on a decision, shows it, and refuses to skip past it', async () => {
      const { core } = await started();
      await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
      const report = await core.handle('advance', months(12));
      expect(report).toMatchObject({ ticksRun: 1, stop: 'decision' });
      expect(report.snapshot.pending).toMatchObject([
        { id: 1, title: 'A test crossroads', choices: [{ id: 'left' }, { id: 'right' }] },
      ]);
      expect(await core.handle('advance', months(3))).toMatchObject({
        ticksRun: 0,
        stop: 'decision',
      });

      const { snapshot } = await act(core, {
        type: 'decision/resolve',
        decisionId: 1,
        choiceId: 'left',
      });
      expect(snapshot.pending).toEqual([]);
      expect(await core.handle('advance', months(3))).toMatchObject({
        ticksRun: 3,
        stop: 'completed',
      });
    });

    it('can auto-resolve decisions when asked (headless style)', async () => {
      const { core } = await started();
      await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
      const report = await core.handle('advance', { ...months(12), decisions: 'auto-first' });
      expect(report).toMatchObject({ ticksRun: 12, stop: 'completed' });
      expect(report.snapshot.pending).toEqual([]);
    });

    it('stops at the present and reports it', async () => {
      const { core } = await started();
      const first = await core.handle('advance', months(468));
      expect(first).toMatchObject({ ticksRun: 468, stop: 'completed' });
      expect(first.snapshot).toMatchObject({ tick: 468, atPresent: true, progress: 1 });
      expect(await core.handle('advance', months(1))).toMatchObject({
        ticksRun: 0,
        stop: 'present',
      });
    });

    it('lets open-ended play continue past the present', async () => {
      const { core } = await started();
      await core.handle('advance', months(468));
      const { snapshot } = await act(core, { type: 'debug/setOpenEnded', value: true });
      expect(snapshot).toMatchObject({ atPresent: false, openEnded: true });
      expect(await core.handle('advance', months(3))).toMatchObject({ ticksRun: 3 });
    });

    it('skips to the next event', async () => {
      const { core } = await started();
      await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
      const report = await core.handle('advance', { plan: { kind: 'untilEvent' }, view: VIEW });
      expect(report).toMatchObject({ ticksRun: 1, stop: 'event' });
    });
  });
});

describe('a time skip that fails part-way', () => {
  /**
   * Hand-built data (it never went through the loader, so the validator that would normally catch
   * this at build time is bypassed) whose event text cannot render. It stands in for any bug in
   * any system that throws in the middle of a tick.
   */
  function brokenData(): GameData {
    const broken = EventSchema.parse({
      id: 'evt_broken',
      type: 'world',
      title: 'Broken',
      text: 'Placeholder.',
    });
    broken.text = '{no_such_variable}';
    return { ...data, events: { ...data.events, evt_broken: broken } };
  }

  /** A probe world (so every tick changes the state) with the broken event due at tick 4. */
  async function doomedWorld() {
    const made = await started({ data: brokenData() }, undefined, { probe: true });
    made.core.peekState().scheduled.push({ eventId: 'evt_broken', tick: 4, source: 'test' });
    return made;
  }

  it('leaves the world exactly as it was before the skip, not half-ticked', async () => {
    const { core } = await doomedWorld();
    const before = stateHash(core);

    // Ticks 0 to 3 succeed; tick 4 fails after its earlier steps have already changed the state.
    await expect(core.handle('advance', months(8))).rejects.toThrow(/no_such_variable/);

    expect(stateHash(core)).toBe(before);
    expect(core.peekState().tick).toBe(0);
    expect(core.peekState().scheduled).toHaveLength(1); // the event was not silently consumed
  });

  it('reports the unchanged world to the page, so the page and the simulation agree', async () => {
    const { core } = await doomedWorld();
    await expect(core.handle('advance', months(8))).rejects.toThrow();
    const after = await snap(core, HASHED);
    expect(after.tick).toBe(0);
    expect(after.stateHash).toBe(hashValue(core.peekState()));
  });

  it('does not autosave the failed world, and keeps working afterwards', async () => {
    const { core, store } = await doomedWorld();
    await expect(core.handle('advance', months(8))).rejects.toThrow();
    expect(await store.list()).toEqual([]);

    // The next skip stops short of the broken event and succeeds from the intact world.
    await expect(core.handle('advance', months(4))).resolves.toMatchObject({
      ticksRun: 4,
      stop: 'completed',
    });
    expect(core.peekState().tick).toBe(4);
  });

  it('is not tripped up by cancelling: a cancelled skip keeps the months it finished', async () => {
    let now = 0;
    const { core } = await started({
      batchTicks: 5,
      clock: () => (now += 20),
      yieldToHost: async () => core.cancel(),
    });
    const report = await core.handle('advance', months(100));
    expect(report.stop).toBe('cancelled');
    expect(report.ticksRun).toBeGreaterThan(0);
    expect(core.peekState().tick).toBe(report.ticksRun);
  });
});

describe('actions', () => {
  it('apply and show up in the next snapshot', async () => {
    const { core } = await started();
    const { snapshot } = await act(core, { type: 'debug/spawnTestEntity' });
    expect(snapshot.counts).toMatchObject({
      entities: 1,
      byType: { character: 1 },
      byOrigin: { generated: 1 },
    });
  });

  it('are atomic: a failing action leaves the world exactly as it was', async () => {
    const { core } = await started({}, undefined, { fixtures: true });
    const before = stateHash(core);
    const id = Object.keys(core.peekState().entities)[0]!;
    await expect(
      act(core, {
        type: 'debug/addModifier',
        entityId: id,
        stat: 'charisma',
        value: 1,
        modKind: 'flat',
      }),
    ).rejects.toThrow(ActionError);
    await expect(act(core, { type: 'debug/forceEvent', eventId: 'evt_nope' })).rejects.toThrow(
      ActionError,
    );
    await expect(
      act(core, { type: 'decision/resolve', decisionId: 5, choiceId: 'x' }),
    ).rejects.toThrow();
    expect(stateHash(core)).toBe(before);
  });

  it('are atomic even when an action fails halfway through its work', async () => {
    // Hand-built data (it never went through the loader) whose choice cannot render. Resolving the
    // decision removes it, logs the choice, and only then hits the bad template: a genuine half-way failure.
    const broken = EventSchema.parse({
      id: 'evt_half_way',
      type: 'personal',
      title: 'Half way',
      text: 'Something is about to go wrong.',
      choices: [{ id: 'go', label: 'Go', effects: [{ kind: 'log', text: 'fine' }] }],
    });
    broken.choices[0]!.effects = [{ kind: 'log', text: '{no_such_variable}', tags: [] }];
    const custom: GameData = { ...data, events: { ...data.events, evt_half_way: broken } };

    const { core } = await started({ data: custom });
    await act(core, { type: 'debug/forceEvent', eventId: 'evt_half_way' });
    await core.handle('advance', months(1));
    const before = stateHash(core);
    expect(core.peekState().pending).toHaveLength(1);

    await expect(
      act(core, { type: 'decision/resolve', decisionId: 1, choiceId: 'go' }),
    ).rejects.toThrow(/no_such_variable/);
    expect(stateHash(core)).toBe(before); // no half-applied choice, no stray log line
    expect(core.peekState().pending).toHaveLength(1); // the decision is still waiting
  });

  it('are validated, with a readable message', async () => {
    const { core } = await started();
    await expect(act(core, { type: 'nonsense' })).rejects.toThrow(/Invalid action/);
    await expect(act(core, { type: 'debug/forceEvent' })).rejects.toThrow(
      /Invalid action: eventId/,
    );
    await expect(act(core, 'not even an object')).rejects.toThrow(/Invalid action/);
    await expect(act(core, { type: 'debug/spawnTestEntity', extra: true })).rejects.toThrow(
      /Invalid action/,
    );
  });

  it('refuse debug actions in a production build, but allow real ones', async () => {
    const { core } = makeCore({ debug: false });
    await core.handle('newWorld', { seed: 'prod', view: VIEW });
    await expect(act(core, { type: 'debug/spawnTestEntity' })).rejects.toThrow(/disabled/);
    await expect(act(core, { type: 'debug/setOpenEnded', value: true })).rejects.toThrow(
      /disabled/,
    );
    expect(core.peekState().entities).toEqual({});
  });

  it('resolving a decision autosaves', async () => {
    const { core, store } = await started();
    await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    await core.handle('advance', months(1));
    const before = (await store.list()).map((s) => s.tick);
    await act(core, { type: 'decision/resolve', decisionId: 1, choiceId: 'right' });
    const after = await store.list();
    expect(after.length).toBe(before.length + 1);
  });
});

describe('looking at the world', () => {
  it('shows a stat as base plus modifiers, as in the plan', async () => {
    const { core } = await started({}, undefined, { fixtures: true });
    const id = Object.keys(core.peekState().entities)[0]!;
    const view = await core.handle('inspect', { entityId: id });
    expect(view).toMatchObject({
      id,
      name: 'Test Dummy 1',
      type: 'character',
      origin: 'generated',
      tier: 2,
      isPlayer: false,
    });
    const strength = view!.stats.find((s) => s.id === 'strength')!;
    expect(strength).toMatchObject({
      base: 50,
      flatTotal: 24,
      pctTotal: 0,
      subtotal: 74,
      total: 74,
    });
    expect(strength.description).toBe(
      'Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)',
    );
    expect(strength.lines.map((l) => [l.source, l.value])).toEqual([
      ['training', 12],
      ['Brawler (trait)', 8],
      ['Cutlass (weapon)', 4],
    ]);
    const speed = view!.stats.find((s) => s.id === 'speed')!;
    expect(speed.total).toBe(70);
    expect(speed.description).toBe(
      'Speed 70 = (40 base + 6 training + 10 Tailwind (temporary)) x 1.25 (+25% Quick (trait))',
    );
    expect(view!.stats.map((s) => s.id)).toEqual(['endurance', 'speed', 'strength']);
    expect(view!.recent[0]?.summary).toContain('spawned Test Dummy 1');
  });

  it('shows modifiers wearing off as time passes', async () => {
    const { core } = await started({}, undefined, { fixtures: true });
    const id = Object.keys(core.peekState().entities)[0]!;
    await core.handle('advance', months(6));
    const speed = (await core.handle('inspect', { entityId: id }))!.stats.find(
      (s) => s.id === 'speed',
    )!;
    expect(speed.total).toBe(57.5);
    expect(speed.lines.map((l) => l.source)).toEqual(['training', 'Quick (trait)']);
  });

  it('returns null for an entity that does not exist', async () => {
    const { core } = await started();
    expect(await core.handle('inspect', { entityId: 'gen_424242' })).toBeNull();
  });

  it('lists and filters entities', async () => {
    const { core } = await started();
    for (let i = 0; i < 3; i++) await act(core, { type: 'debug/spawnTestEntity' });
    const all = await core.handle('listEntities', {});
    expect(all.total).toBe(3);
    expect(all.items.map((e) => e.id)).toEqual(['gen_000001', 'gen_000002', 'gen_000003']);
    expect((await core.handle('listEntities', { text: 'dummy 2' })).items.map((e) => e.id)).toEqual(
      ['gen_000002'],
    );
    expect((await core.handle('listEntities', { type: 'ship' })).total).toBe(0);
    expect(await core.handle('listEntities', { origin: 'generated', limit: 2 })).toMatchObject({
      total: 3,
      items: [{}, {}],
    });
  });

  it('queries the log by tick, entity, tag, kind and text, newest first, with paging', async () => {
    const { core } = await started({}, undefined, { fixtures: true });
    await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await core.handle('advance', months(5));
    await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await core.handle('advance', months(2));

    const q = (extra: object) =>
      core.handle('queryLog', { filter: {}, omniscient: false, ...extra });
    const everything = await q({});
    expect(everything.records.map((r) => r.seq)).toEqual(
      [...everything.records.map((r) => r.seq)].sort((a, b) => b - a),
    );
    expect(everything.total).toBe(everything.records.length);

    expect((await q({ filter: { kind: 'event' } })).total).toBe(2);
    expect((await q({ filter: { tag: 'debug' } })).total).toBeGreaterThanOrEqual(3);
    expect(
      (await q({ filter: { entityId: 'gen_000001' } })).records.every((r) =>
        r.actorIds.includes('gen_000001'),
      ),
    ).toBe(true);
    expect((await q({ filter: { fromTick: 5, toTick: 5, kind: 'event' } })).total).toBe(1);
    expect((await q({ filter: { text: 'TEST NOTICE' } })).total).toBe(2);
    expect((await q({ limit: 2 })).records).toHaveLength(2);
    expect((await q({ limit: 2, offset: 2 })).records[0]?.seq).toBe(everything.records[2]?.seq);

    const filters = await q({});
    expect(filters.tags).toContain('debug');
    expect(filters.kinds).toEqual(['event', 'system']);
  });

  it('hides facts nobody knows unless omniscient mode is on, and says which ones', async () => {
    const { core } = await started();
    await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    await core.handle('advance', months(1));

    const normal = await snap(core);
    expect(normal.feed.some((f) => f.summary.includes('nobody knows about yet'))).toBe(false);

    const omniscient = await snap(core, { omniscient: true, hash: false });
    const secret = omniscient.feed.find((f) => f.summary.includes('nobody knows about yet'));
    expect(secret).toMatchObject({ hidden: true });
    expect(omniscient.feed.filter((f) => f.hidden)).toHaveLength(1);

    const log = await core.handle('queryLog', { filter: { kind: 'event' }, omniscient: true });
    expect(log.records[0]).toMatchObject({ known: false });
  });

  it('classifies feed lines for colour-coding', async () => {
    const { core } = await started();
    for (const id of ['evt_test_notice', 'evt_test_crossroads', 'evt_test_aftermath'])
      await act(core, { type: 'debug/forceEvent', eventId: id });
    await core.handle('advance', months(1));
    const feed = (await snap(core)).feed;
    const category = (text: string) => feed.find((f) => f.summary.includes(text))?.category;
    expect(category('A new world begins')).toBe('system');
    expect(category('Debug: forced')).toBe('system');
    expect(category('test notice is posted')).toBe('world');
    expect(category('Two paths open')).toBe('personal');
    expect(category('consequences of the crossroads')).toBe('family');
  });

  it('caps the feed at the configured tail length but keeps counting everything', async () => {
    const small: GameData = {
      ...data,
      settings: { ...data.settings, host: { feedTail: 10, newsTail: 10 } },
    };
    const { core } = await started({ data: small });
    for (let i = 0; i < 30; i++)
      await act(core, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    await core.handle('advance', months(1));
    const snapshot = await snap(core);
    expect(snapshot.feed).toHaveLength(10);
    expect(snapshot.counts.log).toBeGreaterThan(60);
    expect(snapshot.news.length).toBe(10);
    expect(snapshot.counts.news).toBe(30);
  });

  it('lists the events that can be forced', async () => {
    const { core } = await started();
    const events = await core.handle('listEvents', {});
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(
      expect.arrayContaining([
        'evt_legacy_marine_letter',
        'evt_test_aftermath',
        'evt_test_crossroads',
        'evt_test_notice',
        'evt_test_secret',
      ]),
    );
    expect(events.find((e) => e.id === 'evt_test_crossroads')).toMatchObject({
      choices: 2,
      type: 'personal',
    });
    expect(events.find((e) => e.id === 'evt_test_secret')).toMatchObject({
      visibility: 'secret',
      choices: 0,
    });
  });

  it("reports the state hash on request, and it matches the engine's own", async () => {
    const { core } = await started({}, undefined, { probe: true });
    await core.handle('advance', months(30));
    const reported = await core.handle('hash', {});
    expect(reported).toEqual({ stateHash: stateHash(core), dataHash });
    expect((await snap(core)).stateHash).toBeUndefined();
    expect((await snap(core, HASHED)).stateHash).toBe(reported.stateHash);
  });
});

describe('saving, loading, exporting', () => {
  it('lists slots with the configured counts', async () => {
    const { core } = await started();
    expect(await core.handle('saves/list', {})).toEqual({
      slots: [],
      persistent: false,
      counts: { autosaveSlots: 3, manualSlots: 10 },
      limits: { maxImportBytes: 67108864 },
    });
  });

  it('saves a manual slot and loads it back, restoring that moment', async () => {
    const { core } = await started({}, undefined, { probe: true, fixtures: true });
    await core.handle('advance', months(20));
    const atSave = stateHash(core);
    const listed = await core.handle('saves/save', { slot: 'manual-3', label: 'Before the trip' });
    expect(listed.slots.find((s) => s.slot === 'manual-3')).toMatchObject({
      label: 'Before the trip',
      tick: 20,
    });

    await core.handle('advance', months(50));
    expect(core.peekState().tick).toBe(70);

    const loaded = await core.handle('saves/load', { slot: 'manual-3', view: HASHED });
    expect(loaded.snapshot).toMatchObject({ tick: 20, stateHash: atSave });
    expect(loaded.load).toMatchObject({
      source: 'manual-3',
      report: { hashMatches: true, label: 'Before the trip' },
    });
    expect(loaded.snapshot.lastLoad?.source).toBe('manual-3');
    expect(stateHash(core)).toBe(atSave);
  });

  it('gives a default label from the date', async () => {
    const { core } = await started();
    await core.handle('advance', months(14));
    const { slots } = await core.handle('saves/save', { slot: 'manual-1' });
    expect(slots.find((s) => s.slot === 'manual-1')?.label).toBe('March, Year 1');
  });

  it('deletes a slot', async () => {
    const { core } = await started();
    await core.handle('saves/save', { slot: 'manual-1' });
    expect(
      (await core.handle('saves/delete', { slot: 'manual-1' })).slots.filter(
        (s) => s.slot === 'manual-1',
      ),
    ).toEqual([]);
  });

  it('refuses bad slots and empty slots with a SaveError code', async () => {
    const { core } = await started();
    await expect(core.handle('saves/save', { slot: 'auto-1' })).rejects.toMatchObject({
      code: 'slot',
    });
    await expect(core.handle('saves/save', { slot: 'manual-11' })).rejects.toMatchObject({
      code: 'slot',
    });
    await expect(
      core.handle('saves/load', { slot: 'manual-2', view: VIEW }),
    ).rejects.toBeInstanceOf(SaveError);
  });

  it('exports a file that imports into a different game with the same state hash', async () => {
    const original = await started({}, undefined, { probe: true, fixtures: true });
    await original.core.handle('advance', months(77));
    await act(original.core, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    const exported = await original.core.handle('saves/export', {});
    expect(exported.filename).toBe('opsim-test-world-tick77.opsim');
    expect(exported.bytes).toBeInstanceOf(Uint8Array);

    const other = makeCore().core;
    await other.handle('boot', { autoResume: false, view: VIEW });
    const imported = await other.handle('saves/import', { bytes: exported.bytes, view: HASHED });
    expect(imported.load).toMatchObject({
      source: 'import',
      report: { hashMatches: true, seed: 'test-world', tick: 77 },
    });
    expect(imported.snapshot.stateHash).toBe(stateHash(original.core));
  });

  it('rejects an import that is not a save, or has been tampered with', async () => {
    const { core } = await started();
    await expect(
      core.handle('saves/import', { bytes: new TextEncoder().encode('hello'), view: VIEW }),
    ).rejects.toMatchObject({ code: 'not-opsim' });
    const { bytes } = await core.handle('saves/export', {});
    const damaged = bytes.slice();
    damaged[damaged.length - 8] = (damaged[damaged.length - 8] ?? 0) ^ 0xff;
    await expect(
      core.handle('saves/import', { bytes: damaged, view: VIEW }),
    ).rejects.toBeInstanceOf(SaveError);
    expect(core.peekState().seed).toBe('test-world'); // the failed import changed nothing
  });

  it('warns when the game content has changed since the save was made', async () => {
    const a = await started({ dataHash: 'data-v1' });
    await a.core.handle('advance', months(3));
    const { bytes } = await a.core.handle('saves/export', {});
    const b = makeCore({ dataHash: 'data-v2' }).core;
    const { load } = await b.handle('saves/import', { bytes, view: VIEW });
    expect(load.report).toMatchObject({
      dataHashMatches: false,
      savedDataHash: 'data-v1',
      hashMatches: true,
    });
  });

  it('never lets a failing autosave break play, and reports it instead', async () => {
    const real = new MemorySaveStore();
    const failing: SaveStore = {
      ...real,
      persistent: true,
      list: () => real.list(),
      get: (s) => real.get(s),
      delete: (s) => real.delete(s),
      put: async () => {
        throw new Error('disk full');
      },
    };
    const { core } = await started({}, failing);
    const report = await core.handle('advance', months(5));
    expect(report).toMatchObject({ ticksRun: 5, stop: 'completed' });
    expect(report.snapshot.autosave).toMatchObject({ ok: false, error: 'disk full' });
    expect(core.peekState().tick).toBe(5);
  });
});

describe('request handling', () => {
  it('runs requests one at a time, in order', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let now = 0;
    const { core } = await started({
      batchTicks: 5,
      clock: () => (now += 20),
      yieldToHost: () => gate,
    });
    const order: string[] = [];
    const advancing = core.handle('advance', months(50)).then(() => order.push('advance'));
    const looking = core.handle('snapshot', { view: VIEW }).then(() => order.push('snapshot'));
    await Promise.resolve();
    expect(order).toEqual([]); // the snapshot waits for the advance
    release();
    await Promise.all([advancing, looking]);
    expect(order).toEqual(['advance', 'snapshot']);
  });

  it('keeps working after a request fails', async () => {
    const { core } = await started();
    await expect(act(core, { type: 'nonsense' })).rejects.toThrow();
    await expect(core.handle('advance', months(2))).resolves.toMatchObject({ ticksRun: 2 });
  });

  it('rejects an unknown operation', async () => {
    const { core } = await started();
    await expect(core.handle('nonsense' as never, {} as never)).rejects.toThrow(
      /Unknown operation/,
    );
  });
});
