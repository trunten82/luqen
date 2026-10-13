/**
 * Quick 261013-dr7, CR-01: a user's GLOBAL role resolves from org 'system' only, and no
 * org-scoped source can name itself like a global role or carry admin.system.
 *
 * Before this fix getUserPermissions looked the global role up by NAME in any org
 * (`SELECT * FROM roles WHERE name = ?`); idx_roles_name_org returns rows ordered by org_id and
 * random org ids sort below 'system', so an org role called `user` replaced the system `user` role
 * for every `user` account on the platform.
 *
 * Reserved-name matching is case-SENSITIVE on purpose: the lookup it protects compares
 * dashboard_users.role BINARY, so `Admin` (a default org role every org already has) can never
 * shadow `admin`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { roleRoutes } from '../../src/routes/admin/roles.js';
import { ALL_PERMISSION_IDS, resolveEffectivePermissions } from '../../src/permissions.js';

const RESERVED = ['admin', 'user', 'developer', 'executive', 'viewer'] as const;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

interface Store {
  readonly storage: SqliteStorageAdapter;
  readonly dbPath: string;
  readonly raw: Database.Database;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function openStore(): Promise<Store> {
  const dbPath = join(tmpdir(), `test-role-shadow-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const raw = new Database(dbPath);
  cleanups.push(async () => {
    raw.close();
    await storage.disconnect();
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(p)) rmSync(p);
  });
  return { storage, dbPath, raw };
}

/** A role row written by ANY path (SQL), so the test does not depend on the route refusing it. */
function rawRole(store: Store, name: string, orgId: string, permissions: readonly string[]): string {
  const id = `raw-${randomUUID()}`;
  store.raw
    .prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run(id, name, '', orgId, new Date().toISOString());
  for (const p of permissions) {
    store.raw.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(id, p);
  }
  return id;
}

/** What the pre-fix lookup returned: the first row of `WHERE name = ?` (any org). */
function oldLookupId(store: Store, name: string): string | null {
  const row = store.raw.prepare('SELECT id FROM roles WHERE name = ?').get(name) as { id: string } | undefined;
  return row?.id ?? null;
}

async function systemPerms(store: Store, roleId: string): Promise<string[]> {
  return [...(await store.storage.roles.getRolePermissions(roleId))].sort();
}

describe('global role resolution (repository)', () => {
  it('an org role named user carrying issues.dismiss and admin.system does not change a user account', async () => {
    const store = await openStore();
    const fabrikam = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const northwind = await store.storage.organizations.createOrg({ name: 'Northwind', slug: 'northwind' });
    const member = await store.storage.users.createUser('northwind-member', 'Pass-word-123!', 'user');
    const shadow = rawRole(store, 'user', fabrikam.id, ['issues.dismiss', 'admin.system']);

    // Positive control: the fixture really shadows under the pre-fix query.
    expect(oldLookupId(store, 'user')).toBe(shadow);

    const global = [...(await store.storage.roles.getUserPermissions(member.id))].sort();
    expect(global).toEqual(await systemPerms(store, 'user'));
    expect(global.length).toBeGreaterThan(0);
    const effective = await resolveEffectivePermissions(store.storage.roles, member.id, 'user', northwind.id);
    expect(effective.has('admin.system')).toBe(false);
    expect(effective.has('issues.dismiss')).toBe(false);
    expect((await store.storage.roles.getRoleByName('user'))?.orgId).toBe('system');
  });

  it('a prod-shaped database resolves every user exactly as the old lookup did', async () => {
    // Shape measured on prod 2026-10-13 (counts only): system roles admin/developer/executive/user;
    // org roles only Owner/Admin/Member/Executive/Viewer (capitalized); users hold admin, user or
    // viewer, and viewer matches no role row at all.
    const store = await openStore();
    for (const name of ['Fabrikam', 'Northwind', 'Tailspin']) {
      await store.storage.organizations.createOrg({ name, slug: name.toLowerCase() });
    }
    const users = [
      await store.storage.users.createUser('global-admin', 'Pass-word-123!', 'admin'),
      await store.storage.users.createUser('plain-user', 'Pass-word-123!', 'user'),
      await store.storage.users.createUser('plain-viewer', 'Pass-word-123!', 'viewer'),
    ];
    const expected: Record<string, string[]> = {
      admin: [...ALL_PERMISSION_IDS].sort(),
      user: await systemPerms(store, 'user'),
      viewer: [],
    };
    for (const u of users) {
      const oldId = oldLookupId(store, u.role);
      const now = await store.storage.roles.getRoleByName(u.role);
      expect(now?.id ?? null, u.role).toBe(oldId);
      expect([...(await store.storage.roles.getUserPermissions(u.id))].sort(), u.role).toEqual(expected[u.role]);
    }
  });

  it('an org team bound to the system admin role does not give its members admin.system in that org', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const member = await store.storage.users.createUser('fabrikam-member', 'Pass-word-123!', 'user');
    const team = await store.storage.teams.createTeam({ name: 'ops', description: '', orgId: org.id, roleId: 'admin' });
    await store.storage.teams.addTeamMember(team.id, member.id);

    const effective = await resolveEffectivePermissions(store.storage.roles, member.id, 'user', org.id);
    expect(effective.has('admin.roles')).toBe(true); // positive control: the team path is live
    expect(effective.has('admin.system')).toBe(false);
  });

  it('an org role holding admin.system bound to a team does not give its members admin.system', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const member = await store.storage.users.createUser('fabrikam-member', 'Pass-word-123!', 'user');
    const legacy = rawRole(store, 'qa-legacy', org.id, ['scans.schedule', 'admin.system']);
    const team = await store.storage.teams.createTeam({ name: 'qa', description: '', orgId: org.id, roleId: legacy });
    await store.storage.teams.addTeamMember(team.id, member.id);

    const effective = await resolveEffectivePermissions(store.storage.roles, member.id, 'user', org.id);
    expect(effective.has('scans.schedule')).toBe(true); // positive control
    expect(effective.has('admin.system')).toBe(false);
  });
});

describe('org-role invariants in the repository', () => {
  it('createRole and updateRole refuse a reserved org-role name and admin.system on an org role', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const roles = store.storage.roles;

    for (const name of RESERVED) {
      await expect(roles.createRole({ name, description: '', permissions: [], orgId: org.id }), name).rejects.toThrow();
    }
    await expect(
      roles.createRole({ name: 'qa', description: '', permissions: ['reports.view', 'admin.system'], orgId: org.id }),
    ).rejects.toThrow();

    const qa = await roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: org.id });
    await expect(roles.updateRole(qa.id, { name: 'developer' })).rejects.toThrow();
    await expect(roles.updateRole(qa.id, { permissions: ['admin.system'] })).rejects.toThrow();
    const after = await roles.getRole(qa.id);
    expect(after?.name).toBe('qa');
    expect(after?.permissions).toEqual(['reports.view']);

    // Controls: a global role may carry admin.system; a capitalized org name is not reserved.
    await expect(
      roles.createRole({ name: 'sysops', description: '', permissions: ['admin.system'], orgId: 'system' }),
    ).resolves.toBeTruthy();
    await expect(roles.createRole({ name: 'User', description: '', permissions: [], orgId: org.id })).resolves.toBeTruthy();
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  readonly server: FastifyInstance;
  readonly store: Store;
  readonly orgId: string;
}

async function routeCtx(kind: 'owner' | 'global-admin', store?: Store, orgIdIn?: string): Promise<Ctx> {
  const s = store ?? (await openStore());
  const orgId = orgIdIn ?? (await s.storage.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${randomUUID().slice(0, 6)}` })).id;
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
    (request as unknown as { permissions: Set<string> }).permissions = new Set(['admin.roles']);
  });
  await roleRoutes(server, s.storage);
  await server.ready();
  cleanups.push(async () => { await server.close(); });
  return { server, store: s, orgId };
}

const body = (fields: Record<string, string | readonly string[]>): string =>
  Object.entries(fields)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v as string]).map((x) => `${k}=${encodeURIComponent(x)}`))
    .join('&');

async function create(ctx: Ctx, fields: Record<string, string | readonly string[]>) {
  return ctx.server.inject({ method: 'POST', url: '/admin/roles', headers: FORM, payload: body(fields) });
}

describe('POST /admin/roles refuses an org role named like a global role', () => {
  it('an org Owner cannot create an org role with any reserved global role name', async () => {
    const ctx = await routeCtx('owner');
    for (const name of RESERVED) {
      const res = await create(ctx, { name, scope: 'org', permissions: ['reports.view'] });
      expect(res.statusCode, name).toBe(422);
      expect(await ctx.store.storage.roles.getRoleByNameAndOrg(name, ctx.orgId), name).toBeNull();
    }
  });

  it('a capitalized org role name is allowed: reserved-name matching is case-sensitive', async () => {
    const ctx = await routeCtx('owner');
    for (const name of ['User', 'Developer']) {
      const res = await create(ctx, { name, scope: 'org', permissions: ['reports.view'] });
      expect(res.statusCode, name).toBe(302);
      expect(await ctx.store.storage.roles.getRoleByNameAndOrg(name, ctx.orgId), name).not.toBeNull();
    }
  });

  it('an org role named like a custom global role is refused', async () => {
    const admin = await routeCtx('global-admin');
    expect((await create(admin, { name: 'auditor', scope: 'global', permissions: ['reports.view'] })).statusCode).toBe(302);
    const owner = await routeCtx('owner', admin.store, admin.orgId);
    const res = await create(owner, { name: 'auditor', scope: 'org', permissions: ['reports.view'] });
    expect(res.statusCode).toBe(422);
    expect(await owner.store.storage.roles.getRoleByNameAndOrg('auditor', owner.orgId)).toBeNull();
  });
});

describe('role rename refuses a reserved global role name', () => {
  it('PATCH rename of an org role to a reserved name is refused', async () => {
    const ctx = await routeCtx('owner');
    const qa = await ctx.store.storage.roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'PATCH', url: `/admin/roles/${qa.id}`, headers: FORM,
      payload: body({ name: 'developer', permissions: ['reports.view'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(qa.id))?.name).toBe('qa');
  });

  it('POST method-override rename of an org role to a reserved name is refused', async () => {
    const ctx = await routeCtx('owner');
    const qa = await ctx.store.storage.roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/roles/${qa.id}`, headers: FORM,
      payload: body({ _method: 'PATCH', name: 'executive', permissions: ['reports.view'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(qa.id))?.name).toBe('qa');
  });
});

describe('an org role can never carry admin.system', () => {
  it('org role create with admin.system is refused', async () => {
    const ctx = await routeCtx('owner');
    const res = await create(ctx, { name: 'qa', scope: 'org', permissions: ['reports.view', 'admin.system'] });
    expect(res.statusCode).toBe(422);
    expect(await ctx.store.storage.roles.getRoleByNameAndOrg('qa', ctx.orgId)).toBeNull();
  });

  it('PATCH adding admin.system to an org role is refused', async () => {
    const ctx = await routeCtx('owner');
    const owner = await ctx.store.storage.roles.getRoleByNameAndOrg('Owner', ctx.orgId);
    const before = owner!.permissions;
    const res = await ctx.server.inject({
      method: 'PATCH', url: `/admin/roles/${owner!.id}`, headers: FORM,
      payload: body({ permissions: [...before, 'admin.system'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(owner!.id))?.permissions).toEqual(before);
  });

  it('POST method-override adding admin.system to an org role is refused', async () => {
    const ctx = await routeCtx('global-admin');
    const qa = await ctx.store.storage.roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/roles/${qa.id}`, headers: FORM,
      payload: body({ _method: 'PATCH', permissions: ['reports.view', 'admin.system'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(qa.id))?.permissions).toEqual(['reports.view']);
  });

  it('a global admin may still create a GLOBAL role carrying admin.system', async () => {
    const ctx = await routeCtx('global-admin');
    const res = await create(ctx, { name: 'sysops', scope: 'global', permissions: ['admin.system'] });
    expect(res.statusCode).toBe(302);
    expect((await ctx.store.storage.roles.getRoleByNameAndOrg('sysops', 'system'))?.permissions).toEqual(['admin.system']);
  });
});
