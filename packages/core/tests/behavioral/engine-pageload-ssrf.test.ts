/**
 * ENGINE-SSRF-1 — real-browser proof that every scan engine which loads a
 * scanned page in Chromium refuses the page's redirect hops, subresources,
 * frames and fetch/XHR when they target a private / loopback address.
 *
 * DISCOVERY-SSRF-1 (#86) guarded discovery; this closes the page-LOAD half:
 * pa11y (DirectScanner), behavioral, a11y-tree, reflow, IBM Equal Access and
 * Lighthouse. A loopback "public" fixture (exempted with `trustedOrigins`,
 * exactly as #86's browser tracer does) points a redirect, an <img>, a
 * stylesheet, two <iframe>s (one direct, one via a redirecting hop), a fetch()
 * and an XHR at a second loopback "victim" server. The victim must see ZERO
 * requests, while the scan still completes with results for the public page
 * and the public page's own subresource still loads.
 *
 * Every engine also runs a CONTROL with the operator opt-out
 * (`allowPrivate: true`): the victim MUST be hit there, which proves the
 * fixture really does reach the victim through that engine — so a zero in the
 * guarded run is the guard's doing, not an engine that never loaded the page.
 *
 * Browser tier — run via `npx vitest run --config vitest.browser.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';
import { runBehavioralChecks } from '../../src/behavioral/index.js';
import { runA11yTreeChecks } from '../../src/a11y-tree/index.js';
import { runReflowChecks } from '../../src/reflow/index.js';
import { runIbmChecks } from '../../src/ibm/index.js';
import { runLighthouseChecks } from '../../src/lighthouse/index.js';

const TEST_TIMEOUT = 150_000;
/** Grace period after an engine returns, so a late subresource still counts. */
const SETTLE_MS = 400;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let victim: Server;
let victimOrigin: string;
const victimHits: string[] = [];

let site: Server;
let siteOrigin: string;
const siteHits: string[] = [];
/** Paths whose request carried the `x-luqen-probe` header. */
const siteProbeHeaderHits: string[] = [];

function pageHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title>
<link rel="stylesheet" href="${victimOrigin}/style.css"></head>
<body><main><h1>Public page</h1>
<img src="/public.png" alt="public pixel">
<img src="${victimOrigin}/img.png">
<iframe src="${victimOrigin}/frame" title="direct frame"></iframe>
<iframe src="/hop" title="redirecting frame"></iframe>
<form><input type="text" name="q"></form>
<button></button>
<script>
fetch('${victimOrigin}/fetch').catch(function(){});
try { var x = new XMLHttpRequest(); x.open('GET', '${victimOrigin}/xhr'); x.send(); } catch (e) {}
</script>
</main></body></html>`;
}

beforeAll(async () => {
  victim = createServer((req, res) => {
    victimHits.push(req.url ?? '/');
    res.end('internal');
  });
  await new Promise<void>((resolve) => victim.listen(0, '127.0.0.1', resolve));
  victimOrigin = `http://127.0.0.1:${(victim.address() as AddressInfo).port}`;

  site = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    siteHits.push(pathname);
    if (req.headers['x-luqen-probe'] === 'on') siteProbeHeaderHits.push(pathname);
    if (pathname === '/page') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(pageHtml());
      return;
    }
    if (pathname === '/redirect' || pathname === '/hop') {
      res.statusCode = 302;
      res.setHeader('location', `${victimOrigin}/redirected${pathname}`);
      res.end();
      return;
    }
    if (pathname === '/public.png') {
      res.setHeader('content-type', 'image/png');
      res.end(PNG);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await new Promise<void>((resolve) => victim.close(() => resolve()));
});

beforeEach(() => {
  victimHits.length = 0;
  siteHits.length = 0;
  siteProbeHeaderHits.length = 0;
});

interface EngineOutcome {
  /** The page loaded and the engine produced a result for it. */
  readonly completed: boolean;
  readonly issueCount: number;
}

type EngineRun = (url: string, guard: NetworkGuardPolicy) => Promise<EngineOutcome>;

function fromResult(r: { pagesChecked: number; issues: readonly unknown[] }): EngineOutcome {
  return { completed: r.pagesChecked === 1, issueCount: r.issues.length };
}

/** [name, run, whether the fixture's defects must surface as issues]. */
const ENGINES: ReadonlyArray<readonly [string, EngineRun, boolean]> = [
  ['pa11y (DirectScanner)', async (url, guard) => {
    try {
      const r = await new DirectScanner({ guard }).scan(url, { standard: 'WCAG2AA', timeout: 30_000 });
      return { completed: true, issueCount: r.issues.length };
    } catch {
      return { completed: false, issueCount: 0 };
    }
  }, true],
  ['behavioral', async (url, guard) => fromResult(await runBehavioralChecks(url, { guard, timeout: 30_000 })), false],
  ['a11y-tree', async (url, guard) => fromResult(await runA11yTreeChecks(url, { guard, timeout: 30_000 })), true],
  ['reflow', async (url, guard) => fromResult(await runReflowChecks(url, { guard, timeout: 30_000 })), false],
  ['ibm', async (url, guard) => fromResult(await runIbmChecks(url, { guard, timeout: 60_000 })), true],
  ['lighthouse', async (url, guard) => fromResult(await runLighthouseChecks(url, { guard, timeout: 60_000 })), true],
];

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
}

describe.each(ENGINES)('ENGINE-SSRF-1 %s', (_name, run, expectsIssues) => {
  it(
    '[guarded] subresources, frames, fetch and XHR never reach the victim; the page still scans',
    async () => {
      const outcome = await run(`${siteOrigin}/page`, { trustedOrigins: [siteOrigin] });
      await settle();
      expect(victimHits).toEqual([]);
      expect(outcome.completed).toBe(true);
      if (expectsIssues) expect(outcome.issueCount).toBeGreaterThan(0);
      // The public page's own subresource is NOT collateral damage.
      expect(siteHits).toContain('/public.png');
    },
    TEST_TIMEOUT,
  );

  it(
    '[guarded] a top-level redirect to a private address is refused',
    async () => {
      const outcome = await run(`${siteOrigin}/redirect`, { trustedOrigins: [siteOrigin] });
      await settle();
      expect(victimHits).toEqual([]);
      expect(siteHits).toContain('/redirect');
      // Engines never throw on a refused load; reaching here without the
      // victim being hit is the assertion.
      expect(outcome).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    '[control] with the operator opt-out the same fixture DOES reach the victim',
    async () => {
      const outcome = await run(`${siteOrigin}/page`, { allowPrivate: true });
      await settle();
      expect(outcome.completed).toBe(true);
      expect(victimHits.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );
});

describe('ENGINE-SSRF-1 pa11y header semantics', () => {
  it(
    '[pa11y-headers] custom headers still reach the scanned page, and only the page (pa11y parity)',
    async () => {
      const result = await new DirectScanner({ guard: { trustedOrigins: [siteOrigin] } })
        .scan(`${siteOrigin}/page`, { standard: 'WCAG2AA', timeout: 30_000, headers: { 'X-Luqen-Probe': 'on' } });
      await settle();
      expect(result.issues.length).toBeGreaterThan(0);
      expect(siteProbeHeaderHits).toEqual(['/page']);
      expect(siteHits).toContain('/public.png');
      expect(victimHits).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
