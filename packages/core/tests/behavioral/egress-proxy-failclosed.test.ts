/**
 * SCAN-EGRESS-PROXY-1 — FAIL CLOSED through every real engine.
 *
 * The egress-proxy module is mocked so the proxy either cannot start or comes
 * back not listening. Every engine must then fail with the explicit
 * EgressProxyUnavailableError message, and the target — a loopback server
 * scanned with the operator opt-out (`allowPrivate: true`), so the guard
 * itself would let it through — must accept ZERO connections: Chromium was
 * never launched without its proxy.
 *
 * The `[control]` run uses the real proxy and MUST reach the target, so a
 * zero cannot come from a target no engine would have loaded anyway.
 *
 * Browser tier — run via `npx vitest run --config vitest.browser.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Mode = 'real' | 'throws' | 'dead';
const mode: { current: Mode } = vi.hoisted(() => ({ current: 'real' as Mode }));

vi.mock('../../src/net/egress-proxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/net/egress-proxy.js')>();
  const start: typeof actual.startEgressProxy = async (policy, options) => {
    if (mode.current === 'throws') throw new Error('simulated: listen EADDRNOTAVAIL');
    const proxy = await actual.startEgressProxy(policy, options);
    if (mode.current === 'dead') await proxy.close();
    return proxy;
  };
  return {
    ...actual,
    startEgressProxy: start,
    openEgressProxy: (policy: Parameters<typeof actual.openEgressProxy>[0], s = start) => actual.openEgressProxy(policy, s),
  };
});

const { DirectScanner } = await import('../../src/scanner/direct-scanner.js');
const { runBehavioralChecks } = await import('../../src/behavioral/index.js');
const { runA11yTreeChecks } = await import('../../src/a11y-tree/index.js');
const { runReflowChecks } = await import('../../src/reflow/index.js');
const { runIbmChecks } = await import('../../src/ibm/index.js');
const { runLighthouseChecks } = await import('../../src/lighthouse/index.js');
const { browserCrawlSite } = await import('../../src/discovery/browser-crawler.js');

const TEST_TIMEOUT = 150_000;
const OPT_OUT = { allowPrivate: true } as const;

let target: Server;
let targetUrl: string;
let connections = 0;
const requests: string[] = [];

beforeAll(async () => {
  target = createServer((req, res) => {
    requests.push(req.url ?? '/');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>t</h1><a href="/next">next</a><button></button></main></body></html>');
  });
  target.on('connection', () => { connections += 1; });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/page`;
});

afterAll(async () => {
  target.closeAllConnections?.();
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

beforeEach(() => {
  connections = 0;
  requests.length = 0;
});

/** Runs an engine and returns its error text ('' when it succeeded). */
type EngineRun = (url: string) => Promise<string>;

function errorsOf(r: { pagesChecked: number; errors: ReadonlyArray<{ message: string }> }): string {
  return r.errors.map((e) => e.message).join(' | ');
}

const ENGINES: ReadonlyArray<readonly [string, EngineRun]> = [
  ['pa11y (DirectScanner)', async (url) => {
    try {
      await new DirectScanner({ guard: OPT_OUT }).scan(url, { standard: 'WCAG2AA', timeout: 30_000 });
      return '';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }],
  ['behavioral', async (url) => errorsOf(await runBehavioralChecks(url, { guard: OPT_OUT, timeout: 30_000 }))],
  ['a11y-tree', async (url) => errorsOf(await runA11yTreeChecks(url, { guard: OPT_OUT, timeout: 30_000 }))],
  ['reflow', async (url) => errorsOf(await runReflowChecks(url, { guard: OPT_OUT, timeout: 30_000 }))],
  ['ibm', async (url) => errorsOf(await runIbmChecks(url, { guard: OPT_OUT, timeout: 60_000 }))],
  ['lighthouse', async (url) => errorsOf(await runLighthouseChecks(url, { guard: OPT_OUT, timeout: 60_000 }))],
  ['discovery (browser crawler)', async (url) => {
    const r = await browserCrawlSite(url, { maxPages: 2, maxDepth: 1, isAllowed: () => true, guard: OPT_OUT });
    return r.error ?? '';
  }],
];

describe.each(ENGINES)('SCAN-EGRESS-PROXY-1 fail-closed — %s', (_name, run) => {
  it.each(['throws', 'dead'] as const)(
    '[fail-closed] proxy %s: the scan fails loudly and the target is never reached',
    async (failure) => {
      mode.current = failure;
      const error = await run(targetUrl);
      mode.current = 'real';
      expect(error).toMatch(/egress proxy unavailable/i);
      expect(connections).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    '[control] with a working proxy the same opt-out scan DOES reach the target',
    async () => {
      mode.current = 'real';
      await run(targetUrl);
      expect(requests).toContain('/page');
    },
    TEST_TIMEOUT,
  );
});
