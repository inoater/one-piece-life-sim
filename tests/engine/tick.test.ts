import { describe, expect, it } from 'vitest';
import { PIPELINE, PIPELINE_IDS, tick, tickInPlace } from '../../src/core';
import { advance as advanceWith, advanceBatch, newCursor } from '../../src/engine/advance';
import { dateOf } from '../../src/engine/calendar';
import { hashValue } from '../../src/engine/canonical';
import type { GameData } from '../../src/engine/data/schemas';
import { createEntity, dueEntities } from '../../src/engine/entities';
import { PIPELINE_ORDER, type TickStep } from '../../src/engine/pipeline';
import { statValue } from '../../src/engine/stats';
import { runTick, runTickInPlace } from '../../src/engine/tick';
import { resolveDecision, scheduleEvent } from '../../src/systems/events';
import { ActionError, applyAction, createResolveActionsStep } from '../../src/systems/actions';
import { advanceOptions } from '../../src/core';
import { act, hashOf, makeWorld, run } from '../helpers/world';
import { data } from '../helpers/data';

describe('the pipeline', () => {
  it('has exactly the eight steps from the plan, in order', () => {
    expect(PIPELINE_IDS).toEqual([
      'resolveActions',
      'advanceVoyages',
      'npcDecisions',
      'updateWorld',
      'rollEvents',
      'compileNews',
      'aging',
      'autosave',
    ]);
    expect(PIPELINE_IDS).toEqual([...PIPELINE_ORDER]);
  });

  it('rejects two steps with the same id', () => {
    const world = makeWorld();
    const twice: TickStep[] = [PIPELINE[0]!, PIPELINE[0]!];
    expect(() => runTickInPlace(world.state, data, world.rng, twice)).toThrow(/two steps with id/);
  });

  it('runs steps in the order given', () => {
    const world = makeWorld();
    const seen: string[] = [];
    const spy = (id: string): TickStep => ({ id, run: () => void seen.push(id) });
    runTickInPlace(world.state, data, world.rng, [spy('c'), spy('a'), spy('b')]);
    expect(seen).toEqual(['c', 'a', 'b']);
  });

  it('a new system is one more entry in the list', () => {
    const world = makeWorld();
    const extra: TickStep = { id: 'extra', run: (state) => void (state.flags['extra.ran'] = true) };
    runTickInPlace(world.state, data, world.rng, [...PIPELINE, extra]);
    expect(world.state.flags['extra.ran']).toBe(true);
  });
});

describe('tick(state, data, rng) -> state', () => {
  it('is pure: the input is untouched and a new state comes back', () => {
    const world = makeWorld('pure', { probe: true, fixtures: true });
    const before = hashOf(world.state);
    const next = tick(world.state, data, world.rng);
    expect(hashOf(world.state)).toBe(before);
    expect(world.state.tick).toBe(0);
    expect(next.tick).toBe(1);
    expect(next).not.toBe(world.state);
    expect(next.entities).not.toBe(world.state.entities);
  });

  it('advances the clock by exactly one month, and 468 ticks reach the present', () => {
    const world = makeWorld();
    let state = world.state;
    for (let i = 0; i < 468; i++) {
      expect(state.tick).toBe(i);
      state = tick(state, data, world.rng);
    }
    expect(state.tick).toBe(468);
    expect(data.calendar.presentTick).toBe(468);
  });

  it('gives the same result whether it copies or mutates in place (100 months, probe and fixtures on)', () => {
    const a = makeWorld('same', { probe: true, fixtures: true });
    const b = makeWorld('same', { probe: true, fixtures: true });
    let pure = a.state;
    for (let i = 0; i < 100; i++) {
      pure = tick(pure, data, a.rng);
      tickInPlace(b.state, data, b.rng);
      expect(hashOf(pure)).toBe(hashOf(b.state));
    }
  });

  it('shows each step the month being processed', () => {
    const world = makeWorld();
    const seen: { tick: number; stateTick: number; month: number }[] = [];
    const spy: TickStep = {
      id: 'spy',
      run: (state, ctx) =>
        void seen.push({ tick: ctx.tick, stateTick: state.tick, month: ctx.date.month }),
    };
    for (let i = 0; i < 14; i++) runTickInPlace(world.state, data, world.rng, [spy]);
    expect(seen.map((s) => s.tick)).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(seen.every((s) => s.tick === s.stateTick)).toBe(true);
    expect(seen[12]).toMatchObject({ month: 1 });
  });
});

describe('simulation tiers (rule 5)', () => {
  const record = (overrides?: Partial<GameData['settings']['tiers']>) => {
    const world = makeWorld();
    const customData: GameData = {
      ...data,
      settings: { ...data.settings, tiers: { ...data.settings.tiers, ...overrides } },
    };
    const due: { tick: number; t1: boolean; t2: boolean }[] = [];
    const spy: TickStep = {
      id: 'spy',
      run: (_s, ctx) =>
        void due.push({ tick: ctx.tick, t1: ctx.tiers.tier1Due, t2: ctx.tiers.tier2Due }),
    };
    for (let i = 0; i < 12; i++) runTickInPlace(world.state, customData, world.rng, [spy]);
    return due;
  };

  it('Tier 1 acts every tick and Tier 2 every third tick (quarterly, aligned to Jan/Apr/Jul/Oct)', () => {
    const due = record();
    expect(due.every((d) => d.t1)).toBe(true);
    expect(due.filter((d) => d.t2).map((d) => d.tick)).toEqual([0, 3, 6, 9]);
  });

  it('takes the cadence from data, not code', () => {
    expect(
      record({ tier2Every: 4 })
        .filter((d) => d.t2)
        .map((d) => d.tick),
    ).toEqual([0, 4, 8]);
    expect(
      record({ tier1Every: 2 })
        .filter((d) => d.t1)
        .map((d) => d.tick),
    ).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('dueEntities returns only the tiers that are due, in id order', () => {
    const world = makeWorld();
    const t2a = createEntity(world.state, { type: 'character', origin: 'generated', name: 'T2 A' });
    const t1 = createEntity(world.state, { type: 'character', origin: 'player', name: 'T1' });
    const t2b = createEntity(world.state, { type: 'character', origin: 'generated', name: 'T2 B' });
    expect([t2a.tier, t1.tier, t2b.tier]).toEqual([2, 1, 2]);
    expect(
      dueEntities(world.state, { tier1Due: true, tier2Due: false }).map((e) => e.name),
    ).toEqual(['T1']);
    expect(dueEntities(world.state, { tier1Due: true, tier2Due: true }).map((e) => e.name)).toEqual(
      ['T2 A', 'T1', 'T2 B'],
    );
    expect(dueEntities(world.state, { tier1Due: false, tier2Due: false })).toEqual([]);
    expect(
      dueEntities(world.state, { tier1Due: true, tier2Due: true }, (e) => e.name === 'T2 B').map(
        (e) => e.name,
      ),
    ).toEqual(['T2 B']);
  });
});

describe('random streams in the pipeline', () => {
  const draws = (steps: string[], seed: string, ticks: number) => {
    const world = makeWorld(seed);
    const out: Record<string, number[]> = {};
    const spies: TickStep[] = steps.map((id) => ({
      id,
      run: (_s, ctx) => void (out[`${id}@${ctx.tick}`] = [ctx.rng.nextU32(), ctx.rng.nextU32()]),
    }));
    for (let i = 0; i < ticks; i++) runTickInPlace(world.state, data, world.rng, spies);
    return out;
  };

  it('gives every step its own stream, and every tick its own', () => {
    const out = draws(['x', 'y'], 's', 2);
    const values = Object.values(out).map((v) => v.join(','));
    expect(new Set(values).size).toBe(4);
  });

  it('is repeatable for a seed and different for another', () => {
    expect(draws(['x'], 's', 3)).toEqual(draws(['x'], 's', 3));
    expect(draws(['x'], 's', 3)).not.toEqual(draws(['x'], 't', 3));
  });

  it('is unaffected by adding another step (the point of keyed streams)', () => {
    const alone = draws(['x'], 's', 5);
    const withNeighbour = draws(['y', 'x', 'z'], 's', 5);
    for (let t = 0; t < 5; t++) expect(withNeighbour[`x@${t}`]).toEqual(alone[`x@${t}`]);
  });
});

describe('step 1: resolving queued actions', () => {
  it('runs handlers in queue order and empties the queue', () => {
    const world = makeWorld();
    const handled: string[] = [];
    const step = createResolveActionsStep({
      echo: (_state, ctx, action) =>
        void handled.push(`${ctx.tick}:${String(action.payload['n'])}`),
    });
    world.state.queue.push(
      { kind: 'echo', payload: { n: 1 } },
      { kind: 'echo', payload: { n: 2 } },
    );
    runTickInPlace(world.state, data, world.rng, [step]);
    expect(handled).toEqual(['0:1', '0:2']);
    expect(world.state.queue).toEqual([]);
  });

  it('logs and drops an action nobody handles instead of ignoring it silently', () => {
    const world = makeWorld();
    world.state.queue.push({ kind: 'mystery', payload: {} });
    runTickInPlace(world.state, data, world.rng, [createResolveActionsStep({})]);
    expect(world.state.queue).toEqual([]);
    expect(world.state.log.at(-1)).toMatchObject({ kind: 'system', tags: ['system', 'warning'] });
    expect(world.state.log.at(-1)?.summary).toContain('mystery');
  });

  it('queue/add only accepts kinds that are registered', () => {
    const world = makeWorld();
    expect(() =>
      applyAction(
        world.state,
        data,
        { type: 'queue/add', kind: 'train', payload: {} },
        { debug: false },
      ),
    ).toThrow(ActionError);
    applyAction(
      world.state,
      data,
      { type: 'queue/add', kind: 'train', payload: { stat: 'strength' } },
      { debug: false, queueKinds: ['train'] },
    );
    expect(world.state.queue).toEqual([{ kind: 'train', payload: { stat: 'strength' } }]);
  });
});

describe('step 7: aging prunes expired modifiers', () => {
  it('removes a temporary modifier exactly when its expiry tick arrives', () => {
    const world = makeWorld('aging', { fixtures: true });
    const id = Object.keys(world.state.entities)[0]!;
    const speed = () => world.state.entities[id]!.stats['speed']!;
    expect(speed().mods.some((m) => m.source.startsWith('Tailwind'))).toBe(true); // expires at tick 6

    run(world, 5); // clock now at 5
    expect(world.state.tick).toBe(5);
    expect(speed().mods.some((m) => m.source.startsWith('Tailwind'))).toBe(true);
    expect(statValue(speed(), 5)).toBe((40 + 6 + 10) * 1.25); // 70: Tailwind still counts

    run(world, 1); // clock now at 6: the modifier has expired and been pruned
    expect(world.state.tick).toBe(6);
    expect(speed().mods.some((m) => m.source.startsWith('Tailwind'))).toBe(false);
    expect(statValue(speed(), 6)).toBe((40 + 6) * 1.25); // 57.5
  });
});

describe('step 8: autosave is a request, not an action', () => {
  const effectsFor = (every: number, ticks: number) => {
    const world = makeWorld();
    const customData: GameData = {
      ...data,
      settings: { ...data.settings, saves: { ...data.settings.saves, autosaveEveryTicks: every } },
    };
    const ticksWithAutosave: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const before = world.state.tick;
      const out = runTickInPlace(world.state, customData, world.rng, PIPELINE);
      if (out.effects.some((e) => e.kind === 'autosave')) ticksWithAutosave.push(before);
    }
    return ticksWithAutosave;
  };

  it('asks for a save every tick by default', () => {
    expect(effectsFor(1, 4)).toEqual([0, 1, 2, 3]);
  });

  it('follows the cadence in settings', () => {
    expect(effectsFor(3, 9)).toEqual([2, 5, 8]);
  });

  it('never changes the world: autosave settings do not change the state hash', () => {
    const a = makeWorld('same', { probe: true });
    const b = makeWorld('same', { probe: true });
    const noSaves: GameData = {
      ...data,
      settings: { ...data.settings, saves: { ...data.settings.saves, autosaveEveryTicks: 1000 } },
    };
    for (let i = 0; i < 50; i++) {
      runTickInPlace(a.state, data, a.rng, PIPELINE);
      runTickInPlace(b.state, noSaves, b.rng, PIPELINE);
    }
    expect(hashOf(a.state)).toBe(hashOf(b.state));
  });
});

describe('advancing time', () => {
  it('runs exactly the requested months', () => {
    const world = makeWorld();
    expect(run(world, 3)).toMatchObject({ ticksRun: 3, stop: 'completed' });
    expect(world.state.tick).toBe(3);
    expect(run(world, 0)).toMatchObject({ ticksRun: 0, stop: 'completed' });
  });

  it('rejects negative or fractional counts', () => {
    const world = makeWorld();
    expect(() =>
      advanceWith(world.state, data, world.rng, { kind: 'months', count: -1 }, advanceOptions()),
    ).toThrow(RangeError);
    expect(() =>
      advanceWith(world.state, data, world.rng, { kind: 'months', count: 1.5 }, advanceOptions()),
    ).toThrow(RangeError);
  });

  it('468 months from the start reach the present and report completion', () => {
    const world = makeWorld();
    expect(run(world, 468)).toMatchObject({ ticksRun: 468, stop: 'completed' });
    expect(world.state.tick).toBe(468);
  });

  it('stops at the present: later months are refused until play is open-ended', () => {
    const world = makeWorld();
    world.state.tick = 460;
    expect(run(world, 20)).toMatchObject({ ticksRun: 8, stop: 'present' });
    expect(world.state.tick).toBe(468);
    expect(run(world, 5)).toMatchObject({ ticksRun: 0, stop: 'present' });
    act(world, { type: 'debug/setOpenEnded', value: true });
    expect(run(world, 5)).toMatchObject({ ticksRun: 5, stop: 'completed' });
    expect(world.state.tick).toBe(473);
  });

  describe('decisions', () => {
    const crossroads = () => {
      const world = makeWorld('decide');
      act(world, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
      return world;
    };

    it('any skip stops on an event that needs a decision', () => {
      const world = crossroads();
      expect(run(world, 12, 'stop')).toMatchObject({ ticksRun: 1, stop: 'decision' });
      expect(world.state.pending).toHaveLength(1);
      expect(world.state.tick).toBe(1);
    });

    it('refuses to advance while a decision is waiting', () => {
      const world = crossroads();
      run(world, 12, 'stop');
      expect(run(world, 3, 'stop')).toMatchObject({ ticksRun: 0, stop: 'decision' });
    });

    it('carries on once it is resolved', () => {
      const world = crossroads();
      run(world, 12, 'stop');
      resolveDecision(world.state, data, world.state.pending[0]!.id, 'right');
      expect(run(world, 3, 'stop')).toMatchObject({ ticksRun: 3, stop: 'completed' });
    });

    it('headless runs can auto-resolve instead (first choice)', () => {
      const world = crossroads();
      expect(run(world, 12, 'auto-first')).toMatchObject({ ticksRun: 12, stop: 'completed' });
      expect(world.state.pending).toEqual([]);
      expect(world.state.flags['dev.crossroads']).toBe('left');
    });

    it('auto-random is repeatable for a seed', () => {
      const outcome = () => {
        const world = crossroads();
        run(world, 24, 'auto-random');
        return hashOf(world.state);
      };
      expect(outcome()).toBe(outcome());
    });
  });

  describe('skip to next event', () => {
    it('stops after the month an event the player can see fires', () => {
      const world = makeWorld();
      scheduleEvent(world.state, 'evt_test_notice', 5, 'test');
      const result = advanceWith(
        world.state,
        data,
        world.rng,
        { kind: 'untilEvent' },
        advanceOptions(),
      );
      expect(result).toMatchObject({ ticksRun: 6, stop: 'event' });
      expect(world.state.tick).toBe(6);
    });

    it('does not stop for system lines or for events nobody knows about', () => {
      const world = makeWorld();
      act(world, { type: 'debug/setOpenEnded', value: false });
      scheduleEvent(world.state, 'evt_test_secret', 3, 'test');
      const result = advanceWith(
        world.state,
        data,
        world.rng,
        { kind: 'untilEvent' },
        advanceOptions(),
      );
      expect(result.ticksRun).toBe(468);
      expect(['completed', 'present']).toContain(result.stop);
      expect(world.state.log.some((r) => r.kind === 'event' && r.tags.includes('world'))).toBe(
        true,
      );
    });

    it('is capped so an eventless world cannot loop forever', () => {
      const world = makeWorld();
      const capped: GameData = {
        ...data,
        settings: { ...data.settings, time: { ...data.settings.time, untilEventCap: 10 } },
      };
      const result = advanceWith(
        world.state,
        capped,
        world.rng,
        { kind: 'untilEvent' },
        advanceOptions(),
      );
      expect(result).toMatchObject({ ticksRun: 10, stop: 'completed' });
    });
  });

  it('gives the same world however the work is chunked', () => {
    const results = [1, 7, 1000].map((chunk) => {
      const world = makeWorld('chunks', { probe: true, fixtures: true });
      const plan = { kind: 'months', count: 300 } as const;
      const cursor = newCursor(plan, data);
      for (;;) {
        const batch = advanceBatch(
          world.state,
          data,
          world.rng,
          plan,
          cursor,
          advanceOptions('auto-first'),
          chunk,
        );
        if (batch.stop !== null) break;
      }
      return hashOf(world.state);
    });
    expect(new Set(results).size).toBe(1);
  });

  it('an invalid world still hashes: state stays plain JSON through a full run', () => {
    const world = makeWorld('json', { probe: true, fixtures: true });
    act(world, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    for (let i = 0; i < 40; i++) {
      run(world, 12, 'auto-random'); // throws if anything non-JSON sneaks in
      expect(() => hashValue(world.state)).not.toThrow();
    }
  });

  it('date lookups agree with the calendar', () => {
    const world = makeWorld();
    run(world, 30);
    expect(dateOf(data.calendar, world.state.tick)).toMatchObject({ year: 2, month: 7 });
  });
});

describe('runTick returns effects separately from state', () => {
  it('hands the autosave request back to the caller', () => {
    const world = makeWorld();
    const { state, effects } = runTick(world.state, data, world.rng, PIPELINE);
    expect(effects).toEqual([{ kind: 'autosave' }]);
    expect(state.tick).toBe(1);
  });
});
