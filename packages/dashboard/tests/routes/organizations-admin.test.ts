import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { organizationRoutes } from '../../src/routes/admin/organizations.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-orgs-${randomUUID()}.db`);

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
    request.user = { id: 'test-user-id', username: 'testadmin', role };
    const permissions = role === 'admin'
      ? new Set(ALL_PERMISSION_IDS)
      : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  // Pass no complianceUrl so deleteOrgData is skipped in tests
  await organizationRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

// ── GET /admin/organizations ──────────────────────────────────────────────────

describe('GET /admin/organizations', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with organizations template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organizations.hbs');
  });

  it('returns empty orgs list initially', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });
    const body = response.json() as { data: { orgs: unknown[] } };
    expect(body.data.orgs).toHaveLength(0);
  });

  it('lists created organizations', async () => {
    await ctx.storage.organizations.createOrg({ name: 'Acme Corp', slug: 'acme' });
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });
    const body = response.json() as { data: { orgs: Array<{ name: string }> } };
    expect(body.data.orgs).toHaveLength(1);
    expect(body.data.orgs[0].name).toBe('Acme Corp');
  });
});

// ── GET /admin/organizations/new ──────────────────────────────────────────────

describe('GET /admin/organizations/new', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with organization-form template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations/new' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organization-form.hbs');
  });
});

// ── POST /admin/organizations ─────────────────────────────────────────────────

describe('POST /admin/organizations', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('creates an org and returns HTMX HTML', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Test+Org&slug=test-org',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Test Org');
    expect(response.body).toContain('created successfully');
  });

  it('returns 400 when name is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'slug=my-org',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('required');
  });

  it('returns 400 when slug is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=My+Org',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('required');
  });

  it('returns 400 for invalid slug format', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Bad+Org&slug=Bad Slug!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('lowercase');
  });

  it('returns 400 for duplicate slug', async () => {
    await ctx.storage.organizations.createOrg({ name: 'First', slug: 'dup-slug' });
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Second&slug=dup-slug',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('already exists');
  });
});

// ── POST /admin/organizations/:id/delete ─────────────────────────────────────

describe('POST /admin/organizations/:id/delete', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('deletes an existing org and returns success toast', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'To Delete', slug: 'to-delete' });
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/delete`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('deleted successfully');

    const remaining = await ctx.storage.organizations.listOrgs();
    expect(remaining).toHaveLength(0);
  });

  it('returns 404 for non-existent org', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations/nonexistent-id/delete',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('not found');
  });
});

// ── GET /admin/organizations/:id/members ─────────────────────────────────────

describe('GET /admin/organizations/:id/members', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with organization-members template', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/organizations/${org.id}/members`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organization-members.hbs');
  });

  it('returns 404 for non-existent org', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/organizations/nonexistent-id/members',
    });
    expect(response.statusCode).toBe(404);
  });

  it('includes org info and empty members list in template data', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Beta', slug: 'beta' });
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/organizations/${org.id}/members`,
    });
    const body = response.json() as {
      data: { org: { name: string }; members: unknown[]; availableUsers: unknown[] };
    };
    expect(body.data.org.name).toBe('Beta');
    expect(body.data.members).toHaveLength(0);
  });
});

// ── POST /admin/organizations/:id/members/add-to-team ────────────────────────

describe('POST /admin/organizations/:id/members/add-to-team', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('adds a member to a team and returns success', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Gamma', slug: 'gamma' });
    const user = await ctx.storage.users.createUser('bob', 'Password123!', 'viewer');
    const team = await ctx.storage.teams.createTeam({ name: 'Members', description: 'Test team', orgId: org.id });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/members/add-to-team`,
      payload: `userId=${user.id}&teamId=${team.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 400 when userId is missing', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Delta', slug: 'delta' });
    const team = await ctx.storage.teams.createTeam({ name: 'Members', description: 'Test team', orgId: org.id });
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/members/add-to-team`,
      payload: `teamId=${team.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when org does not exist', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations/nonexistent-id/members/add-to-team',
      payload: 'userId=some-user-id&teamId=some-team',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(404);
  });
});

// ── POST /admin/organizations/:id/members/:userId/remove ─────────────────────

describe('POST /admin/organizations/:id/members/:userId/remove', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('removes a member and returns success toast', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Zeta', slug: 'zeta' });
    const user = await ctx.storage.users.createUser('dave', 'Password123!', 'viewer');
    await ctx.storage.organizations.addMember(org.id, user.id, 'member');

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/members/${user.id}/remove`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('removed from organization');

    const members = await ctx.storage.organizations.listMembers(org.id);
    expect(members).toHaveLength(0);
  });
});

// ── Access control ────────────────────────────────────────────────────────────

describe('Organizations admin access control', () => {
  it('non-admin (viewer role) gets 403 on GET /admin/organizations', async () => {
    const ctx = await createTestServer('viewer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (user role) gets 403 on POST /admin/organizations', async () => {
    const ctx = await createTestServer('user');
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Test&slug=test',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (developer role) gets 403 on POST /admin/organizations/:id/delete', async () => {
    const ctx = await createTestServer('developer');
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations/some-id/delete',
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});
