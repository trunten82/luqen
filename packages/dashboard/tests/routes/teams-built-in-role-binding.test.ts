/**
 * Built-in global role rows (org 'system', is_system) are bound to teams by global administrators.
 *
 * An org Owner (admin.teams in their own org) binds a team to one of their org's roles or to a
 * global custom role (the team forms offer both); creating a team with, or rebinding a team to, a
 * built-in row such as 'admin' or 'developer' answers 403 and writes nothing. A global
 * administrator binds any of them. Teams already bound to a built-in row keep their binding; the
 * permissions such a binding confers are filtered where they are resolved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { teamRoutes } from '../../src/routes/admin/teams.js';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const BUILT_IN = ['admin', 'developer'] as const;

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly orgId: string;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function openStorage(): Promise<SqliteStorageAdapter> {
  const dbPath = join(tmpdir(), `test-team-binding-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  cleanups.push(async () => {
    await storage.disconnect();
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(p)) rmSync(p);
  });
  return storage;
}

/** teamRoutes as an org Owner of `orgId` (global role 'user') or as a global administrator. */
async function teamCtx(kind: 'owner' | 'global-admin', storageIn?: SqliteStorageAdapter, orgIdIn?: string): Promise<Ctx> {
  const storage = storageIn ?? (await openStorage());
  const orgId = orgIdIn ?? (await storage.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${randomUUID().slice(0, 6)}` })).id;
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  const user = kind === 'owner'
    ? { id: 'owner-1', username: 'fabrikam-owner', role: 'user', currentOrgId: orgId }
    : { id: 'admin-1', username: 'root', role: 'admin', currentOrgId: orgId };
  server.addHook('preHandler', async (request) => {
    request.user = { ...user } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(['admin.teams']);
  });
  await teamRoutes(server, storage);
  await server.ready();
  cleanups.push(async () => { await server.close(); });
  return { server, storage, orgId };
}

const body = (fields: Record<string, string>): string =>
  Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function createTeam(ctx: Ctx, name: string, roleId: string) {
  return ctx.server.inject({ method: 'POST', url: '/admin/teams', headers: FORM, payload: body({ name, roleId }) });
}

async function rebind(ctx: Ctx, teamId: string, roleId: string) {
  return ctx.server.inject({ method: 'POST', url: `/admin/teams/${teamId}/role`, headers: FORM, payload: body({ roleId }) });
}

describe('global only permissions: team bindings to built in roles', () => {
  it('global only permissions: binding a new team to a built in role needs a global admin', async () => {
    const ctx = await teamCtx('owner');
    for (const roleId of BUILT_IN) {
      const res = await createTeam(ctx, `ops-${roleId}`, roleId);
      expect(res.statusCode, roleId).toBe(403);
      expect(await ctx.storage.teams.getTeamByName(`ops-${roleId}`, ctx.orgId), roleId).toBeNull();
    }
    const htmx = await ctx.server.inject({
      method: 'POST', url: '/admin/teams', headers: { ...FORM, 'hx-request': 'true' }, payload: body({ name: 'ops-htmx', roleId: 'admin' }),
    });
    expect(htmx.statusCode).toBe(403);
    expect(htmx.body).toContain('toast--error');
    expect(await ctx.storage.teams.getTeamByName('ops-htmx', ctx.orgId)).toBeNull();
  });

  it('global only permissions: rebinding a team to a built in role needs a global admin', async () => {
    const ctx = await teamCtx('owner');
    const member = await ctx.storage.roles.getRoleByNameAndOrg('Member', ctx.orgId);
    const team = await ctx.storage.teams.createTeam({ name: 'qa', description: '', orgId: ctx.orgId, roleId: member!.id });
    for (const roleId of BUILT_IN) {
      const res = await rebind(ctx, team.id, roleId);
      expect(res.statusCode, roleId).toBe(403);
      expect((await ctx.storage.teams.getTeam(team.id))?.roleId, roleId).toBe(member!.id);
    }
  });

  it('global only permissions: an org owner binds a team to an org role or a global custom role', async () => {
    const owner = await teamCtx('owner');
    const orgRole = await owner.storage.roles.getRoleByNameAndOrg('Member', owner.orgId);
    const auditor = await owner.storage.roles.createRole({ name: 'auditor', description: '', permissions: ['reports.view'], orgId: 'system' });
    expect(auditor.isSystem).toBe(false);

    for (const [name, roleId] of [['readers', orgRole!.id], ['auditors', auditor.id]] as const) {
      const res = await createTeam(owner, name, roleId);
      expect(res.statusCode, name).toBe(302);
      expect((await owner.storage.teams.getTeamByName(name, owner.orgId))?.roleId, name).toBe(roleId);
    }
    const readers = await owner.storage.teams.getTeamByName('readers', owner.orgId);
    expect((await rebind(owner, readers!.id, auditor.id)).statusCode).toBe(302);
    expect((await owner.storage.teams.getTeam(readers!.id))?.roleId).toBe(auditor.id);
    expect((await rebind(owner, readers!.id, orgRole!.id)).statusCode).toBe(302);
    expect((await owner.storage.teams.getTeam(readers!.id))?.roleId).toBe(orgRole!.id);

    // A global administrator binds a built-in row on both routes.
    const admin = await teamCtx('global-admin', owner.storage, owner.orgId);
    expect((await createTeam(admin, 'platform', 'developer')).statusCode).toBe(302);
    expect((await admin.storage.teams.getTeamByName('platform', owner.orgId))?.roleId).toBe('developer');
    expect((await rebind(admin, readers!.id, 'admin')).statusCode).toBe(302);
    expect((await admin.storage.teams.getTeam(readers!.id))?.roleId).toBe('admin');
  });
});
