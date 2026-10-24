import { describe, expect, it } from 'vitest';
import { advance, applyAction, createWorld, Rng } from '../../src/core';
import { DEFAULT_WORLD_CONFIG, WorldStateSchema, type WorldState } from '../../src/engine/state';
import { beatState, monthlyChance } from '../../src/systems/canon/beats';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { worldTimeline } from '../../src/systems/places/timeline';
import { canonView } from '../../src/systems/places/view';
import { data } from '../helpers/data';
import { startLife } from '../helpers/life';

/**
 * The canon layer (Phase 3): beats pushed by the canon mode, roles that die or are elsewhere,
 * cascades, early deaths, the player's part, and the world's timeline.
 */

function world(seed: string, canonMode: string, tick = 0, fixtures = true): WorldState {
  const state = createWorld({
    seed,
    startTick: tick,
    config: { ...DEFAULT_WORLD_CONFIG, canonMode, population: 'none' },
    intro: false,
  });
  if (fixtures) state.flags['dev.fixtures'] = true;
  ensureWorldLayer(state, data);
  return state;
}

function runTo(state: WorldState, tick: number): void {
  advance(
    state,
    data,
    Rng.root(state.seed),
    { kind: 'months', count: tick - state.tick },
    'auto-first',
  );
}

const DUEL_END = 2 * 12 + 6; // the test duel's window closes in June 1488 SC

describe('Done when: a test beat fires ~100% (Canon), ~70% (Probable), under 20% (Random)', () => {
  const rates: Record<string, number> = {};
  for (const mode of ['canon', 'probable', 'random']) {
    it(`fires in ${mode} mode at the expected rate across 100 seeded runs`, () => {
      let fired = 0;
      for (let i = 0; i < 100; i++) {
        const state = world(`rate-${mode}-${i}`, mode);
        runTo(state, DUEL_END);
        const status = beatState(state, 'beat_test_duel').status;
        expect(status, `${mode} ${i}`).not.toBe('pending');
        if (status === 'fired') fired += 1;
      }
      rates[mode] = fired;
      if (mode === 'canon') expect(fired).toBe(100);
      if (mode === 'probable') expect(fired).toBeGreaterThanOrEqual(58);
      if (mode === 'probable') expect(fired).toBeLessThanOrEqual(82);
      if (mode === 'random') expect(fired).toBeLessThan(20);
    });
  }

  it('gets those rates from the beat chance, the window, and the mode multiplier', () => {
    const beat = data.canon['beat_test_duel']!;
    const state = world('chance', 'probable');
    const p = monthlyChance(data, state, beat);
    const months = 6;
    expect(1 - (1 - p) ** months).toBeGreaterThan(0.6);
    expect(1 - (1 - p) ** months).toBeLessThan(0.75);
    state.config.canonMode = 'random';
    const r = monthlyChance(data, state, beat);
    expect(1 - (1 - r) ** months).toBeCloseTo(0.15, 5);
  });
});

describe('Done when: killing a role-holder before a beat cancels or reassigns it', () => {
  it('reassigns the role to the substitute, and logs it', () => {
    const state = world('reassign', 'canon');
    applyAction(
      state,
      data,
      { type: 'debug/killEntity', entityId: 'char_test_captain', cause: 'a test' },
      { debug: true },
    );
    runTo(state, DUEL_END);
    const st = beatState(state, 'beat_test_duel');
    expect(st.status).toBe('fired');
    expect(st.cast?.['captain']).toBe('char_test_mate');
    // The captain's death is an early death (it was not in the story), then the beat recasts.
    expect(state.canon.divergences.map((d) => d.kind)).toEqual(['early-death', 'substituted']);
    // The crew picked a successor too.
    expect(state.entities['org_test_crew']?.org?.leaderId).toBe('char_test_mate');
    expect(
      state.log.some((r) => r.summary.startsWith('Test Mate took command of the Test Crew')),
    ).toBe(true);
  });

  it('cancels it when nobody can stand in, tags the survivors canon-diverged, and logs it', () => {
    const state = world('cancel', 'canon');
    for (const id of ['char_test_captain', 'char_test_mate']) {
      applyAction(
        state,
        data,
        { type: 'debug/killEntity', entityId: id, cause: 'a test' },
        { debug: true },
      );
    }
    runTo(state, DUEL_END);
    expect(beatState(state, 'beat_test_duel').status).toBe('diverged');
    expect(state.entities['char_test_rival']?.origin).toBe('canon-diverged');
    const entry = state.canon.divergences.find((d) => d.beat === 'beat_test_duel');
    expect(entry).toMatchObject({ kind: 'cancelled' });
    expect(entry?.text).toContain('Test Captain was already dead');
    const record = state.log.find((r) => r.seq === entry?.causeSeq);
    expect(record?.tags).toContain('divergence');
    expect(state.flags['test.duel']).toBe(false); // onDiverge ran
    expect(canonView(state, data).divergences[0]?.kind).toBe('cancelled');
  });

  it('waits for a role-holder who is elsewhere, up to six months, then cancels', () => {
    const state = world('away', 'canon');
    runTo(state, 2 * 12 - 1);
    // Send the rival to the far side of the world, where no lane can bring them back in time.
    state.entities['char_test_rival']!.character!.place = 'loc_wano';
    state.entities['char_test_rival']!.origin = 'canon-diverged';
    runTo(state, DUEL_END + 7);
    const st = beatState(state, 'beat_test_duel');
    expect(st.status).toBe('diverged');
    expect(
      state.canon.divergences.some(
        (d) => d.kind === 'cancelled' && d.text.includes('could not get there in time'),
      ),
    ).toBe(true);
  });
});

describe('the story in Canon mode', () => {
  it('happens on its dates: God Valley, the Pirate King executed at Loguetown, Ohara', () => {
    const state = world('canon-dates', 'canon', 17 * 12, false);
    expect(beatState(state, 'beat_god_valley')).toMatchObject({ status: 'fired', tick: 0 });
    expect(beatState(state, 'beat_roger_execution')).toMatchObject({
      status: 'fired',
      tick: 14 * 12 + 5,
    });
    expect(state.entities['char_gol_d_roger']?.character).toMatchObject({
      alive: false,
      death: { cause: 'executed at Loguetown' },
    });
    expect(state.entities['char_rocks_d_xebec']?.character?.alive).toBe(false);
    expect(beatState(state, 'beat_ohara').status).toBe('fired');
    expect(state.entities['loc_ohara']?.place?.controller).toBe('org_world_government');
    expect(state.canon.divergences).toEqual([]);
    expect(WorldStateSchema.safeParse(state).success).toBe(true);
  });

  it('cascades: when the Laugh Tale voyage cannot happen, neither can the crew breaking up after it', () => {
    const state = world('cascade', 'canon', 12 * 12, false);
    applyAction(
      state,
      data,
      { type: 'debug/killEntity', entityId: 'char_silvers_rayleigh', cause: 'a test' },
      { debug: true },
    );
    runTo(state, 14 * 12);
    expect(beatState(state, 'beat_laugh_tale').status).toBe('diverged');
    expect(beatState(state, 'beat_roger_disbands').status).toBe('diverged');
    const kinds = state.canon.divergences.map((d) => `${d.kind}:${d.beat ?? d.entity}`);
    expect(kinds).toContain('early-death:char_silvers_rayleigh');
    expect(kinds).toContain('cancelled:beat_laugh_tale');
    expect(kinds).toContain('requirement:beat_roger_disbands');
    expect(state.entities['char_gol_d_roger']?.origin).toBe('canon-diverged');
  });

  it('notices an early death: the crew picks a successor, the news hears, those tied to them leave the story', () => {
    const state = world('early', 'canon', 20 * 12, false);
    applyAction(
      state,
      data,
      { type: 'debug/killEntity', entityId: 'char_edward_newgate', cause: 'a test' },
      { debug: true },
    );
    expect(state.entities['org_whitebeard_pirates']?.org?.leaderId).toBe('char_marco');
    expect(state.entities['char_marco']?.origin).toBe('canon-diverged');
    expect(state.canon.divergences[0]).toMatchObject({
      kind: 'early-death',
      entity: 'char_edward_newgate',
    });
    runTo(state, 37 * 12);
    // Marineford needed him: it cannot happen as written.
    expect(beatState(state, 'beat_marineford').status).toBe('diverged');
  });
});

describe('the player in the story', () => {
  it('can be there, take part, and stop it', () => {
    const t = startLife({ seed: 'scaffold', entryYear: 13, entryAge: 30 }, data);
    ensureWorldLayer(t.state, t.data);
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    for (const stat of [
      'strength',
      'speed',
      'durability',
      'dexterity',
      'willpower',
      'perception',
    ]) {
      t.player().stats[stat]!.base = 250;
    }
    t.run(14 * 12 + 6 - t.state.tick, 'stop');
    const decision = t.state.pending.find((d) => d.beat && d.eventId === 'beat_roger_execution');
    expect(decision).toBeDefined();
    expect(decision!.choices.map((c) => c.id)).toEqual(['watch', 'cheer', 'storm']);
    t.act({ type: 'decision/resolve', decisionId: decision!.id, choiceId: 'storm' });
    expect(beatState(t.state, 'beat_roger_execution').status).toBe('diverged');
    expect(t.state.canon.divergences.find((d) => d.kind === 'player')).toMatchObject({
      beat: 'beat_roger_execution',
    });
    // And what needed it cannot happen either: the Golden Lion's escape came after it.
    expect(beatState(t.state, 'beat_shiki_escape').status).toBe('diverged');
    expect(t.state.entities['char_gol_d_roger']?.character?.alive).toBe(true);
    expect(t.player().flags['bounty']).toBe(50_000_000);
  });

  it('witnesses a beat at the place it happens', () => {
    const t = startLife({ seed: 'witness', entryYear: 12, entryAge: 30 }, data);
    ensureWorldLayer(t.state, t.data);
    t.act({ type: 'debug/teleport', location: 'loc_sabaody' });
    t.run(13 * 12 + 8 - t.state.tick, 'auto-first');
    const mine = t.state.log.filter((r) => r.knownBy.includes(t.state.playerId!));
    expect(
      mine.some(
        (r) =>
          r.summary ===
          'You were there in Sabaody Archipelago and saw it with your own eyes: The Roger Pirates disband.',
      ),
    ).toBe(true);
    // The beat itself is known to the player who saw it, and to nobody else.
    const beat = t.state.log.find((r) => r.kind === 'canon' && r.cause === 'beat_roger_disbands');
    expect(beat?.knownBy).toEqual([t.state.playerId]);
  });

  it('takes part (and does not stop it) when the beat offers a part but not the power to stop it', () => {
    const t = startLife({ seed: 'crowd', entryYear: 13, entryAge: 30 }, data);
    ensureWorldLayer(t.state, t.data);
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.run(14 * 12 + 6 - t.state.tick, 'stop');
    const decision = t.state.pending.find((d) => d.beat);
    expect(decision?.choices.map((c) => c.id)).toEqual(['watch', 'cheer']);
    t.act({ type: 'decision/resolve', decisionId: decision!.id, choiceId: 'watch' });
    expect(beatState(t.state, 'beat_roger_execution').status).toBe('fired');
    expect(
      t.state.log.some(
        (r) =>
          r.summary ===
          'You were in the thick of it when it happened: The execution of Gol D. Roger.',
      ),
    ).toBe(true);
  });
});

describe('Done when: a 39-year run with no player ends with a readable world timeline', () => {
  it('plays Year 0 to the present with nobody in it, and the timeline reads in order', () => {
    const state = world('timeline', 'canon', 0, false);
    const result = advance(
      state,
      data,
      Rng.root(state.seed),
      { kind: 'months', count: 468 },
      'auto-first',
    );
    expect(['completed', 'present']).toContain(result.stop);
    expect(state.tick).toBe(468);
    const lines = worldTimeline(state, data);
    const canon = lines.filter((l) => l.kind === 'canon');
    expect(canon.length).toBeGreaterThanOrEqual(20);
    const order = ['God Valley', 'scaffold', 'Buster Call', 'Marineford'].map((w) =>
      canon.findIndex((l) => l.text.includes(w)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(lines.filter((l) => l.kind === 'news').length).toBeGreaterThan(100);
    for (const line of lines) expect(line.text, line.date).not.toMatch(/\{|\}|undefined|NaN/);
    expect(lines.every((l, i) => i === 0 || l.tick >= lines[i - 1]!.tick)).toBe(true);
    expect(WorldStateSchema.safeParse(state).success).toBe(true);
  });
});
