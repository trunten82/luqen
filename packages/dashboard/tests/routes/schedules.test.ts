import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { scheduleRoutes } from '../../src/routes/schedules.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ALL_PERMISSION_IDS as unknown as string[]): Promise<TestContext> {
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

  await scheduleRoutes(server, storage);
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
