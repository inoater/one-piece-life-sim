/**
 * Non-cryptographic 128-bit hash (cyrb128, public domain, by bryc).
 *
 * Used for two things only:
 *  1. turning a stream path like ["seed", "tick", 12, "events"] into RNG seed words, and
 *  2. fingerprinting canonical JSON so two runs can be compared by one short string.
 *
 * It uses only 32-bit integer maths (Math.imul, shifts, xor), so it gives the same answer in
 * every JavaScript engine. It is not collision-resistant against an attacker; the gzip layer
 * already guards file corruption and saves are not a security boundary.
 */

export type Words128 = [number, number, number, number];

export function hash128(text: string): Words128 {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function words128ToHex(words: Words128): string {
  return words.map((w) => w.toString(16).padStart(8, '0')).join('');
}

/** Hash text and return 32 lowercase hex characters. */
export function hashText(text: string): string {
  return words128ToHex(hash128(text));
}

/** First characters of a hash, for display. */
export function shortHash(hash: string, length = 10): string {
  return hash.slice(0, length);
}
