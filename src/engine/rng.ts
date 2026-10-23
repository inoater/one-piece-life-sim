import { hash128 } from './hash';

/**
 * Seeded randomness with *keyed streams*.
 *
 * A plain seeded generator hands out one long sequence, so adding a new system that draws a
 * single extra number shifts every later draw and changes the whole world. Here a stream is
 * derived from a path instead:
 *
 *     root(seed) → fork('tick', 12) → fork('rollEvents') → fork('char_gol_d_roger')
 *
 * `fork` is a pure function of the path. It never consumes the parent, so:
 *   - save files need no RNG state, only the seed (the clock position is the tick);
 *   - the player choosing differently does not disturb what the rest of the world rolls;
 *   - a new system gets its own stream and cannot disturb existing ones.
 *
 * Forking the same labels twice returns the same sequence. That is the point, but it means a
 * label must say what the randomness is *for* (a purpose or entity id), and be forked once per
 * use.
 *
 * Core generator: sfc32, fed from the path hash and warmed up. Only 32-bit integer maths is
 * used, so every engine produces identical numbers.
 */

export type StreamLabel = string | number;

export class Rng {
  readonly path: readonly StreamLabel[];
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  private constructor(path: readonly StreamLabel[]) {
    this.path = path;
    const [a, b, c, d] = hash128(JSON.stringify(path));
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** The root stream of a world. Everything else is forked from it. */
  static root(seed: string): Rng {
    if (typeof seed !== 'string' || seed.length === 0) {
      throw new TypeError('Rng.root needs a non-empty string seed');
    }
    return new Rng([seed]);
  }

  /** Derive an independent child stream. Does not consume this stream. */
  fork(...labels: StreamLabel[]): Rng {
    for (const label of labels) {
      if (typeof label === 'string') continue;
      if (typeof label === 'number' && Number.isInteger(label)) continue;
      throw new TypeError(`Rng.fork labels must be strings or integers, got ${String(label)}`);
    }
    return new Rng([...this.path, ...labels]);
  }

  /** Next 32 random bits as an unsigned integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`Rng.int needs integers with min <= max, got ${min}..${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p (clamped to 0..1). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick on an empty list');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Pick by weight. Items with weight <= 0 are never chosen. Returns undefined if none qualify. */
  weightedPick<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    for (const item of items) {
      const w = weightOf(item);
      if (w > 0) total += w;
    }
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    let last: T | undefined;
    for (const item of items) {
      const w = weightOf(item);
      if (w <= 0) continue;
      last = item;
      if (roll < w) return item;
      roll -= w;
    }
    return last;
  }

  /** In-place Fisher-Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Approximately normal (Irwin-Hall: sum of 12 uniforms minus 6, so about +/-6 sigma at the
   * extremes). Deliberately avoids Math.log/Math.cos (Box-Muller), whose last bits differ between
   * engines.
   */
  normal(mean = 0, sd = 1): number {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += this.next();
    return mean + (sum - 6) * sd;
  }
}
