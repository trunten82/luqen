/**
 * admin.system and admin.users are global-only: a user holds them through their GLOBAL role and
 * through no organization-scoped source.
 *
 * - Writes: an organization role cannot carry either id (POST, PATCH and the method-override update
 *   answer 422; the repository refuses as a second layer) and the organization role form does not
 *   offer them. A global role may carry them.
 * - Resolution: a team-bound role confers neither (the repository's team-role loop), and
 *   resolveEffectivePermissions removes both from every non-admin result, so a role row written by
 *   any path, before or after this rule, gives nobody either id.
 *
 * R1 and R2 read the REPOSITORY (getEffectivePermissions) so its filter is observed on its own; R3
 * uses a stub repository so only the resolver is observed.
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

const GLOBAL_ONLY = ['admin.system', 'admin.users'] as const;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

interface Store {
  readonly storage: SqliteStorageAdapter;
  readonly raw: Database.Database;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function openStore(): Promise<Store> {
  const dbPath = join(tmpdir(), `test-global-only-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const raw = new Database(dbPath);
  cleanups.push(async () => {
    raw.close();
    await storage.disconnect();
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(p)) rmSync(p);
  });
  return { storage, raw };
}

/** A role row written by ANY path (SQL), so the test does not depend on a write refusal. */
function rawRole(store: Store, name: string, orgId: string, permissions: readonly string[], isSystem = 0): string {
  const id = `raw-${randomUUID()}`;
  store.raw
    .prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, '', isSystem, orgId, new Date().toISOString());
  for (const p of permissions) {
    store.raw.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(id, p);
  }
  return id;
}

/** A 'user' account that is a member of a team in `orgId` bound to `roleId`. */
async function teamMember(store: Store, orgId: string, roleId: string, tag: string): Promise<string> {
  const member = await store.storage.users.createUser(`fabrikam-member-${tag}`, 'Pass-word-123!', 'user');
  const team = await store.storage.teams.createTeam({ name: `team-${tag}`, description: '', orgId, roleId });
  await store.storage.teams.addTeamMember(team.id, member.id);
  return member.id;
}

// ── Route harness ───────────────────────────────────────────────────────────────────────────

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

/** The checkbox values of the role form (role-form.hbs renders one checkbox per permissionGroups id). */
async function formPermissionIds(ctx: Ctx, url: string): Promise<string[]> {
  const res = await ctx.server.inject({ method: 'GET', url });
  expect(res.statusCode, url).toBe(200);
  const data = (res.json() as { data: { permissionGroups: Array<{ permissions: Array<{ id: string }> }> } }).data;
  return data.permissionGroups.flatMap((g) => g.permissions.map((p) => p.id));
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────

describe('global only permissions: organization role writes', () => {
  it('global only permissions: creating an org role with admin users is refused', async () => {
    const ctx = await routeCtx('owner');
    const res = await ctx.server.inject({
      method: 'POST', url: '/admin/roles', headers: FORM,
      payload: body({ name: 'qa', scope: 'org', permissions: ['reports.view', 'admin.users'] }),
    });
    expect(res.statusCode).toBe(422);
    expect(await ctx.store.storage.roles.getRoleByNameAndOrg('qa', ctx.orgId)).toBeNull();
  });

  it('global only permissions: patching an org role to add admin users is refused', async () => {
    const ctx = await routeCtx('owner');
    const owner = await ctx.store.storage.roles.getRoleByNameAndOrg('Owner', ctx.orgId);
    const before = owner!.permissions;
    const res = await ctx.server.inject({
      method: 'PATCH', url: `/admin/roles/${owner!.id}`, headers: FORM,
      payload: body({ permissions: [...before, 'admin.users'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(owner!.id))?.permissions).toEqual(before);
  });

  it('global only permissions: the method override update adding admin users is refused', async () => {
    const ctx = await routeCtx('owner');
    const qa = await ctx.store.storage.roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: ctx.orgId });
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/roles/${qa.id}`, headers: FORM,
      payload: body({ _method: 'PATCH', permissions: ['reports.view', 'admin.users'] }),
    });
    expect(res.statusCode).toBe(422);
    expect((await ctx.store.storage.roles.getRole(qa.id))?.permissions).toEqual(['reports.view']);
  });

  it('global only permissions: the repository refuses an org role carrying admin users', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const roles = store.storage.roles;

    await expect(
      roles.createRole({ name: 'qa-users', description: '', permissions: ['reports.view', 'admin.users'], orgId: org.id }),
    ).rejects.toThrow(/admin\.users/);
    expect(await roles.getRoleByNameAndOrg('qa-users', org.id)).toBeNull();

    const qa = await roles.createRole({ name: 'qa', description: '', permissions: ['reports.view'], orgId: org.id });
    await expect(roles.updateRole(qa.id, { permissions: ['reports.view', 'admin.users'] })).rejects.toThrow(/admin\.users/);
    expect((await roles.getRole(qa.id))?.permissions).toEqual(['reports.view']);

    // Control: a global role may carry both.
    const ops = await roles.createRole({ name: 'user-ops', description: '', permissions: [...GLOBAL_ONLY], orgId: 'system' });
    expect([...ops.permissions].sort()).toEqual([...GLOBAL_ONLY]);
  });

  it('global only permissions: the org role form offers neither admin users nor admin system', async () => {
    const owner = await routeCtx('owner');
    const orgRole = await owner.store.storage.roles.getRoleByNameAndOrg('Owner', owner.orgId);
    const createIds = await formPermissionIds(owner, '/admin/roles/new?scope=org');
    const editIds = await formPermissionIds(owner, `/admin/roles/${orgRole!.id}/edit`);
    expect(createIds).toContain('admin.roles'); // positive control: the org form lists administration ids
    for (const id of GLOBAL_ONLY) {
      expect(createIds, `create form ${id}`).not.toContain(id);
      expect(editIds, `edit form ${id}`).not.toContain(id);
    }

    const admin = await routeCtx('global-admin', owner.store, owner.orgId);
    const globalIds = await formPermissionIds(admin, '/admin/roles/new?scope=global');
    for (const id of GLOBAL_ONLY) expect(globalIds, `global form ${id}`).toContain(id);
  });
});

// ── Resolution ──────────────────────────────────────────────────────────────────────────────

describe('global only permissions: resolution', () => {
  it('global only permissions: a team bound to an org role carrying them confers neither', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const legacy = rawRole(store, 'ops-legacy', org.id, ['scans.schedule', ...GLOBAL_ONLY]);
    const memberId = await teamMember(store, org.id, legacy, 'r1');

    const perms = await store.storage.roles.getEffectivePermissions(memberId, org.id);
    expect(perms.has('scans.schedule')).toBe(true); // positive control: the team path is live
    for (const id of GLOBAL_ONLY) expect(perms.has(id), id).toBe(false);
  });

  it('global only permissions: a team bound to the built in admin role confers neither', async () => {
    const store = await openStore();
    const org = await store.storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
    const memberId = await teamMember(store, org.id, 'admin', 'r2');

    const perms = await store.storage.roles.getEffectivePermissions(memberId, org.id);
    expect(perms.has('admin.roles')).toBe(true); // positive control: the built-in row's grants arrive
    for (const id of GLOBAL_ONLY) expect(perms.has(id), id).toBe(false);
  });

  it('global only permissions: resolveEffectivePermissions removes them for a non admin', async () => {
    const stub = { getEffectivePermissions: async (): Promise<Set<string>> => new Set(['reports.view', ...GLOBAL_ONLY]) };
    const perms = await resolveEffectivePermissions(stub, 'member-1', 'user', 'org-1');
    expect(perms.has('reports.view')).toBe(true);
    for (const id of GLOBAL_ONLY) expect(perms.has(id), id).toBe(false);
  });

  it('global only permissions: the resolver keeps the repository answer when the caller role names no global role', async () => {
    // A token without a role claim reaches the resolver as 'member'; the repository reads the stored
    // row, and for a stored global admin it answers every permission. That answer stands.
    const stub = { getEffectivePermissions: async (): Promise<Set<string>> => new Set(ALL_PERMISSION_IDS) };
    const perms = await resolveEffectivePermissions(stub, 'admin-1', 'member', 'org-1');
    for (const id of GLOBAL_ONLY) expect(perms.has(id), id).toBe(true);
  });

  it('global only permissions: a global admin still resolves every permission', async () => {
    const stub = { getEffectivePermissions: async (): Promise<Set<string>> => new Set<string>() };
    const perms = await resolveEffectivePermissions(stub, 'admin-1', 'admin', 'org-1');
    expect([...perms].sort()).toEqual([...ALL_PERMISSION_IDS].sort());
  });
});
