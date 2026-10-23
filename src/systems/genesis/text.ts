/**
 * Small English helpers for generated prose: numbers as words, lists, articles, capitals.
 * They hold no content (rule 1); every phrase they arrange comes from /data.
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 7 -> "seven", 23 -> "twenty-three", 100 -> "a hundred"; larger numbers stay as digits. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 100) return String(n);
  if (n === 100) return 'a hundred';
  if (n < 20) return ONES[n] as string;
  const tens = TENS[Math.floor(n / 10)] as string;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones] as string}`;
}

/** "first", "second", ... up to "tenth"; then "11th". */
export function ordinalWords(n: number): string {
  const words = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
  ];
  return words[n - 1] ?? `${n}th`;
}

/** ["a"] -> "a"; ["a", "b"] -> "a and b"; ["a", "b", "c"] -> "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Template variables that write a name (or a place), so the sentence must keep its capital. */
const NAMING_VARS = ['{other}', '{parentName}', '{familyName}', '{home}', '{race}'];

/**
 * Continue a rendered sentence after a lead-in such as "At seven, ". The first letter is lowered
 * unless the template starts with a variable that writes a name ("{other} beat you ...").
 */
export function continueSentence(template: string, rendered: string): string {
  if (NAMING_VARS.some((v) => template.startsWith(v))) return rendered;
  return rendered.charAt(0).toLowerCase() + rendered.slice(1);
}

/** "A" or "An" for the word that follows (sentence start). */
export function articleFor(word: string): 'A' | 'An' {
  return /^[aeiou]/i.test(word.trim()) ? 'An' : 'A';
}

/** "a village on the East Blue" from "A village on the East Blue"; "Wano Country" stays as it is. */
export function midSentence(placeName: string): string {
  return /^(A|An|The) /.test(placeName)
    ? placeName.charAt(0).toLowerCase() + placeName.slice(1)
    : placeName;
}

/** 1234567 -> "1,234,567". Plain grouping, independent of the host's locale. */
export function formatBerries(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return sign + out;
}
