/**
 * Proves the scan form, GraphQL createScan, report retry and the scan service
 * handed to the MCP routes draw from ONE scan-start bucket in the REAL
 * createServer wiring. The unit tests build their own limiter and
 * hand it to both callers; this proves createServer does that itself. A broken
 * wiring (a limiter per ScanService instance) lets 30 starts through each
 * surface, which this test refuses to see as a pass.
 * Hosts are placeholders; DNS is hermetic; a second storage adapter on the
 * same file seeds the signed-in user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (): Promise<readonly string[]> => ['93.184.215.14'],
}));

// Records the scan service createServer hands to the MCP routes, then delegates to the real registration.
const mcpCapture = vi.hoisted(() => ({ scanService: undefined as unknown }));
vi.mock('../../src/routes/api/mcp.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/routes/api/mcp.js')>();
  return {
    ...actual,
    registerMcpRoutes: ((server, opts) => {
      mcpCapture.scanService = opts.scanService;
      return actual.registerMcpRoutes(server, opts);
    }) as typeof actual.registerMcpRoutes,
  };
});

import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { SCAN_RATE_LIMIT_ERROR, type ScanService } from '../../src/services/scan-service.js';

const PASSWORD = 'Wiring-Admin-Pass-123!';
const CREATE_SCAN = 'mutation { createScan(input: { siteUrl: "https://example.com" }) { id status } }';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let startScan: ReturnType<typeof vi.spyOn>;

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

/** A password session as a browser holds it after opening the scan form: cookie + page token. */
async function adminSession(username = 'wiring-admin'): Promise<Session> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  let cookie = login.cookies.find((c) => c.name === 'session')!.value;
  const formPage = await app.inject({ method: 'GET', url: '/scan/new', cookies: { session: cookie } });
  expect(formPage.statusCode).toBe(200);
  cookie = formPage.cookies.find((c) => c.name === 'session')?.value ?? cookie;
  const csrf = tokenOf(formPage.body);
  expect(csrf).toBeDefined();
  return { cookie, csrf: csrf! };
}

async function graphqlCreateScan(s: Session): Promise<{ errors?: ReadonlyArray<{ message: string }> }> {
  const res = await app.inject({
    method: 'POST', url: '/graphql', cookies: { session: s.cookie },
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ query: CREATE_SCAN }),
  });
  return JSON.parse(res.body) as { errors?: ReadonlyArray<{ message: string }> };
}

const FORM = 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA';

/** One scan start through the scan form; returns the response (a 302 to the progress page on success). */
function formStart(s: Session) {
  return app.inject({
    method: 'POST', url: '/scan/new', cookies: { session: s.cookie },
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': s.csrf },
    payload: FORM,
  });
}

const scanIdOf = (location: unknown): string => /\/scan\/([^/]+)\/progress/.exec(String(location))![1]!;

beforeEach(() => {
  startScan.mockClear();
});

beforeAll(async () => {
  startScan = vi.spyOn(ScanOrchestrator.prototype, 'startScan').mockImplementation(() => undefined as never);
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-scan-start-wiring-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'e'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  await seed.users.createUser('wiring-admin', PASSWORD, 'admin');
  await seed.users.createUser('wiring-mcp', PASSWORD, 'admin');
  await seed.users.createUser('wiring-retry', PASSWORD, 'admin');
  // The reachability probe uses global fetch; stub it AFTER boot so server
  // start-up traffic is untouched.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createServer scan start limit wiring', () => {
  it('SCAN-02 wiring createServer scan new and graphql createScan share one rate limit bucket', async () => {
    const s = await adminSession();

    for (let i = 0; i < 30; i += 1) {
      const body = await graphqlCreateScan(s);
      expect(body.errors, `graphql start ${i + 1} must succeed`).toBeUndefined();
    }
    expect(startScan).toHaveBeenCalledTimes(30);

    const form = 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA';
    const json = await app.inject({
      method: 'POST', url: '/scan/new', cookies: { session: s.cookie },
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': s.csrf },
      payload: form,
    });
    expect(json.statusCode).toBe(429);
    expect((json.json() as { error: string }).error).toBe(SCAN_RATE_LIMIT_ERROR);
    expect(Number(String(json.headers['retry-after']))).toBeGreaterThanOrEqual(1);

    const htmx = await app.inject({
      method: 'POST', url: '/scan/new', cookies: { session: s.cookie },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': s.csrf,
        'hx-request': 'true',
      },
      payload: form,
    });
    expect(htmx.statusCode).toBe(429);
    expect(htmx.body).toContain(SCAN_RATE_LIMIT_ERROR);

    const thirtyFirst = await graphqlCreateScan(s);
    expect(thirtyFirst.errors?.[0]?.message).toBe(SCAN_RATE_LIMIT_ERROR);
    expect(startScan).toHaveBeenCalledTimes(30);
  }, 120_000);
  it('HARD-15 createServer hands the mcp tools a scan service that shares the form scan start bucket', async () => {
    const user = await seed.users.getUserByUsername('wiring-mcp');
    expect(user, 'the seeded user must exist').not.toBeNull();
    const s = await adminSession('wiring-mcp');
    for (let i = 0; i < 30; i += 1) {
      const res = await formStart(s);
      expect(res.statusCode, `form start ${i + 1} must succeed`).toBe(302);
    }
    expect(startScan).toHaveBeenCalledTimes(30);

    const mcpScanService = mcpCapture.scanService as ScanService;
    expect(mcpScanService, 'createServer must hand a scan service to registerMcpRoutes').toBeDefined();
    const subject = { userId: user!.id, apiKeyId: undefined, clientIp: undefined };

    const spent = mcpScanService.consumeScanStart(subject);
    expect(spent?.error).toBe(SCAN_RATE_LIMIT_ERROR);

    const site = await mcpScanService.initiateScanRateLimited(
      { siteUrl: 'https://example.com', standard: 'WCAG2AA', scanMode: 'single' },
      { orgId: 'system', username: user!.id, complianceToken: '', startSubject: subject },
    );
    expect(site.ok).toBe(false);
    expect(site.ok === false && site.error).toBe(SCAN_RATE_LIMIT_ERROR);
    expect(startScan).toHaveBeenCalledTimes(30);

    // Another caller's bucket is untouched.
    expect(
      mcpScanService.consumeScanStart({ userId: 'someone-else', apiKeyId: undefined, clientIp: undefined }),
    ).toBeUndefined();
  }, 120_000);

  it('HARD-14 createServer retry draws from the bucket the scan form uses', async () => {
    const s = await adminSession('wiring-retry');
    const first = await formStart(s);
    expect(first.statusCode).toBe(302);
    const id = scanIdOf(first.headers['location']);

    const cancel = await app.inject({
      method: 'POST', url: `/reports/${id}/cancel`, cookies: { session: s.cookie },
      headers: { 'x-csrf-token': s.csrf },
    });
    expect(cancel.statusCode).toBe(302);
    expect((await seed.scans.getScan(id))?.status).toBe('failed');

    for (let i = 0; i < 29; i += 1) {
      const res = await formStart(s);
      expect(res.statusCode, `form start ${i + 2} must succeed`).toBe(302);
    }
    expect(startScan).toHaveBeenCalledTimes(30);

    const retry = await app.inject({
      method: 'POST', url: `/reports/${id}/retry`, cookies: { session: s.cookie },
      headers: { 'x-csrf-token': s.csrf },
    });
    expect(retry.statusCode).toBe(429);
    expect((retry.json() as { error: string }).error).toBe(SCAN_RATE_LIMIT_ERROR);
    expect(Number(String(retry.headers['retry-after']))).toBeGreaterThanOrEqual(1);
    expect(startScan).toHaveBeenCalledTimes(30);
    expect((await seed.scans.getScan(id))?.status).toBe('failed');
  }, 120_000);
});
