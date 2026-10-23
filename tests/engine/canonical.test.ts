import { describe, expect, it } from 'vitest';
import { canonicalize, CanonicalError, hashValue } from '../../src/engine/canonical';
import { hashText } from '../../src/engine/hash';

describe('hash', () => {
  it('is pinned (vectors from an independent cyrb128 implementation)', () => {
    expect(hashText('')).toBe('027ae52ecfc796215593990d4b41437c');
    expect(hashText('abc')).toBe('4664cddf317f7918ec487c9f600d8b09');
  });

  it('returns 32 hex characters and changes with a single character', () => {
    expect(hashText('hello')).toMatch(/^[0-9a-f]{32}$/);
    expect(hashText('hello')).not.toBe(hashText('hellp'));
  });
});

describe('canonicalize', () => {
  it('sorts keys at every depth, so insertion order never matters', () => {
    const a = { b: 1, a: { y: [1, 2], x: true } };
    const b = { a: { x: true, y: [1, 2] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"x":true,"y":[1,2]},"b":1}');
  });

  it('is pinned (vector from an independent implementation)', () => {
    expect(canonicalize({ b: 1, a: [1, 2, { c: null }] })).toBe('{"a":[1,2,{"c":null}],"b":1}');
    expect(hashValue({ b: 1, a: [1, 2, { c: null }] })).toBe('7e02127029ea5812caac392974c8475c');
  });

  it('keeps array order and skips undefined object properties like JSON.stringify', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('writes strings with proper escapes', () => {
    expect(canonicalize('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it('refuses values that would silently change meaning when saved', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(CanonicalError);
    expect(() => canonicalize({ x: Infinity })).toThrow(CanonicalError);
    expect(() => canonicalize([1, undefined])).toThrow(CanonicalError);
    expect(() => canonicalize({ m: new Map() })).toThrow(CanonicalError);
    expect(() => canonicalize({ s: new Set() })).toThrow(CanonicalError);
    expect(() => canonicalize({ d: new Date(0) })).toThrow(CanonicalError);
    expect(() => canonicalize({ f: () => 1 })).toThrow(CanonicalError);
    expect(() => canonicalize({ b: 10n })).toThrow(CanonicalError);
    expect(() => canonicalize(Symbol('x'))).toThrow(CanonicalError);
    class Thing {
      x = 1;
    }
    expect(() => canonicalize({ t: new Thing() })).toThrow(CanonicalError);
  });

  it('names the path to the offending value', () => {
    try {
      canonicalize({ entities: { gen_000001: { stats: { strength: { base: Number.NaN } } } } });
      expect.unreachable();
    } catch (error) {
      expect((error as CanonicalError).path).toBe('entities.gen_000001.stats.strength.base');
      expect((error as Error).message).toContain('Non-finite number');
    }
    try {
      canonicalize({ list: [1, 2, undefined] });
      expect.unreachable();
    } catch (error) {
      expect((error as CanonicalError).path).toBe('list[2]');
    }
  });

  it('survives a JSON round trip and a structuredClone with the same hash (what saving relies on)', () => {
    const value = {
      n: 0.1 + 0.2,
      big: 1e21,
      neg: -3.5,
      list: [{ a: 'x' }],
      flag: false,
      nothing: null,
    };
    expect(hashValue(JSON.parse(JSON.stringify(value)))).toBe(hashValue(value));
    expect(hashValue(structuredClone(value))).toBe(hashValue(value));
  });

  it('treats -0 like 0, as JSON does', () => {
    expect(canonicalize({ x: -0 })).toBe(canonicalize({ x: 0 }));
  });

  it('rejects absurd nesting rather than overflowing the stack', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 400; i++) deep = [deep];
    expect(() => canonicalize(deep)).toThrow(CanonicalError);
  });
});
