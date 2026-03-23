import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { emailReportRoutes } from '../../src/routes/admin/email-reports.js';
import { PluginManager } from '../../src/plugins/manager.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['admin.system']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-email-reports-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-plugins-email-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const pluginManager = new PluginManager({
    db: storage.getRawDatabase(),
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: [],
  });

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

  await emailReportRoutes(server, storage, pluginManager);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, cleanup };
}

async function setupSmtp(ctx: TestContext): Promise<void> {
  await ctx.storage.email.upsertSmtpConfig({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    username: 'test',
    password: 'pass',
    fromAddress: 'noreply@example.com',
    fromName: 'Test',
    orgId: 'system',
  });
}

async function makeEmailReport(ctx: TestContext, name = 'Weekly Report') {
  return ctx.storage.email.createEmailReport({
    id: randomUUID(),
    name,
    siteUrl: 'https://example.com',
    recipients: 'test@example.com',
    frequency: 'weekly',
    format: 'pdf',
    nextSendAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'alice',
    orgId: 'system',
  });
}

describe('Email report routes', () => {
  describe('GET /admin/email-reports', () => {
    it('returns 403 without admin.system permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/email-reports' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('redirects to /admin/plugins when no plugin or smtp config', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/email-reports' });
      ctx.cleanup();
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/admin/plugins');
    });

    it('returns 200 with email-reports template when SMTP is configured', async () => {
      const ctx = await createTestServer();
      await setupSmtp(ctx);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/email-reports' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/email-reports.hbs');
    });

    it('lists email reports in template data', async () => {
      const ctx = await createTestServer();
      await setupSmtp(ctx);
      await makeEmailReport(ctx, 'Report 1');
      await makeEmailReport(ctx, 'Report 2');
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/email-reports' });
      ctx.cleanup();
      const body = response.json() as { data: { reports: unknown[] } };
      expect(body.data.reports).toHaveLength(2);
    });
  });

  describe('POST /admin/email-reports/smtp', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.system permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/email-reports/smtp',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'host=smtp.example.com&port=587&username=u&password=p&fromAddress=a@b.com',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when host is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/email-reports/smtp',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'port=587&username=user&password=pass&fromAddress=a@b.com',
      });
      expect(response.statusCode).toBe(400);
    });

    it('saves SMTP config and returns success toast', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/email-reports/smtp',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'host=smtp.example.com&port=587&username=testuser&password=testpass&fromAddress=noreply@example.com',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      const saved = await ctx.storage.email.getSmtpConfig('system');
      expect(saved?.host).toBe('smtp.example.com');
    });
  });

  describe('POST /admin/email-reports', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.system permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/email-reports',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=Test&siteUrl=https://example.com&recipients=t@e.com&frequency=weekly&format=pdf',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/email-reports',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https%3A%2F%2Fexample.com&recipients=t%40e.com&frequency=weekly&format=pdf',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid email in recipients', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/email-reports',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=Test&siteUrl=https%3A%2F%2Fexample.com&recipients=not-an-email&frequency=weekly&format=pdf',
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates an email report schedule and returns HTML row', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/email-reports',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=Weekly+Accessibility&siteUrl=https%3A%2F%2Fexample.com&recipients=admin%40example.com&frequency=weekly&format=pdf',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      const reports = await ctx.storage.email.listEmailReports('system');
      expect(reports).toHaveLength(1);
      expect(reports[0].name).toBe('Weekly Accessibility');
    });
  });

  describe('PATCH /admin/email-reports/:id/toggle', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.system permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'PATCH', url: '/admin/email-reports/some-id/toggle' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent report', async () => {
      const response = await ctx.server.inject({ method: 'PATCH', url: '/admin/email-reports/non-existent-id/toggle' });
      expect(response.statusCode).toBe(404);
    });

    it('toggles the enabled status', async () => {
      await setupSmtp(ctx);
      const report = await makeEmailReport(ctx);
      const response = await ctx.server.inject({ method: 'PATCH', url: `/admin/email-reports/${report.id}/toggle` });
      expect(response.statusCode).toBe(200);
      const updated = await ctx.storage.email.getEmailReport(report.id);
      expect(updated?.enabled).toBe(false);
    });
  });

  describe('DELETE /admin/email-reports/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.system permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/admin/email-reports/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent report', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/email-reports/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('deletes an email report', async () => {
      await setupSmtp(ctx);
      const report = await makeEmailReport(ctx);
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/email-reports/${report.id}` });
      expect(response.statusCode).toBe(200);
      const deleted = await ctx.storage.email.getEmailReport(report.id);
      expect(deleted).toBeNull();
    });
  });
});
