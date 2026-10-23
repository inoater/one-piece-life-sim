/**
 * Deterministic maths for simulation code.
 *
 * ECMAScript only requires Math.exp, Math.log, Math.pow, Math.sin, ... to be
 * "implementation-approximated", so Chrome, Safari and Firefox may return values that differ in
 * the last bit. A single differing bit in a mortality roll is enough to give two browsers
 * different worlds from the same seed.
 *
 * The functions here use only + - * / and bit access, which IEEE-754 pins down exactly, so they
 * return identical results everywhere. They are accurate to a few ulps, which is far more than a
 * game needs. `tests/engine/lint.test.ts` forbids the approximated Math functions inside
 * `src/engine` and `src/systems`; use these instead (a Gompertz mortality curve needs `dexp`).
 *
 * Exact in every engine and therefore fine to use directly: Math.sqrt, floor, ceil, round, trunc,
 * abs, min, max, sign, fround, imul, clz32.
 */

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;

const scratch = new DataView(new ArrayBuffer(8));

/** 2^k as an exact double, for k in [-1022, 1023]. */
function pow2(k: number): number {
  scratch.setUint32(0, (k + 1023) << 20);
  scratch.setUint32(4, 0);
  return scratch.getFloat64(0);
}

/** e^x for |x| <= 700. */
export function dexp(x: number): number {
  if (!Number.isFinite(x) || x > 700 || x < -700) {
    throw new RangeError(`dexp supports |x| <= 700, got ${x}`);
  }
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let sum = 1;
  for (let n = 18; n >= 1; n--) sum = 1 + (r / n) * sum;
  return sum * pow2(k);
}

/** Natural logarithm for finite x > 0. */
export function dlog(x: number): number {
  if (!Number.isFinite(x) || x <= 0) {
    throw new RangeError(`dlog needs a finite x > 0, got ${x}`);
  }
  let value = x;
  let e = 0;
  scratch.setFloat64(0, value);
  if (((scratch.getUint32(0) >>> 20) & 0x7ff) === 0) {
    value *= 18014398509481984; // 2^54, exact; lifts subnormals into the normal range
    e -= 54;
    scratch.setFloat64(0, value);
  }
  const hi = scratch.getUint32(0);
  e += ((hi >>> 20) & 0x7ff) - 1023;
  scratch.setUint32(0, (hi & 0x000fffff) | 0x3ff00000); // mantissa now in [1, 2)
  let m = scratch.getFloat64(0);
  if (m > SQRT2) {
    m /= 2;
    e += 1;
  }
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let t = 0;
  for (let k = 14; k >= 0; k--) t = 1 / (2 * k + 1) + z * t;
  return e * LN2_HI + (e * LN2_LO + 2 * s * t);
}

/** x^n for integer n >= 0, by repeated squaring. Exact IEEE operations only. */
export function ipow(x: number, n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`ipow needs an integer n >= 0, got ${n}`);
  let result = 1;
  let base = x;
  let e = n;
  while (e > 0) {
    if (e & 1) result *= base;
    base *= base;
    e = Math.floor(e / 2);
  }
  return result;
}

/** x^y for x > 0 (x = 0 gives 0 for y > 0). Result must stay below e^700. */
export function dpow(x: number, y: number): number {
  if (x === 0) {
    if (y > 0) return 0;
    throw new RangeError('dpow(0, y) needs y > 0');
  }
  if (x < 0) throw new RangeError('dpow needs x >= 0');
  return dexp(y * dlog(x));
}
