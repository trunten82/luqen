import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { dashboardUserRoutes } from '../../src/routes/admin/dashboard-users.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-du-${randomUUID()}.db`);

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

  // Inject user and permissions into all requests
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testadmin', role };
    const permissions = role === 'admin'
      ? new Set(ALL_PERMISSION_IDS)
      : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await dashboardUserRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

// ── GET /admin/dashboard-users ──────────────────────────────────────────────

describe('GET /admin/dashboard-users', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with dashboard-users template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/dashboard-users.hbs');
  });

  it('includes empty users list when no users exist', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users' });
    const body = response.json() as { data: { users: unknown[] } };
    expect(body.data.users).toHaveLength(0);
  });

  it('includes users after creation', async () => {
    await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users' });
    const body = response.json() as { data: { users: Array<{ username: string }> } };
    expect(body.data.users).toHaveLength(1);
    expect(body.data.users[0].username).toBe('alice');
  });
});

// ── GET /admin/dashboard-users/new ──────────────────────────────────────────

describe('GET /admin/dashboard-users/new', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with user form template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users/new' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/dashboard-user-form.hbs');
  });

  it('includes roles in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users/new' });
    const body = response.json() as { data: { roles: string[] } };
    expect(body.data.roles).toEqual(['executive', 'viewer', 'user', 'developer', 'admin']);
  });
});

// ── POST /admin/dashboard-users ─────────────────────────────────────────────

describe('POST /admin/dashboard-users', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('creates user and returns HTMX row', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=alice&password=S3cr3tPass!&role=user',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('alice');
    expect(response.body).toContain('created successfully');
  });

  it('returns 400 when username is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'password=Secret123!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=alice',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid role', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=alice&password=Secret123!&role=superuser',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for duplicate username', async () => {
    await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=alice&password=NewPass123!&role=user',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(409);
  });
});

// ── PATCH /admin/dashboard-users/:id/role ───────────────────────────────────

describe('PATCH /admin/dashboard-users/:id/role', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('updates user role and returns updated row', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'PATCH', url: `/admin/dashboard-users/${user.id}/role`,
      payload: 'role=admin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Role updated');
    const updated = await ctx.storage.users.getUserById(user.id);
    expect(updated?.role).toBe('admin');
  });

  it('returns 400 for invalid role', async () => {
    const user = await ctx.storage.users.createUser('bob', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'PATCH', url: `/admin/dashboard-users/${user.id}/role`,
      payload: 'role=superuser',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ── POST /admin/dashboard-users/:id/deactivate ─────────────────────────────

describe('POST /admin/dashboard-users/:id/deactivate', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('deactivates user and returns updated row', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/deactivate`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('deactivated successfully');
    const updated = await ctx.storage.users.getUserById(user.id);
    expect(updated?.active).toBe(false);
  });
});

// ── Admin role required ─────────────────────────────────────────────────────

describe('Dashboard users admin access control', () => {
  it('non-admin (viewer role) gets 403 on GET /admin/dashboard-users', async () => {
    const ctx = await createTestServer('viewer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/dashboard-users' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (user role) gets 403 on POST /admin/dashboard-users', async () => {
    const ctx = await createTestServer('user');
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=alice&password=Secret123!&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});

// ── Fine-grained permission tests ─────────────────────────────────────────────

async function createServerWithPerms(permissions: string[]): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-du-perms-${randomUUID()}.db`);
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
    request.user = { id: 'test-user-id', username: 'testadmin', role: 'admin' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await dashboardUserRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('Dashboard users fine-grained permission checks', () => {
  it('users.create allows POST /admin/dashboard-users', async () => {
    const ctx = await createServerWithPerms(['users.create']);
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=newuser&password=Secret123!&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('missing users.create gets 403 on POST /admin/dashboard-users', async () => {
    const ctx = await createServerWithPerms(['users.delete']);
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users',
      payload: 'username=newuser&password=Secret123!&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('users.delete allows DELETE /admin/dashboard-users/:id', async () => {
    const ctx = await createServerWithPerms(['users.delete']);
    const user = await ctx.storage.users.createUser('todelete', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'DELETE', url: `/admin/dashboard-users/${user.id}`,
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('missing users.delete gets 403 on DELETE /admin/dashboard-users/:id', async () => {
    const ctx = await createServerWithPerms(['users.create']);
    const user = await ctx.storage.users.createUser('todelete2', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'DELETE', url: `/admin/dashboard-users/${user.id}`,
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('users.activate allows POST /admin/dashboard-users/:id/activate', async () => {
    const ctx = await createServerWithPerms(['users.activate']);
    const user = await ctx.storage.users.createUser('toactivate', 'Password123!', 'viewer');
    await ctx.storage.users.deactivateUser(user.id);
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/activate`,
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('missing users.activate gets 403 on POST /admin/dashboard-users/:id/activate', async () => {
    const ctx = await createServerWithPerms(['users.create']);
    const user = await ctx.storage.users.createUser('toactivate2', 'Password123!', 'viewer');
    await ctx.storage.users.deactivateUser(user.id);
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/activate`,
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('users.activate allows POST /admin/dashboard-users/:id/deactivate', async () => {
    const ctx = await createServerWithPerms(['users.activate']);
    const user = await ctx.storage.users.createUser('todeactivate', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/deactivate`,
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('users.reset_password allows GET /admin/dashboard-users/:id/reset-password', async () => {
    const ctx = await createServerWithPerms(['users.reset_password']);
    const user = await ctx.storage.users.createUser('resetme', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'GET', url: `/admin/dashboard-users/${user.id}/reset-password`,
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('missing users.reset_password gets 403 on GET /admin/dashboard-users/:id/reset-password', async () => {
    const ctx = await createServerWithPerms(['users.create']);
    const user = await ctx.storage.users.createUser('resetme2', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'GET', url: `/admin/dashboard-users/${user.id}/reset-password`,
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('users.roles allows PATCH /admin/dashboard-users/:id/role', async () => {
    const ctx = await createServerWithPerms(['users.roles']);
    const user = await ctx.storage.users.createUser('rolechange', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'PATCH', url: `/admin/dashboard-users/${user.id}/role`,
      payload: 'role=user',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    ctx.cleanup();
  });

  it('missing users.roles gets 403 on PATCH /admin/dashboard-users/:id/role', async () => {
    const ctx = await createServerWithPerms(['users.create']);
    const user = await ctx.storage.users.createUser('rolechange2', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'PATCH', url: `/admin/dashboard-users/${user.id}/role`,
      payload: 'role=user',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});

// ── POST /admin/dashboard-users/:id/activate ────────────────────────────────

describe('POST /admin/dashboard-users/:id/activate', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('activates a deactivated user', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    await ctx.storage.users.deactivateUser(user.id);
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/activate`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('activated successfully');
    const updated = await ctx.storage.users.getUserById(user.id);
    expect(updated?.active).toBe(true);
  });

  it('returns 404 for unknown user', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users/nonexistent-id/activate',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('User not found');
  });
});

// ── DELETE /admin/dashboard-users/:id ───────────────────────────────────────

describe('DELETE /admin/dashboard-users/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('deletes user permanently', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'DELETE', url: `/admin/dashboard-users/${user.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('deleted permanently');
    const deleted = await ctx.storage.users.getUserById(user.id);
    expect(deleted).toBeNull();
  });

  it('returns 404 for unknown user', async () => {
    const response = await ctx.server.inject({
      method: 'DELETE', url: '/admin/dashboard-users/nonexistent-id',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('User not found');
  });
});

// ── GET /admin/dashboard-users/:id/reset-password ───────────────────────────

describe('GET /admin/dashboard-users/:id/reset-password', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns modal HTML for existing user', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'GET', url: `/admin/dashboard-users/${user.id}/reset-password`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Reset Password');
    expect(response.body).toContain('alice');
    expect(response.body).toContain('modal');
  });

  it('returns 404 for unknown user', async () => {
    const response = await ctx.server.inject({
      method: 'GET', url: '/admin/dashboard-users/nonexistent-id/reset-password',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('User not found');
  });
});

// ── POST /admin/dashboard-users/:id/reset-password ──────────────────────────

describe('POST /admin/dashboard-users/:id/reset-password', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('resets password for existing user', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/reset-password`,
      payload: 'newPassword=newSecret123!&confirmPassword=newSecret123!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Password reset successfully');
    const valid = await ctx.storage.users.verifyPassword('alice', 'newSecret123!');
    expect(valid).toBe(true);
  });

  it('rejects short password', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/reset-password`,
      payload: 'newPassword=short&confirmPassword=short',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('at least 8 characters');
  });

  it('rejects mismatched passwords', async () => {
    const user = await ctx.storage.users.createUser('alice', 'Password123!', 'viewer');
    const response = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${user.id}/reset-password`,
      payload: 'newPassword=newSecret123!&confirmPassword=Different1!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('do not match');
  });

  it('returns 404 for unknown user', async () => {
    const response = await ctx.server.inject({
      method: 'POST', url: '/admin/dashboard-users/nonexistent-id/reset-password',
      payload: 'newPassword=newSecret123!&confirmPassword=newSecret123!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('User not found');
  });
});
