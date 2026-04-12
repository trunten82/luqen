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
  dbPath: string;
  cleanup: () => void;
}

/**
 * Build a Fastify server wired to an EXISTING storage adapter.
 * This lets tests create orgs first (to learn the generated UUID),
 * then build the server with a matching currentOrgId.
 */
async function buildServer(
  storage: SqliteStorageAdapter,
  dbPath: string,
  permissions: Set<string>,
  opts: { role?: string; currentOrgId?: string } = {},
): Promise<TestContext> {
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

  const role = opts.role ?? 'user';
  const currentOrgId = opts.currentOrgId;

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'test-user-id',
      username: 'testuser',
      role,
      ...(currentOrgId !== undefined ? { currentOrgId } : {}),
    };
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await organizationRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, dbPath, cleanup };
}

/** Create a fresh DB + storage adapter. Caller owns lifecycle. */
async function freshStorage(): Promise<{ storage: SqliteStorageAdapter; dbPath: string }> {
  const dbPath = join(tmpdir(), `test-org-bmode-perms-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  return { storage, dbPath };
}

describe('branding-mode permission matrix — BPERM-01/02/03', () => {
  // ── admin.org-only user (own org) — should PASS branding routes ─────────

  describe('admin.org user accessing own org branding routes', () => {
    let ctx: TestContext;

    afterEach(() => { ctx.cleanup(); });

    it('GET /admin/organizations/:id/branding-mode returns 200', async () => {
      const { storage, dbPath } = await freshStorage();
      const org = await storage.organizations.createOrg({ name: 'Own Org', slug: 'own-org' });

      ctx = await buildServer(storage, dbPath, new Set(['admin.org']), {
        role: 'user',
        currentOrgId: org.id,
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(200);
    });

    it('POST /admin/organizations/:id/branding-mode returns 200 with _confirm=yes', async () => {
      const { storage, dbPath } = await freshStorage();
      const org = await storage.organizations.createOrg({ name: 'Own Org 2', slug: 'own-org-2' });

      ctx = await buildServer(storage, dbPath, new Set(['admin.org']), {
        role: 'user',
        currentOrgId: org.id,
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('POST /admin/organizations/:id/branding-test passes permission gate (not 403)', async () => {
      const { storage, dbPath } = await freshStorage();
      const org = await storage.organizations.createOrg({ name: 'Own Org 3', slug: 'own-org-3' });

      ctx = await buildServer(storage, dbPath, new Set(['admin.org']), {
        role: 'user',
        currentOrgId: org.id,
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
      });

      // branding-test calls server.brandingOrchestrator which is not decorated
      // in test — it will 500 (TypeError). The key assertion is NOT 403:
      // if we get 403 the permission gate rejected; any other code means
      // the route handler ran (permission + tenant isolation passed).
      expect(res.statusCode).not.toBe(403);
    });
  });

  // ── admin.org user accessing DIFFERENT org — should be DENIED ───────────

  describe('admin.org user accessing different org (tenant isolation)', () => {
    let ctx: TestContext;

    afterEach(() => { ctx.cleanup(); });

    it('GET /admin/organizations/:id/branding-mode returns 403 for different org', async () => {
      const { storage, dbPath } = await freshStorage();
      const org = await storage.organizations.createOrg({ name: 'Other Org', slug: 'other-org' });

      // currentOrgId deliberately does NOT match org.id
      ctx = await buildServer(storage, dbPath, new Set(['admin.org']), {
        role: 'user',
        currentOrgId: 'my-own-org-id',
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── admin.org user denied on system-wide routes ─────────────────────────

  describe('admin.org user denied system-wide org routes', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const { storage, dbPath } = await freshStorage();
      ctx = await buildServer(storage, dbPath, new Set(['admin.org']), {
        role: 'user',
        currentOrgId: 'some-org',
      });
    });

    afterEach(() => { ctx.cleanup(); });

    it('GET /admin/organizations (list all) returns 403', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/admin/organizations',
      });

      expect(res.statusCode).toBe(403);
    });

    it('GET /admin/organizations/new (create form) returns 403', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/admin/organizations/new',
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /admin/organizations (create org) returns 403', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/admin/organizations',
        payload: 'name=Hacked&slug=hacked',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /admin/organizations/:id/delete returns 403', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Target Org',
        slug: 'target-org',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/delete`,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── No-permission user denied ALL routes ────────────────────────────────

  describe('unprivileged user denied all branding-mode routes', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const { storage, dbPath } = await freshStorage();
      ctx = await buildServer(storage, dbPath, new Set<string>(), { role: 'viewer' });
    });

    afterEach(() => { ctx.cleanup(); });

    it('GET /admin/organizations/:id/branding-mode returns 403', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Restricted Org',
        slug: 'restricted-org',
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /admin/organizations/:id/branding-mode returns 403', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Restricted Org 2',
        slug: 'restricted-org-2',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── Full admin (admin.system) regression — still passes all routes ──────

  describe('admin.system user still passes all routes (regression)', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const { storage, dbPath } = await freshStorage();
      ctx = await buildServer(storage, dbPath, new Set(ALL_PERMISSION_IDS), { role: 'admin' });
    });

    afterEach(() => { ctx.cleanup(); });

    it('GET /admin/organizations returns 200', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/admin/organizations',
      });

      expect(res.statusCode).toBe(200);
    });

    it('GET /admin/organizations/:id/branding-mode returns 200', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Admin Org',
        slug: 'admin-org',
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(200);
    });

    it('POST /admin/organizations/:id/branding-mode returns 200', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Admin Org 2',
        slug: 'admin-org-2',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
