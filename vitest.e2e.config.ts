import { defineConfig } from 'vitest/config';

/** Browser end-to-end tests. Opt-in: `npm run e2e` (needs Chromium: `npx playwright-core install chromium`). */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
