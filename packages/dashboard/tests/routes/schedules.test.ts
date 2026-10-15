import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hermetic DNS for the start-URL check: a name containing `private-name` resolves to a
// private address, every other name to a public documentation address.
vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (hostname: string): Promise<readonly string[]> =>
    hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'],
}));
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { scheduleRoutes } from '../../src/routes/schedules.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import type { StartUrlValidator } from '../../src/routes/schedules.js';
import { PRIVATE_TARGET_ERROR, ScanService } from '../../src/services/scan-service.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = ALL_PERMISSION_IDS as unknown as string[],
  validateStartUrl?: StartUrlValidator,
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-schedules-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

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

  await scheduleRoutes(server, storage, validateStartUrl);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

async function createNoPermServer(): Promise<TestContext> {
  return createTestServer([]);
}

describe('Schedule routes', () => {
  describe('GET /schedules', () => {
    it('returns 403 without scans.schedule permission', async () => {
      const ctx = await createNoPermServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/schedules' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with schedules template when authorized', async () => {
      const ctx = await createTestServer(['scans.schedule']);
      const response = await ctx.server.inject({ method: 'GET', url: '/schedules' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('schedules.hbs');
    });

    it('lists schedules in template data', async () => {
      const ctx = await createTestServer(['scans.schedule']);
      await ctx.storage.schedules.createSchedule({
        id: randomUUID(),
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        scanMode: 'site',
        jurisdictions: [],
        frequency: 'weekly',
        nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdBy: 'alice',
        orgId: 'system',
        runner: 'htmlcs',
        incremental: false,
      });
      const response = await ctx.server.inject({ method: 'GET', url: '/schedules' });
      ctx.cleanup();
      const body = response.json() as { data: { schedules: unknown[]; hasSchedules: boolean } };
      expect(body.data.schedules).toHaveLength(1);
      expect(body.data.hasSchedules).toBe(true);
    });
  });

  describe('POST /schedules', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(['scans.schedule']); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without scans.schedule permission', async () => {
      const noPerm = await createNoPermServer();
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&frequency=weekly',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('creates a schedule and sets HX-Redirect header', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&standard=WCAG2AA&frequency=weekly',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['hx-redirect']).toBe('/schedules');
      const schedules = await ctx.storage.schedules.listSchedules('system');
      expect(schedules).toHaveLength(1);
    });

    it('returns 400 when siteUrl is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'standard=WCAG2AA&frequency=weekly',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when siteUrl is not a valid URL', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=not-a-url&standard=WCAG2AA&frequency=weekly',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /schedules start url validation', () => {
    const post = (ctx: TestContext, siteUrl: string) =>
      ctx.server.inject({
        method: 'POST',
        url: '/schedules',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `siteUrl=${encodeURIComponent(siteUrl)}&standard=WCAG2AA&frequency=weekly`,
      });

    it('HARD-14 schedule create validates the start url with the shared start validation', async () => {
      const ctx = await createTestServer(['scans.schedule']);
      const response = await post(ctx, 'http://127.0.0.1/');
      const stored = await ctx.storage.schedules.listSchedules('system');
      ctx.cleanup();
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain(PRIVATE_TARGET_ERROR);
      expect(stored).toHaveLength(0);
    });

    it('HARD-14 schedule create refuses a name that resolves to a private address', async () => {
      const ctx = await createTestServer(['scans.schedule']);
      const response = await post(ctx, 'https://private-name.example.com/');
      const stored = await ctx.storage.schedules.listSchedules('system');
      ctx.cleanup();
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain(PRIVATE_TARGET_ERROR);
      expect(stored).toHaveLength(0);
    });

    it('HARD-14 schedule create stores a schedule for a public start url', async () => {
      const ctx = await createTestServer(['scans.schedule']);
      const response = await post(ctx, 'https://www.example.com');
      const stored = await ctx.storage.schedules.listSchedules('system');
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.siteUrl).toBe('https://www.example.com/');
    });

    it('HARD-14 schedule create honours allowPrivateScanTargets through the shared validation', async () => {
      const config = { allowPrivateScanTargets: true, maxPages: 100 } as unknown as DashboardConfig;
      const service = new ScanService({} as never, {} as unknown as ScanOrchestrator, config);
      const ctx = await createTestServer(['scans.schedule'], (raw) => service.validateStartUrl(raw));
      const response = await post(ctx, 'http://127.0.0.1/');
      const stored = await ctx.storage.schedules.listSchedules('system');
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.siteUrl).toBe('http://127.0.0.1/');
    });
  });

  describe('PATCH /schedules/:id/toggle', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(['scans.schedule']); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without scans.schedule permission', async () => {
      const noPerm = await createNoPermServer();
      const response = await noPerm.server.inject({ method: 'PATCH', url: '/schedules/some-id/toggle' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent schedule', async () => {
      const response = await ctx.server.inject({ method: 'PATCH', url: '/schedules/non-existent-id/toggle' });
      expect(response.statusCode).toBe(404);
    });

    it('toggles a schedule and sets HX-Redirect header', async () => {
      const id = randomUUID();
      await ctx.storage.schedules.createSchedule({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        scanMode: 'site',
        jurisdictions: [],
        frequency: 'weekly',
        nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdBy: 'alice',
        orgId: 'system',
        runner: 'htmlcs',
        incremental: false,
      });
      const response = await ctx.server.inject({ method: 'PATCH', url: `/schedules/${id}/toggle` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['hx-redirect']).toBe('/schedules');
      const updated = await ctx.storage.schedules.getSchedule(id);
      expect(updated?.enabled).toBe(false);
    });
  });

  describe('DELETE /schedules/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(['scans.schedule']); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without scans.schedule permission', async () => {
      const noPerm = await createNoPermServer();
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/schedules/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent schedule', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/schedules/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('deletes a schedule and sets HX-Redirect header', async () => {
      const id = randomUUID();
      await ctx.storage.schedules.createSchedule({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        scanMode: 'site',
        jurisdictions: [],
        frequency: 'weekly',
        nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdBy: 'alice',
        orgId: 'system',
        runner: 'htmlcs',
        incremental: false,
      });
      const response = await ctx.server.inject({ method: 'DELETE', url: `/schedules/${id}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['hx-redirect']).toBe('/schedules');
      const deleted = await ctx.storage.schedules.getSchedule(id);
      expect(deleted).toBeNull();
    });
  });
});
