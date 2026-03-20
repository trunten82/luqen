import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { registerSession } from '../../src/auth/session.js';
import { homeRoutes } from '../../src/routes/home.js';
import { jurisdictionRoutes } from '../../src/routes/admin/jurisdictions.js';
import { regulationRoutes } from '../../src/routes/admin/regulations.js';
import { proposalRoutes } from '../../src/routes/admin/proposals.js';
import { sourceRoutes } from '../../src/routes/admin/sources.js';
import { webhookRoutes } from '../../src/routes/admin/webhooks.js';
import { userRoutes } from '../../src/routes/admin/users.js';
import { clientRoutes } from '../../src/routes/admin/clients.js';
import { systemRoutes } from '../../src/routes/admin/system.js';
import type { DashboardConfig } from '../../src/config.js';

// Mock the compliance client module so no real HTTP calls are made
vi.mock('../../src/compliance-client.js', () => ({
  listJurisdictions: vi.fn().mockResolvedValue([]),
  createJurisdiction: vi.fn().mockResolvedValue({ id: 'EU', name: 'European Union', type: 'supranational' }),
  updateJurisdiction: vi.fn().mockResolvedValue({ id: 'EU', name: 'European Union', type: 'supranational' }),
  deleteJurisdiction: vi.fn().mockResolvedValue(undefined),
  listRegulations: vi.fn().mockResolvedValue([]),
  createRegulation: vi.fn().mockResolvedValue({ id: 'reg-1', name: 'Reg', shortName: 'R', jurisdictionId: 'EU', enforcementDate: '', status: 'active', scope: '' }),
  updateRegulation: vi.fn().mockResolvedValue({ id: 'reg-1', name: 'Reg', shortName: 'R', jurisdictionId: 'EU', enforcementDate: '', status: 'active', scope: '' }),
  deleteRegulation: vi.fn().mockResolvedValue(undefined),
  listUpdateProposals: vi.fn().mockResolvedValue([]),
  approveProposal: vi.fn().mockResolvedValue({ id: 'prop-1', status: 'approved', source: 'EU', type: 'update', summary: 'test', detectedAt: new Date().toISOString() }),
  rejectProposal: vi.fn().mockResolvedValue({ id: 'prop-1', status: 'rejected', source: 'EU', type: 'update', summary: 'test', detectedAt: new Date().toISOString() }),
  listSources: vi.fn().mockResolvedValue([]),
  createSource: vi.fn().mockResolvedValue({ id: 'src-1', name: 'EU Monitor', url: 'https://eur-lex.europa.eu/feed.rss', type: 'rss', schedule: 'daily' }),
  deleteSource: vi.fn().mockResolvedValue(undefined),
  scanSources: vi.fn().mockResolvedValue({ scanned: 3, proposalsCreated: 1 }),
  listWebhooks: vi.fn().mockResolvedValue([]),
  createWebhook: vi.fn().mockResolvedValue({ id: 'wh-1', url: 'https://example.com/hook', events: ['scan.complete'], active: true, createdAt: new Date().toISOString() }),
  deleteWebhook: vi.fn().mockResolvedValue(undefined),
  testWebhook: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn().mockResolvedValue({ id: 'user-1', username: 'alice', role: 'viewer', active: true, createdAt: new Date().toISOString() }),
  deactivateUser: vi.fn().mockResolvedValue(undefined),
  listClients: vi.fn().mockResolvedValue([]),
  createClient: vi.fn().mockResolvedValue({ clientId: 'my-app-client', name: 'My App', scopes: ['read'], grantTypes: ['client_credentials'], createdAt: new Date().toISOString(), secret: 'super-secret-value' }),
  revokeClient: vi.fn().mockResolvedValue(undefined),
  getSystemHealth: vi.fn().mockResolvedValue({ compliance: { status: 'ok' }, pa11y: { status: 'ok' } }),
  safeGetSystemHealth: vi.fn().mockResolvedValue({ compliance: { status: 'ok' }, pa11y: { status: 'ok' } }),
  safeListJurisdictions: vi.fn().mockResolvedValue([]),
  getSeedStatus: vi.fn().mockResolvedValue({ seeded: true, jurisdictions: 2, regulations: 5, requirements: 20 }),
  getToken: vi.fn().mockResolvedValue({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 }),
  checkCompliance: vi.fn().mockResolvedValue({ summary: { totalJurisdictions: 1, passing: 1, failing: 0, totalMandatoryViolations: 0 }, matrix: {} }),
}));

// Import mocked module after vi.mock declaration
import * as complianceClient from '../../src/compliance-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const COMPLIANCE_URL = 'http://localhost:4000';

interface AdminTestContext {
  server: FastifyInstance;
  db: ScanDb;
  cleanup: () => void;
  dbPath: string;
}

async function createAdminTestServer(): Promise<AdminTestContext> {
  const dbPath = join(tmpdir(), `test-admin-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: COMPLIANCE_URL,
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
  };

  const db = new ScanDb(dbPath);
  db.initialize();

  const orchestrator = new ScanOrchestrator(db, reportsDir, 2);

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub reply.view so tests can inspect template name + data without needing
  // full Handlebars + file-system setup.
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Inject admin user into all requests (bypass JWT verification in tests)
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role: 'admin' };
  });

  await homeRoutes(server, db);
  await jurisdictionRoutes(server, COMPLIANCE_URL);
  await regulationRoutes(server, COMPLIANCE_URL);
  await proposalRoutes(server, COMPLIANCE_URL);
  await sourceRoutes(server, COMPLIANCE_URL);
  await webhookRoutes(server, COMPLIANCE_URL);
  await userRoutes(server, COMPLIANCE_URL);
  await clientRoutes(server, COMPLIANCE_URL);
  await systemRoutes(server, { complianceUrl: COMPLIANCE_URL, dbPath });

  server.get('/health', async () => ({ status: 'ok' }));

  await server.ready();

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, db, cleanup, dbPath };
}

// ── Non-admin 403 tests ──────────────────────────────────────────────────────

describe('Admin route access control', () => {
  it('non-admin (viewer role) gets 403 on GET /admin/jurisdictions', async () => {
    const dbPath = join(tmpdir(), `test-na-${randomUUID()}.db`);
    const reportsDir = join(tmpdir(), `test-na-reports-${randomUUID()}`);
    mkdirSync(reportsDir, { recursive: true });

    const db = new ScanDb(dbPath);
    db.initialize();

    const server = Fastify({ logger: false });
    await server.register(import('@fastify/formbody'));
    await registerSession(server, TEST_SESSION_SECRET);

    server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
    });

    // Inject viewer role — no admin access
    server.addHook('preHandler', async (request) => {
      request.user = { id: 'viewer-id', username: 'viewer', role: 'viewer' };
    });

    await jurisdictionRoutes(server, COMPLIANCE_URL);
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/admin/jurisdictions' });
    expect(response.statusCode).toBe(403);

    db.close();
    rmSync(dbPath, { force: true });
    rmSync(reportsDir, { recursive: true, force: true });
    await server.close();
  });

  it('non-admin (user role) gets 403 on POST /admin/jurisdictions', async () => {
    const dbPath = join(tmpdir(), `test-na2-${randomUUID()}.db`);
    const reportsDir = join(tmpdir(), `test-na2-reports-${randomUUID()}`);
    mkdirSync(reportsDir, { recursive: true });

    const db = new ScanDb(dbPath);
    db.initialize();

    const server = Fastify({ logger: false });
    await server.register(import('@fastify/formbody'));
    await registerSession(server, TEST_SESSION_SECRET);

    server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
    });

    // Inject user role — not admin
    server.addHook('preHandler', async (request) => {
      request.user = { id: 'user-id', username: 'regularuser', role: 'user' };
    });

    await jurisdictionRoutes(server, COMPLIANCE_URL);
    await server.ready();

    const response = await server.inject({
      method: 'POST',
      url: '/admin/jurisdictions',
      payload: 'id=test&name=Test&type=country',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);

    db.close();
    rmSync(dbPath, { force: true });
    rmSync(reportsDir, { recursive: true, force: true });
    await server.close();
  });
});

// ── Jurisdiction tests ────────────────────────────────────────────────────────

describe('GET /admin/jurisdictions', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with jurisdictions template', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
      { id: 'EU', name: 'European Union', type: 'supranational' },
    ]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/jurisdictions.hbs');
  });

  it('includes jurisdictions list in template data', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
      { id: 'EU', name: 'European Union', type: 'supranational' },
      { id: 'US', name: 'United States', type: 'country' },
    ]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });

    const body = response.json() as { data: { jurisdictions: Array<{ id: string }> } };
    expect(body.data.jurisdictions).toHaveLength(2);
    expect(body.data.jurisdictions[0].id).toBe('EU');
  });

  it('filters jurisdictions by search query', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
      { id: 'EU', name: 'European Union', type: 'supranational' },
      { id: 'US', name: 'United States', type: 'country' },
    ]);

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/jurisdictions?q=European',
    });

    const body = response.json() as { data: { jurisdictions: Array<{ name: string }> } };
    expect(body.data.jurisdictions).toHaveLength(1);
    expect(body.data.jurisdictions[0].name).toBe('European Union');
  });

  it('shows error when compliance service fails', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(new Error('Service unavailable'));

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { error?: string } };
    expect(body.data.error).toBe('Service unavailable');
  });
});

describe('GET /admin/jurisdictions/new', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with jurisdiction form fragment', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/new' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/jurisdiction-form.hbs');
  });

  it('sets isNew to true in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/new' });

    const body = response.json() as { data: { isNew: boolean } };
    expect(body.data.isNew).toBe(true);
  });
});

describe('POST /admin/jurisdictions', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/jurisdictions',
      payload: 'name=Test',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('creates jurisdiction and returns HTMX row fragment', async () => {
    vi.mocked(complianceClient.createJurisdiction).mockResolvedValueOnce({
      id: 'EU',
      name: 'European Union',
      type: 'supranational',
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/jurisdictions',
      payload: 'id=EU&name=European+Union&type=supranational',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('jurisdiction-EU');
    expect(response.body).toContain('European Union');
  });

  it('returns 500 on compliance API error', async () => {
    vi.mocked(complianceClient.createJurisdiction).mockRejectedValueOnce(new Error('API error'));

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/jurisdictions',
      payload: 'id=EU&name=Test&type=country',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('API error');
  });
});

describe('DELETE /admin/jurisdictions/:id', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('deletes jurisdiction and returns HTMX fragment', async () => {
    vi.mocked(complianceClient.deleteJurisdiction).mockResolvedValueOnce(undefined);

    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/jurisdictions/EU',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('deleted successfully');
  });

  it('returns 500 on compliance API error', async () => {
    vi.mocked(complianceClient.deleteJurisdiction).mockRejectedValueOnce(new Error('Not found'));

    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/jurisdictions/NONEXISTENT',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Not found');
  });
});

// ── Regulation tests ──────────────────────────────────────────────────────────

describe('GET /admin/regulations', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with regulations template', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([]);
    vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/regulations.hbs');
  });

  it('passes jurisdictionId filter to compliance client', async () => {
    vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
      { id: 'EU', name: 'European Union', type: 'supranational' },
    ]);
    vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([]);

    await ctx.server.inject({ method: 'GET', url: '/admin/regulations?jurisdictionId=EU' });

    expect(vi.mocked(complianceClient.listRegulations)).toHaveBeenCalledWith(
      COMPLIANCE_URL,
      expect.any(String),
      { jurisdictionId: 'EU' },
    );
  });
});

// ── Proposals tests ───────────────────────────────────────────────────────────

describe('GET /admin/proposals', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with proposals template', async () => {
    vi.mocked(complianceClient.listUpdateProposals).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/proposals.hbs');
  });
});

describe('POST /admin/proposals/:id/approve', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('approves proposal and returns HTMX row', async () => {
    vi.mocked(complianceClient.approveProposal).mockResolvedValueOnce({
      id: 'prop-1',
      status: 'approved',
      source: 'EU Official Journal',
      type: 'regulation_update',
      summary: 'New EAA requirement',
      detectedAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/proposals/prop-1/approve',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('approved');
    expect(response.body).toContain('Proposal approved successfully');
  });
});

describe('POST /admin/proposals/:id/reject', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('rejects proposal and returns HTMX row', async () => {
    vi.mocked(complianceClient.rejectProposal).mockResolvedValueOnce({
      id: 'prop-1',
      status: 'rejected',
      source: 'EU Official Journal',
      type: 'regulation_update',
      summary: 'New EAA requirement',
      detectedAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/proposals/prop-1/reject',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('rejected');
  });
});

// ── Sources tests ─────────────────────────────────────────────────────────────

describe('GET /admin/sources', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with sources template', async () => {
    vi.mocked(complianceClient.listSources).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/sources' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/sources.hbs');
  });
});

describe('POST /admin/sources', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when name is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/sources',
      payload: 'url=https://example.com/feed.rss',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('creates source and returns HTMX row', async () => {
    vi.mocked(complianceClient.createSource).mockResolvedValueOnce({
      id: 'src-1',
      name: 'EU Monitor',
      url: 'https://eur-lex.europa.eu/feed.rss',
      type: 'rss',
      schedule: 'daily',
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/sources',
      payload: 'name=EU+Monitor&url=https%3A%2F%2Feur-lex.europa.eu%2Ffeed.rss',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('EU Monitor');
    expect(response.body).toContain('added successfully');
  });
});

describe('DELETE /admin/sources/:id', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('deletes source and returns HTMX fragment', async () => {
    vi.mocked(complianceClient.deleteSource).mockResolvedValueOnce(undefined);

    const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/sources/src-1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('removed successfully');
  });
});

describe('POST /admin/sources/scan', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('triggers scan and returns results fragment', async () => {
    vi.mocked(complianceClient.scanSources).mockResolvedValueOnce({ scanned: 3, proposalsCreated: 1 });

    const response = await ctx.server.inject({ method: 'POST', url: '/admin/sources/scan' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('3 source');
    expect(response.body).toContain('1 proposal');
  });
});

// ── Webhooks tests ────────────────────────────────────────────────────────────

describe('GET /admin/webhooks', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with webhooks template', async () => {
    vi.mocked(complianceClient.listWebhooks).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/webhooks' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/webhooks.hbs');
  });
});

// ── Users tests ───────────────────────────────────────────────────────────────

describe('GET /admin/users', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with users template', async () => {
    vi.mocked(complianceClient.listUsers).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/users.hbs');
  });
});

describe('POST /admin/users', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when password is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid role', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice&password=secret123&role=superuser',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('creates user and returns HTMX row', async () => {
    vi.mocked(complianceClient.createUser).mockResolvedValueOnce({
      id: 'user-1',
      username: 'alice',
      role: 'viewer',
      active: true,
      createdAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice&password=s3cr3tpass&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('alice');
    expect(response.body).toContain('created successfully');
  });
});

// ── Clients tests ─────────────────────────────────────────────────────────────

describe('GET /admin/clients', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with clients template', async () => {
    vi.mocked(complianceClient.listClients).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/clients.hbs');
  });
});

describe('POST /admin/clients', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 400 when name is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/clients',
      payload: 'scopes=read',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('creates client and shows secret once in modal', async () => {
    vi.mocked(complianceClient.createClient).mockResolvedValueOnce({
      clientId: 'my-app-client',
      name: 'My App',
      scopes: ['read'],
      grantTypes: ['client_credentials'],
      createdAt: new Date().toISOString(),
      secret: 'super-secret-value',
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/clients',
      payload: 'name=My+App&scopes=read&grantTypes=client_credentials',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('client-my-app-client');
    // Secret is shown in modal one time
    expect(response.body).toContain('super-secret-value');
    expect(response.body).toContain('Client Secret');
  });
});

// ── System health tests ───────────────────────────────────────────────────────

describe('GET /admin/system', () => {
  let ctx: AdminTestContext;

  beforeEach(async () => {
    ctx = await createAdminTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with system template', async () => {
    vi.mocked(complianceClient.safeGetSystemHealth).mockResolvedValueOnce({
      compliance: { status: 'ok' },
      pa11y: { status: 'ok' },
    });
    vi.mocked(complianceClient.getSeedStatus).mockResolvedValueOnce({
      seeded: true,
      jurisdictions: 2,
      regulations: 5,
      requirements: 20,
    });

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/system.hbs');
  });

  it('shows compliance status in template data', async () => {
    vi.mocked(complianceClient.safeGetSystemHealth).mockResolvedValueOnce({
      compliance: { status: 'ok' },
    });
    vi.mocked(complianceClient.getSeedStatus).mockResolvedValueOnce({
      seeded: false,
      jurisdictions: 0,
      regulations: 0,
      requirements: 0,
    });

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });

    const body = response.json() as { data: { services: { compliance: { status: string } } } };
    expect(body.data.services.compliance.status).toBe('ok');
  });

  it('shows degraded status when compliance service is unreachable', async () => {
    vi.mocked(complianceClient.safeGetSystemHealth).mockResolvedValueOnce({
      compliance: { status: 'degraded' },
    });
    vi.mocked(complianceClient.getSeedStatus).mockRejectedValueOnce(new Error('Connection refused'));

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { services: { compliance: { status: string } } } };
    expect(body.data.services.compliance.status).toBe('degraded');
  });
});
