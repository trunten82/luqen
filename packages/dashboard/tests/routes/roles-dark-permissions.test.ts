/**
 * D-07 path 2 (Phase 87): a custom role can never carry `issues.dismiss` while
 * the permission is dark. Covers the three create/update call sites of
 * parsePermissions in routes/admin/roles.ts (POST, PATCH, POST method-override)
 * for an org Owner and for a global admin, plus the role form (D-13).
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { roleRoutes } from '../../src/routes/admin/roles.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly currentOrgId: string;
}

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orgId: string;
  cleanup: () => Promise<void>;
}

const open: Ctx[] = [];

async function createCtx(kind: 'owner' | 'global-admin'): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-roles-dark-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const org = await storage.organizations.createOrg({ name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });

  const user: TestUser = kind === 'owner'
    ? { id: 'owner-1', username: 'owner', role: 'user', currentOrgId: org.id }
    : { id: 'admin-1', username: 'root', role: 'admin', currentOrgId: 'system' };
  server.addHook('preHandler', async (request) => {
    request.user = { ...user };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.roles']);
  });
  await roleRoutes(server, storage);
  await server.ready();

  const ctx: Ctx = {
    server,
    storage,
    orgId: org.id,
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
  open.push(ctx);
  return ctx;
}

afterEach(async () => {
  while (open.length > 0) await open.pop()!.cleanup();
});

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function perms(...ids: string[]): string {
  return ids.map((id) => `permissions=${encodeURIComponent(id)}`).join('&');
}

async function storedPermissions(ctx: Ctx, name: string, orgId: string): Promise<string[]> {
  const role = await ctx.storage.roles.getRoleByNameAndOrg(name, orgId);
  expect(role, `role ${name} must exist`).not.toBeNull();
  return [...(role?.permissions ?? [])].sort();
}

describe('roles: dark permission handling', () => {
  it('org owner cannot grant a dark permission on create', async () => {
    const ctx = await createCtx('owner');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/roles',
      headers: FORM,
      payload: `name=auditors&scope=org&${perms('issues.dismiss', 'reports.view')}`,
    });
    expect(res.statusCode).toBe(302);
    expect(await storedPermissions(ctx, 'auditors', ctx.orgId)).toEqual(['reports.view']);
  });

  it('org owner cannot grant a dark permission on PATCH', async () => {
    const ctx = await createCtx('owner');
    const role = await ctx.storage.roles.createRole({ name: 'auditors', description: '', permissions: ['trends.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/roles/${role.id}`,
      headers: FORM,
      payload: perms('issues.dismiss', 'reports.view'),
    });
    expect(res.statusCode).toBe(302);
    expect(await storedPermissions(ctx, 'auditors', ctx.orgId)).toEqual(['reports.view']);
  });

  it('org owner cannot grant a dark permission on POST method-override', async () => {
    const ctx = await createCtx('owner');
    const role = await ctx.storage.roles.createRole({ name: 'auditors', description: '', permissions: ['trends.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/roles/${role.id}`,
      headers: FORM,
      payload: `_method=PATCH&${perms('issues.dismiss', 'reports.view')}`,
    });
    expect(res.statusCode).toBe(302);
    expect(await storedPermissions(ctx, 'auditors', ctx.orgId)).toEqual(['reports.view']);
  });

  it('global admin cannot grant a dark permission on a GLOBAL role', async () => {
    const ctx = await createCtx('global-admin');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/roles',
      headers: FORM,
      payload: `name=globalauditors&scope=global&${perms('issues.dismiss', 'reports.view')}`,
    });
    expect(res.statusCode).toBe(302);
    expect(await storedPermissions(ctx, 'globalauditors', 'system')).toEqual(['reports.view']);
  });

  it('role form hides dark permissions', async () => {
    const ctx = await createCtx('owner');
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/roles/new' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { permissionGroups: Array<{ permissions: Array<{ id: string }> }> } };
    const ids = body.data.permissionGroups.flatMap((g) => g.permissions.map((p) => p.id));
    expect(ids).not.toContain('issues.dismiss');
    expect(ids).toContain('issues.fix');
  });
});
