import { describe, expect, it } from 'vitest';
import { dexp, dlog, dpow, ipow } from '../../src/engine/dmath';

const relativeError = (actual: number, expected: number) =>
  expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected);

describe('dmath: deterministic exp, log and pow', () => {
  it('dexp matches Math.exp to well under game precision across its domain', () => {
    for (let x = -700; x <= 700; x += 0.731) {
      expect(relativeError(dexp(x), Math.exp(x))).toBeLessThan(1e-13);
    }
    expect(dexp(0)).toBe(1);
  });

  it('dlog matches Math.log across many magnitudes, including subnormals', () => {
    for (const x of [
      5e-324,
      1e-310,
      1e-100,
      1e-10,
      0.1,
      0.5,
      0.999,
      1.001,
      2,
      Math.E,
      10,
      1e6,
      1e100,
      1e300,
    ]) {
      expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(Math.log(x))),
      );
    }
    expect(dlog(1)).toBe(0);
  });

  it('dlog and dexp are inverses', () => {
    for (const x of [0.01, 0.5, 1, 3.7, 123.456, 1e5]) {
      expect(relativeError(dexp(dlog(x)), x)).toBeLessThan(1e-13);
    }
  });

  it('dpow matches Math.pow for positive bases', () => {
    for (const [x, y] of [
      [2, 10],
      [10, -3],
      [0.5, 4.2],
      [1.07, 39],
      [3, 0.5],
    ] as const) {
      expect(relativeError(dpow(x, y), Math.pow(x, y))).toBeLessThan(1e-12);
    }
    expect(dpow(0, 2)).toBe(0);
  });

  it('ipow is exact repeated multiplication', () => {
    expect(ipow(2, 10)).toBe(1024);
    expect(ipow(7, 0)).toBe(1);
    expect(ipow(1.5, 3)).toBe(3.375);
    expect(ipow(-2, 3)).toBe(-8);
  });

  it('rejects inputs outside the supported domain instead of returning garbage', () => {
    expect(() => dexp(701)).toThrow(RangeError);
    expect(() => dexp(Number.NaN)).toThrow(RangeError);
    expect(() => dlog(0)).toThrow(RangeError);
    expect(() => dlog(-1)).toThrow(RangeError);
    expect(() => dlog(Infinity)).toThrow(RangeError);
    expect(() => dpow(-1, 2)).toThrow(RangeError);
    expect(() => dpow(0, 0)).toThrow(RangeError);
    expect(() => ipow(2, -1)).toThrow(RangeError);
    expect(() => ipow(2, 1.5)).toThrow(RangeError);
  });

  it('is monotonic where it should be (no jitter between neighbouring inputs)', () => {
    let previous = dexp(-5);
    for (let x = -4.99; x < 5; x += 0.01) {
      const current = dexp(x);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });
});
