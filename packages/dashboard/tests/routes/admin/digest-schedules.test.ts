/**
 * Admin digest-schedule routes test suite.
 *
 * Mirrors email-reports.test.ts structure: inject-style Fastify tests,
 * mocking processDigest and buildDigest at the module level.
 *
 * Coverage: GET list, POST create, PATCH toggle, POST send-now, DELETE,
 * GET :id/view, GET :id/pdf/:period, permission gates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { digestScheduleRoutes } from '../../../src/routes/admin/digest-schedules.js';
import { PluginManager } from '../../../src/plugins/manager.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';

// Mock processDigest so send-now tests don't attempt real delivery
vi.mock('../../../src/email/digest-scheduler.js', () => ({
  processDigest: vi.fn().mockResolvedValue(undefined),
  computeNextDigestSendAt: vi
    .fn()
    .mockReturnValue(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ),
}));

// Mock generateDigestPdf so PDF-download tests return a buffer without PDFKit
vi.mock('../../../src/pdf/digest-generator.js', () => ({
  generateDigestPdf: vi
    .fn()
    .mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf content')),
  buildDigestPdfAttachment: vi.fn().mockResolvedValue(null),
}));

// Mock buildDigest so view tests don't require real scan data
vi.mock('../../../src/services/digest-service.js', () => ({
  buildDigest: vi.fn().mockResolvedValue({
    orgId: 'system',
    siteUrl: null,
    period: {
      start: '2026-05-01T00:00:00.000Z',
      end: '2026-06-01T00:00:00.000Z',
    },
    sites: [],
    generatedAt: '2026-06-01T00:00:00.000Z',
  }),
}));

import { processDigest } from '../../../src/email/digest-scheduler.js';
import { generateDigestPdf } from '../../../src/pdf/digest-generator.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  pluginManager: PluginManager;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = [...ALL_PERMISSION_IDS],
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-digest-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-plugins-digest-${randomUUID()}`);
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

  await digestScheduleRoutes(server, storage, pluginManager);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, pluginManager, cleanup };
}

async function makeSchedule(
  ctx: TestContext,
  overrides: Partial<{
    name: string;
    frequency: string;
    channels: string;
    enabled: boolean;
  }> = {},
) {
  return ctx.storage.digest!.createDigestSchedule({
    id: randomUUID(),
    orgId: 'system',
    name: overrides.name ?? 'Board Digest',
    siteUrl: null,
    frequency: overrides.frequency ?? 'weekly',
    recipients: 'exec@example.com',
    channels: overrides.channels ?? JSON.stringify(['email']),
    nextSendAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'alice',
  });
}

// ── GET /admin/digest-schedules ──────────────────────────────────────────────

describe('GET /admin/digest-schedules', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const ctx = await createTestServer([]);
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules',
    });
    ctx.cleanup();
    expect(response.statusCode).toBe(403);
  });

  // Regression (UAT 2026-07-14): the sidebar shows "Digest schedules" to
  // admin.org / compliance.manage holders (same Integrations block as
  // Notifications), but the routes were admin.system-only — every org Admin
  // saw the link and got 403. Handlers are fully org-scoped, so the guard
  // now matches the sidebar and the notifications routes.
  it('org Admin (compliance.manage + admin.org, no admin.system) can open the page', async () => {
    const ctx = await createTestServer(['admin.org', 'compliance.manage']);
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules',
    });
    ctx.cleanup();
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 with digest-schedules template', async () => {
    const ctx = await createTestServer();
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules',
    });
    ctx.cleanup();
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/digest-schedules.hbs');
  });

  it('lists schedules in template data', async () => {
    const ctx = await createTestServer();
    await makeSchedule(ctx, { name: 'Schedule A' });
    await makeSchedule(ctx, { name: 'Schedule B' });
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules',
    });
    ctx.cleanup();
    const body = response.json() as { data: { schedules: unknown[] } };
    expect(body.data.schedules).toHaveLength(2);
  });
});

// ── POST /admin/digest-schedules ─────────────────────────────────────────────

describe('POST /admin/digest-schedules', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Test&scope=org&frequency=weekly&recipients=exec@example.com&channelEmail=on',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'scope=org&frequency=weekly&recipients=exec@example.com&channelEmail=on',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('name is required');
  });

  it('creates a schedule and returns an HTML TR row', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Monthly+Board&scope=org&frequency=monthly&recipients=board@example.com&channelEmail=on',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('digest-row-');
    expect(response.body).toContain('Monthly Board');
    const schedules = await ctx.storage.digest!.listDigestSchedules('system');
    expect(schedules).toHaveLength(1);
    expect(schedules[0].name).toBe('Monthly Board');
  });

  it('defaults to email channel when no channel selected', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=No+Channel&scope=org&frequency=weekly&recipients=exec@example.com',
    });
    expect(response.statusCode).toBe(200);
    const schedules = await ctx.storage.digest!.listDigestSchedules('system');
    expect(schedules[0].channels).toContain('email');
  });

  it('sets siteUrl when scope=site', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'name=Site+Digest&scope=site&siteUrl=https%3A%2F%2Fexample.com&frequency=weekly&recipients=exec@example.com&channelEmail=on',
    });
    expect(response.statusCode).toBe(200);
    const schedules = await ctx.storage.digest!.listDigestSchedules('system');
    expect(schedules[0].siteUrl).toBe('https://example.com');
  });

  it('returns HTML row without <form> inside TR (no form-in-table-cell violation)', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=FormCheck&scope=org&frequency=weekly&recipients=exec@example.com&channelEmail=on',
    });
    expect(response.statusCode).toBe(200);
    // Extract just the TR content (before any toast HTML)
    const trStart = response.body.indexOf('<tr');
    const trEnd = response.body.indexOf('</tr>') + '</tr>'.length;
    const trContent = response.body.slice(trStart, trEnd);
    expect(trContent).not.toContain('<form');
  });
});

// ── PATCH /admin/digest-schedules/:id/toggle ────────────────────────────────

describe('PATCH /admin/digest-schedules/:id/toggle', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'PATCH',
      url: '/admin/digest-schedules/some-id/toggle',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent schedule', async () => {
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: '/admin/digest-schedules/non-existent/toggle',
    });
    expect(response.statusCode).toBe(404);
  });

  it('toggles enabled from true to false', async () => {
    const schedule = await makeSchedule(ctx);
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/digest-schedules/${schedule.id}/toggle`,
    });
    expect(response.statusCode).toBe(200);
    const updated = await ctx.storage.digest!.getDigestSchedule(schedule.id);
    expect(updated?.enabled).toBe(false);
  });

  it('returns updated HTML row with Paused state', async () => {
    const schedule = await makeSchedule(ctx);
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/digest-schedules/${schedule.id}/toggle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('digest-row-');
  });
});

// ── POST /admin/digest-schedules/:id/send-now ───────────────────────────────

describe('POST /admin/digest-schedules/:id/send-now', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules/some-id/send-now',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent schedule', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules/non-existent/send-now',
    });
    expect(response.statusCode).toBe(404);
  });

  it('calls processDigest and returns success toast', async () => {
    const schedule = await makeSchedule(ctx);
    vi.mocked(processDigest).mockResolvedValueOnce(undefined);
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/digest-schedules/${schedule.id}/send-now`,
    });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(processDigest)).toHaveBeenCalledOnce();
  });

  it('returns 500 when processDigest throws', async () => {
    const schedule = await makeSchedule(ctx);
    vi.mocked(processDigest).mockRejectedValueOnce(new Error('Delivery error'));
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/digest-schedules/${schedule.id}/send-now`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Delivery error');
  });
});

// ── DELETE /admin/digest-schedules/:id ──────────────────────────────────────

describe('DELETE /admin/digest-schedules/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'DELETE',
      url: '/admin/digest-schedules/some-id',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent schedule', async () => {
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/digest-schedules/non-existent',
    });
    expect(response.statusCode).toBe(404);
  });

  it('deletes a schedule and returns success toast', async () => {
    const schedule = await makeSchedule(ctx);
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: `/admin/digest-schedules/${schedule.id}`,
    });
    expect(response.statusCode).toBe(200);
    const deleted = await ctx.storage.digest!.getDigestSchedule(schedule.id);
    expect(deleted).toBeNull();
  });
});

// ── GET /admin/digest-schedules/:id/view ────────────────────────────────────

describe('GET /admin/digest-schedules/:id/view', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules/some-id/view',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent schedule', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules/non-existent/view',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 200 with digest-view template for an admin', async () => {
    const schedule = await makeSchedule(ctx);
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/digest-schedules/${schedule.id}/view`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/digest-view.hbs');
  });
});

// ── GET /admin/digest-schedules/:id/pdf/:period ─────────────────────────────

describe('GET /admin/digest-schedules/:id/pdf/:period', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('returns 403 without admin.system permission', async () => {
    const noPerm = await createTestServer([]);
    const response = await noPerm.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules/some-id/pdf/2026-05',
    });
    noPerm.cleanup();
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent schedule', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/digest-schedules/non-existent/pdf/2026-05',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 200 with content-type application/pdf and %PDF body', async () => {
    const schedule = await makeSchedule(ctx);
    vi.mocked(generateDigestPdf).mockResolvedValueOnce(
      Buffer.from('%PDF-1.4 test content'),
    );
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/digest-schedules/${schedule.id}/pdf/2026-05`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.body).toContain('%PDF');
  });

  it('CR-03: rejects period with forbidden characters (400 from TypeBox)', async () => {
    const schedule = await makeSchedule(ctx);
    // Period with newline — header injection attempt; TypeBox pattern rejects it
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/digest-schedules/${schedule.id}/pdf/2026-05%0d%0aX-Injected:evil`,
    });
    // TypeBox pattern '^[0-9A-Za-z._-]{1,32}$' does not match the decoded value
    expect([400, 404]).toContain(response.statusCode);
  });
});

// ── CR-02: Org-scope guard tests ─────────────────────────────────────────────

describe('CR-02: org-scope guard — cross-org access returns 404', () => {
  it('toggle returns 404 when schedule belongs to a different org', async () => {
    // Create schedule owned by 'system' org
    const ownerCtx = await createTestServer();
    const schedule = await makeSchedule(ownerCtx);

    // Create a server that authenticates as a DIFFERENT org
    const dbPath = join(tmpdir(), `test-digest-xorg-${randomUUID()}.db`);
    const pluginsDir = join(tmpdir(), `test-plugins-xorg-${randomUUID()}`);
    mkdirSync(pluginsDir, { recursive: true });
    const xStorage = new SqliteStorageAdapter(dbPath);
    await xStorage.migrate();
    const xPlugin = new PluginManager({
      db: xStorage.getRawDatabase(),
      pluginsDir,
      encryptionKey: TEST_SESSION_SECRET,
      registryEntries: [],
    });
    const xServer = Fastify({ logger: false });
    await xServer.register(import('@fastify/formbody'));
    await registerSession(xServer, TEST_SESSION_SECRET);
    xServer.decorateReply('view', function (this: FastifyReply, t: string, d: unknown) {
      return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template: t, data: d }));
    });
    xServer.addHook('preHandler', async (request) => {
      request.user = { id: 'user-2', username: 'bob', role: 'admin', currentOrgId: 'other-org' };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([...ALL_PERMISSION_IDS]);
    });
    await digestScheduleRoutes(xServer, ownerCtx.storage, xPlugin);
    await xServer.ready();

    const response = await xServer.inject({
      method: 'PATCH',
      url: `/admin/digest-schedules/${schedule.id}/toggle`,
    });
    ownerCtx.cleanup();
    void xStorage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void xServer.close();

    // Must be 404 (not 403) — no existence leakage
    expect(response.statusCode).toBe(404);
  });
});

// ── WR-01: Recipient email validation ────────────────────────────────────────

describe('WR-01: recipient email validation on create', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('rejects invalid recipient email addresses with 400', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Bad+Email+Test&scope=org&frequency=weekly&recipients=good%40example.com%2C%40badaddr&channelEmail=on',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('@badaddr');
  });

  it('accepts a comma-separated list of valid email addresses', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Multi+Email&scope=org&frequency=weekly&recipients=alice%40example.com%2Cbob%40example.org&channelEmail=on',
    });
    expect(response.statusCode).toBe(200);
    const schedules = await ctx.storage.digest!.listDigestSchedules('system');
    expect(schedules).toHaveLength(1);
  });
});

// ── WR-02: siteUrl validation ────────────────────────────────────────────────

describe('WR-02: siteUrl validation on create', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); vi.clearAllMocks(); });

  it('rejects a non-http/https siteUrl with 400', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Bad+URL&scope=site&siteUrl=javascript%3Afoo&frequency=weekly&recipients=exec%40example.com&channelEmail=on',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('http/https');
  });

  it('treats empty siteUrl with scope=site as org-wide (stores null)', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/digest-schedules',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Empty+URL&scope=site&siteUrl=&frequency=weekly&recipients=exec%40example.com&channelEmail=on',
    });
    // Empty siteUrl: `'' || null` = null; since null is a site-scope with no URL, it's accepted
    // but stored as null (becomes org-wide in effect)
    expect(response.statusCode).toBe(200);
    const schedules = await ctx.storage.digest!.listDigestSchedules('system');
    expect(schedules[0].siteUrl).toBeNull();
  });
});
