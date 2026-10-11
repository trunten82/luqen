/**
 * User resolvers mirror routes/admin/dashboard-users.ts. Org Owner/Admin roles
 * hold users.* (ORG_OWNER_PERMISSIONS / ORG_ADMIN_PERMISSIONS), so REST gates
 * every by-id user action with canManageUser — a global admin may act on anyone;
 * anyone else only on users who are members of a team of their current org —
 * refusing with 403 BEFORE the existence check. It also downgrades a
 * non-global-admin's `role: 'admin'` create to 'user', and lists only the
 * caller org's users to a non-global-admin.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import {
  FABRIKAM_ORG, NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx, makeOrgKeyCtx,
} from './helpers/org-ctx.js';

const PERMS = ['users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles'];
const STRONG_PASSWORD = 'Placeholder-Pass-2026!x';

const NW_USER = { id: 'user-nw-member', username: 'northwind-member', role: 'user', active: true, createdAt: '2026-01-01' };
const FB_USER = { id: 'user-fb-member', username: 'fabrikam-member', role: 'user', active: true, createdAt: '2026-01-01' };
const GA_USER = { id: 'user-global-admin', username: 'global-admin', role: 'admin', active: true, createdAt: '2026-01-01' };
const TEAMS: Record<string, { id: string; orgId: string; members: Array<{ userId: string }> }> = {
  'team-fb': { id: 'team-fb', orgId: FABRIKAM_ORG, members: [{ userId: FB_USER.id }, { userId: GA_USER.id }] },
  'team-nw': { id: 'team-nw', orgId: NORTHWIND_ORG, members: [{ userId: NW_USER.id }] },
};

function makeStorage() {
  const users = [NW_USER, FB_USER, GA_USER];
  return {
    teams: {
      listTeamsByOrgId: vi.fn(async (orgId: string) => Object.values(TEAMS).filter((t) => t.orgId === orgId)),
      getTeam: vi.fn(async (id: string) => TEAMS[id] ?? null),
    },
    users: {
      getUserById: vi.fn(async (id: string) => users.find((u) => u.id === id) ?? null),
      listUsers: vi.fn(async () => users),
      listUsersForOrg: vi.fn(async (orgId: string) => (orgId === FABRIKAM_ORG ? [FB_USER] : [NW_USER])),
      deleteUser: vi.fn(async () => true),
      activateUser: vi.fn(async () => undefined),
      deactivateUser: vi.fn(async () => undefined),
      updatePassword: vi.fn(async () => undefined),
      createUser: vi.fn(async (username: string, _p: string, role: string) =>
        ({ id: 'new', username, role, active: true, createdAt: '2026-01-01' })),
    },
  };
}

type Storage = ReturnType<typeof makeStorage>;
const orgOwner = (s: Storage) => makeOrgCtx(s, { orgId: FABRIKAM_ORG, permissions: PERMS });

const byIdCases: ReadonlyArray<{
  name: string;
  write: keyof Storage['users'];
  run: (id: string, ctx: ReturnType<typeof orgOwner>) => Promise<unknown>;
}> = [
  { name: 'deleteUser', write: 'deleteUser', run: (id, ctx) => resolvers.Mutation.deleteUser({}, { id }, ctx) },
  { name: 'activateUser', write: 'activateUser', run: (id, ctx) => resolvers.Mutation.activateUser({}, { id }, ctx) },
  { name: 'deactivateUser', write: 'deactivateUser', run: (id, ctx) => resolvers.Mutation.deactivateUser({}, { id }, ctx) },
  { name: 'resetPassword', write: 'updatePassword',
    run: (id, ctx) => resolvers.Mutation.resetPassword({}, { id, newPassword: STRONG_PASSWORD }, ctx) },
];

describe('GraphQL user org scoping', () => {
  for (const c of byIdCases) {
    describe(c.name, () => {
      it('refuses an org owner acting on another org user (cross-org)', async () => {
        const storage = makeStorage();
        await expect(c.run(NW_USER.id, orgOwner(storage))).rejects.toThrow('Forbidden');
        expect(storage.users[c.write]).not.toHaveBeenCalled();
      });

      it('refuses an org-scoped admin key acting on another org user (cross-org)', async () => {
        const storage = makeStorage();
        await expect(c.run(NW_USER.id, makeOrgKeyCtx(storage, PERMS))).rejects.toThrow('Forbidden');
        expect(storage.users[c.write]).not.toHaveBeenCalled();
      });

      it('lets an org owner act on a member of their own org', async () => {
        const storage = makeStorage();
        await c.run(FB_USER.id, orgOwner(storage));
        expect(storage.users[c.write]).toHaveBeenCalled();
      });

      it('refuses an org owner acting on a global admin who sits in their team (admin target)', async () => {
        const storage = makeStorage();
        await expect(c.run(GA_USER.id, orgOwner(storage))).rejects.toThrow('Forbidden');
        expect(storage.users[c.write]).not.toHaveBeenCalled();
      });

      it('lets a global admin act on any user, as REST does', async () => {
        const storage = makeStorage();
        await c.run(NW_USER.id, makeGlobalAdminCtx(storage, PERMS));
        expect(storage.users[c.write]).toHaveBeenCalled();
      });
    });
  }

  describe('createUser', () => {
    it("downgrades an org owner's role 'admin' request to 'user' (cross-org escalation)", async () => {
      const storage = makeStorage();
      const created = await resolvers.Mutation.createUser({},
        { username: 'fabrikam-newuser', password: STRONG_PASSWORD, role: 'admin' }, orgOwner(storage));
      expect(created.role).toBe('user');
    });

    it("lets a global admin create a role 'admin' user, as REST does", async () => {
      const storage = makeStorage();
      const created = await resolvers.Mutation.createUser({},
        { username: 'fabrikam-newadmin', password: STRONG_PASSWORD, role: 'admin' }, makeGlobalAdminCtx(storage, PERMS));
      expect(created.role).toBe('admin');
    });
  });

  describe('Query.dashboardUsers', () => {
    it('lists only the caller org users to an org owner (cross-org)', async () => {
      const storage = makeStorage();
      const result = await resolvers.Query.dashboardUsers({}, {}, orgOwner(storage));
      expect(result).toEqual([FB_USER]);
      expect(storage.users.listUsers).not.toHaveBeenCalled();
    });

    it('lists every user to a global admin, as REST does', async () => {
      const storage = makeStorage();
      const result = await resolvers.Query.dashboardUsers({}, {}, makeGlobalAdminCtx(storage, PERMS));
      expect(result).toHaveLength(3);
    });
  });
});
