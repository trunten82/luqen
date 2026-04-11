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

async function createTestServer(role: 'admin' | 'viewer' = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-org-bmode-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Test-only reply.view: returns JSON so we can assert template+data without
  // running Handlebars. Same pattern as organizations-admin.test.ts.
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  // Inject user + permissions. Admin gets every permission; viewer gets none
  // (empty set) so requirePermission('admin.system') rejects with 403.
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role };
    const permissions =
      role === 'admin' ? new Set(ALL_PERMISSION_IDS) : new Set<string>();
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

describe('admin branding-mode toggle — BMODE-03', () => {
  // ── GET /admin/organizations/:id/branding-mode ──────────────────────────

  describe('GET /admin/organizations/:id/branding-mode', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer('admin'); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 200 with form partial and current mode embedded (default)', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Acme Corp',
        slug: 'acme-corp',
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        template: string;
        data: { mode: string; org: { id: string }; currentMode: string };
      };
      expect(body.template).toBe('admin/partials/branding-mode-toggle.hbs');
      expect(body.data.mode).toBe('form');
      expect(body.data.org.id).toBe(org.id);
      expect(body.data.currentMode).toBe('embedded');
    });
  });

  describe('GET /admin/organizations/:id/branding-mode — non-admin', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer('viewer'); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 for a user without admin.system', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Bobs Brews',
        slug: 'bobs-brews',
      });

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /admin/organizations/:id/branding-mode — two-step confirmation ─

  describe('POST /admin/organizations/:id/branding-mode — step 1 (no _confirm)', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer('admin'); });
    afterEach(() => { ctx.cleanup(); });

    it('without _confirm: returns confirm modal and does NOT persist', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Cinnamon Co',
        slug: 'cinnamon-co',
      });

      // Before POST: mode is 'embedded'
      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        template: string;
        data: { mode: string; pendingMode: string; currentMode: string };
      };
      expect(body.template).toBe('admin/partials/branding-mode-toggle.hbs');
      expect(body.data.mode).toBe('confirm');
      expect(body.data.pendingMode).toBe('remote');
      expect(body.data.currentMode).toBe('embedded');

      // After POST without _confirm: mode MUST still be 'embedded'.
      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');
    });
  });

  describe('POST /admin/organizations/:id/branding-mode — step 2 (_confirm=yes)', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer('admin'); });
    afterEach(() => { ctx.cleanup(); });

    it('with _confirm=yes: persists the new mode', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Dune Distillers',
        slug: 'dune-distillers',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        template: string;
        data: { mode: string; currentMode: string };
      };
      expect(body.template).toBe('admin/partials/branding-mode-toggle.hbs');
      expect(body.data.mode).toBe('form');
      expect(body.data.currentMode).toBe('remote');

      // Persistence actually happened.
      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('remote');
    });

    it('with mode=default and _confirm=yes: resets to embedded (schema default)', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Echo Events',
        slug: 'echo-events',
      });

      // First, flip to 'remote' so we have something to reset FROM.
      await ctx.storage.organizations.setBrandingMode(org.id, 'remote');
      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('remote');

      // Now POST mode=default + _confirm=yes.
      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=default&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        template: string;
        data: { mode: string; currentMode: string };
      };
      expect(body.data.mode).toBe('form');
      expect(body.data.currentMode).toBe('embedded');

      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');
    });
  });

  describe('POST /admin/organizations/:id/branding-mode — non-admin', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer('viewer'); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 and does NOT persist, even with _confirm=yes', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Forever Foods',
        slug: 'forever-foods',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-mode`,
        payload: 'mode=remote&_confirm=yes',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(403);

      // Must not have been persisted.
      expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');
    });
  });
});
