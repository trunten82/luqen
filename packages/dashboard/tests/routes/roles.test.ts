import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { roleRoutes } from '../../src/routes/admin/roles.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['admin.roles']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-roles-${randomUUID()}.db`);
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
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await roleRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('Role routes', () => {
  describe('GET /admin/roles', () => {
    it('returns 403 without admin.roles permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/roles' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with roles template when authorized', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/roles' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/roles.hbs');
    });

    it('lists roles including system roles in template data', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/roles' });
      ctx.cleanup();
      const body = response.json() as { data: { globalRoles: Array<{ name: string; systemBadge: boolean; canDelete: boolean }> } };
      expect(body.data.globalRoles.length).toBeGreaterThan(0);
      const adminRole = body.data.globalRoles.find((r) => r.name === 'admin');
      expect(adminRole).toBeDefined();
      expect(adminRole?.systemBadge).toBe(true);
      expect(adminRole?.canDelete).toBe(false);
    });
  });

  describe('GET /admin/roles/new', () => {
    it('returns 403 without admin.roles permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/roles/new' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with role form template', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/roles/new' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { isNew: boolean } };
      expect(body.template).toBe('admin/role-form.hbs');
      expect(body.data.isNew).toBe(true);
    });
  });

  describe('POST /admin/roles', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.roles permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=custom-role',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 422 when name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'description=Test',
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 when name has invalid characters', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=invalid+name',
      });
      expect(response.statusCode).toBe(422);
    });

    it('creates a custom role with permissions and redirects', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=my-custom-role&description=Custom+role&permissions=reports.view&permissions=trends.view',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/admin/roles');
      const role = await ctx.storage.roles.getRoleByName('my-custom-role');
      expect(role).not.toBeNull();
      expect(role?.permissions).toContain('reports.view');
    });

    it('returns 422 when role name already exists', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=admin&description=duplicate',
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('PATCH /admin/roles/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.roles permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'PATCH',
        url: '/admin/roles/some-id',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'description=updated',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent role', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/roles/non-existent-id',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'description=updated',
      });
      expect(response.statusCode).toBe(404);
    });

    it('updates a custom role', async () => {
      const role = await ctx.storage.roles.createRole({
        name: 'patch-role',
        description: 'before',
        permissions: [],
        orgId: 'system',
      });
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: `/admin/roles/${role.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'description=after&permissions=reports.view',
      });
      expect(response.statusCode).toBe(302);
    });
  });

  describe('DELETE /admin/roles/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without admin.roles permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/admin/roles/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent role', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/roles/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('refuses to delete a system role', async () => {
      const adminRole = await ctx.storage.roles.getRoleByName('admin');
      expect(adminRole).not.toBeNull();
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/roles/${adminRole!.id}` });
      expect(response.statusCode).toBe(422);
    });

    it('deletes a custom role', async () => {
      const role = await ctx.storage.roles.createRole({
        name: 'delete-me',
        description: 'to be deleted',
        permissions: [],
        orgId: 'system',
      });
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/roles/${role.id}` });
      expect(response.statusCode).toBe(302);
      const deleted = await ctx.storage.roles.getRole(role.id);
      expect(deleted).toBeNull();
    });
  });
});
