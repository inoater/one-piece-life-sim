import { describe, expect, it } from 'vitest';
import { advance } from '../../src/engine/advance';
import type { GameData } from '../../src/engine/data/schemas';
import { EventSchema } from '../../src/engine/data/schemas';
import { explainChain, queryLog } from '../../src/engine/log';
import { PIPELINE } from '../../src/systems';
import { ActionError, ActionSchema, applyAction } from '../../src/systems/actions';
import { EventError, resolveDecision, scheduleEvent } from '../../src/systems/events';
import { data } from '../helpers/data';
import { act, makeWorld, run, type TestWorld } from '../helpers/world';

/** Advance with custom data (for tests that add events), using the real pipeline. */
function runWith(world: TestWorld, customData: GameData, months: number) {
  return advance(
    world.state,
    customData,
    world.rng,
    { kind: 'months', count: months },
    { pipeline: PIPELINE, decisions: 'stop', resolveDecision },
  );
}

/** Test data with extra events added, defaults filled in by the real schema. */
function withEvents(...defs: Record<string, unknown>[]): GameData {
  const events = { ...data.events };
  for (const def of defs) {
    const parsed = EventSchema.parse(def);
    events[parsed.id] = parsed;
  }
  return { ...data, events };
}

describe('firing events', () => {
  it('a forced event fires in the next month processed and records why', () => {
    const w = makeWorld('fire');
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    expect(w.state.scheduled).toMatchObject([
      { eventId: 'evt_test_notice', tick: 0, source: 'debug' },
    ]);

    run(w, 1);
    const record = w.state.log.find((r) => r.kind === 'event');
    expect(record).toMatchObject({
      tick: 0,
      cause: 'evt_test_notice',
      tags: ['event', 'world', 'dev'],
      knownBy: ['*'],
      summary: 'A test notice is posted in January 1486 SC. Nothing depends on it.',
    });
    expect(w.state.scheduled).toEqual([]);
  });

  it("turns the event's news into a news item the same month, linked to its record", () => {
    const w = makeWorld('news');
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
    run(w, 1);
    const record = w.state.log.find((r) => r.kind === 'event')!;
    expect(w.state.news).toEqual([
      {
        id: 1,
        tick: 0,
        text: 'Test notice posted (January 1486 SC).',
        tags: ['news', 'dev', 'world'],
        sourceSeq: record.seq,
      },
    ]);
    expect(w.state.counters.newsSeq).toBe(1);
  });

  it('does not fire an event before its month, and fires an overdue one at the next tick', () => {
    const w = makeWorld('timing');
    scheduleEvent(w.state, 'evt_test_notice', 3, 'test');
    run(w, 3);
    expect(w.state.log.some((r) => r.kind === 'event')).toBe(false);
    run(w, 1);
    expect(w.state.log.find((r) => r.kind === 'event')?.tick).toBe(3);

    const late = makeWorld('late');
    late.state.tick = 5;
    scheduleEvent(late.state, 'evt_test_notice', 2, 'test'); // overdue
    run(late, 1);
    expect(late.state.log.find((r) => r.kind === 'event')?.tick).toBe(5);
  });

  it('fires several due events in the order they were scheduled', () => {
    const w = makeWorld('order');
    scheduleEvent(w.state, 'evt_test_aftermath', 0, 'test');
    scheduleEvent(w.state, 'evt_test_notice', 0, 'test');
    run(w, 1);
    expect(w.state.log.filter((r) => r.kind === 'event').map((r) => r.cause)).toEqual([
      'evt_test_aftermath',
      'evt_test_notice',
    ]);
  });

  it('events nobody knows about are true in the world but invisible to a player', () => {
    const w = makeWorld('secret');
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_secret' });
    run(w, 1);
    const record = w.state.log.find((r) => r.cause === 'evt_test_secret')!;
    expect(record.knownBy).toEqual([]);
    const query = (omniscient: boolean) =>
      queryLog(w.state, { kind: 'event' }, { playerId: null, omniscient });
    expect(query(false)).toEqual([]);
    expect(query(true)).toHaveLength(1);
  });
});

describe('chains scheduled by effects', () => {
  const chain = withEvents(
    {
      id: 'evt_a',
      type: 'world',
      title: 'A',
      text: 'A fires.',
      effects: [
        { kind: 'schedule', eventId: 'evt_b', afterMonths: 2 },
        { kind: 'setFlag', flag: 'chain.a', value: true },
      ],
    },
    {
      id: 'evt_b',
      type: 'world',
      title: 'B',
      text: 'B fires.',
      effects: [{ kind: 'schedule', eventId: 'evt_c', afterMonths: 1 }],
    },
    { id: 'evt_c', type: 'world', title: 'C', text: 'C fires.' },
  );

  it('follow-ups fire the stated number of months later, never in the same month', () => {
    const w = makeWorld('chain');
    w.state.tick = 10;
    scheduleEvent(w.state, 'evt_a', 10, 'test');
    runWith(w, chain, 6);
    const fired = w.state.log.filter((r) => r.kind === 'event').map((r) => [r.cause, r.tick]);
    expect(fired).toEqual([
      ['evt_a', 10],
      ['evt_b', 12],
      ['evt_c', 13],
    ]);
    expect(w.state.flags['chain.a']).toBe(true);
  });

  it('an event that schedules itself fires once a month, not endlessly within one tick', () => {
    const loop = withEvents({
      id: 'evt_loop',
      type: 'world',
      title: 'L',
      text: 'Again.',
      effects: [{ kind: 'schedule', eventId: 'evt_loop', afterMonths: 1 }],
    });
    const w = makeWorld('loop');
    scheduleEvent(w.state, 'evt_loop', 0, 'test');
    runWith(w, loop, 5);
    expect(w.state.log.filter((r) => r.cause === 'evt_loop').map((r) => r.tick)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('skips and reports a scheduled event whose content has since been removed', () => {
    const w = makeWorld('gone');
    scheduleEvent(w.state, 'evt_deleted_from_data', 0, 'old save');
    run(w, 1);
    expect(w.state.scheduled).toEqual([]);
    const warning = w.state.log.find((r) => r.tags.includes('warning'));
    expect(warning?.summary).toContain('evt_deleted_from_data');
  });
});

describe('decisions', () => {
  const crossroads = () => {
    const w = makeWorld('decisions');
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    run(w, 1, 'stop');
    return w;
  };

  it('an event with choices leaves a pending decision describing them', () => {
    const w = crossroads();
    expect(w.state.pending).toHaveLength(1);
    expect(w.state.pending[0]).toMatchObject({
      id: 1,
      eventId: 'evt_test_crossroads',
      firedTick: 0,
      title: 'A test crossroads',
      choices: [
        { id: 'left', label: 'Take the left path', text: 'Quiet, and a little longer.' },
        { id: 'right', label: 'Take the right path', text: 'Shorter, but you will hear about it.' },
      ],
    });
  });

  it('resolving applies the choice: flag set, lines logged, decision removed', () => {
    const w = crossroads();
    resolveDecision(w.state, data, 1, 'left');
    expect(w.state.pending).toEqual([]);
    expect(w.state.flags['dev.crossroads']).toBe('left');
    expect(w.state.log.map((r) => r.summary)).toContain('The left path was quiet.');
    expect(w.state.log.find((r) => r.kind === 'decision')?.summary).toBe(
      'Chose "Take the left path" (A test crossroads).',
    );
  });

  it('chains the follow-up scheduled by the choice, counted from the current month', () => {
    const w = crossroads(); // clock is at 1 after the event month
    resolveDecision(w.state, data, 1, 'left'); // schedules the aftermath 2 months from now
    expect(w.state.scheduled).toMatchObject([{ eventId: 'evt_test_aftermath', tick: 3 }]);
    run(w, 5);
    expect(w.state.log.find((r) => r.cause === 'evt_test_aftermath')?.tick).toBe(3);
  });

  it('lets "why did this happen?" be walked back through the log', () => {
    const w = crossroads();
    resolveDecision(w.state, data, 1, 'left');
    run(w, 5);
    const aftermath = w.state.log.find(
      (r) => r.kind === 'event' && r.cause === 'evt_test_aftermath',
    )!;
    const chain = explainChain(w.state, aftermath.seq);
    expect(
      chain.map((r) =>
        r.kind === 'event' ? `event:${r.cause}` : r.kind === 'decision' ? 'decision' : r.cause,
      ),
    ).toEqual([
      'event:evt_test_aftermath',
      'decision',
      'event:evt_test_crossroads',
      'action:debug/forceEvent',
    ]);
  });

  it('the other choice takes a different path with no follow-up', () => {
    const w = crossroads();
    resolveDecision(w.state, data, 1, 'right');
    expect(w.state.flags['dev.crossroads']).toBe('right');
    expect(w.state.scheduled).toEqual([]);
  });

  it('rejects an unknown decision or choice with a helpful message and changes nothing', () => {
    const w = crossroads();
    expect(() => resolveDecision(w.state, data, 99, 'left')).toThrow(EventError);
    expect(() => resolveDecision(w.state, data, 1, 'sideways')).toThrow(/choices: left, right/);
    expect(w.state.pending).toHaveLength(1);
  });

  it('drops a decision whose event was removed from the data rather than leaving the world stuck', () => {
    const w = crossroads();
    const without: GameData = {
      ...data,
      events: Object.fromEntries(
        Object.entries(data.events).filter(([id]) => id !== 'evt_test_crossroads'),
      ),
    };
    resolveDecision(w.state, without, 1, 'left');
    expect(w.state.pending).toEqual([]);
    expect(w.state.log.at(-1)?.tags).toContain('warning');
  });
});

describe('actions', () => {
  it('refuse debug actions when debug is off', () => {
    const w = makeWorld();
    for (const action of [
      { type: 'debug/spawnTestEntity' },
      { type: 'debug/forceEvent', eventId: 'evt_test_notice' },
      { type: 'debug/setOpenEnded', value: true },
    ] as const) {
      expect(() => applyAction(w.state, data, action, { debug: false })).toThrow(/disabled/);
    }
    expect(w.state.entities).toEqual({});
  });

  it('forcing an unknown event fails clearly', () => {
    const w = makeWorld();
    expect(() =>
      applyAction(
        w.state,
        data,
        { type: 'debug/forceEvent', eventId: 'evt_nope' },
        { debug: true },
      ),
    ).toThrow(ActionError);
  });

  it('adds a temporary modifier to a stat, which then shows in its stack and expires', () => {
    const w = makeWorld('mod', { fixtures: true });
    const id = Object.keys(w.state.entities)[0]!;
    act(w, {
      type: 'debug/addModifier',
      entityId: id,
      stat: 'endurance',
      value: 20,
      modKind: 'pct',
      months: 3,
      source: 'Test boost',
    });
    const stat = w.state.entities[id]!.stats['endurance']!;
    expect(stat.mods).toEqual([{ source: 'Test boost', value: 20, kind: 'pct', expiresTick: 3 }]);
    run(w, 3);
    expect(stat.mods).toEqual([]);
  });

  it('rejects a modifier on a missing entity or stat, naming the stats that exist', () => {
    const w = makeWorld('mod2', { fixtures: true });
    const id = Object.keys(w.state.entities)[0]!;
    expect(() =>
      act(w, {
        type: 'debug/addModifier',
        entityId: 'gen_999999',
        stat: 'speed',
        value: 1,
        modKind: 'flat',
      }),
    ).toThrow(ActionError);
    expect(() =>
      act(w, {
        type: 'debug/addModifier',
        entityId: id,
        stat: 'charisma',
        value: 1,
        modKind: 'flat',
      }),
    ).toThrow(/it has: endurance, speed, strength|has: strength/);
  });

  it('resolving a decision asks the host to autosave', () => {
    const w = makeWorld('autosave');
    act(w, { type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
    run(w, 1, 'stop');
    const { effects } = applyAction(
      w.state,
      data,
      { type: 'decision/resolve', decisionId: 1, choiceId: 'right' },
      { debug: false },
    );
    expect(effects).toEqual([{ kind: 'autosave' }]);
  });

  it('are validated strictly at the boundary', () => {
    expect(ActionSchema.safeParse({ type: 'debug/forceEvent' }).success).toBe(false);
    expect(
      ActionSchema.safeParse({ type: 'debug/forceEvent', eventId: 'x', extra: 1 }).success,
    ).toBe(false);
    expect(ActionSchema.safeParse({ type: 'nonsense' }).success).toBe(false);
    expect(
      ActionSchema.safeParse({ type: 'decision/resolve', decisionId: 1.5, choiceId: 'a' }).success,
    ).toBe(false);
    expect(ActionSchema.safeParse({ type: 'debug/spawnTestEntity' }).success).toBe(true);
  });
});
