import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { userRoutes } from '../../../src/routes/admin/users.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';

// Mock the compliance client module so no real HTTP calls are made
vi.mock('../../../src/compliance-client.js', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    username: 'alice',
    role: 'viewer',
    active: true,
    createdAt: new Date().toISOString(),
  }),
  deactivateUser: vi.fn().mockResolvedValue(undefined),
}));

import * as complianceClient from '../../../src/compliance-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const COMPLIANCE_URL = 'http://localhost:4000';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(role = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-users-adm-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-users-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

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
    request.user = { id: 'test-user-id', username: 'testuser', role };
    const permissions =
      role === 'admin' ? new Set(ALL_PERMISSION_IDS) : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await userRoutes(server, COMPLIANCE_URL);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, cleanup };
}

// ── GET /admin/users — additional branch coverage ─────────────────────────

describe('GET /admin/users (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns users with formatted createdAtDisplay', async () => {
    const isoDate = '2025-01-15T10:30:00.000Z';
    vi.mocked(complianceClient.listUsers).mockResolvedValueOnce([
      { id: 'u1', username: 'bob', role: 'admin', active: true, createdAt: isoDate },
    ]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { users: Array<{ username: string; createdAtDisplay: string }> };
    };
    expect(body.data.users).toHaveLength(1);
    expect(body.data.users[0].username).toBe('bob');
    expect(body.data.users[0].createdAtDisplay).toBeDefined();
  });

  it('sets error when listUsers throws a non-Error object', async () => {
    vi.mocked(complianceClient.listUsers).mockRejectedValueOnce('plain string error');

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { error?: string } };
    expect(body.data.error).toBe('Failed to load users');
  });

  it('sets error message from Error instance when listUsers throws', async () => {
    vi.mocked(complianceClient.listUsers).mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { error?: string } };
    expect(body.data.error).toBe('Connection refused');
  });

  it('passes correct template and pageTitle', async () => {
    vi.mocked(complianceClient.listUsers).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    const body = response.json() as {
      template: string;
      data: { pageTitle: string; currentPath: string };
    };
    expect(body.template).toBe('admin/users.hbs');
    expect(body.data.pageTitle).toBe('API Users (Compliance)');
    expect(body.data.currentPath).toBe('/admin/users');
  });

  it('includes user in template data', async () => {
    vi.mocked(complianceClient.listUsers).mockResolvedValueOnce([]);

    const response = await ctx.server.inject({ method: 'GET', url: '/admin/users' });

    const body = response.json() as {
      data: { user: { username: string } };
    };
    expect(body.data.user.username).toBe('testuser');
  });
});

// ── GET /admin/users/new ──────────────────────────────────────────────────

describe('GET /admin/users/new', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('returns 200 with user-form template', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/users/new',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/user-form.hbs');
  });

  it('sets isNew to true in template data', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/users/new',
    });

    const body = response.json() as { data: { isNew: boolean } };
    expect(body.data.isNew).toBe(true);
  });

  it('includes empty formUser and roles list', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/users/new',
    });

    const body = response.json() as {
      data: {
        formUser: { username: string; role: string; password: string };
        roles: string[];
      };
    };
    expect(body.data.formUser.username).toBe('');
    expect(body.data.formUser.role).toBe('viewer');
    expect(body.data.formUser.password).toBe('');
    expect(body.data.roles).toEqual(['viewer', 'user', 'admin']);
  });

  it('returns 403 for non-admin user', async () => {
    const viewerCtx = await createTestServer('viewer');
    const response = await viewerCtx.server.inject({
      method: 'GET',
      url: '/admin/users/new',
    });
    expect(response.statusCode).toBe(403);
    viewerCtx.cleanup();
  });
});

// ── POST /admin/users (extended) ──────────────────────────────────────────

describe('POST /admin/users (extended)', () => {
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
      url: '/admin/users',
      payload: 'password=secret123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Username and password are required');
  });

  it('returns 400 when username is whitespace only', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=%20%20&password=secret123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Username and password are required');
  });

  it('returns 400 when password is whitespace only', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice&password=%20%20',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Username and password are required');
  });

  it('defaults role to viewer when role is not provided', async () => {
    vi.mocked(complianceClient.createUser).mockResolvedValueOnce({
      id: 'user-2',
      username: 'bob',
      role: 'viewer',
      active: true,
      createdAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=bob&password=secret123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(complianceClient.createUser)).toHaveBeenCalledWith(
      COMPLIANCE_URL,
      expect.any(String),
      expect.objectContaining({ role: 'viewer' }),
      undefined,
    );
  });

  it('creates user with admin role', async () => {
    vi.mocked(complianceClient.createUser).mockResolvedValueOnce({
      id: 'user-3',
      username: 'carol',
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=carol&password=secret123&role=admin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('carol');
    expect(response.body).toContain('created successfully');
  });

  it('returns HTMX row with inactive user badge', async () => {
    vi.mocked(complianceClient.createUser).mockResolvedValueOnce({
      id: 'user-4',
      username: 'inactive-user',
      role: 'viewer',
      active: false,
      createdAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=inactive-user&password=secret123&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('badge--error');
    expect(response.body).toContain('Inactive');
    expect(response.body).toContain('disabled');
  });

  it('returns 500 when createUser throws an Error', async () => {
    vi.mocked(complianceClient.createUser).mockRejectedValueOnce(
      new Error('Duplicate username'),
    );

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice&password=secret123&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Duplicate username');
  });

  it('returns 500 with generic message when createUser throws non-Error', async () => {
    vi.mocked(complianceClient.createUser).mockRejectedValueOnce(
      'non-error rejection',
    );

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=alice&password=secret123&role=viewer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Failed to create user');
  });

  it('closes modal container via hx-swap-oob on success', async () => {
    vi.mocked(complianceClient.createUser).mockResolvedValueOnce({
      id: 'user-5',
      username: 'dave',
      role: 'user',
      active: true,
      createdAt: new Date().toISOString(),
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users',
      payload: 'username=dave&password=secret123&role=user',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('modal-container');
    expect(response.body).toContain('hx-swap-oob');
  });
});

// ── POST /admin/users/:id/deactivate ──────────────────────────────────────

describe('POST /admin/users/:id/deactivate', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllMocks();
  });

  it('deactivates user and returns HTMX row with Inactive badge', async () => {
    vi.mocked(complianceClient.deactivateUser).mockResolvedValueOnce(undefined);

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users/user-1/deactivate',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('badge--error');
    expect(response.body).toContain('Inactive');
    expect(response.body).toContain('User deactivated successfully');
    expect(response.body).toContain('user-user-1');
  });

  it('returns 500 when deactivateUser throws an Error', async () => {
    vi.mocked(complianceClient.deactivateUser).mockRejectedValueOnce(
      new Error('User not found'),
    );

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users/nonexistent/deactivate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('User not found');
  });

  it('returns 500 with generic message when deactivateUser throws non-Error', async () => {
    vi.mocked(complianceClient.deactivateUser).mockRejectedValueOnce(42);

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/users/some-id/deactivate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Failed to deactivate user');
  });

  it('returns 403 for non-admin user', async () => {
    const viewerCtx = await createTestServer('viewer');
    const response = await viewerCtx.server.inject({
      method: 'POST',
      url: '/admin/users/user-1/deactivate',
    });
    expect(response.statusCode).toBe(403);
    viewerCtx.cleanup();
  });
});
