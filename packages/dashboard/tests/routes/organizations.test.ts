import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import { organizationRoutes } from '../../src/routes/admin/organizations.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-orgs-admin-${randomUUID()}.db`);

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub reply.view so tests can inspect template name + data
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Inject user into all requests
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testadmin', role };
    const permissions = role === 'admin'
      ? new Set(ALL_PERMISSION_IDS)
      : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await organizationRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

// ── GET /admin/organizations ────────────────────────────────────────────────

describe('GET /admin/organizations', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 200 with organizations template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organizations.hbs');
  });

  it('includes empty orgs list when no orgs exist', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });

    const body = response.json() as { data: { orgs: unknown[] } };
    expect(body.data.orgs).toHaveLength(0);
  });

  it('includes orgs after creation', async () => {
    ctx.storage.organizations.createOrg({ name: 'Acme Corp', slug: 'acme' });

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations' });

    const body = response.json() as { data: { orgs: Array<{ name: string }> } };
    expect(body.data.orgs).toHaveLength(1);
    expect(body.data.orgs[0].name).toBe('Acme Corp');
  });
});

// ── GET /admin/organizations/new ────────────────────────────────────────────

describe('GET /admin/organizations/new', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 200 with organization form template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/organizations/new' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organization-form.hbs');
  });
});

// ── POST /admin/organizations ───────────────────────────────────────────────

describe('POST /admin/organizations', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('creates org and returns HTMX row', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Acme+Corp&slug=acme',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Acme Corp');
    expect(response.body).toContain('created successfully');
  });

  it('returns 400 when name is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'slug=acme',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when slug is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Acme',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for duplicate slug', async () => {
    ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=Acme+Two&slug=acme',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('already exists');
  });

  it('persists org to database', async () => {
    await ctx.server.inject({
      method: 'POST',
      url: '/admin/organizations',
      payload: 'name=TestOrg&slug=test-org',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const orgs = await ctx.storage.organizations.listOrgs();
    expect(orgs).toHaveLength(1);
    expect(orgs[0].slug).toBe('test-org');
  });
});

// ── POST /admin/organizations/:id/delete ────────────────────────────────────

describe('POST /admin/organizations/:id/delete', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('deletes org and returns toast', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'ToDelete', slug: 'to-delete' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/delete`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('deleted');

    const deleted = await ctx.storage.organizations.getOrg(org.id);
    expect(deleted).toBeNull();
  });

  it('returns 404 when org does not exist', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${randomUUID()}/delete`,
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── GET /admin/organizations/:id/members ────────────────────────────────────

describe('GET /admin/organizations/:id/members', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 200 with members template', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/organizations/${org.id}/members`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/organization-members.hbs');
  });

  it('returns 404 when org does not exist', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/organizations/${randomUUID()}/members`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('includes org name and members list', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const user = await ctx.storage.users.createUser('alice', 'password123', 'user');
    await ctx.storage.organizations.addMember(org.id, user.id, 'member');

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/organizations/${org.id}/members`,
    });

    const body = response.json() as {
      data: {
        org: { name: string };
        members: Array<{ userId: string; username: string }>;
      };
    };
    expect(body.data.org.name).toBe('Acme');
    expect(body.data.members).toHaveLength(1);
    expect(body.data.members[0].username).toBe('alice');
  });
});

// ── POST /admin/organizations/:id/members/add-to-team ───────────────────────

describe('POST /admin/organizations/:id/members/add-to-team', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('adds member to team and returns success', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const user = await ctx.storage.users.createUser('bob', 'password123', 'user');
    const team = await ctx.storage.teams.createTeam({ name: 'Members', description: 'Test team', orgId: org.id });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/members/add-to-team`,
      payload: `userId=${user.id}&teamId=${team.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('returns 400 when userId is missing', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
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
      url: `/admin/organizations/${randomUUID()}/members/add-to-team`,
      payload: 'userId=some-id&teamId=some-team',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── POST /admin/organizations/:id/members/:userId/remove ────────────────────

describe('POST /admin/organizations/:id/members/:userId/remove', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('removes member from org teams and returns toast', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const user = await ctx.storage.users.createUser('charlie', 'password123', 'user');
    // Add user to a team in this org
    const teams = await ctx.storage.teams.listTeamsByOrgId(org.id);
    if (teams.length > 0) {
      await ctx.storage.teams.addTeamMember(teams[0].id, user.id);
    }

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/organizations/${org.id}/members/${user.id}/remove`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('removed');
  });
});

// ── Admin role required ─────────────────────────────────────────────────────

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
      payload: 'name=Acme&slug=acme',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);

    ctx.cleanup();
  });
});
