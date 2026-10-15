/**
 * HARD-14 (retry and cancel half) — POST /reports/:id/retry and /cancel.
 *
 * Retry and cancel need the scans.create permission and the scan's organization; retry
 * also draws one start from the shared scan-start limit and validates the stored start URL
 * before anything starts. The caller is parametrised per test (role, current org, org-scoped
 * key flag, permission set); the limiter is injected with a frozen clock and an inspectable
 * store so a test can read which keys were charged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hermetic DNS for the start-URL check: a name containing `private-name` resolves to a
// private address, every other name to a public documentation address.
vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (hostname: string): Promise<readonly string[]> =>
    hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'],
}));
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { scanRoutes } from '../../src/routes/scan.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import {
  PRIVATE_TARGET_ERROR,
  SCAN_RATE_LIMIT_ERROR,
  createScanStartLimiter,
} from '../../src/services/scan-service.js';
import type { DashboardConfig } from '../../src/config.js';
import type { ScanRecord } from '../../src/db/types.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const NOW = 1_000_000;

interface Caller {
  id: string;
  role: string;
  currentOrgId?: string;
  orgScopedApiKey?: boolean;
  permissions: string[];
}

interface Harness {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  startScan: ReturnType<typeof vi.fn>;
  limiterStore: Map<string, readonly number[]>;
  caller: Caller;
  orgA: string;
  orgB: string;
  cleanup: () => Promise<void>;
}

const MEMBER: Omit<Caller, 'currentOrgId'> = {
  id: 'u-northwind',
  role: 'user',
  permissions: ['scans.create', 'reports.view'],
};

async function build(): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-scan-retry-cancel-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-scan-retry-cancel-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const orgA = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' })).id;
  const orgB = (await storage.organizations.createOrg({ name: 'Northwind', slug: 'northwind' })).id;

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    maxPages: 100,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
    runner: 'htmlcs',
  };
  const orchestrator = new ScanOrchestrator(storage, reportsDir, 2);
  const startScan = vi.spyOn(orchestrator, 'startScan').mockReturnValue(undefined);

  const limiterStore = new Map<string, readonly number[]>();
  const limiter = createScanStartLimiter({ now: () => NOW, store: limiterStore });
  const caller: Caller = { ...MEMBER, currentOrgId: orgA };

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: caller.id,
      username: 'tester',
      role: caller.role,
      ...(caller.currentOrgId !== undefined ? { currentOrgId: caller.currentOrgId } : {}),
      ...(caller.orgScopedApiKey === true ? { orgScopedApiKey: true } : {}),
    } as never;
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(caller.permissions);
  });
  await scanRoutes(server, storage, orchestrator, config, undefined, limiter);
  await server.ready();

  return {
    server,
    storage,
    startScan,
    limiterStore,
    caller,
    orgA,
    orgB,
    async cleanup() {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
      vi.restoreAllMocks();
    },
  };
}

async function seed(
  h: Harness,
  orgId: string,
  status: 'queued' | 'running' | 'failed',
  siteUrl = 'https://scan-target.example/',
): Promise<string> {
  const id = randomUUID();
  await h.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: ['EU'],
    regulations: [],
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    orgId,
  });
  if (status !== 'queued') {
    await h.storage.scans.updateScan(id, {
      status,
      ...(status === 'failed' ? { error: 'earlier failure', completedAt: new Date().toISOString() } : {}),
    });
  }
  return id;
}

async function row(h: Harness, id: string): Promise<ScanRecord> {
  const scan = await h.storage.scans.getScan(id);
  if (scan === null) throw new Error('row missing');
  return scan;
}

const HTMX = { 'hx-request': 'true' };

let h: Harness;
beforeEach(async () => {
  h = await build();
});
afterEach(async () => {
  await h.cleanup();
});

describe('POST /reports/:id/retry', () => {
  it('HARD-14 retry requires the scan create permission', async () => {
    const id = await seed(h, h.orgA, 'failed');
    h.caller.permissions = ['reports.view', 'scans.schedule'];

    const plain = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry` });
    expect(plain.statusCode).toBe(403);

    const htmx = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry`, headers: HTMX });
    expect(htmx.statusCode).toBe(403);
    expect(htmx.headers['hx-reswap']).toBe('none');
    expect(htmx.body).toContain('toast--error');

    expect(h.startScan).not.toHaveBeenCalled();
    expect((await row(h, id)).status).toBe('failed');
    expect(h.limiterStore.size).toBe(0);
  });

  it('HARD-14 retry is scoped to the scan organization', async () => {
    const foreign = await seed(h, h.orgB, 'failed');
    const system = await seed(h, 'system', 'failed');

    const other = await h.server.inject({ method: 'POST', url: `/reports/${foreign}/retry` });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual({ error: 'Scan not found' });

    const onSystem = await h.server.inject({ method: 'POST', url: `/reports/${system}/retry` });
    expect(onSystem.statusCode).toBe(404);

    expect(h.startScan).not.toHaveBeenCalled();
    expect((await row(h, foreign)).status).toBe('failed');
    expect((await row(h, system)).status).toBe('failed');
    expect(h.limiterStore.size).toBe(0);
  });

  it('HARD-14 retry validates the stored start url before starting', async () => {
    const loopback = await seed(h, h.orgA, 'failed', 'http://127.0.0.1/');
    const resolvesPrivately = await seed(h, h.orgA, 'failed', 'https://private-name.example/');

    for (const id of [loopback, resolvesPrivately]) {
      const res = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: PRIVATE_TARGET_ERROR });
      const stored = await row(h, id);
      expect(stored.status).toBe('failed');
      expect(stored.error).toBe(PRIVATE_TARGET_ERROR);
    }
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('HARD-14 retry uses the shared scan start limit', async () => {
    const id = await seed(h, h.orgA, 'failed');
    h.limiterStore.set('user:u-northwind', Array.from({ length: 30 }, () => NOW - 1000));

    const refused = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry` });
    expect(refused.statusCode).toBe(429);
    const retryAfter = Number(String(refused.headers['retry-after']));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(refused.json()).toEqual({ error: SCAN_RATE_LIMIT_ERROR });
    expect(h.startScan).not.toHaveBeenCalled();
    expect((await row(h, id)).status).toBe('failed');

    // A permitted retry by another caller records exactly one start for that caller's key.
    h.caller.id = 'u-contoso';
    const ok = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry` });
    expect(ok.statusCode).toBe(302);
    expect(h.limiterStore.get('user:u-contoso')).toHaveLength(1);
  });

  it('HARD-14 retry restarts a failed scan with a valid start url', async () => {
    const id = await seed(h, h.orgA, 'failed');
    const res = await h.server.inject({ method: 'POST', url: `/reports/${id}/retry` });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`/scan/${id}/progress`);
    expect((await row(h, id)).status).toBe('queued');
    expect(h.startScan).toHaveBeenCalledTimes(1);
    const [calledId, config] = h.startScan.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledId).toBe(id);
    expect(config['siteUrl']).toBe('https://scan-target.example/');
    expect(config['standard']).toBe('WCAG2AA');
    expect(config['jurisdictions']).toEqual(['EU']);
    expect(config['orgId']).toBe(h.orgA);

    const second = await seed(h, h.orgA, 'failed');
    const htmx = await h.server.inject({ method: 'POST', url: `/reports/${second}/retry`, headers: HTMX });
    expect(htmx.statusCode).toBe(200);
    expect(htmx.headers['hx-redirect']).toBe(`/scan/${second}/progress`);
    expect(h.startScan).toHaveBeenCalledTimes(2);
  });
});
