import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { gameDataPlugin } from './tools/vite-plugin-gamedata.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Modes:
 *   vite / vite dev            development: debug panel on
 *   vite build                 production: debug panel compiled out
 *   vite build --mode preview  one self-contained HTML file (with the debug panel) for sharing
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  return {
    base: './',
    plugins: [process.env['VITEST'] ? null : gameDataPlugin()],
    define: {
      __DEBUG_PANEL__: JSON.stringify(mode !== 'production'),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        // The preview build embeds the worker as a blob so the page needs no other file.
        '#worker-factory': at(
          preview ? './src/ui/worker-factory.inline.ts' : './src/ui/worker-factory.ts',
        ),
      },
    },
    worker: { format: 'es' as const },
    build: preview
      ? {
          outDir: 'dist-preview',
          target: 'es2022',
          assetsInlineLimit: 100_000_000,
          cssCodeSplit: false,
          rolldownOptions: { output: { codeSplitting: false } },
        }
      : { target: 'es2022' },
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['tests/helpers/setup.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  };
});
