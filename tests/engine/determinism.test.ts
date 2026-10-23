import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { PIPELINE } from '../../src/core';
import { hashValue } from '../../src/engine/canonical';
import type { TickStep } from '../../src/engine/pipeline';
import { Rng } from '../../src/engine/rng';
import { SaveManager } from '../../src/engine/saves/manager';
import { MemorySaveStore } from '../../src/engine/saves/store';
import { runTickInPlace } from '../../src/engine/tick';
import { PROBE_DRAWS } from '../../src/systems/world';
import { data, dataHash } from '../helpers/data';
import { act, hashOf, makeWorld, run } from '../helpers/world';

describe('same seed, same world (rule 6)', () => {
  it('two independent 468-month runs end with identical state hashes', () => {
    const a = makeWorld('twins', { probe: true });
    const b = makeWorld('twins', { probe: true });
    run(a, 468);
    run(b, 468);
    expect(a.state.tick).toBe(468);
    expect(hashOf(a.state)).toBe(hashOf(b.state));
  });

  it('is not vacuous: the probe really drew from the RNG, and the hash depends on it', () => {
    const a = makeWorld('seed-one', { probe: true });
    const b = makeWorld('seed-two', { probe: true });
    run(a, 468);
    run(b, 468);
    expect(a.state.flags['dev.probe.draws']).toBe(468 * PROBE_DRAWS);
    expect(a.state.flags['dev.probe.acc']).not.toBe(b.state.flags['dev.probe.acc']);
    expect(hashOf(a.state)).not.toBe(hashOf(b.state));

    // Same seed text with the probe off must differ from probe on: the probe is in the hash.
    const quiet = makeWorld('seed-one');
    run(quiet, 468);
    expect(hashOf(quiet.state)).not.toBe(hashOf(a.state));
  });

  it('a corrupted generator would be caught: perturbing one draw changes the final hash', () => {
    const honest = makeWorld('tamper', { probe: true });
    const tampered = makeWorld('tamper', { probe: true });
    run(honest, 100);
    // Same world, but one month's random stream is replaced by another's.
    const swapped: TickStep[] = PIPELINE.map((step) =>
      step.id === 'updateWorld'
        ? {
            id: step.id,
            run: (state, ctx) => step.run(state, { ...ctx, rng: Rng.root('someone-else') }),
          }
        : step,
    );
    for (let i = 0; i < 100; i++)
      runTickInPlace(tampered.state, data, tampered.rng, i === 50 ? swapped : PIPELINE);
    expect(hashOf(tampered.state)).not.toBe(hashOf(honest.state));
  });

  it('different seeds give different worlds', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const w = makeWorld(`seed-${i}`, { probe: true });
      run(w, 24);
      hashes.add(hashOf(w.state));
    }
    expect(hashes.size).toBe(25);
  });
});

describe('keyed streams isolate systems from each other', () => {
  it('adding a system that draws lots of randomness leaves every existing system unchanged', () => {
    const plain = makeWorld('isolation', { probe: true });
    const crowded = makeWorld('isolation', { probe: true });
    const greedy = (id: string): TickStep => ({
      id,
      run: (_state, ctx) => {
        for (let i = 0; i < 1000; i++) ctx.rng.next();
      },
    });
    const crowdedPipeline = [greedy('greedyFirst'), ...PIPELINE, greedy('greedyLast')];
    for (let i = 0; i < 200; i++) {
      runTickInPlace(plain.state, data, plain.rng, PIPELINE);
      runTickInPlace(crowded.state, data, crowded.rng, crowdedPipeline);
    }
    expect(crowded.state.flags['dev.probe.acc']).toBe(plain.state.flags['dev.probe.acc']);
    expect(hashOf(crowded.state)).toBe(hashOf(plain.state));
  });

  it('the player doing something different does not disturb what the rest of the world rolls', () => {
    const idle = makeWorld('butterfly', { probe: true });
    const busy = makeWorld('butterfly', { probe: true });
    act(busy, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    run(busy, 1, 'stop');
    act(busy, { type: 'decision/resolve', decisionId: 1, choiceId: 'left' });
    run(idle, 1);
    run(busy, 200);
    run(idle, 200);
    expect(busy.state.flags['dev.probe.acc']).toBe(idle.state.flags['dev.probe.acc']);
    expect(hashOf(busy.state)).not.toBe(hashOf(idle.state)); // the player's choices did change *their* world
  });
});

describe('replay, save and reload', () => {
  const script = (w: ReturnType<typeof makeWorld>) => {
    act(w, { type: 'debug/spawnTestEntity' });
    run(w, 12);
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    run(w, 6, 'stop');
    act(w, { type: 'decision/resolve', decisionId: 1, choiceId: 'left' });
    const id = Object.keys(w.state.entities)[0]!;
    act(w, {
      type: 'debug/addModifier',
      entityId: id,
      stat: 'strength',
      value: 15,
      modKind: 'pct',
      months: 30,
    });
    run(w, 60);
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    run(w, 200);
  };

  it('a scripted session of actions and time replays to the same hash', () => {
    const a = makeWorld('replay', { probe: true });
    const b = makeWorld('replay', { probe: true });
    script(a);
    script(b);
    expect(hashOf(a.state)).toBe(hashOf(b.state));
    expect(a.state.log.length).toBeGreaterThan(10);
  });

  const manager = () =>
    new SaveManager(new MemorySaveStore(), {
      counts: { autosaveSlots: 3, manualSlots: 10 },
      limits: { maxCompressedBytes: 64 << 20, maxDecompressedBytes: 256 << 20 },
      dataHash,
      now: () => 1_700_000_000_000,
    });

  it('save, reload and the state hash still matches', async () => {
    const w = makeWorld('reload', { probe: true });
    script(w);
    const before = hashOf(w.state);
    const m = manager();
    await m.saveManual(w.state, 'manual-1', 'checkpoint');
    const { state, report } = await m.load('manual-1');
    expect(hashOf(state)).toBe(before);
    expect(report).toMatchObject({
      hashMatches: true,
      dataHashMatches: true,
      storedHash: before,
      actualHash: before,
    });
  });

  it('a world saved mid-run and reloaded carries on exactly like one that never stopped', async () => {
    const straight = makeWorld('resume', { probe: true });
    script(straight);

    const interrupted = makeWorld('resume', { probe: true });
    act(interrupted, { type: 'debug/spawnTestEntity' });
    run(interrupted, 12);
    act(interrupted, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    act(interrupted, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    run(interrupted, 6, 'stop');

    // Save, "reload the page" (fresh objects and a fresh RNG built from the seed only), carry on.
    const m = manager();
    await m.saveManual(interrupted.state, 'manual-1', 'mid');
    const loaded = await m.load('manual-1');
    const reloaded = { state: loaded.state, rng: Rng.root(loaded.state.seed) };

    act(reloaded, { type: 'decision/resolve', decisionId: 1, choiceId: 'left' });
    const id = Object.keys(reloaded.state.entities)[0]!;
    act(reloaded, {
      type: 'debug/addModifier',
      entityId: id,
      stat: 'strength',
      value: 15,
      modKind: 'pct',
      months: 30,
    });
    run(reloaded, 60);
    act(reloaded, { type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    run(reloaded, 200);

    expect(hashOf(reloaded.state)).toBe(hashOf(straight.state));
  });

  it('survives a save and reload at every month of a run', async () => {
    const m = manager();
    const w = makeWorld('every-month', { probe: true, fixtures: true });
    for (let i = 0; i < 60; i++) {
      run(w, 1);
      const bytes = (await m.exportBytes(w.state, 'x')).bytes;
      const { state } = await m.decode(bytes);
      expect(hashOf(state)).toBe(hashOf(w.state));
    }
  });
});

describe('speed', () => {
  it('a headless 468-month run with no NPCs finishes in under 2 seconds', () => {
    const w = makeWorld('speed');
    const started = performance.now();
    run(w, 468);
    const ms = performance.now() - started;
    expect(w.state.tick).toBe(468);
    expect(ms).toBeLessThan(2000);
    console.info(`468 ticks, no NPCs: ${ms.toFixed(1)} ms`);
  });

  it('stays fast with the probe and a test entity too', () => {
    const w = makeWorld('speed2', { probe: true, fixtures: true });
    const started = performance.now();
    run(w, 468);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('state size after a full run is small enough to save in a blink', () => {
    const w = makeWorld('size', { probe: true, fixtures: true });
    run(w, 468);
    expect(JSON.stringify(w.state).length).toBeLessThan(50_000);
    expect(hashValue(w.state)).toMatch(/^[0-9a-f]{32}$/);
  });
});
