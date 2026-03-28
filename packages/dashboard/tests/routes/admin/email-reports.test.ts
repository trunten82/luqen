import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { emailReportRoutes } from '../../../src/routes/admin/email-reports.js';
import { PluginManager } from '../../../src/plugins/manager.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';

// Mock email modules
vi.mock('../../../src/email/sender.js', () => ({
  testSmtpConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/email/scheduler.js', () => ({
  processEmailReport: vi.fn().mockResolvedValue(undefined),
  computeNextSendAt: vi.fn().mockReturnValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
}));

import { testSmtpConnection } from '../../../src/email/sender.js';
import { processEmailReport } from '../../../src/email/scheduler.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  pluginManager: PluginManager;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = [...ALL_PERMISSION_IDS],
  opts: { skipPluginManager?: boolean } = {},
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-email-ext-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-plugins-email-ext-${randomUUID()}`);
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
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-1',
      username: 'alice',
      role: 'admin',
      currentOrgId: 'system',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(
      permissions,
    );
  });

  await emailReportRoutes(
    server,
    storage,
    opts.skipPluginManager ? undefined : pluginManager,
  );
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, pluginManager, cleanup };
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

async function makeEmailReport(
  ctx: TestContext,
  overrides: Partial<{
    name: string;
    siteUrl: string;
    recipients: string;
    frequency: string;
    format: string;
    enabled: boolean;
  }> = {},
) {
  const report = await ctx.storage.email.createEmailReport({
    id: randomUUID(),
    name: overrides.name ?? 'Weekly Report',
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    recipients: overrides.recipients ?? 'test@example.com',
    frequency: overrides.frequency ?? 'weekly',
    format: overrides.format ?? 'pdf',
    nextSendAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'alice',
    orgId: 'system',
  });
  return report;
}

// ── GET /admin/email-reports — base coverage ──────────────────────────────

describe('GET /admin/email-reports', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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
    await makeEmailReport(ctx, { name: 'Report 1' });
    await makeEmailReport(ctx, { name: 'Report 2' });
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/email-reports' });
    ctx.cleanup();
    const body = response.json() as { data: { reports: unknown[] } };
    expect(body.data.reports).toHaveLength(2);
  });
});

// ── POST /admin/email-reports/smtp — base coverage ────────────────────────

describe('POST /admin/email-reports/smtp', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

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

// ── POST /admin/email-reports — base coverage ─────────────────────────────

describe('POST /admin/email-reports', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

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

// ── PATCH /admin/email-reports/:id/toggle — base coverage ─────────────────

describe('PATCH /admin/email-reports/:id/toggle', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

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
  });
});

// ── DELETE /admin/email-reports/:id — base coverage ───────────────────────

describe('DELETE /admin/email-reports/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

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

// ── POST /admin/email-reports/smtp — extended validation ──────────────────

describe('POST /admin/email-reports/smtp (extended)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when username is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=587&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('SMTP username is required');
  });

  it('returns 400 when password is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=587&username=user&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('SMTP password is required');
  });

  it('returns 400 when fromAddress is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=587&username=user&password=pass',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('From address is required');
  });

  it('returns 400 for invalid port number (0)', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=0&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid port number');
  });

  it('returns 400 for port number above 65535', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=99999&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid port number');
  });

  it('returns 400 for non-numeric port', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=abc&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid port number');
  });

  it('defaults secure to false when secure checkbox not sent', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=587&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(200);
    const saved = await ctx.storage.email.getSmtpConfig('system');
    expect(saved?.secure).toBe(false);
  });

  it('sets secure to true when secure=on', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=465&secure=on&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(200);
    const saved = await ctx.storage.email.getSmtpConfig('system');
    expect(saved?.secure).toBe(true);
  });

  it('defaults fromName to Luqen when not provided', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&port=587&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(200);
    const saved = await ctx.storage.email.getSmtpConfig('system');
    expect(saved?.fromName).toBe('Luqen');
  });

  it('saves custom fromName', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'host=smtp.example.com&port=587&username=user&password=pass&fromAddress=a@b.com&fromName=My+App',
    });
    expect(response.statusCode).toBe(200);
    const saved = await ctx.storage.email.getSmtpConfig('system');
    expect(saved?.fromName).toBe('My App');
  });

  it('defaults port to 587 when not provided', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'host=smtp.example.com&username=user&password=pass&fromAddress=a@b.com',
    });
    expect(response.statusCode).toBe(200);
    const saved = await ctx.storage.email.getSmtpConfig('system');
    expect(saved?.port).toBe(587);
  });
});

// ── POST /admin/email-reports/smtp/test — extended coverage ───────────────

describe('POST /admin/email-reports/smtp/test', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when no SMTP config exists and no plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp/test',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('No SMTP configuration found');
  });

  it('returns success when legacy SMTP test succeeds', async () => {
    await setupSmtp(ctx);
    vi.mocked(testSmtpConnection).mockResolvedValueOnce(true);

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp/test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SMTP connection successful');
  });

  it('returns error when legacy SMTP test fails', async () => {
    await setupSmtp(ctx);
    vi.mocked(testSmtpConnection).mockResolvedValueOnce(false);

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp/test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SMTP connection failed');
  });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp/test',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });
});

// ── POST /admin/email-reports — extended validation ───────────────────────

describe('POST /admin/email-reports (extended)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 for invalid siteUrl', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&siteUrl=not-a-url&recipients=t@e.com&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('valid site URL');
  });

  it('returns 400 when siteUrl is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&recipients=t@e.com&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('valid site URL');
  });

  it('returns 400 when recipients is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&siteUrl=https%3A%2F%2Fexample.com&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('At least one recipient');
  });

  it('returns 400 for invalid frequency', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&siteUrl=https%3A%2F%2Fexample.com&recipients=t@e.com&frequency=hourly&format=pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid frequency');
  });

  it('returns 400 for invalid format', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&siteUrl=https%3A%2F%2Fexample.com&recipients=t@e.com&frequency=weekly&format=docx',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid format');
  });

  it('returns 400 for multiple recipients with one invalid', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Test&siteUrl=https%3A%2F%2Fexample.com&recipients=good@e.com%2Cbad-email&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Invalid email address');
  });

  it('creates report with daily frequency', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Daily+Check&siteUrl=https%3A%2F%2Fexample.com&recipients=admin@example.com&frequency=daily&format=csv',
    });
    expect(response.statusCode).toBe(200);
    const reports = await ctx.storage.email.listEmailReports('system');
    expect(reports).toHaveLength(1);
    expect(reports[0].name).toBe('Daily Check');
    expect(reports[0].frequency).toBe('daily');
    expect(reports[0].format).toBe('csv');
  });

  it('creates report with monthly frequency and both format', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Monthly+Summary&siteUrl=https%3A%2F%2Fexample.com&recipients=admin@example.com&frequency=monthly&format=both',
    });
    expect(response.statusCode).toBe(200);
    const reports = await ctx.storage.email.listEmailReports('system');
    expect(reports[0].frequency).toBe('monthly');
    expect(reports[0].format).toBe('both');
  });

  it('creates report with includeCsv flag', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Test&siteUrl=https%3A%2F%2Fexample.com&recipients=t@e.com&frequency=weekly&format=pdf&includeCsv=on',
    });
    expect(response.statusCode).toBe(200);
    const reports = await ctx.storage.email.listEmailReports('system');
    expect(reports[0].includeCsv).toBe(true);
  });

  it('creates report with multiple valid recipients', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Multi&siteUrl=https%3A%2F%2Fexample.com&recipients=a@e.com%2Cb@e.com%2Cc@e.com&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(200);
    const reports = await ctx.storage.email.listEmailReports('system');
    expect(reports[0].recipients).toContain('a@e.com');
    expect(reports[0].recipients).toContain('c@e.com');
  });

  it('returns HTML row with report data', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Row+Test&siteUrl=https%3A%2F%2Fexample.com&recipients=t@e.com&frequency=weekly&format=pdf',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Row Test');
    expect(response.body).toContain('report-row-');
    expect(response.body).toContain('Email report schedule created');
  });
});

// ── GET /admin/email-reports — extended coverage ──────────────────────────

describe('GET /admin/email-reports (extended)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows smtpConfigured as true when SMTP is configured', async () => {
    const ctx = await createTestServer();
    await setupSmtp(ctx);
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/email-reports',
    });
    const body = response.json() as { data: { smtpConfigured: boolean } };
    expect(body.data.smtpConfigured).toBe(true);
    ctx.cleanup();
  });

  it('includes formatted report display fields', async () => {
    const ctx = await createTestServer();
    await setupSmtp(ctx);
    await makeEmailReport(ctx, { name: 'Formatted Report' });
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/email-reports',
    });
    const body = response.json() as {
      data: {
        reports: Array<{
          nextSendAtDisplay: string;
          lastSentAtDisplay: string;
          enabledLabel: string;
          enabledClass: string;
        }>;
      };
    };
    expect(body.data.reports[0].nextSendAtDisplay).toBeDefined();
    expect(body.data.reports[0].lastSentAtDisplay).toBe('Never');
    expect(body.data.reports[0].enabledLabel).toBe('Active');
    expect(body.data.reports[0].enabledClass).toBe('badge--success');
    ctx.cleanup();
  });

  it('shows default SMTP config values when none configured but has legacy', async () => {
    const ctx = await createTestServer();
    await setupSmtp(ctx);
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/email-reports',
    });
    const body = response.json() as {
      data: { smtpConfig: { host: string } };
    };
    expect(body.data.smtpConfig.host).toBe('smtp.example.com');
    ctx.cleanup();
  });
});

// ── PATCH /admin/email-reports/:id/toggle — extended coverage ─────────────

describe('PATCH /admin/email-reports/:id/toggle (extended)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('toggles from enabled to disabled and returns correct label', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    // Report is enabled by default
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/email-reports/${report.id}/toggle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Disabled');
    expect(response.body).toContain('badge--neutral');
    expect(response.body).toContain('Enable');
    expect(response.body).toContain('disabled');
  });

  it('toggles from disabled to enabled and returns correct label', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    // First toggle to disabled
    await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/email-reports/${report.id}/toggle`,
    });
    // Second toggle back to enabled
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/email-reports/${report.id}/toggle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Active');
    expect(response.body).toContain('badge--success');
    expect(response.body).toContain('Disable');
    expect(response.body).toContain('enabled');
  });

  it('includes hx-swap-oob elements for status and toggle button', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/email-reports/${report.id}/toggle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('hx-swap-oob');
    expect(response.body).toContain(`status-${report.id}`);
    expect(response.body).toContain(`toggle-btn-${report.id}`);
  });
});

// ── DELETE /admin/email-reports/:id — extended coverage ───────────────────

describe('DELETE /admin/email-reports/:id (extended)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns success toast on deletion', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: `/admin/email-reports/${report.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Email report deleted');
  });
});

// ── POST /admin/email-reports/:id/send-now — coverage ─────────────────────

describe('POST /admin/email-reports/:id/send-now', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'POST',
      url: '/admin/email-reports/some-id/send-now',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent report', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/nonexistent/send-now',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Email report not found');
  });

  it('returns 400 when no email sending is configured', async () => {
    const report = await makeEmailReport(ctx);
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/email-reports/${report.id}/send-now`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('not configured');
  });

  it('sends report successfully with legacy SMTP', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    vi.mocked(processEmailReport).mockResolvedValueOnce(undefined);

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/email-reports/${report.id}/send-now`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('sent successfully');
  });

  it('returns 500 when processEmailReport throws an Error', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    vi.mocked(processEmailReport).mockRejectedValueOnce(
      new Error('SMTP timeout'),
    );

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/email-reports/${report.id}/send-now`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('SMTP timeout');
  });

  it('returns 500 with generic message when processEmailReport throws non-Error', async () => {
    await setupSmtp(ctx);
    const report = await makeEmailReport(ctx);
    vi.mocked(processEmailReport).mockRejectedValueOnce('raw rejection');

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/email-reports/${report.id}/send-now`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Failed to send email report');
  });
});

// ── POST /admin/email-reports/smtp/test — plugin path ─────────────────────

describe('POST /admin/email-reports/smtp/test (without plugin manager)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('falls through to legacy SMTP when no pluginManager', async () => {
    const ctx = await createTestServer([...ALL_PERMISSION_IDS], {
      skipPluginManager: true,
    });
    await setupSmtp(ctx);
    vi.mocked(testSmtpConnection).mockResolvedValueOnce(true);

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/email-reports/smtp/test',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SMTP connection successful');
    ctx.cleanup();
  });
});
