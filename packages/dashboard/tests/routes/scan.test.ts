import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { scanRoutes } from '../../src/routes/scan.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orchestrator: ScanOrchestrator;
  config: DashboardConfig;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['scans.create', 'reports.view']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-scan-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-scan-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

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
  // Stub out startScan so we never actually launch a real scan process
  vi.spyOn(orchestrator, 'startScan').mockReturnValue(undefined);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await scanRoutes(server, storage, orchestrator, config);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
    vi.restoreAllMocks();
  };

  return { server, storage, orchestrator, config, cleanup };
}

/** Stub global fetch to return a successful HEAD response. */
function stubFetchOk(): MockInstance {
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
  }));
}

async function makeScan(ctx: TestContext, orgId = 'system'): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId,
  });
  return id;
}

describe('Scan Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.unstubAllGlobals();
  });

  describe('GET /scan/new', () => {
    it('renders scan-new.hbs form', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('scan-new.hbs');
    });

    it('includes standards and defaultStandard in template data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      const body = response.json() as {
        data: {
          standards: string[];
          defaultStandard: string;
          pageTitle: string;
        };
      };
      expect(body.data.standards).toContain('WCAG2AA');
      expect(body.data.defaultStandard).toBe('WCAG2AA');
      expect(body.data.pageTitle).toBe('New Scan');
    });

    it('includes prefillUrl in template data when prefill query param is provided', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new?prefill=https%3A%2F%2Fprefilled.com',
      });

      const body = response.json() as { data: { prefillUrl: string } };
      expect(body.data.prefillUrl).toBe('https://prefilled.com');
    });
  });

  describe('POST /scan/new', () => {
    it('returns 400 when siteUrl is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('siteUrl');
    });

    it('returns 400 when siteUrl is not a valid URL', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=not-a-url&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('valid URL');
    });

    it('returns 400 for invalid standard', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=INVALID',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('standard');
    });

    it('creates scan record and redirects to progress page on valid input', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      // Should redirect to /scan/:id/progress
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toMatch(/^\/scan\/.+\/progress$/);

      // Verify scan was created in storage
      const scans = await ctx.storage.scans.listScans({ orgId: 'system' });
      expect(scans.length).toBeGreaterThan(0);
    });

    it('calls orchestrator.startScan after creating the scan record', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /scan/:id/progress', () => {
    it('renders scan-progress.hbs for an existing scan', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/progress`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('scan-progress.hbs');
    });

    it('includes scan data in template', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/progress`,
      });

      const body = response.json() as { data: { scan: { id: string } } };
      expect(body.data.scan.id).toBe(scanId);
    });

    it('handles non-existent scan ID — returns 404', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/non-existent-id/progress',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Scan not found');
    });

    it('returns 404 when scan belongs to a different org', async () => {
      const scanId = await makeScan(ctx, 'other-org');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/progress`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
