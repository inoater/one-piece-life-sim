import { hashText } from './hash';

/**
 * Canonical JSON: the same value always produces the same text.
 *
 * - Object keys are sorted, so insertion order never matters.
 * - Only plain JSON values are accepted. Anything that would silently change meaning when saved
 *   (NaN, Infinity, undefined inside arrays, Map, Set, Date, class instances, functions, bigint)
 *   throws with the path to the offending value. That turns a determinism bug into a loud,
 *   local error instead of a hash mismatch found weeks later.
 * - Object properties whose value is `undefined` are skipped, exactly like JSON.stringify.
 *
 * The world state is hashed through this function, which is why "same seed, same hash" is a
 * meaningful check.
 */

export class CanonicalError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path || '(root)'}`);
    this.name = 'CanonicalError';
  }
}

const MAX_DEPTH = 200;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalize(value: unknown): string {
  const path: (string | number)[] = [];
  const fail = (message: string): never => {
    throw new CanonicalError(
      message,
      path
        .map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`))
        .join('')
        .replace(/^\./, ''),
    );
  };

  const write = (v: unknown, depth: number): string => {
    if (depth > MAX_DEPTH) return fail('Nesting is too deep (cycle?)');
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v);
      case 'number':
        if (!Number.isFinite(v)) return fail(`Non-finite number (${String(v)})`);
        return String(v);
      case 'boolean':
        return v ? 'true' : 'false';
      case 'object': {
        if (v === null) return 'null';
        if (Array.isArray(v)) {
          let out = '[';
          for (let i = 0; i < v.length; i++) {
            path.push(i);
            const item: unknown = v[i];
            if (item === undefined) fail('undefined array element');
            out += (i === 0 ? '' : ',') + write(item, depth + 1);
            path.pop();
          }
          return out + ']';
        }
        if (!isPlainObject(v)) {
          return fail(
            `Unsupported object (${v.constructor?.name ?? 'unknown'}); state must be plain JSON`,
          );
        }
        const record = v as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        let out = '{';
        let first = true;
        for (const key of keys) {
          const item = record[key];
          if (item === undefined) continue;
          path.push(key);
          out += (first ? '' : ',') + JSON.stringify(key) + ':' + write(item, depth + 1);
          path.pop();
          first = false;
        }
        return out + '}';
      }
      default:
        return fail(`Unsupported value of type ${typeof v}`);
    }
  };

  return write(value, 0);
}

/** 32-hex-character fingerprint of any plain JSON value. */
export function hashValue(value: unknown): string {
  return hashText(canonicalize(value));
}
