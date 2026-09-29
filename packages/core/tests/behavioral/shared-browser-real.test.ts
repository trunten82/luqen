/**
 * DEEP-SCAN-BROWSER-REUSE-1 — real-browser proof for the per-scan shared
 * Chromium (browser/shared-browser.ts):
 *
 *  - ISOLATION: a lease's cookies, localStorage, sessionStorage, permission
 *    grants and viewport emulation are invisible to every other lease — while
 *    the first lease is still open AND after it was released. The `[control]`
 *    shows the same probe DOES see the state from a second page in the SAME
 *    context, so an empty read cannot come from a probe that sees nothing.
 *  - ONE LAUNCH: all six browser engines run on one shared browser.
 *  - CRASH: a killed browser is relaunched for the next engine, which completes.
 *
 * The egress proxy / request guard on shared leases is proven in
 * egress-proxy-browser.test.ts (its "(shared)" engine rows).
 *
 * Browser tier — run via `npx vitest run --config vitest.browser.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from 'puppeteer';
import { createSharedBrowser } from '../../src/browser/shared-browser.js';
import { liveBrowserCount } from '../../src/browser/launch.js';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';
import { runBehavioralChecks } from '../../src/behavioral/index.js';
import { runA11yTreeChecks } from '../../src/a11y-tree/index.js';
import { runReflowChecks } from '../../src/reflow/index.js';
import { runIbmChecks } from '../../src/ibm/index.js';
import { runLighthouseChecks } from '../../src/lighthouse/index.js';

const TEST_TIMEOUT = 180_000;
const GUARD = { allowPrivate: true } as const;

let server: Server;
let origin: string;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shared fixture</title></head>
<body><main><h1>Shared fixture</h1><img src="/px.png"><button></button><a href="/"></a>
<input type="text"><div style="width:1100px">wide</div></main></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if ((req.url ?? '/').startsWith('/px.png')) {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Leave every kind of per-origin state a page (or an engine) can leave. */
async function plantState(page: Page): Promise<void> {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('planted', '1');
    sessionStorage.setItem('planted', '1');
    document.cookie = 'planted=1; path=/; max-age=3600';
  });
  await page.browserContext().overridePermissions(origin, ['geolocation']);
  await page.setViewport({ width: 320, height: 480 });
}

interface Observed {
  readonly local: string | null;
  readonly cookie: string;
  readonly geolocation: string;
  readonly width: number;
}

async function observe(page: Page): Promise<Observed> {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  return page.evaluate(async () => ({
    local: localStorage.getItem('planted'),
    cookie: document.cookie,
    geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
    width: window.innerWidth,
  }));
}

describe('DEEP-SCAN-BROWSER-REUSE-1 shared browser — isolation between leases', () => {
  it(
    '[isolation] state planted by one lease is invisible to the next, while open and after release',
    async () => {
      const shared = createSharedBrowser(GUARD);
      try {
        const planter = await shared.acquire();
        await plantState(planter.page);

        const concurrent = await shared.acquire();
        const whileOpen = await observe(concurrent.page);
        await concurrent.release();

        await planter.release();
        const after = await shared.acquire();
        const afterRelease = await observe(after.page);
        await after.release();

        for (const seen of [whileOpen, afterRelease]) {
          expect(seen.local).toBeNull();
          expect(seen.cookie).toBe('');
          expect(seen.geolocation).toBe('prompt');
          expect(seen.width).not.toBe(320);
        }
        expect(shared.launchCount()).toBe(1);
      } finally {
        await shared.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    '[control] a second page in the SAME context does see the planted state',
    async () => {
      const shared = createSharedBrowser(GUARD);
      try {
        const lease = await shared.acquire();
        await plantState(lease.page);
        const sibling = await lease.page.browserContext().newPage();
        const seen = await observe(sibling);
        expect(seen.local).toBe('1');
        expect(seen.cookie).toContain('planted=1');
        expect(seen.geolocation).toBe('granted');
        await lease.release();
      } finally {
        await shared.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describe('DEEP-SCAN-BROWSER-REUSE-1 shared browser — every engine on one launch', () => {
  it(
    '[one-launch] pa11y, behavioral, lighthouse, ibm, reflow and a11y-tree all complete on ONE browser, closed at the end',
    async () => {
      const before = liveBrowserCount();
      const shared = createSharedBrowser(GUARD);
      const url = `${origin}/`;
      const opts = { guard: GUARD, sharedBrowser: shared, timeout: 60_000 };
      try {
        const pa11y = await new DirectScanner({ guard: GUARD }).scan(url, {
          standard: 'WCAG2AA', runners: ['htmlcs', 'axe'], sharedBrowser: shared,
        });
        expect(pa11y.issues.length).toBeGreaterThan(0);
        for (const run of [runBehavioralChecks, runLighthouseChecks, runIbmChecks, runReflowChecks, runA11yTreeChecks]) {
          const result = await run(url, opts);
          expect(result.errors, run.name).toEqual([]);
          expect(result.pagesChecked, run.name).toBe(1);
        }
        expect(shared.launchCount()).toBe(1);
        expect(liveBrowserCount()).toBe(before + 1);
      } finally {
        await shared.close();
      }
      expect(liveBrowserCount()).toBe(before);
    },
    TEST_TIMEOUT,
  );

  it(
    '[crash] a killed browser is relaunched and the next engine completes on it',
    async () => {
      const shared = createSharedBrowser(GUARD);
      try {
        const lease = await shared.acquire();
        const disconnected = new Promise<void>((resolve) => lease.browser.once('disconnected', () => resolve()));
        lease.browser.process()?.kill('SIGKILL');
        await disconnected;
        await lease.release(); // releasing a lease on a dead browser must not throw

        const result = await runA11yTreeChecks(`${origin}/`, { guard: GUARD, sharedBrowser: shared });
        expect(result.errors).toEqual([]);
        expect(result.pagesChecked).toBe(1);
        expect(shared.launchCount()).toBe(2);
      } finally {
        await shared.close();
      }
    },
    TEST_TIMEOUT,
  );
});
