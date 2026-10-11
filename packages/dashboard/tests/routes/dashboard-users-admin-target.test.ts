/**
 * canManageUser let an org Owner manage ANY member of one of their org's
 * teams — including a global dashboard admin who happens to sit in that team.
 * An org Owner could then reset the admin's password (account takeover),
 * deactivate or delete them. A non-global-admin actor must never manage a
 * global admin, wherever that admin sits.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { dashboardUserRoutes } from '../../src/routes/admin/dashboard-users.js';

const PASSWORD = 'Placeholder-Pass-2026!x';
const NEW_PASSWORD = 'Placeholder-Pass-2026!y';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly adminId: string;
  readonly memberId: string;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-du-admin-target-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const fabrikam = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' })).id;
  const team = await storage.teams.createTeam({ name: 'Fabrikam QA', description: 'QA', orgId: fabrikam });
  const admin = await storage.users.createUser('global-admin', PASSWORD, 'admin');
  const member = await storage.users.createUser('fabrikam-member', PASSWORD, 'user');
  // A second, unrelated admin so the last-active-admin protection cannot mask the scope check.
  await storage.users.createUser('other-admin', PASSWORD, 'admin');
  await storage.teams.addTeamMember(team.id, admin.id);
  await storage.teams.addTeamMember(team.id, member.id);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'owner-1', username: 'fabrikam-owner', role: 'user', currentOrgId: fabrikam };
    (request as unknown as Record<string, unknown>)['permissions'] =
      new Set(['users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles']);
  });
  await dashboardUserRoutes(server, storage);
  await server.ready();
  return {
    server, storage, adminId: admin.id, memberId: member.id,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

describe('an org owner cannot manage a global admin who sits in their team', () => {
  it('refuses resetting a global admin password (admin target)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/dashboard-users/${ctx.adminId}/reset-password`, headers: FORM,
      payload: `newPassword=${encodeURIComponent(NEW_PASSWORD)}&confirmPassword=${encodeURIComponent(NEW_PASSWORD)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(await ctx.storage.users.verifyPassword('global-admin', PASSWORD)).toBeTruthy();
  });

  it('refuses deactivating a global admin (admin target)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/dashboard-users/${ctx.adminId}/deactivate` });
    expect(res.statusCode).toBe(403);
    expect((await ctx.storage.users.getUserById(ctx.adminId))?.active).toBe(true);
  });

  it('refuses deleting a global admin (admin target)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({ method: 'DELETE', url: `/admin/dashboard-users/${ctx.adminId}` });
    expect(res.statusCode).toBe(403);
    expect(await ctx.storage.users.getUserById(ctx.adminId)).not.toBeNull();
  });

  it('still lets the owner deactivate an ordinary member of their team', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/dashboard-users/${ctx.memberId}/deactivate` });
    expect(res.statusCode).toBe(200);
    expect((await ctx.storage.users.getUserById(ctx.memberId))?.active).toBe(false);
  });
});
