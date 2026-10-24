import { describe, expect, it } from 'vitest';
import { dateOf } from '../../src/engine/calendar';
import type { Effect, EventDef } from '../../src/engine/data/schemas';
import { WorldStateSchema, type WorldState } from '../../src/engine/state';
import { fireEvent, resolveDecision } from '../../src/systems/events';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { bandFor, successChance } from '../../src/systems/story/checks';
import { playerStory } from '../../src/systems/story/context';
import { allHold } from '../../src/systems/story/conditions';
import { candidates, eventWeight, pickEvents } from '../../src/systems/story/select';
import { vesselNow } from '../../src/systems/voyage/progress';
import { Rng } from '../../src/engine/rng';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * The event engine (Phase 3): candidates, conditions, weights, cooldowns, roles, skill checks with
 * four bands, and the voyage events that change the ship, the crew, the stores and the arrival.
 */

const VESSEL = new Set<Effect['kind']>(['hull', 'crew', 'supplies', 'delay', 'morale', 'redirect']);

function checkBands(def: EventDef) {
  return def.choices.flatMap((c) =>
    c.check
      ? [c.check.criticalSuccess, c.check.success, c.check.failure, c.check.criticalFailure]
          .filter((b) => b !== undefined)
          .map((b) => ({ choice: c.id, effects: b.effects }))
      : [],
  );
}

/** Voyage events with a skill check whose result changes the ship, crew, stores or arrival. */
const shipChecks = Object.values(data.events)
  .filter((e) => e.type === 'voyage')
  .filter((e) => checkBands(e).some((b) => b.effects.some((x) => VESSEL.has(x.kind))))
  .sort((a, b) => (a.id < b.id ? -1 : 1));

/** A captain at sea in a caravel with a crew and stores: the widest set of choices. */
function atSea(seed: string): TestLife {
  const t = startLife({ seed, entryAge: 26 });
  ensureWorldLayer(t.state, t.data);
  t.player().character!.berries = 3_000_000;
  t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
  t.act({ type: 'travel/buyShip', vessel: 'vessel_caravel' });
  t.act({ type: 'travel/hire', count: 9 });
  t.act({ type: 'travel/provision', months: 6 });
  t.act({ type: 'travel/sail', lane: 'lane_baratie_loguetown', mode: 'own' });
  return t;
}

function shipState(state: WorldState) {
  const c = state.entities[state.playerId!]!.character!;
  const v = c.travel?.voyage;
  const vessel = v ? vesselNow(state, v) : null;
  return JSON.stringify({
    v: v ? [v.to, Math.round(v.done), Math.round(v.miles)] : c.place,
    vessel: vessel ? [vessel.hull, vessel.crew, vessel.morale, vessel.supplies] : null,
  });
}

describe('Done when: at least 25 voyage events work, with checks that change ship, crew, supplies or arrival time', () => {
  it('has at least 25 of them', () => {
    expect(shipChecks.length).toBeGreaterThanOrEqual(25);
  });

  it('every one fires on a real voyage, and its check changes the ship, crew, stores or arrival', () => {
    const base = atSea('voyage-events');
    const failures: string[] = [];
    for (const def of shipChecks) {
      let changed = false;
      for (let attempt = 0; attempt < 30 && !changed; attempt++) {
        const state = structuredClone(base.state);
        state.counters.decisionId += attempt * 13;
        const tick = state.tick;
        fireEvent(
          state,
          def,
          { tick, date: dateOf(data.calendar, tick), newsDrafts: [], data },
          undefined,
          {
            story: playerStory(state, data, tick),
          },
        );
        const decision = state.pending.at(-1);
        const choice = def.choices.find(
          (c) =>
            c.check &&
            decision?.choices.some((d) => d.id === c.id) &&
            checkBands({ ...def, choices: [c] }).some((b) =>
              b.effects.some((x) => VESSEL.has(x.kind)),
            ),
        );
        if (!decision || !choice) break;
        const before = shipState(state);
        resolveDecision(state, data, decision.id, choice.id);
        changed = shipState(state) !== before;
        expect(WorldStateSchema.safeParse(state).success, def.id).toBe(true);
      }
      if (!changed) failures.push(def.id);
    }
    expect(failures).toEqual([]);
  });

  it('rolls them month by month at sea, and only voyage events', () => {
    const t = atSea('voyage-rolls');
    delete t.state.flags['dev.quiet'];
    t.run(4, 'auto-random');
    const fired = t.state.log.filter(
      (r) => r.kind === 'event' && r.tags.includes('voyage') && data.events[r.cause ?? ''],
    );
    for (const r of fired) expect(data.events[r.cause!]!.trigger, r.cause).toBe('voyage');
    const story = playerStory(t.state, data, t.state.tick);
    const pool = candidates(story, 'voyage');
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (const def of pickEvents(story, Rng.root(`pick-${i}`), pool, 2, data.travel.quietWeight))
        picks.add(def.id);
    }
    expect(picks.size).toBeGreaterThan(5);
  });
});

describe('candidates, weights and cooldowns', () => {
  it('drops events whose conditions fail, and keeps a cooldown', () => {
    const t = startLife({ seed: 'candidates', entryAge: 30 });
    ensureWorldLayer(t.state, t.data);
    const story = playerStory(t.state, data, t.state.tick);
    const pool = candidates(story, 'random');
    expect(pool.length).toBeGreaterThan(3);
    for (const def of pool) expect(allHold(story, def.conditions), def.id).toBe(true);
    // The village has no Marine base and no underworld: no slavers.
    expect(pool.some((d) => d.id === 'evt_local_slavers')).toBe(false);
    // A festival just held is cooling down.
    t.state.eventState['evt_local_festival'] = { last: t.state.tick, count: 1 };
    expect(
      candidates(playerStory(t.state, data, t.state.tick), 'random').some(
        (d) => d.id === 'evt_local_festival',
      ),
    ).toBe(false);
  });

  it('multiplies weights by their modifiers, the place, and the danger of the lane', () => {
    const t = atSea('weights');
    const story = playerStory(t.state, data, t.state.tick);
    const storm = data.events['evt_voyage_storm']!;
    // A storm's weight rises in winter and autumn, and on a dangerous lane.
    const w = eventWeight(story, storm);
    expect(w).toBeGreaterThan(storm.weight * 0.9);
    const calmer = { ...story, lane: { ...story.lane!, danger: 0 } };
    expect(eventWeight(calmer, storm)).toBeLessThan(w);
  });

  it('casts strangers from the place and names them in the text', () => {
    const t = atSea('roles');
    const def = data.events['evt_voyage_argument']!;
    const record = fireEvent(t.state, def, {
      tick: t.state.tick,
      date: dateOf(data.calendar, t.state.tick),
      newsDrafts: [],
      data,
    });
    const stranger = t.state.entities[record.targetIds[0]!]!;
    expect(record.summary.startsWith(`${stranger.name}, who had been needling`)).toBe(true);
    expect(t.state.pending.at(-1)?.roles?.['stranger']).toBe(stranger.id);
  });
});

describe('skill checks', () => {
  it('is even at the difficulty, moves by half every 20 points, and keeps 5% either way', () => {
    expect(successChance(50, 50)).toBe(0.5);
    expect(successChance(70, 50)).toBe(0.95);
    expect(successChance(60, 50)).toBe(0.75);
    expect(successChance(0, 100)).toBe(0.05);
  });

  it('has four bands: the best and worst slices are critical', () => {
    expect(bandFor(0.01, 0.5)).toBe('criticalSuccess');
    expect(bandFor(0.3, 0.5)).toBe('success');
    expect(bandFor(0.6, 0.5)).toBe('failure');
    expect(bandFor(0.99, 0.5)).toBe('criticalFailure');
  });

  it('writes the band that came up, and applies its effects', () => {
    const t = startLife({ seed: 'band', entryAge: 30 });
    ensureWorldLayer(t.state, t.data);
    const def = data.events['evt_local_tavern_brawl']!;
    fireEvent(t.state, def, {
      tick: t.state.tick,
      date: dateOf(data.calendar, t.state.tick),
      newsDrafts: [],
      data,
    });
    const decision = t.state.pending.at(-1)!;
    const before = t.state.log.length;
    resolveDecision(t.state, data, decision.id, 'brawl');
    const band = t.state.log.slice(before).find((r) => r.tags.includes('check'))!;
    expect(
      ['criticalSuccess', 'success', 'failure', 'criticalFailure'].some((b) =>
        band.tags.includes(b),
      ),
    ).toBe(true);
  });
});

describe('world events', () => {
  it('happen somewhere that matches, reach the news, and change the world', () => {
    const t = startLife({ seed: 'world-events', entryYear: 20, entryAge: 30 }, data, false);
    ensureWorldLayer(t.state, t.data);
    const before = t.state.news.length;
    t.run(24);
    const world = t.state.log.filter(
      (r) => r.tags.includes('world') && r.kind === 'event' && r.tick >= t.state.tick - 24,
    );
    expect(world.length).toBeGreaterThan(3);
    for (const r of world) {
      const def = data.events[r.cause!]!;
      expect(def.trigger, r.cause).toBe('world');
      expect(r.place, r.cause).not.toBeNull();
    }
    expect(t.state.news.length).toBeGreaterThan(before);
  });
});
