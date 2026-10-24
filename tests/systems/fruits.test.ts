import { describe, expect, it } from 'vitest';
import { advance, createWorld, Rng } from '../../src/core';
import { applyLifeEffect } from '../../src/systems/life/effects';
import { moveLock } from '../../src/systems/powers/techniques';
import { FruitDefSchema } from '../../src/engine/data/schemas';
import { DEFAULT_WORLD_CONFIG, type Entity, type WorldState } from '../../src/engine/state';
import { statValue } from '../../src/engine/stats';
import { playerPerson } from '../../src/systems/life/body';
import { continueOptions } from '../../src/systems/life/death';
import type { LifeEnv } from '../../src/systems/life/env';
import { giveTraitTo } from '../../src/systems/life/traits';
import { lanesFrom } from '../../src/systems/places/graph';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { canonIndex, fruitDefOf, generateFruit } from '../../src/systems/powers/catalogue';
import { cursedNow, eatenFruit, findFruit, fruitEntities } from '../../src/systems/powers/fruits';
import { overboard, setSail } from '../../src/systems/voyage/sea';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Phase 4, "Done when", for Devil Fruits:
 *  - every canon fruit and 1,000 generated fruits validate; no generated fruit takes a canon power;
 *  - a fruit user's death puts the fruit back into the world, and a 39-year run never has two
 *    copies of one fruit;
 *  - a fruit user overboard drowns without a rescuer and lives with one, in seeded tests.
 */

function env(t: TestLife, label = 'fruit'): LifeEnv {
  const p = playerPerson(t.state, data)!;
  return {
    state: t.state,
    data,
    tick: t.state.tick,
    rng: Rng.root(label).fork(t.state.tick),
    p,
    life: p.c.life!,
    cause: `test:${label}`,
  };
}

function life(seed: string, over: Record<string, unknown> = {}): TestLife {
  const t = startLife({ seed, entryYear: 30, entryAge: 22, ...over });
  t.run(1);
  return t;
}

/** Give the player a fruit and eat it (identified, so discovery does not get in the way). */
function eatOne(t: TestLife, fruitId?: string): Entity {
  const fruit = findFruit(env(t, 'find'), fruitId ? { fruit: fruitId } : {})!;
  t.player().character!.powers!.known[fruit.id]!.identified = true;
  t.act({ type: 'powers/eat', fruit: fruit.id });
  return fruit;
}

describe('Done when: every canon fruit and 1,000 generated fruits validate', () => {
  it('the canon catalogue validates, one power to a fruit', () => {
    const fruits = Object.values(data.fruits);
    expect(fruits.length).toBeGreaterThanOrEqual(130);
    const powers = new Set<string>();
    for (const fruit of fruits) {
      expect(FruitDefSchema.safeParse(fruit).success, fruit.id).toBe(true);
      expect(powers.has(fruit.power), fruit.power).toBe(false);
      powers.add(fruit.power);
      expect(fruit.techniques.length, `${fruit.id} techniques`).toBeGreaterThan(0);
    }
    for (const type of ['paramecia', 'zoan', 'logia'] as const) {
      expect(fruits.some((f) => f.type === type)).toBe(true);
    }
    for (const kind of ['regular', 'ancient', 'mythical', 'artificial'] as const) {
      expect(
        fruits.some((f) => f.zoan === kind),
        kind,
      ).toBe(true);
    }
  });

  it('1,000 generated fruits validate, and none takes a canon power or name', () => {
    const canon = canonIndex(data);
    const names = new Set<string>();
    for (let world = 0; world < 34; world++) {
      // One world's worth at a time (about thirty): within a world no power repeats either.
      const taken = new Set<string>(canon.powers);
      for (let i = 0; i < 30 && world * 30 + i < 1000; i++) {
        const n = world * 30 + i;
        const def = generateFruit(data, Rng.root('generated').fork(n), {
          id: `fruit_gen_${String(n).padStart(6, '0')}`,
          taken,
        });
        expect(FruitDefSchema.safeParse(def).success, def.id).toBe(true);
        expect(canon.powers.has(def.power), def.power).toBe(false);
        expect(canon.names.has(def.name.toLowerCase()), def.name).toBe(false);
        expect(canon.words.has((def.name.split(/[- ]/)[0] ?? '').toLowerCase()), def.name).toBe(
          false,
        );
        expect(def.techniques.length).toBeGreaterThanOrEqual(data.powers.generator.techniques.min);
        expect(def.techniques.length).toBeLessThanOrEqual(data.powers.generator.techniques.max);
        expect(def.origin).toBe('generated');
        names.add(def.name);
      }
      expect(taken.size).toBe(canon.powers.size + Math.min(30, 1000 - world * 30));
    }
    expect(names.size).toBeGreaterThan(80);
  });
});

describe('Done when: one fruit, one world', () => {
  it('a 39-year world never holds two copies of a fruit, and every user is who the fruit says', () => {
    const state: WorldState = createWorld({
      seed: 'one-fruit',
      startTick: 0,
      config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'full' },
      intro: false,
    });
    ensureWorldLayer(state, data);
    let released = 0;
    for (let year = 0; year < 39; year++) {
      advance(state, data, Rng.root(state.seed), { kind: 'months', count: 12 }, 'auto-first');
      const powers = new Set<string>();
      for (const fruit of fruitEntities(state)) {
        const def = fruitDefOf(data, fruit)!;
        expect(powers.has(def.power), `${def.name} twice in ${1486 + year}`).toBe(false);
        powers.add(def.power);
        const f = fruit.fruit!;
        if (f.userId) {
          const user = state.entities[f.userId];
          expect(
            [user?.flags['fruit'], user?.flags['fruit.first']],
            `${def.name}'s user`,
          ).toContain(fruit.id);
          if (user?.character)
            expect(user.character.alive, `${def.name}'s user is alive`).toBe(true);
        }
        if (f.container === 'eaten') expect(f.userId !== null || f.userName !== null).toBe(true);
      }
      // Nobody alive holds two (but the canon anomaly).
      const users = new Map<string, number>();
      for (const fruit of fruitEntities(state))
        if (fruit.fruit?.userId)
          users.set(fruit.fruit.userId, (users.get(fruit.fruit.userId) ?? 0) + 1);
      for (const [id, n] of users) {
        if (n > 1)
          expect(state.entities[id]?.character?.traits, id).toContain('trait_anomalous_body');
      }
    }
    released = state.log.filter(
      (r) => r.tags.includes('fruit') && r.summary.includes('returned to the world'),
    ).length;
    expect(released).toBeGreaterThan(0);
    // The story's own handovers: Whitebeard's quake fruit went to Blackbeard after Marineford.
    expect(state.entities['fruit_gura_gura']?.fruit?.userId).toBe('char_marshall_d_teach');
    expect(state.entities['fruit_gomu_gomu']?.fruit?.userId).toBe('char_monkey_d_luffy');
  }, 240_000);

  it("a fruit user's death puts the fruit back into the world, where nobody knows it is", () => {
    const t = life('fruit-death', { entryYear: 36 });
    const fruit = t.state.entities['fruit_suna_suna']!;
    expect(fruit.fruit?.userId).toBe('char_crocodile');
    t.act({ type: 'debug/killEntity', entityId: 'char_crocodile', cause: 'a test' });
    expect(fruit.fruit?.container).toBe('tree');
    expect(fruit.fruit?.userId).toBeNull();
    expect(fruit.fruit?.place).toBeTruthy();
    expect(fruit.knownBy).toEqual([]);
    expect(t.state.entities['char_crocodile']?.flags['fruit']).toBeUndefined();
    expect(fruit.fruit?.history.at(-1)?.text).toContain('Crocodile died');
  });

  it("the player's own death returns their fruit; a carried fruit passes to the heir", () => {
    const t = life('fruit-heir');
    const eaten = eatOne(t);
    const carried = findFruit(env(t, 'carry'), {})!;
    expect(carried.fruit?.holderId).toBe(t.player().id);
    t.act({ type: 'debug/kill', cause: 'a test' });
    expect(eaten.fruit?.container).toBe('tree');
    expect(eaten.fruit?.userId).toBeNull();
    const options = t.state.entities[t.state.playerId as string]!;
    expect(options.character?.alive).toBe(false);
    // Someone who inherits (an heir, a protégé, a crewmate, a sibling); a newborn stranger inherits nothing.
    const option = continueOptions(t.state, data).find((o) => o.available && o.inherits);
    expect(option, 'someone to inherit').toBeDefined();
    t.act({
      type: 'life/continue',
      mode: option!.id,
      ...(option!.candidates[0] ? { targetId: option!.candidates[0].id } : {}),
    });
    const heir = t.player();
    expect(carried.fruit?.holderId).toBe(heir.id);
    expect(heir.character?.powers?.items).toContain(carried.id);
  });
});

describe('Done when: a fruit user overboard drowns without a rescuer and lives with one', () => {
  function atSea(seed: string, crew: number): TestLife {
    const t = life(seed);
    eatOne(t);
    const lane = lanesFrom(data, playerPerson(t.state, data)!.place.id).find((e) => !e.lane.land)!;
    setSail(env(t, 'sail'), lane.lane.id, 'passenger');
    const voyage = t.player().character!.travel!.voyage!;
    voyage.vessel!.crew = crew;
    return t;
  }

  for (const seed of ['sea-1', 'sea-2', 'sea-3', 'sea-4', 'sea-5']) {
    it(`${seed}: alone, the sea takes them`, () => {
      const t = atSea(seed, 0);
      overboard(env(t, 'over'));
      expect(t.player().character?.alive).toBe(false);
      expect(t.player().character?.death?.cause).toContain('drowned');
    });
    it(`${seed}: with hands aboard, someone dives after them`, () => {
      const t = atSea(seed, 6);
      overboard(env(t, 'over'));
      expect(t.player().character?.alive).toBe(true);
      expect(t.state.log.some((r) => r.summary.includes('dove after you'))).toBe(true);
    });
  }

  it('anyone else overboard still gets the Phase 3 swimming roll', () => {
    const t = life('sea-nonuser');
    const lane = lanesFrom(data, playerPerson(t.state, data)!.place.id).find((e) => !e.lane.land)!;
    setSail(env(t, 'sail'), lane.lane.id, 'passenger');
    t.player().character!.travel!.voyage!.vessel!.crew = 0;
    overboard(env(t, 'over'));
    expect(t.state.log.some((r) => r.summary.includes('dove after you'))).toBe(false);
  });
});

describe('the curse, eating and knowing', () => {
  it('in sea water a fruit user loses 90% of every stat, and their power, until it lets go', () => {
    const t = life('curse');
    eatOne(t, 'fruit_mera_mera');
    const tick = t.state.tick;
    const p = t.player();
    const before = statValue(p.stats['strength']!, tick);
    // An event's "immerse" effect: a month in the sea.
    applyLifeEffect(env(t, 'curse'), { kind: 'immerse', months: 1 }, { cast: {} });
    expect(statValue(p.stats['strength']!, tick)).toBeCloseTo(before * 0.1, 5);
    expect(cursedNow(p, tick)).toBe(true);
    const hiken = p.character!.powers!.moves.find((m) => m.id === 'tech_mera_mera_hiken')!;
    expect(moveLock(data, p, hiken, tick)).toContain('sea');
    expect(statValue(p.stats['strength']!, tick + 1)).toBeCloseTo(before, 5);
    // Someone without a fruit is untouched by it.
    const u = life('no-curse');
    const s = statValue(u.player().stats['strength']!, u.state.tick);
    applyLifeEffect(env(u, 'curse'), { kind: 'immerse', months: 1 }, { cast: {} });
    expect(statValue(u.player().stats['strength']!, u.state.tick)).toBeCloseTo(s, 5);
  });

  it('a second fruit kills; the canon anomaly can hold two', () => {
    const t = life('second');
    eatOne(t);
    eatOne(t);
    expect(t.player().character?.alive).toBe(false);
    expect(t.player().character?.death?.cause).toContain('second Devil Fruit');

    const u = life('anomaly');
    giveTraitTo(data, u.player(), 'trait_anomalous_body', 'test', u.state.tick);
    const first = eatOne(u);
    const second = eatOne(u);
    expect(u.player().character?.alive).toBe(true);
    expect(first.fruit?.userId).toBe(u.player().id);
    expect(second.fruit?.userId).toBe(u.player().id);
  });

  it('an unknown fruit shows what it is over 1 to 6 months; a scholar or the encyclopedia names it at once', () => {
    const t = life('discover');
    const fruit = findFruit(env(t, 'find'), {})!;
    t.act({ type: 'powers/eat', fruit: fruit.id });
    const record = t.player().character!.powers!.fruit!;
    expect(record.identified).toBe(false);
    const due = record.knownAt!;
    expect(due - t.state.tick).toBeGreaterThanOrEqual(data.powers.fruit.discoveryMonths.min);
    expect(due - t.state.tick).toBeLessThanOrEqual(data.powers.fruit.discoveryMonths.max);
    t.run(due - t.state.tick + 1);
    expect(t.player().character!.powers!.fruit!.identified).toBe(true);

    const u = life('scholar');
    const held = findFruit(env(u, 'find'), {})!;
    u.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    u.player().character!.berries = 10_000_000;
    u.act({ type: 'powers/identify', fruit: held.id, how: 'scholar' });
    expect(u.player().character!.powers!.known[held.id]?.identified).toBe(true);
    u.act({ type: 'powers/buyEncyclopedia' });
    const another = findFruit(env(u, 'find2'), {})!;
    u.act({ type: 'powers/identify', fruit: another.id, how: 'encyclopedia' });
    expect(u.player().character!.powers!.known[another.id]?.identified).toBe(true);
  });

  it('eating gives the type track, the curse trait and the first techniques; the moves show on the sheet', () => {
    const t = life('eat');
    const fruit = eatOne(t, 'fruit_mera_mera');
    expect(eatenFruit(t.state, t.player())?.id).toBe(fruit.id);
    const c = t.player().character!;
    expect(c.traits).toContain('trait_devil_fruit_user');
    expect(c.powers?.tracks['track_logia']).toBeDefined();
    expect(c.powers?.moves.some((m) => m.id === 'tech_mera_mera_hiken')).toBe(true);
    const view = t.state.entities[fruit.id]!;
    expect(view.fruit?.history.at(-1)?.text).toContain('ate it');
  });

  it('the black market sells fruits for 100 million Berries and up', () => {
    const t = life('market');
    const fruit = fruitEntities(t.state).find((e) => e.fruit?.container === 'tree')!;
    fruit.fruit!.container = 'market';
    fruit.fruit!.place = 'loc_loguetown';
    fruit.fruit!.price = 120_000_000;
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.player().character!.berries = 200_000_000;
    t.act({ type: 'powers/buyFruit', fruit: fruit.id });
    expect(fruit.fruit?.holderId).toBe(t.player().id);
    expect(t.player().character!.berries).toBe(80_000_000);
    for (const range of Object.values(data.powers.fruit.prices))
      expect(range.min).toBeGreaterThanOrEqual(100_000_000);
  });

  it('objects and animals with a body can hold a fruit (Lassoo, Funkfreed)', () => {
    const t = life('bodies', { entryYear: 34 });
    const lassoo = t.state.entities['item_lassoo']!;
    expect(lassoo.type).toBe('item');
    expect(lassoo.flags['body']).toBe(true);
    expect(eatenFruit(t.state, lassoo)?.id).toBe('fruit_inu_inu_dachshund');
  });
});

describe('matchups live in data (Phase 5 reads them)', () => {
  it('rubber against lightning, magma against fire, sand against water', () => {
    const pairs = data.matchups.pairs;
    expect(
      pairs.some(
        (p) =>
          p.attacker === 'tag:lightning' && p.defender === 'power:rubber' && p.result === 'immune',
      ),
    ).toBe(true);
    expect(
      pairs.some(
        (p) => p.attacker === 'power:magma' && p.defender === 'power:fire' && p.result === 'wins',
      ),
    ).toBe(true);
    expect(
      pairs.some(
        (p) =>
          p.attacker === 'tag:water' && p.defender === 'power:sand' && p.result === 'solidifies',
      ),
    ).toBe(true);
  });
});
