/**
 * SCAN-EGRESS-PROXY-1 — real-browser proof that every Chromium a scan or
 * discovery launches sends ALL of its traffic through the in-process
 * filtering egress proxy, closing the two residuals #88/#89 measured:
 *
 *  1. WebSocket handshakes. Chromium's request interception never surfaces
 *     ws:/wss:, so the page-level guard could not refuse them. A trusted
 *     "public" page opens WebSockets (ws:// and wss://) to a loopback victim
 *     from the page AND from a dedicated worker; the victim must accept ZERO
 *     TCP connections.
 *  2. DNS rebinding on browser loads. The guard resolves a name, then
 *     Chromium resolved it AGAIN on its own. Here the guard's resolver answers
 *     the public address (127.0.0.2) while Chromium's own resolver is forced
 *     to the victim (127.0.0.1) with `--host-resolver-rules` — the rebinding
 *     answer. The subresource must reach the public server, never the victim.
 *
 * Every guarded case has an `allowPrivate` CONTROL that MUST reach the victim,
 * so a zero cannot come from a page (or socket) that never loaded.
 *
 * Browser tier — run via `npx vitest run --config vitest.browser.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';
import { CHROMIUM_LAUNCH_ARGS, egressProxyOf, launchChromium, safeCloseBrowser } from '../../src/browser/launch.js';
import { guardPageRequests } from '../../src/net/browser-request-guard.js';
import { startEgressProxy } from '../../src/net/egress-proxy.js';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';
import { runBehavioralChecks } from '../../src/behavioral/index.js';
import { runA11yTreeChecks } from '../../src/a11y-tree/index.js';
import { runReflowChecks } from '../../src/reflow/index.js';
import { runIbmChecks } from '../../src/ibm/index.js';
import { runLighthouseChecks } from '../../src/lighthouse/index.js';
import { browserCrawlSite } from '../../src/discovery/browser-crawler.js';

const TEST_TIMEOUT = 150_000;
/** Attempts for the guarded WebSocket test when the worker fails to report in (see that test). */
const WS_ATTEMPTS = 2;
/** Grace period after an engine returns, so a late socket still counts. */
const SETTLE_MS = 600;
const PUBLIC_IP = '127.0.0.2';
const VICTIM_IP = '127.0.0.1';

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface Recorder {
  readonly server: Server;
  /** Every TCP connection accepted — the strictest "was it reached" signal. */
  connections: number;
  readonly requests: string[];
  readonly upgrades: string[];
}

function record(handler?: (req: IncomingMessage, res: ServerResponse) => void): Recorder {
  const rec: Recorder = {
    server: createServer((req, res) => {
      rec.requests.push(req.url ?? '/');
      if (handler) handler(req, res);
      else res.end('internal');
    }),
    connections: 0,
    requests: [],
    upgrades: [],
  };
  rec.server.on('connection', () => { rec.connections += 1; });
  rec.server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    rec.upgrades.push(req.url ?? '/');
    socket.destroy();
  });
  return rec;
}

async function listenOn(rec: Recorder, address: string, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    rec.server.once('error', reject);
    rec.server.listen(port, address, () => resolve());
  });
  return (rec.server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function reset(rec: Recorder): void {
  rec.connections = 0;
  rec.requests.length = 0;
  rec.upgrades.length = 0;
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
}

// ---------------------------------------------------------------------------
// Fixtures: a trusted loopback "public" site, a loopback victim, and a
// public(127.0.0.2)/victim(127.0.0.1) pair sharing ONE port for rebinding.
// ---------------------------------------------------------------------------

let victim: Recorder;
let victimPort: number;
let site: Recorder;
let siteOrigin: string;
let rebindPublic: Recorder;
let rebindVictim: Recorder;
let rebindPort: number;

function wsPage(): string {
  const ws = `ws://${VICTIM_IP}:${victimPort}`;
  const wss = `wss://${VICTIM_IP}:${victimPort}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WS fixture</title></head>
<body><main><h1>Public page</h1><img src="/public.png" alt="public pixel"><button></button>
<script>
try { new WebSocket('${ws}/ws-page'); } catch (e) {}
try { new WebSocket('${wss}/wss-page'); } catch (e) {}
try { new Worker('/worker.js'); } catch (e) {}
</script>
<script src="/gate.js"></script>
</main></body></html>`;
}

function workerJs(): string {
  return `try { new WebSocket('ws://${VICTIM_IP}:${victimPort}/ws-worker'); } catch (e) {}
try { new WebSocket('wss://${VICTIM_IP}:${victimPort}/wss-worker'); } catch (e) {}
fetch('/worker-ran').catch(function(){});`;
}

function rebindPage(): string {
  const host = `rebind.test:${rebindPort}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rebind fixture</title></head>
<body><main><h1>Public page</h1><img src="http://${host}/sub.png" alt="rebinding pixel"><button></button>
<script>fetch('http://${host}/fetch').catch(function(){});</script>
</main></body></html>`;
}

/** Resolves once the worker has reported in (plus a grace), capped at 25 s (a loaded CI host throttled by Lighthouse is slow). */
async function holdGate(): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !site.requests.includes('/worker-ran')) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 700));
}

beforeAll(async () => {
  victim = record();
  victimPort = await listenOn(victim, VICTIM_IP);

  site = record((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/ws') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(wsPage());
    } else if (pathname === '/worker.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(workerJs());
    } else if (pathname === '/gate.js') {
      // Parser-blocking: holds DOMContentLoaded until the worker has run and
      // its sockets had time to go out, so no engine closes the browser first.
      void holdGate().then(() => {
        res.setHeader('content-type', 'text/javascript');
        res.end('');
      });
    } else if (pathname === '/rebind') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(rebindPage());
    } else if (pathname === '/public.png') {
      res.setHeader('content-type', 'image/png');
      res.end(PNG);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  siteOrigin = `http://${VICTIM_IP}:${await listenOn(site, VICTIM_IP)}`;

  // Public/victim pair on one port (retry if 127.0.0.1:<port> is taken).
  for (let attempt = 0; attempt < 5; attempt++) {
    const pub = record((_req, res) => { res.setHeader('content-type', 'image/png'); res.end(PNG); });
    const port = await listenOn(pub, PUBLIC_IP);
    const vic = record();
    try {
      await listenOn(vic, VICTIM_IP, port);
      rebindPublic = pub;
      rebindVictim = vic;
      rebindPort = port;
      break;
    } catch {
      await closeServer(pub.server);
    }
  }
  if (rebindPort === undefined) throw new Error('could not bind the rebinding pair');
});

afterAll(async () => {
  for (const rec of [victim, site, rebindPublic, rebindVictim]) {
    if (rec) await closeServer(rec.server);
  }
});

beforeEach(() => {
  for (const rec of [victim, site, rebindPublic, rebindVictim]) reset(rec);
});

// ---------------------------------------------------------------------------
// Engines. `args` is extra Chromium flags (only the rebinding test uses it).
// ---------------------------------------------------------------------------

interface EngineOutcome { readonly completed: boolean; readonly error?: string }
type EngineRun = (url: string, guard: NetworkGuardPolicy, args?: readonly string[]) => Promise<EngineOutcome>;

function fromResult(r: { pagesChecked: number; errors?: ReadonlyArray<{ message: string }> }): EngineOutcome {
  return { completed: r.pagesChecked === 1, error: r.errors?.[0]?.message };
}

function launchConfig(args?: readonly string[]): { args: string[] } | undefined {
  return args ? { args: [...CHROMIUM_LAUNCH_ARGS, ...args] } : undefined;
}

const ENGINES: ReadonlyArray<readonly [string, EngineRun, boolean]> = [
  ['pa11y (DirectScanner)', async (url, guard) => {
    try {
      await new DirectScanner({ guard }).scan(url, { standard: 'WCAG2AA', timeout: 30_000 });
      return { completed: true };
    } catch (err) {
      return { completed: false, error: String(err) };
    }
  }, false],
  ['behavioral', async (url, guard, args) =>
    fromResult(await runBehavioralChecks(url, { guard, timeout: 30_000, chromeLaunchConfig: launchConfig(args) })), true],
  ['a11y-tree', async (url, guard, args) =>
    fromResult(await runA11yTreeChecks(url, { guard, timeout: 30_000, chromeLaunchConfig: launchConfig(args) })), true],
  ['reflow', async (url, guard, args) =>
    fromResult(await runReflowChecks(url, { guard, timeout: 30_000, chromeLaunchConfig: launchConfig(args) })), true],
  ['ibm', async (url, guard, args) =>
    fromResult(await runIbmChecks(url, { guard, timeout: 60_000, chromeLaunchConfig: launchConfig(args) })), true],
  ['lighthouse', async (url, guard, args) =>
    fromResult(await runLighthouseChecks(url, {
      guard,
      timeout: 60_000,
      chromeLaunchConfig: args ? { chromeFlags: ['--headless=new', ...CHROMIUM_LAUNCH_ARGS, ...args] } : undefined,
    })), true],
  ['discovery (browser crawler)', async (url, guard) => {
    const r = await browserCrawlSite(url, { maxPages: 2, maxDepth: 1, isAllowed: () => true, guard, pageTimeoutMs: 20_000 });
    return { completed: r.error === undefined, error: r.error };
  }, false],
];

describe.each(ENGINES)('SCAN-EGRESS-PROXY-1 %s — WebSocket', (_name, run) => {
  it(
    '[guarded] ws:// and wss:// from the page and from a dedicated worker never reach the victim',
    async () => {
      // The victim assertions come FIRST and run on EVERY attempt: the security
      // property must never be masked by the liveness precondition below.
      // Liveness (the worker really ran and opened its sockets) is a test
      // precondition, not the guard: under a loaded host the dedicated worker
      // has been measured failing to report in before pa11y closed the page
      // (1 in 10 combined runs; 1 in 18 runs with 3 suites in parallel, always
      // the '/worker-ran' assertion, never a victim hit). A run where the
      // worker did not report is inconclusive for the worker half, so it is
      // retried once rather than counted as a pass.
      let workerRan = false;
      for (let attempt = 1; attempt <= WS_ATTEMPTS && !workerRan; attempt++) {
        reset(victim);
        reset(site);
        const outcome = await run(`${siteOrigin}/ws`, { trustedOrigins: [siteOrigin] });
        await settle();
        expect(outcome.completed).toBe(true);
        expect(victim.upgrades).toEqual([]);
        expect(victim.connections).toBe(0);
        workerRan = site.requests.includes('/worker-ran');
      }
      expect(workerRan, `the dedicated worker never reported in across ${WS_ATTEMPTS} attempts, so its sockets were not exercised`).toBe(true);
    },
    TEST_TIMEOUT * WS_ATTEMPTS,
  );

  it(
    '[control] with the operator opt-out the same sockets DO reach the victim',
    async () => {
      const outcome = await run(`${siteOrigin}/ws`, { allowPrivate: true });
      await settle();
      expect(outcome.completed).toBe(true);
      expect(victim.upgrades).toEqual(expect.arrayContaining(['/ws-page', '/ws-worker']));
    },
    TEST_TIMEOUT,
  );
});

/** The guard's view: rebind.test is public 127.0.0.2; nothing else resolves. */
function rebindGuard(extra: Partial<NetworkGuardPolicy> = {}): NetworkGuardPolicy {
  return {
    trustedOrigins: [siteOrigin],
    resolve: async (host) => {
      if (host === 'rebind.test') return [PUBLIC_IP];
      throw new Error(`unexpected lookup ${host}`);
    },
    isBlockedAddress: (address) => address !== PUBLIC_IP,
    ...extra,
  };
}

/** Chromium's OWN resolution of rebind.test answers the victim: the rebind. */
const BROWSER_REBINDS = [`--host-resolver-rules=MAP rebind.test ${VICTIM_IP}`];

describe.each(ENGINES.filter(([, , takesArgs]) => takesArgs))('SCAN-EGRESS-PROXY-1 %s — DNS rebinding', (_name, run) => {
  it(
    '[rebinding] a subresource on a rebinding host reaches the validated public address, never the victim',
    async () => {
      const outcome = await run(`${siteOrigin}/rebind`, rebindGuard(), BROWSER_REBINDS);
      await settle();
      expect(outcome.completed).toBe(true);
      expect(rebindVictim.connections).toBe(0);
      expect(rebindPublic.requests).toContain('/sub.png');
    },
    TEST_TIMEOUT,
  );
});

describe('SCAN-EGRESS-PROXY-1 DNS rebinding between the two layers', () => {
  it(
    '[rebinding] a resolver that answers public first and loopback afterwards never reaches the victim',
    async () => {
      const calls = new Map<string, number>();
      const guard = rebindGuard({
        resolve: async (host) => {
          const n = (calls.get(host) ?? 0) + 1;
          calls.set(host, n);
          return n === 1 ? [PUBLIC_IP] : [VICTIM_IP];
        },
      });
      const outcome = await ENGINES[2][1](`${siteOrigin}/rebind`, guard, BROWSER_REBINDS);
      await settle();
      expect(outcome.completed).toBe(true);
      expect(rebindVictim.connections).toBe(0);
      // The rebinding name really was requested by the page.
      expect(calls.get('rebind.test') ?? 0).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );
});

describe('SCAN-EGRESS-PROXY-1 fail-closed', () => {
  async function loadVictim(killProxy: boolean): Promise<string | null> {
    const guard: NetworkGuardPolicy = { allowPrivate: true };
    const browser = await launchChromium({ guard });
    try {
      const proxy = egressProxyOf(browser);
      expect(proxy?.listening).toBe(true);
      if (killProxy) await proxy?.close();
      const page = await browser.newPage();
      await guardPageRequests(page, guard);
      try {
        await page.goto(`http://${VICTIM_IP}:${victimPort}/direct`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    } finally {
      await safeCloseBrowser(browser);
    }
  }

  it(
    '[fail-closed] with the proxy gone the load fails loudly and Chromium never reaches the target directly',
    async () => {
      const error = await loadVictim(true);
      await settle();
      expect(error).toMatch(/ERR_PROXY_CONNECTION_FAILED/);
      expect(victim.connections).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    '[control] with the proxy up the same allowPrivate load DOES reach the target',
    async () => {
      const error = await loadVictim(false);
      await settle();
      expect(error).toBeNull();
      expect(victim.requests).toContain('/direct');
    },
    TEST_TIMEOUT,
  );

  it(
    '[measured] Chromium sends plain ws:// through the proxy as CONNECT, which the proxy refuses',
    async () => {
      const seen: string[] = [];
      const browser = await launchChromium({ guard: {} }, {
        startEgressProxy: (policy) => startEgressProxy(policy, { onEvent: (e) => seen.push(`${e.kind} ${e.method} ${e.target}`) }),
      });
      try {
        const page = await browser.newPage();
        await page.goto('about:blank');
        await page.evaluate((port) => { new WebSocket(`ws://127.0.0.1:${port}/plain`); }, victimPort);
        const deadline = Date.now() + 5_000;
        while (seen.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      } finally {
        await safeCloseBrowser(browser);
      }
      expect(seen).toEqual([`refused CONNECT ${VICTIM_IP}:${victimPort}`]);
      expect(victim.connections).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    '[teardown] closing the browser closes its proxy',
    async () => {
      const browser = await launchChromium({ guard: {} });
      const proxy = egressProxyOf(browser);
      expect(proxy?.listening).toBe(true);
      await safeCloseBrowser(browser);
      expect(proxy?.listening).toBe(false);
      expect(proxy?.activeConnections()).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
