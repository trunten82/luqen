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

async function makeScan(ctx: TestContext, orgId = 'system', overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId,
    ...overrides,
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

    it('sets prefillUrl to undefined when prefill param is empty', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new?prefill=',
      });

      const body = response.json() as { data: { prefillUrl?: string } };
      expect(body.data.prefillUrl).toBeUndefined();
    });

    it('sets prefillUrl to undefined when prefill param is whitespace', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new?prefill=%20%20',
      });

      const body = response.json() as { data: { prefillUrl?: string } };
      expect(body.data.prefillUrl).toBeUndefined();
    });

    it('includes complianceWarning when compliance service is unreachable', async () => {
      // compliance service is not running in test, so it should show warning
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      const body = response.json() as { data: { complianceWarning: string } };
      expect(body.data.complianceWarning).toContain('unreachable');
    });

    it('includes maxConcurrency and maxPages from config', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      const body = response.json() as {
        data: { maxConcurrency: number; maxPages: number; defaultConcurrency: number; defaultRunner: string };
      };
      expect(body.data.maxConcurrency).toBe(10);
      expect(body.data.maxPages).toBe(100);
      expect(body.data.defaultConcurrency).toBe(2);
      expect(body.data.defaultRunner).toBe('htmlcs');
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
      expect(body.error).toContain('Please enter a URL to scan');
    });

    it('returns 400 when siteUrl is empty string', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
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

    it('returns 400 when URL protocol is not http or https', async () => {
      stubFetchOk();
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=ftp%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('http or https');
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

    it('returns 400 when concurrency is out of range (too high)', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&concurrency=99',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('concurrency');
    });

    it('returns 400 when concurrency is 0', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&concurrency=0',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when concurrency is NaN', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&concurrency=abc',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when jurisdictions exceed 50', async () => {
      stubFetchOk();

      const jurisdictions = Array.from({ length: 51 }, (_, i) => `jurisdictions=j${i}`).join('&');
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&${jurisdictions}`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('50 jurisdictions');
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

    it('uses single scan mode when scanMode=single', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&scanMode=single',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ scanMode: 'single' }),
      );
    });

    it('defaults scanMode to site when not "single"', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&scanMode=anything',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ scanMode: 'site' }),
      );
    });

    it('passes runner option when specified', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&runner=axe',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ runner: 'axe' }),
      );
    });

    it('falls back to config runner when invalid runner is specified', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&runner=invalid-runner',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ runner: 'htmlcs' }),
      );
    });

    it('passes incremental flag and orgId when incremental=true', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&incremental=true',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ incremental: true, orgId: 'system' }),
      );
    });

    it('does not include incremental when not set to "true"', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&incremental=false',
      });

      const callArgs = (ctx.orchestrator.startScan as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.incremental).toBeUndefined();
    });

    it('uses custom maxPages when valid', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&maxPages=50',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxPages: 50 }),
      );
    });

    it('falls back to config maxPages when maxPages is out of range', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&maxPages=9999',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxPages: 100 }),
      );
    });

    it('falls back to config maxPages when maxPages is NaN', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&maxPages=abc',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxPages: 100 }),
      );
    });

    it('falls back to config maxPages when maxPages is 0', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&maxPages=0',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxPages: 100 }),
      );
    });

    it('normalizes single jurisdiction string to array', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&jurisdictions=uk',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ jurisdictions: ['uk'] }),
      );
    });

    it('normalizes multiple jurisdictions to array', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&jurisdictions=uk&jurisdictions=eu',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ jurisdictions: ['uk', 'eu'] }),
      );
    });

    it('defaults concurrency to config value when not provided', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ concurrency: 2 }),
      );
    });

    it('accepts valid concurrency within range', async () => {
      stubFetchOk();

      await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&concurrency=5',
      });

      expect(ctx.orchestrator.startScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ concurrency: 5 }),
      );
    });

    // --- Pre-validation: URL reachability checks ---

    it('returns 400 when site returns 500+ status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('500');
    });

    it('returns 400 for ENOTFOUND (domain not found)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.invalid')));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.invalid&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Domain not found');
    });

    it('returns 400 for ECONNREFUSED', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443')));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Connection refused');
    });

    it('returns 400 for TimeoutError', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('TimeoutError: signal timed out')));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('timed out');
    });

    it('proceeds with scan when fetch throws an unknown error (WAF blocking HEAD)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('some random network error')));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      // Should proceed and redirect (not fail)
      expect(response.statusCode).toBe(302);
      expect(ctx.orchestrator.startScan).toHaveBeenCalledTimes(1);
    });

    it('proceeds with scan when site returns 4xx (not 5xx)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      }));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(302);
    });

    it('handles non-Error thrown by fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA',
      });

      // Unknown error type should let the scan proceed
      expect(response.statusCode).toBe(302);
    });

    it('defaults standard to WCAG2AA when not provided', async () => {
      stubFetchOk();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com',
      });

      expect(response.statusCode).toBe(302);
      const scans = await ctx.storage.scans.listScans({ orgId: 'system' });
      expect(scans[0].standard).toBe('WCAG2AA');
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

    it('joins jurisdictions as comma-separated string', async () => {
      const scanId = await makeScan(ctx, 'system', { jurisdictions: ['uk', 'eu'] });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/progress`,
      });

      const body = response.json() as { data: { scan: { jurisdictions: string } } };
      expect(body.data.scan.jurisdictions).toBe('uk, eu');
    });
  });

  describe('GET /scan/:id/events', () => {
    it('returns 404 when scan does not exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/non-existent-id/events',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Scan not found');
    });

    it('returns 404 when scan belongs to a different org', async () => {
      const scanId = await makeScan(ctx, 'other-org');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('sends SSE complete event for already-completed scan', async () => {
      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      // hijack means statusCode is 200 and body is raw SSE
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.body).toContain('event: complete');
      expect(response.body).toContain(`/reports/${scanId}`);
    });

    it('sends SSE failed event for already-failed scan', async () => {
      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'failed',
        error: 'Timeout exceeded',
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.body).toContain('event: failed');
      expect(response.body).toContain('Timeout exceeded');
    });

    it('sends SSE failed event with default error when scan.error is undefined', async () => {
      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'failed',
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Scan failed');
    });

    it('sends SSE stream with keepalive for in-progress scan', async () => {
      const scanId = await makeScan(ctx);
      // Scan is in queued state — neither completed nor failed

      // We need to spy on orchestrator.on to capture the listener callback
      const onSpy = vi.spyOn(ctx.orchestrator, 'on').mockImplementation((_id, listener) => {
        // Immediately emit a complete event to end the stream
        listener({
          type: 'complete',
          timestamp: new Date().toISOString(),
          data: { reportUrl: `/reports/${scanId}` },
        });
      });
      vi.spyOn(ctx.orchestrator, 'off').mockImplementation(() => {});

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      // Should contain the keepalive comment
      expect(response.body).toContain(': connected');
      // Should contain the complete event
      expect(response.body).toContain('event: complete');
      expect(onSpy).toHaveBeenCalledWith(scanId, expect.any(Function));
    });

    it('sends SSE progress events for in-progress scan', async () => {
      const scanId = await makeScan(ctx);

      vi.spyOn(ctx.orchestrator, 'on').mockImplementation((_id, listener) => {
        // Emit a progress event then complete
        listener({
          type: 'progress',
          timestamp: new Date().toISOString(),
          data: { pagesScanned: 5, totalPages: 10 },
        });
        listener({
          type: 'complete',
          timestamp: new Date().toISOString(),
          data: { reportUrl: `/reports/${scanId}` },
        });
      });
      vi.spyOn(ctx.orchestrator, 'off').mockImplementation(() => {});

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.body).toContain('event: progress');
      expect(response.body).toContain('event: complete');
    });

    it('sends failed event through SSE stream for in-progress scan', async () => {
      const scanId = await makeScan(ctx);

      vi.spyOn(ctx.orchestrator, 'on').mockImplementation((_id, listener) => {
        listener({
          type: 'failed',
          timestamp: new Date().toISOString(),
          data: { error: 'Browser crashed' },
        });
      });
      vi.spyOn(ctx.orchestrator, 'off').mockImplementation(() => {});

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      expect(response.body).toContain('event: failed');
      expect(response.body).toContain('Browser crashed');
    });

    it('stops sending events after stream is closed', async () => {
      const scanId = await makeScan(ctx);
      let capturedListener: ((event: { type: string; timestamp: string; data: unknown }) => void) | null = null;

      vi.spyOn(ctx.orchestrator, 'on').mockImplementation((_id, listener) => {
        capturedListener = listener;
        // Send complete to end the response
        listener({
          type: 'complete',
          timestamp: new Date().toISOString(),
          data: { reportUrl: `/reports/${scanId}` },
        });
      });
      vi.spyOn(ctx.orchestrator, 'off').mockImplementation(() => {});

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/scan/${scanId}/events`,
      });

      // After complete, closed=true, sending more events should be no-op
      expect(capturedListener).not.toBeNull();
      // Calling listener again after closed should not throw
      capturedListener!({
        type: 'progress',
        timestamp: new Date().toISOString(),
        data: { pagesScanned: 99 },
      });

      // Response body should not contain the post-close progress event
      // (the response was already ended after complete)
      expect(response.body).toContain('event: complete');
    });
  });
});
