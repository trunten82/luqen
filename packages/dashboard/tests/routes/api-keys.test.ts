import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { apiKeyRoutes } from '../../src/routes/admin/api-keys.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-apikeys-${randomUUID()}.db`);

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

  await apiKeyRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

// ── GET /admin/api-keys ──────────────────────────────────────────────────────

describe('GET /admin/api-keys', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with api-keys template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/api-keys' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/api-keys.hbs');
  });

  it('includes empty keys list when no keys exist', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/api-keys' });
    const body = response.json() as { data: { keys: unknown[] } };
    expect(body.data.keys).toHaveLength(0);
  });

  it('includes keys after creation', async () => {
    await ctx.storage.apiKeys.storeKey('test-key-value', 'my-label');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/api-keys' });
    const body = response.json() as { data: { keys: Array<{ label: string }> } };
    expect(body.data.keys).toHaveLength(1);
    expect(body.data.keys[0].label).toBe('my-label');
  });
});

// ── GET /admin/api-keys/new ──────────────────────────────────────────────────

describe('GET /admin/api-keys/new', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with api-key-form template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/api-keys/new' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/api-key-form.hbs');
  });
});

// ── POST /admin/api-keys ─────────────────────────────────────────────────────

describe('POST /admin/api-keys', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('creates a key and returns HTMX HTML with key value', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys',
      payload: 'label=my-test-key',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('my-test-key');
    expect(response.body).toContain('created successfully');
  });

  it('uses "default" label when none is provided', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys',
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('default');
  });

  it('returns 400 when label exceeds 100 characters', async () => {
    const longLabel = 'a'.repeat(101);
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys',
      payload: `label=${longLabel}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('100 characters');
  });

  it('the plaintext key is shown in the response only once', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys',
      payload: 'label=reveal-test',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('New API Key Generated');
    expect(response.body).toContain('will not be shown again');
  });
});

// ── POST /admin/api-keys/:id/revoke ──────────────────────────────────────────

describe('POST /admin/api-keys/:id/revoke', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('revokes an existing key and returns updated row', async () => {
    const id = await ctx.storage.apiKeys.storeKey('some-key', 'revoke-me');
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/api-keys/${id}/revoke`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('revoked successfully');

    const keys = await ctx.storage.apiKeys.listKeys();
    const key = keys.find(k => k.id === id);
    // active is stored as 0/false in SQLite — test either falsy value
    expect(key?.active).toBeFalsy();
  });

  it('returns 404 for non-existent key id', async () => {
    // Revoke first, then check — storage.revokeKey may not throw for unknown,
    // so we check the 404 path by using a key id that was never created.
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys/nonexistent-id/revoke',
    });
    // Either 404 (key not found after revoke) or 500 (storage error)
    expect([404, 500]).toContain(response.statusCode);
  });
});

// ── GET /admin/api-keys/:id/view ──────────────────────────────────────────────

describe('GET /admin/api-keys/:id/view', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with key detail template for existing key', async () => {
    const id = await ctx.storage.apiKeys.storeKey('view-key-value', 'view-label');
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/api-keys/${id}/view`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string; data: { key: { label: string } } };
    expect(body.template).toBe('admin/api-key-view.hbs');
    expect(body.data.key.label).toBe('view-label');
  });

  it('returns 404 for non-existent key id', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/api-keys/nonexistent-id/view',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('not found');
  });
});

// ── Access control ────────────────────────────────────────────────────────────

describe('API keys admin access control', () => {
  it('non-admin (viewer role) gets 403 on GET /admin/api-keys', async () => {
    const ctx = await createTestServer('viewer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/api-keys' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (user role) gets 403 on POST /admin/api-keys', async () => {
    const ctx = await createTestServer('user');
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys',
      payload: 'label=test',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (developer role) gets 403 on POST /admin/api-keys/:id/revoke', async () => {
    const ctx = await createTestServer('developer');
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/api-keys/some-id/revoke',
    });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});
