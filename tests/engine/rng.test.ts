import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';

const take = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextU32());

describe('Rng: determinism', () => {
  it('gives the same sequence for the same seed', () => {
    expect(take(Rng.root('abc'), 20)).toEqual(take(Rng.root('abc'), 20));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(Rng.root('abc'), 8)).not.toEqual(take(Rng.root('abd'), 8));
  });

  it('is pinned forever: changing these numbers changes every existing world', () => {
    // If this fails you changed the generator or the seeding. That invalidates every seed anyone
    // has shared. Do it only deliberately, with a save-version bump.
    //
    // These vectors were cross-checked against an independent implementation of the published
    // cyrb128 + sfc32 algorithms, so they pin the *algorithm*, not just this file's behaviour.
    expect(take(Rng.root('golden'), 5)).toEqual([
      435144372, 2778290421, 1617271541, 920525259, 443466979,
    ]);
    expect(take(Rng.root('golden').fork('tick', 12, 'rollEvents'), 3)).toEqual([
      3781091364, 3957660671, 1118917075,
    ]);
    expect(take(Rng.root('abc'), 3)).toEqual([914436586, 1012648956, 3435709757]);
  });

  it('rejects empty seeds', () => {
    expect(() => Rng.root('')).toThrow();
  });
});

describe('Rng: keyed streams', () => {
  it('fork is a pure function of the path: same labels, same stream', () => {
    const root = Rng.root('world');
    expect(take(root.fork('a', 1), 6)).toEqual(take(root.fork('a', 1), 6));
  });

  it('different labels give different streams', () => {
    const root = Rng.root('world');
    expect(take(root.fork('a'), 6)).not.toEqual(take(root.fork('b'), 6));
    expect(take(root.fork('a', 1), 6)).not.toEqual(take(root.fork('a', 2), 6));
  });

  it('distinguishes the number 1 from the string "1"', () => {
    const root = Rng.root('world');
    expect(take(root.fork(1), 6)).not.toEqual(take(root.fork('1'), 6));
  });

  it('does not consume the parent: using a child never shifts the parent', () => {
    const a = Rng.root('world');
    const b = Rng.root('world');
    take(a.fork('child'), 100);
    expect(take(a, 5)).toEqual(take(b, 5));
  });

  it('is independent of fork order: adding a system cannot disturb another', () => {
    const root = Rng.root('world');
    const first = take(root.fork('existing'), 6);
    take(root.fork('brand-new-system'), 50);
    expect(take(root.fork('existing'), 6)).toEqual(first);
  });

  it('records its path', () => {
    expect(Rng.root('w').fork('tick', 3, 'x').path).toEqual(['w', 'tick', 3, 'x']);
  });

  it('rejects labels that would make an ambiguous path', () => {
    const root = Rng.root('w');
    expect(() => root.fork(1.5)).toThrow(TypeError);
    expect(() => root.fork(Number.NaN)).toThrow(TypeError);
    expect(() => root.fork({} as never)).toThrow(TypeError);
  });
});

describe('Rng: helpers', () => {
  it('next() stays in [0, 1) and is roughly uniform', () => {
    const rng = Rng.root('uniform');
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('int() is inclusive at both ends and covers the range evenly', () => {
    const rng = Rng.root('ints');
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const v = rng.int(3, 8);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([3, 4, 5, 6, 7, 8]);
    for (const count of counts.values()) expect(Math.abs(count - 10_000)).toBeLessThan(600);
    expect(Rng.root('x').int(5, 5)).toBe(5);
  });

  it('int() rejects bad ranges', () => {
    const rng = Rng.root('x');
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
  });

  it('chance() respects its probability and clamps', () => {
    const rng = Rng.root('chance');
    let hits = 0;
    for (let i = 0; i < 50_000; i++) if (rng.chance(0.3)) hits++;
    expect(hits / 50_000).toBeGreaterThan(0.28);
    expect(hits / 50_000).toBeLessThan(0.32);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(-1)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(2)).toBe(true);
  });

  it('pick() chooses from the list and throws on an empty one', () => {
    const rng = Rng.root('pick');
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('weightedPick() follows weights and never picks zero-weight items', () => {
    const rng = Rng.root('weights');
    const items = [
      { id: 'never', w: 0 },
      { id: 'rare', w: 1 },
      { id: 'common', w: 9 },
    ];
    const counts: Record<string, number> = { never: 0, rare: 0, common: 0 };
    for (let i = 0; i < 20_000; i++) {
      const picked = rng.weightedPick(items, (x) => x.w);
      counts[picked?.id ?? 'none'] = (counts[picked?.id ?? 'none'] ?? 0) + 1;
    }
    expect(counts['never']).toBe(0);
    expect(counts['common']! / 20_000).toBeGreaterThan(0.88);
    expect(counts['common']! / 20_000).toBeLessThan(0.92);
    expect(rng.weightedPick([{ w: 0 }], (x) => x.w)).toBeUndefined();
    expect(rng.weightedPick([], () => 1)).toBeUndefined();
  });

  it('shuffle() is a deterministic permutation', () => {
    const base = Array.from({ length: 20 }, (_, i) => i);
    const a = Rng.root('shuffle').shuffle([...base]);
    const b = Rng.root('shuffle').shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(base);
  });

  it('normal() has about the requested mean and spread, using no transcendental maths', () => {
    const rng = Rng.root('normal');
    const samples = Array.from({ length: 50_000 }, () => rng.normal(100, 15));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(mean).toBeGreaterThan(99.6);
    expect(mean).toBeLessThan(100.4);
    expect(Math.sqrt(variance)).toBeGreaterThan(14.6);
    expect(Math.sqrt(variance)).toBeLessThan(15.4);
  });
});
