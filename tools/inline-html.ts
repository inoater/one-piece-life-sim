import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * npm run build:preview  (second half)
 *
 * Folds the preview build (dist-preview/) into ONE self-contained HTML file: the stylesheet, the
 * script, the fonts and the worker are all embedded, so the file can be opened from disk, emailed,
 * or hosted anywhere. It includes the debug panel; the normal `npm run build` does not.
 */

const dir = resolve(process.argv[2] ?? 'dist-preview');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

let html = read('index.html');
let inlined = 0;

html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/(assets\/[^"]+\.css)"[^>]*>/g,
  (_match, file: string) => {
    inlined += 1;
    return `<style>${read(file).replace(/<\/style/gi, '<\\/style')}</style>`;
  },
);

// Inline module scripts are deferred like external ones, so their position does not matter.
html = html.replace(
  /<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g,
  (_match, file: string) => {
    inlined += 1;
    return `<script type="module">${read(file).replace(/<\/script/gi, '<\\/script')}</script>`;
  },
);

if (/\b(?:src|href)="\.\/assets\//.test(html)) {
  throw new Error('Some assets were not inlined; the preview would not be self-contained.');
}
if (inlined < 2)
  throw new Error(`Expected to inline a stylesheet and a script, inlined ${inlined}.`);

const out = join(dir, 'opsim-preview.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
