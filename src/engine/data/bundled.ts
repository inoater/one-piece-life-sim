import type { RawFile } from './loader';

/**
 * The /data folder as bundled by Vite (browser, worker and vitest). Node tools use
 * tools/lib/read-data.ts instead; a test checks both produce the same data hash.
 *
 * Do not import this file from Node-only code (tsx): `import.meta.glob` is a Vite feature.
 */
const modules = import.meta.glob('/data/**/*.json', { eager: true, import: 'default' }) as Record<
  string,
  unknown
>;

export function bundledRawFiles(): RawFile[] {
  return Object.entries(modules).map(([path, content]) => ({
    path: path.replace(/^\//, ''),
    content,
  }));
}
