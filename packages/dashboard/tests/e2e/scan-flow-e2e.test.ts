import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type TestContext } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { homeRoutes } from '../../src/routes/home.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { scanRoutes } from '../../src/routes/scan.js';
import { registerSession } from '../../src/auth/session.js';
import type { DashboardConfig } from '../../src/config.js';

/**
 * E2E test for the scan flow: create scan, list, view progress, view report, home page.
 *
 * Builds a focused test server with auth injected via a preHandler hook
 * (added before server.ready()) so request.user and permissions are set
 * for every request.
 */

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface E2EContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orchestrator: ScanOrchestrator;
  config: DashboardConfig;
  cleanup: () => void;
}

let ctx: E2EContext;

async function createE2EServer(): Promise<E2EContext> {
  const dbPath = join(tmpdir(), `test-e2e-scan-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-e2e-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
  };

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const orchestrator = new ScanOrchestrator(storage, reportsDir, 2);
  vi.spyOn(orchestrator, 'startScan').mockReturnValue(undefined);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub reply.view to return JSON
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Inject auth on every request (before server.ready)
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'test-user-id',
      username: 'testuser',
      role: 'admin',
      currentOrgId: 'system',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set([
      'scans.create',
      'reports.view',
      'reports.delete',
      'trends.view',
    ]);
  });

  // Register the routes needed for scan flow E2E
  await homeRoutes(server, storage, config);
  await scanRoutes(server, storage, orchestrator, config);
  await reportRoutes(server, storage);

  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, orchestrator, config, cleanup };
}

/** Stub global fetch so URL reachability checks succeed. */
function stubFetchOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  );
}

/** Helper to create a scan directly in storage for tests that need pre-existing data. */
async function insertScan(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'testuser',
    createdAt: new Date().toISOString(),
    orgId: 'system',
    ...overrides,
  });
  return id;
}

describe('Scan Flow E2E', () => {
  beforeAll(async () => {
    stubFetchOk();
    ctx = await createE2EServer();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  // ── 1. New scan page loads ──────────────────────────────────────────────

  describe('GET /scan/new — new scan form', () => {
    it('returns 200 with scan-new template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('scan-new.hbs');
    });

    it('includes standards list and default standard', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      const body = response.json() as {
        data: { standards: string[]; defaultStandard: string };
      };
      expect(body.data.standards).toContain('WCAG2AA');
      expect(body.data.defaultStandard).toBe('WCAG2AA');
    });
  });

  // ── 2. Start a scan ────────────────────────────────────────────────────

  describe('POST /scan/new — start a scan', () => {
    it('creates a scan and redirects to progress page', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&scanMode=single',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toMatch(/^\/scan\/.+\/progress$/);
    });

    it('queues the scan in storage', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fqueued-test.example.com&standard=WCAG2AA',
      });

      const scans = await ctx.storage.scans.listScans({ orgId: 'system' });
      // URL.toString() may add a trailing slash
      const queued = scans.find((s) => s.siteUrl.startsWith('https://queued-test.example.com'));
      expect(queued).toBeDefined();
      expect(queued!.status).toBe('queued');
    });

    it('calls orchestrator.startScan', async () => {
      const callsBefore = (ctx.orchestrator.startScan as ReturnType<typeof vi.fn>).mock.calls.length;

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Forch-test.example.com&standard=WCAG2AA',
      });

      const callsAfter = (ctx.orchestrator.startScan as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    it('returns 400 for invalid URL', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=not-a-url&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── 3. List scans ──────────────────────────────────────────────────────

  describe('GET /reports — list scans', () => {
    it('lists scans in reports page', async () => {
      // Insert a known scan
      const scanId = await insertScan({ siteUrl: 'https://list-test.example.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: { scans: Array<{ id: string; siteUrl: string }> };
      };
      expect(body.template).toBe('reports-list.hbs');
      const found = body.data.scans.find((s) => s.id === scanId);
      expect(found).toBeDefined();
      expect(found!.siteUrl).toBe('https://list-test.example.com');
    });

    it('shows scans created via POST /scan/new', async () => {
      // Create a scan through the route
      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Froute-created.example.com&standard=WCAG2AA',
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      const body = response.json() as {
        data: { scans: Array<{ siteUrl: string }> };
      };
      // URL.toString() may add a trailing slash
      const found = body.data.scans.find((s) => s.siteUrl.startsWith('https://route-created.example.com'));
      expect(found).toBeDefined();
    });
  });

  // ── 4. Scan status via SSE (basic check) ───────────────────────────────

  describe('GET /scan/:id/events — SSE endpoint', () => {
    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${randomUUID()}/events`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('sends final event for completed scan', async () => {
      const scanId = await insertScan({ siteUrl: 'https://sse-test.example.com' });
      // Mark scan as completed so the SSE handler sends a final event immediately
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      // SSE endpoint hijacks the response for completed scans and sends
      // a final event. inject() returns the raw response body.
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event:');
    });
  });

  // ── 5. View report ─────────────────────────────────────────────────────

  describe('GET /reports/:id — view report', () => {
    it('returns 404 for non-existent report', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('renders report-detail template for queued scan', async () => {
      const scanId = await insertScan({ siteUrl: 'https://report-view.example.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: { scan: { id: string; siteUrl: string } };
      };
      expect(body.template).toBe('report-detail.hbs');
      expect(body.data.scan.id).toBe(scanId);
    });

    it('renders report-detail for completed scan (no report data)', async () => {
      const scanId = await insertScan({
        siteUrl: 'https://completed-report.example.com',
      });
      // Mark scan as completed
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        totalIssues: 5,
        pagesScanned: 3,
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: { scan: { siteUrl: string }; reportData: unknown };
      };
      expect(body.template).toBe('report-detail.hbs');
      expect(body.data.scan.siteUrl).toBe('https://completed-report.example.com');
    });
  });

  // ── 6. Home page shows recent scans ────────────────────────────────────

  describe('GET /home — recent scans', () => {
    it('renders home template with recent scans', async () => {
      await insertScan({ siteUrl: 'https://home-test.example.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: {
          recentScans: Array<{ siteUrl: string }>;
          stats: { totalScans: number };
        };
      };
      expect(body.template).toBe('home.hbs');
      expect(body.data.stats.totalScans).toBeGreaterThan(0);
    });

    it('includes the scan in recentScans list', async () => {
      const url = `https://home-recent-${Date.now()}.example.com`;
      await insertScan({ siteUrl: url });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as {
        data: { recentScans: Array<{ siteUrl: string }> };
      };
      const found = body.data.recentScans.find((s) => s.siteUrl === url);
      expect(found).toBeDefined();
    });
  });
});
