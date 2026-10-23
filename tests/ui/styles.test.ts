import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles } from '../../tools/lib/source-lint';
import { ROOT } from '../helpers/data';

const STYLES = join(ROOT, 'src', 'styles');
const read = (name: string) => readFileSync(join(STYLES, name), 'utf8');
const tokens = read('tokens.css');

/** Custom properties declared with a hex colour inside the block matched by `opening`. */
function colours(opening: RegExp, from = tokens): Record<string, string> {
  const start = opening.exec(from);
  if (!start) throw new Error(`No block matching ${opening}`);
  let depth = 1;
  let i = start.index + start[0].length;
  const begin = i;
  while (depth > 0 && i < from.length) {
    if (from[i] === '{') depth++;
    if (from[i] === '}') depth--;
    i++;
  }
  const body = from.slice(begin, i - 1);
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );
}

const light = colours(/:root\s*\{/);
const dark = colours(/:root\[data-theme='dark'\]\s*\{/);
const darkFromSystem = colours(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{/,
);

const channel = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Text must reach 4.5:1 (WCAG AA). Pairs are the combinations the stylesheet actually uses. */
const TEXT: [string, string][] = [
  ['ink', 'ground'],
  ['ink', 'surface'],
  ['mist', 'ground'],
  ['mist', 'surface'],
  ['tide', 'ground'],
  ['tide', 'surface'],
  ['tide-ink', 'tide'],
  ['squall', 'ground'],
  ['squall', 'surface'],
  ['squall', 'squall-soft'],
  ['ink', 'squall-soft'],
  ['warn-ink', 'warn-soft'],
  ['ink', 'tide-soft'],
  ['mist', 'tide-soft'],
  ['tide', 'tide-soft'],
];
/** Lines and borders that carry meaning must reach 3:1 (WCAG 1.4.11). Hairline separators are exempt. */
const GRAPHICS: [string, string][] = [
  ['cat-personal', 'ground'],
  ['cat-family', 'ground'],
  ['cat-world', 'ground'],
  ['cat-news', 'ground'],
  ['cat-system', 'ground'],
  ['brass-line', 'ground'],
  ['tide', 'ground'],
  ['rule-strong', 'ground'],
  ['rule-strong', 'surface'],
];

for (const [theme, palette] of [
  ['light', light],
  ['dark', dark],
] as const) {
  describe(`${theme} theme contrast`, () => {
    it.each(TEXT)('text: %s on %s reaches 4.5:1', (fg, bg) => {
      expect(
        contrast(palette[fg] as string, palette[bg] as string),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
    it.each(GRAPHICS)('lines and borders: %s on %s reaches 3:1', (fg, bg) => {
      expect(
        contrast(palette[fg] as string, palette[bg] as string),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(3);
    });
  });
}

describe('the theme blocks', () => {
  it('define the same colour tokens in light and dark', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('keep the automatic dark theme (device setting) identical to the explicit dark theme', () => {
    // The two are the same palette written twice (CSS cannot share them), so drift would be silent.
    expect(darkFromSystem).toEqual(dark);
  });
});

describe('the stylesheet', () => {
  const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
  const all = files.map((f) => read(f)).join('\n');
  // Some properties are set at runtime through an inline style (the progress bars), so UI source counts too.
  const uiSource = listSourceFiles(ROOT, 'src/ui')
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
    .join('\n');
  const declared = new Set(
    [...`${all}\n${uiSource}`.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string),
  );

  it('never uses a custom property that nothing declares', () => {
    const used = [...new Set([...all.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] as string))];
    expect(used.filter((name) => !declared.has(name))).toEqual([]);
  });

  it('declares no colour token that nothing uses', () => {
    const others = files
      .filter((f) => f !== 'tokens.css')
      .map((f) => read(f))
      .join('\n');
    const unused = Object.keys(light).filter((name) => !others.includes(`var(--${name})`));
    expect(unused).toEqual([]);
  });

  it('respects reduced-motion preferences', () => {
    expect(read('base.css')).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps content clear of device notches and system bars', () => {
    expect(read('base.css')).toContain('env(safe-area-inset-top');
    expect(read('base.css')).toContain('env(safe-area-inset-bottom');
  });
});
