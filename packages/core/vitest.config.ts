import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
    // Real-browser behavioral/E2E tests (launch headless Chromium, full tab
    // traversal + pa11y scans) are SLOW and flaky on shared CI runners. They
    // are a separate tier — run via `npm run test:browser` (vitest.browser.
    // config.ts), locally and on demand, NOT in the fast unit CI gate.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/behavioral/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/cli.ts', 'src/mcp.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
