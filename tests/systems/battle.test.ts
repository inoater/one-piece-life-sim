import { describe, expect, it } from 'vitest';
import { advance, createWorld } from '../../src/core';
import type { BattleState, Fighter } from '../../src/engine/battle-state';
import type { FightSpec, FoeDef } from '../../src/engine/data/schemas';
import { tickOfWhen } from '../../src/engine/data/defs';
import { Rng } from '../../src/engine/rng';
import { DEFAULT_WORLD_CONFIG, type WorldState } from '../../src/engine/state';
import { decide } from '../../src/systems/battle/ai';
import { applyAftermath } from '../../src/systems/battle/aftermath';
import {
  ctxOf,
  newBattle,
  resolveAbstract,
  runDuel,
  setBonds,
  sidePower,
  winChance,
} from '../../src/systems/battle/battle';
import { canTouch, landBlow } from '../../src/systems/battle/engine';
import { foeFighter } from '../../src/systems/battle/fighters';
import { castPowerAt, tierOf } from '../../src/systems/battle/ladder';
import { beginFight, buildFight } from '../../src/systems/battle/player';
import { runBattle, setBoard } from '../../src/systems/battle/scales';
import { activityFight, partnerMult } from '../../src/systems/battle/spar';
import { combatPowerOf, playerPerson } from '../../src/systems/life/body';
import { relate } from '../../src/systems/life/people';
import { TRAINING_SOURCE } from '../../src/systems/genesis/context';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Phase 5, "Done when": one battle engine for every scale, the Logia rule, the abstract resolver
 * fitted to the tactical engine, injuries and Spare intent, the ladder, NPC fights, the crew
 * battle's board, combinations and taking the blow, and sparring.
 */

const foe = (id: string): FoeDef => data.battle.foes.find((f) => f.id === id) as FoeDef;
const band = { text: 'It is over.', effects: [] };

function spec(over: Partial<FightSpec>): FightSpec {
  return {
    scale: 'duel',
    foes: [{ kind: 'foe', foe: 'foe_thug', count: 1 }],
    mine: 'spare',
    allies: 'none',
    mode: 'quick',
    fronts: [],
    water: false,
    success: band,
    failure: band,
    ...over,
  } as FightSpec;
}

function life(seed: string): TestLife {
  const t = startLife({ seed, entryYear: 30, entryAge: 24 });
  t.run(1);
  return t;
}

function duel(
  a: Fighter,
  b: Fighter,
  id: number,
  seed = 'duel',
  extra: Partial<BattleState> = {},
): BattleState {
  const battle = newBattle(data, {
    id,
    scale: 'duel',
    mode: 'narrated',
    tick: 0,
    place: null,
    fighters: [a, b],
    sides: [a.name, b.name],
    source: { kind: 'debug', id: 'test' },
  });
  Object.assign(battle, extra);
  runDuel(ctxOf({ seed }, data, battle));
  return battle;
}

// ---- One engine, every scale ---------------------------------------------------------------------

describe('Done when: one engine resolves a duel, a skirmish, a crew battle, a naval battle and a war', () => {
  const cases: [string, Partial<FightSpec>][] = [
    ['duel', { scale: 'duel', foes: [{ kind: 'foe', foe: 'foe_thug', count: 1 }] }],
    ['skirmish', { scale: 'skirmish', foes: [{ kind: 'foe', foe: 'foe_pirate', count: 4 }] }],
    [
      'crew',
      {
        scale: 'crew',
        foes: [
          { kind: 'foe', foe: 'foe_pirate_officer', count: 2 },
          { kind: 'foe', foe: 'foe_pirate', count: 40 },
        ],
        allies: 'crew',
      },
    ],
    [
      'naval',
      {
        scale: 'naval',
        foes: [
          { kind: 'foe', foe: 'foe_pirate_captain', count: 1 },
          { kind: 'foe', foe: 'foe_pirate', count: 8 },
        ],
        ship: { vessel: 'vessel_caravel', crew: 12 },
        allies: 'crew',
      },
    ],
    [
      'war',
      {
        scale: 'war',
        foes: [{ kind: 'foe', foe: 'foe_marine_officer', count: 1 }],
        fronts: [
          { name: 'The left', mine: { strength: 200 }, theirs: { strength: 240 } },
          { name: 'The right', mine: { strength: 300 }, theirs: { strength: 260 } },
        ],
      },
    ],
  ];
  for (const [name, over] of cases) {
    it(`a ${name} runs to an end, the same every time from the same seed`, () => {
      const results: string[] = [];
      for (let run = 0; run < 2; run++) {
        const t = life(`scale-${name}`);
        const battle = buildFight(t.state, data, spec(over), {
          tick: t.state.tick,
          place: t.person().c.place ?? null,
          roles: {},
          source: { kind: 'debug', id: `test_${name}` },
        });
        expect(battle.scale).toBe(name);
        runBattle(ctxOf(t.state, data, battle));
        expect(battle.result, name).not.toBeNull();
        expect(battle.log.length).toBeGreaterThan(2);
        results.push(JSON.stringify([battle.result, battle.log.map((l) => l.text)]));
      }
      expect(results[0]).toBe(results[1]);
    });
  }

  it('the winner decides the fate of the beaten: let go, hand over, recruit, rob or kill', () => {
    const t = life('fate');
    // Strong enough to win against a drunk every time.
    for (const stat of Object.values(t.player().stats))
      stat.mods.push({ source: 'test might', value: 150, kind: 'flat' });
    const battle = buildFight(
      t.state,
      data,
      spec({ mode: 'tactical', foes: [{ kind: 'foe', foe: 'foe_drunk', count: 1 }] }),
      {
        tick: t.state.tick,
        place: null,
        roles: {},
        source: { kind: 'debug', id: 'test_fate' },
      },
    );
    beginFight(t.state, data, battle, 'A test fight');
    const play = t.state.pending.find((d) => d.battle)!;
    t.act({ type: 'decision/resolve', decisionId: play.id, choiceId: 'auto' });
    expect(t.state.battle?.result?.how).toBe('won');
    expect(t.state.battle?.card.length).toBeGreaterThan(0);
    const fate = t.state.pending.find((d) => d.battle)!;
    expect(fate.title).toBe('Their fate');
    expect(fate.choices.map((c) => c.id)).toEqual(
      expect.arrayContaining(['let_go', 'rob', 'kill']),
    );
    const before = t.player().character!.berries;
    t.act({ type: 'decision/resolve', decisionId: fate.id, choiceId: 'rob' });
    expect(t.state.battle).toBeNull();
    expect(t.player().character!.berries).toBeGreaterThan(before);
    expect(t.state.log.at(-1)?.summary).toMatch(/went through their pockets/);
  });

  it('a second fight while one is held open plays out by itself', () => {
    const t = life('two-fights');
    const make = (id: string) =>
      buildFight(
        t.state,
        data,
        spec({ mode: 'tactical', foes: [{ kind: 'foe', foe: 'foe_drunk', count: 1 }] }),
        {
          tick: t.state.tick,
          place: null,
          roles: {},
          source: { kind: 'debug', id },
        },
      );
    const first = make('test_first');
    beginFight(t.state, data, first, 'The first');
    const second = make('test_second');
    expect(() => beginFight(t.state, data, second, 'The second')).not.toThrow();
    expect(second.result).not.toBeNull();
    expect(t.state.battle).toBe(first);
    expect(t.state.pending.filter((d) => d.battle)).toHaveLength(1);
  });

  it('a tactical fight holds time still, one exchange per action, and its choice plays the rest out', () => {
    const t = life('tactical');
    const battle = buildFight(
      t.state,
      data,
      spec({ mode: 'tactical', foes: [{ kind: 'foe', foe: 'foe_bandit', count: 1 }] }),
      {
        tick: t.state.tick,
        place: null,
        roles: {},
        source: { kind: 'debug', id: 'test_tactical' },
      },
    );
    beginFight(t.state, data, battle, 'A test fight');
    expect(t.state.battle).not.toBeNull();
    const decision = t.state.pending.find((d) => d.battle);
    expect(decision?.choices[0]?.id).toBe('auto');
    const before = t.state.tick;
    expect(t.run(3, 'stop').stop).toBe('decision');
    expect(t.state.tick).toBe(before);
    t.act({ type: 'battle/act', verb: 'strike', target: 'foe1' });
    expect(t.state.battle?.exchange ?? 99).toBeGreaterThanOrEqual(1);
    // Headless, the decision plays the rest out (and the fate of the beaten, if it comes to that).
    t.run(1, 'auto-first');
    expect(t.state.battle).toBeNull();
    expect(t.state.pending.some((d) => d.battle)).toBe(false);
  });
});

// ---- The Logia rule -------------------------------------------------------------------------------

describe("Done when: a Logia user takes no damage from an unhaki'd attack and full damage from a coated one", () => {
  function pair(): [Fighter, Fighter, Fighter] {
    const a = foeFighter(data, foe('foe_pirate_officer'), Rng.root('logia').fork('a'), {
      id: 'a',
      side: 0,
      intent: 'kill',
    });
    const b = foeFighter(data, foe('foe_pirate_officer'), Rng.root('logia').fork('b'), {
      id: 'b',
      side: 1,
      intent: 'kill',
    });
    const plain = structuredClone(b);
    b.fruit = {
      name: 'Smoke-Smoke Fruit',
      power: 'smoke',
      type: 'logia',
      logia: true,
      tags: ['smoke'],
      weaknesses: ['water'],
    };
    a.armament = 2;
    a.haki = 20;
    return [a, b, plain];
  }

  it('an ordinary blow passes straight through', () => {
    const [a, b] = pair();
    const ctx = {
      battle: newBattle(data, {
        id: 1,
        scale: 'duel',
        mode: 'narrated',
        tick: 0,
        place: null,
        fighters: [a, b],
        sides: ['A', 'B'],
        source: { kind: 'debug', id: 't' },
      }),
      data,
      rng: Rng.root('x'),
    };
    expect(canTouch(ctx, a, b, null)).toBe(false);
    for (let i = 0; i < 20; i++) {
      const blow = landBlow(ctx, a, b, null, 40, Rng.root('blow').fork(i));
      expect(blow.damage).toBe(0);
      expect(blow.blocked).toBe('logia');
    }
    expect(b.hp).toBe(b.maxHp);
  });

  it('coated in Armament, the same blow does what it would to anyone', () => {
    const [a, b, plain] = pair();
    a.status.coated = 3;
    const battle = newBattle(data, {
      id: 1,
      scale: 'duel',
      mode: 'narrated',
      tick: 0,
      place: null,
      fighters: [a, b],
      sides: ['A', 'B'],
      source: { kind: 'debug', id: 't' },
    });
    const ctx = { battle, data, rng: Rng.root('x') };
    expect(canTouch(ctx, a, b, null)).toBe(true);
    for (let i = 0; i < 20; i++) {
      const onLogia = landBlow(ctx, a, structuredClone(b), null, 40, Rng.root('blow').fork(i));
      const onPlain = landBlow(ctx, a, structuredClone(plain), null, 40, Rng.root('blow').fork(i));
      expect(onLogia.damage).toBeGreaterThan(0);
      expect(onLogia.damage).toBe(onPlain.damage);
    }
  });

  it('water, a weakness, or seastone also lands', () => {
    const [a, b] = pair();
    const ctx = {
      battle: newBattle(data, {
        id: 1,
        scale: 'duel',
        mode: 'narrated',
        tick: 0,
        place: null,
        fighters: [a, b],
        sides: ['A', 'B'],
        source: { kind: 'debug', id: 't' },
      }),
      data,
      rng: Rng.root('x'),
    };
    const splash = {
      id: 'w',
      name: 'Water',
      form: 'projectile',
      tags: ['water'],
      effects: [],
      power: 40,
      accuracy: 80,
      cost: 0,
      range: 'near',
      source: 'test',
      signature: false,
      finisher: false,
    };
    expect(canTouch(ctx, a, b, splash)).toBe(true);
    a.seastone = true;
    expect(canTouch(ctx, a, b, null)).toBe(true);
  });
});

// ---- The abstract resolver against the tactical engine ----------------------------------------------

describe('Done when: abstract and tactical resolvers agree within 5 points over 1,000 seeded pairings', () => {
  it('the share each gives the first side, overall and in each band of odds', () => {
    const pool = data.battle.foes.filter(
      (f) => f.id !== 'foe_sea_king' && f.id !== 'foe_pacifista',
    );
    const rows: { p: number; won: number }[] = [];
    for (let i = 0; i < 1000; i++) {
      const rng = Rng.root('pairing').fork(i);
      const a = foeFighter(data, rng.fork('a').pick(pool), rng.fork('A'), {
        id: 'a',
        side: 0,
        intent: 'spare',
      });
      const b = foeFighter(data, rng.fork('b').pick(pool), rng.fork('B'), {
        id: 'b',
        side: 1,
        intent: 'spare',
      });
      const p = winChance(data, sidePower(data, [a], [b]), sidePower(data, [b], [a]));
      const battle = duel(a, b, i + 1, 'pairings');
      rows.push({
        p,
        won: battle.result?.winner === 0 ? 1 : battle.result?.winner === 1 ? 0 : 0.5,
      });
    }
    const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
    const overall = Math.abs(mean(rows.map((r) => r.p)) - mean(rows.map((r) => r.won)));
    expect(overall, 'overall').toBeLessThanOrEqual(0.05);
    for (const [lo, hi] of [
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1.01],
    ] as const) {
      const band = rows.filter((r) => r.p >= lo && r.p < hi);
      if (band.length < 60) continue;
      const gap = Math.abs(mean(band.map((r) => r.p)) - mean(band.map((r) => r.won)));
      expect(gap, `odds ${lo} to ${hi} (${band.length} pairings)`).toBeLessThanOrEqual(0.05);
    }
  }, 120_000);

  it('the same pairing, the same roll: an NPC fight is deterministic', () => {
    const a = foeFighter(data, foe('foe_pirate'), Rng.root('d').fork('a'), {
      id: 'a',
      side: 0,
      intent: 'spare',
    });
    const b = foeFighter(data, foe('foe_marine'), Rng.root('d').fork('b'), {
      id: 'b',
      side: 1,
      intent: 'spare',
    });
    expect(resolveAbstract(data, [a], [b], Rng.root('roll'))).toEqual(
      resolveAbstract(data, [a], [b], Rng.root('roll')),
    );
  });
});

// ---- Injuries, scars and Spare intent ----------------------------------------------------------------

describe('Done when: fights leave Phase 2 injuries and scars, and Spare intent never kills outside field deaths', () => {
  it('a hard fight leaves injuries from violence, and some heal into scars', () => {
    let injuries = 0;
    let scars = 0;
    for (let i = 0; i < 12; i++) {
      const t = life(`wounds-${i}`);
      const battle = buildFight(
        t.state,
        data,
        spec({ foes: [{ kind: 'foe', foe: 'foe_pirate_captain', count: 1 }], intent: 'spare' }),
        {
          tick: t.state.tick,
          place: null,
          roles: {},
          source: { kind: 'debug', id: 'test_wounds' },
        },
      );
      runBattle(ctxOf(t.state, data, battle));
      applyAftermath(t.state, data, battle, t.state.tick, []);
      const hurt = t.life().injuries.filter((x) => x.cause === 'violence');
      injuries += hurt.length;
      const before = t.player().character!.scars.length;
      t.run(18);
      scars += t.player().character!.scars.length - before;
    }
    expect(injuries).toBeGreaterThan(5);
    expect(scars).toBeGreaterThan(0);
  }, 120_000);

  it('a thousand fights where both sides mean to spare kill nobody on land', () => {
    const pool = data.battle.foes;
    let deaths = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = Rng.root('spare').fork(i);
      const a = foeFighter(data, rng.fork('a').pick(pool), rng.fork('A'), {
        id: 'a',
        side: 0,
        intent: 'spare',
      });
      const b = foeFighter(data, rng.fork('b').pick(pool), rng.fork('B'), {
        id: 'b',
        side: 1,
        intent: 'spare',
      });
      const battle = duel(a, b, i + 1, 'spare');
      deaths += battle.fighters.filter((f) => f.down === 'dead').length;
    }
    expect(deaths).toBe(0);
  }, 60_000);

  it('in the water, a fruit user who falls with nobody to dive in drowns (a field death), Spare or not', () => {
    let drowned = 0;
    let rescued = 0;
    for (let i = 0; i < 200; i++) {
      const rng = Rng.root('water').fork(i);
      const a = foeFighter(data, foe('foe_pirate_officer'), rng.fork('A'), {
        id: 'a',
        side: 0,
        intent: 'spare',
        cp: 900,
      });
      const b = foeFighter(data, foe('foe_pirate'), rng.fork('B'), {
        id: 'b',
        side: 1,
        intent: 'spare',
        cp: 300,
      });
      b.fruit = {
        name: 'Test Fruit',
        power: 'test',
        type: 'paramecia',
        logia: false,
        tags: [],
        weaknesses: [],
      };
      const battle = duel(a, b, i + 1, 'water', { water: true } as Partial<BattleState>);
      if (b.down === 'dead') drowned += 1;
      if (battle.log.some((l) => l.text.includes('dives in'))) rescued += 1;
      if (b.down === 'dead')
        expect(battle.log.some((l) => l.text.includes('sea takes'))).toBe(true);
    }
    expect(drowned).toBeGreaterThan(0);
    expect(rescued).toBe(0);
  }, 60_000);
});

// ---- The ladder ------------------------------------------------------------------------------------

describe("Done when: every canon cast member's Combat Power keyframes place them on the ladder for their era", () => {
  it('at every rung change and every year, each living cast member stands on the rung the data gives', () => {
    const state: WorldState = createWorld({
      seed: 'ladder',
      config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'none' },
      intro: false,
    });
    ensureWorldLayer(state, data);
    const checks = new Set<number>();
    for (let y = 0; y <= 38; y++) checks.add(y * 12 + 6);
    for (const cast of Object.values(data.cast))
      for (const k of cast.power) checks.add(tickOfWhen(k.from) + 1);
    const ticks = [...checks]
      .filter((t) => t > 0 && t < data.calendar.presentTick)
      .sort((a, b) => a - b);
    let checked = 0;
    const misses: string[] = [];
    for (const tick of ticks) {
      advance(
        state,
        data,
        Rng.root('ladder'),
        { kind: 'months', count: tick - state.tick },
        'auto-first',
      );
      for (const cast of Object.values(data.cast)) {
        const entity = state.entities[cast.id];
        if (!entity?.character?.alive || cast.dev) continue;
        const key = castPowerAt(cast, state.tick - 1);
        if (!key) continue;
        const cp = combatPowerOf(data, entity, state.tick - 1);
        checked += 1;
        if (tierOf(data, cp).id !== key.tier)
          misses.push(
            `${cast.name} in ${1486 + Math.floor((state.tick - 1) / 12)} SC: ${cp} is not ${key.tier}`,
          );
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(misses).toEqual([]);
  }, 120_000);

  it('the ladder runs from townsfolk to the strongest of an era', () => {
    expect(tierOf(data, 100).id).toBe('civilian');
    expect(tierOf(data, 250).id).toBe('thug');
    expect(tierOf(data, 800).id).toBe('captain');
    expect(tierOf(data, 3000).id).toBe('commander');
    expect(tierOf(data, 12000).id).toBe('peak');
  });
});

// ---- NPC fights -------------------------------------------------------------------------------------

describe('Done when: a 39-year world logs at least 200 NPC fights with readable reasons', () => {
  it('Tier 2 people hunt pirates, raid towns and settle scores by the same rules, each with a reason', () => {
    const state = createWorld({
      seed: 'npc-fights',
      config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'full' },
      intro: false,
    });
    ensureWorldLayer(state, data);
    advance(state, data, Rng.root('npc-fights'), { kind: 'months', count: 39 * 12 }, 'auto-first');
    const fights = state.log.filter((r) => r.tags.includes('fight') && r.tags.includes('npc'));
    expect(fights.length).toBeGreaterThanOrEqual(200);
    const reasons = /went after|came to blows|raided|met trouble|stood against/;
    for (const f of fights) {
      expect(f.summary, f.summary).toMatch(reasons);
      expect(f.summary).not.toMatch(/\{|\}|undefined/);
    }
    const kinds = new Set(
      fights.flatMap((f) => f.tags.filter((t) => ['hunt', 'quarrel', 'raid', 'sea'].includes(t))),
    );
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['hunt', 'quarrel']));
  }, 180_000);
});

// ---- The crew battle's board, combinations and taking the blow ----------------------------------------

describe('Done when: a crew battle runs from the match-up board, with a combination attack and a member taking a blow for a friend', () => {
  function crew(seed: number): BattleState {
    const rng = Rng.root('crew').fork(seed);
    const mine = [0, 1, 2, 3].map((i) =>
      foeFighter(data, foe('foe_pirate_officer'), rng.fork('m', i), {
        id: `m${i}`,
        side: 0,
        intent: 'spare',
        cp: 520,
        name: `Mate ${i + 1}`,
        leader: i === 0,
      }),
    );
    const theirs = [0, 1, 2].map((i) =>
      foeFighter(data, foe('foe_pirate_officer'), rng.fork('t', i), {
        id: `t${i}`,
        side: 1,
        intent: 'capture',
        cp: 600,
        name: `Raider ${i + 1}`,
        leader: i === 0,
      }),
    );
    // Bound crewmates, with moves that fit together.
    for (const f of mine) {
      f.moves.push({
        id: `tech_blow_${f.id}`,
        name: `${f.name}'s Blow`,
        form: 'strike',
        tags: ['blunt'],
        effects: [],
        power: 40,
        accuracy: 75,
        cost: 2,
        range: 'melee',
        source: 'test',
        signature: false,
        finisher: false,
      });
      for (const g of mine) if (g.id !== f.id) f.bonds[g.id] = 90;
    }
    const battle = newBattle(data, {
      id: seed + 1,
      scale: 'crew',
      mode: 'narrated',
      tick: 0,
      place: null,
      fighters: [...mine, ...theirs],
      sides: ['The crew', 'The raiders'],
      source: { kind: 'debug', id: 'crew' },
      ranks: [30, 30],
      rankPower: [200, 220],
    });
    setBonds({ seed: 'crew', entities: {} } as unknown as WorldState, data, battle, 0);
    // The board: two of ours on their captain, one each on the others; the fourth to the fronts.
    setBoard(battle, [
      ['m0', 't0'],
      ['m1', 't1'],
      ['m2', 't2'],
    ]);
    battle.sides[0].order = 'combo';
    return battle;
  }

  it('the board pairs the duels; combinations, interposed blows and the fronts all happen', () => {
    let combos = 0;
    let shields = 0;
    let ended = 0;
    for (let s = 0; s < 12; s++) {
      const battle = crew(s);
      expect(battle.board).toHaveLength(3);
      expect(battle.fighters.find((f) => f.id === 'm3')?.front).toBe(true);
      const ctx = ctxOf({ seed: `crew-${s}` }, data, battle);
      runBattle(ctx, (c, f, r) => {
        // Keep the side's order to strike as one every few exchanges.
        if (f.side === 0 && c.battle.exchange % 3 === 0) c.battle.sides[0].order = 'combo';
        return decide(c, f, r);
      });
      if (battle.result) ended += 1;
      if (battle.log.some((l) => / strike as one: /.test(l.text))) combos += 1;
      if (battle.log.some((l) => /throws themselves in front of the blow meant for/.test(l.text)))
        shields += 1;
      expect(battle.round).toBeGreaterThan(0);
    }
    expect(ended).toBe(12);
    expect(combos).toBeGreaterThan(0);
    expect(shields).toBeGreaterThan(0);
  }, 60_000);
});

// ---- Sparring ---------------------------------------------------------------------------------------

describe('Done when: a thousand seeded spars kill nobody and train faster against stronger partners', () => {
  it('a thousand spars of every kind of partner: nobody dies', () => {
    const pool = data.battle.foes;
    let deaths = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = Rng.root('spars').fork(i);
      const a = foeFighter(data, rng.fork('a').pick(pool), rng.fork('A'), {
        id: 'a',
        side: 0,
        intent: 'spare',
      });
      const b = foeFighter(data, rng.fork('b').pick(pool), rng.fork('B'), {
        id: 'b',
        side: 1,
        intent: 'spare',
      });
      if (rng.fork('fruit').chance(0.3))
        b.fruit = {
          name: 'Test Fruit',
          power: 'test',
          type: 'paramecia',
          logia: false,
          tags: [],
          weaknesses: [],
        };
      const battle = duel(a, b, i + 1, 'spar', {
        spar: true,
        stop: (['first_hit', 'first_knockdown', 'time_limit', 'yield'] as const)[i % 4],
        water: i % 5 === 0,
      } as Partial<BattleState>);
      deaths += battle.fighters.filter((f) => f.down === 'dead').length;
      expect(battle.result).not.toBeNull();
    }
    expect(deaths).toBe(0);
  }, 60_000);

  it('the player sparring month after month never dies of it', () => {
    const t = life('spar-life');
    const env = t.env('spar');
    const act = data.activities['act_spar']!;
    for (let i = 0; i < 60; i++) {
      const fought = activityFight(
        { ...env, rng: Rng.root('spar-life').fork(i) },
        act,
        Rng.root('spar-life').fork('f', i),
      );
      expect(fought).not.toBeNull();
      expect(t.player().character?.alive).toBe(true);
    }
    expect(t.player().character?.fights?.spars).toBe(60);
  });

  it('a stronger partner trains more: x2 at 20% stronger, and little from a much weaker one', () => {
    expect(partnerMult(data, 100, 120)).toBe(2);
    expect(partnerMult(data, 100, 150)).toBe(2);
    expect(partnerMult(data, 100, 110)).toBeCloseTo(1.5, 6);
    expect(partnerMult(data, 100, 100)).toBe(1);
    expect(partnerMult(data, 100, 70)).toBeLessThan(0.5);
    expect(partnerMult(data, 100, 10)).toBe(data.battle.spar.partner.floor);
  });

  it('a year of sparring with a strong mentor builds more than a year with a weak one', () => {
    const gained = (strong: boolean) => {
      const t = life('mentor');
      const p = t.person();
      // A mentor with a body like the player's own, made stronger or weaker.
      const m = structuredClone(p.entity);
      m.id = 'char_test_mentor_x';
      m.name = 'Test Mentor';
      delete m.character!.life;
      delete m.character!.powers;
      m.character!.relationships = [];
      m.character!.place = p.c.place;
      m.character!.birthTick = p.c.birthTick - 12 * 10;
      for (const [id, stat] of Object.entries(m.stats)) {
        if (id === 'fame' || id === 'infamy' || id === 'luck') continue;
        stat.base = strong ? 140 : 15;
        stat.mods = [];
      }
      t.state.entities[m.id] = m;
      p.c.relationships = p.c.relationships.filter(
        (r) => r.kind !== 'mentor' && r.kind !== 'rival' && r.kind !== 'friend',
      );
      relate(m, p.entity, 'protege', 70, t.state.tick, Rng.root('rel'));
      // What training added (injuries from a hard partner lower stats only for a while).
      const trained = () =>
        Object.values(playerPerson(t.state, data)!.entity.stats).reduce(
          (n, stat) =>
            n +
            stat.mods.filter((x) => x.source === TRAINING_SOURCE).reduce((a, x) => a + x.value, 0),
          0,
        );
      const before = trained();
      t.act({ type: 'life/routine', routine: [{ activity: 'act_spar', effort: 'normal' }] });
      t.run(12);
      return trained() - before;
    };
    expect(gained(true)).toBeGreaterThan(gained(false));
  }, 60_000);
});
