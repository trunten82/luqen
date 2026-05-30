import { defineConfig } from 'vitest/config';

/**
 * Dedicated config for the real-browser behavioral / E2E tier.
 *
 * These tests launch headless Chromium (puppeteer via pa11y) and perform full
 * keyboard traversal + dynamic-state interaction + static Pa11y scans. They are
 * slow and timing-sensitive on shared CI runners, so they live OUTSIDE the fast
 * unit gate (see vitest.config.ts `exclude`). Run them with:
 *
 *   npm run test:browser -w packages/core
 *
 * locally and on demand. Timeout is generous and set HERE (not per-test) so a
 * single knob governs the whole tier; tests run serially (fileParallelism:false)
 * to avoid launching multiple browsers at once on constrained machines.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/behavioral/**/*.test.ts'],
    testTimeout: 180000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
