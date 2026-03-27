import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ALL_PERMISSION_IDS, resolveEffectivePermissions } from '../../src/permissions.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('getEffectivePermissions', () => {
  it('returns global permissions when no org context', async () => {
    const user = await storage.users.createUser('global-user', 'pass', 'user');
    const perms = await storage.roles.getEffectivePermissions(user.id);

    // Should match the 'user' system role permissions (9)
    const userRole = await storage.roles.getRoleByName('user');
    expect(perms.size).toBe(userRole!.permissions.length);
  });

  it('returns global permissions when org context is system', async () => {
    const user = await storage.users.createUser('sys-user', 'pass', 'user');
    const perms = await storage.roles.getEffectivePermissions(user.id, 'system');

    const userRole = await storage.roles.getRoleByName('user');
    expect(perms.size).toBe(userRole!.permissions.length);
  });

  it('admin gets all permissions regardless of org context', async () => {
    const user = await storage.users.createUser('admin-eff', 'pass', 'admin');
    const org = await storage.organizations.createOrg({ name: 'AdminOrg', slug: 'admin-eff' });

    const perms = await storage.roles.getEffectivePermissions(user.id, org.id);
    expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
  });

  it('unions global and org role permissions via team membership', async () => {
    // Create a user with 'executive' role (3 global perms: reports.view, reports.export, trends.view)
    const user = await storage.users.createUser('exec-team', 'pass', 'executive');

    // Create org (auto-creates Owner/Admin/Member/Viewer roles)
    const org = await storage.organizations.createOrg({ name: 'TeamOrg', slug: 'team-perm' });

    // Find the org's "Admin" role (has more perms than executive)
    const orgRoles = (await storage.roles.listRoles(org.id)).filter((r) => r.orgId === org.id);
    const adminRole = orgRoles.find((r) => r.name === 'Admin');
    expect(adminRole).toBeDefined();

    // Create team with Admin role, add user
    const team = await storage.teams.createTeam({
      name: 'Perm Team',
      description: '',
      orgId: org.id,
      roleId: adminRole!.id,
    });
    await storage.teams.addTeamMember(team.id, user.id);

    // Get effective permissions
    const perms = await storage.roles.getEffectivePermissions(user.id, org.id);

    // Should have global executive perms UNION org admin perms
    expect(perms.has('reports.view')).toBe(true);      // global executive
    expect(perms.has('reports.export')).toBe(true);     // global executive
    expect(perms.has('trends.view')).toBe(true);        // global executive
    expect(perms.has('scans.create')).toBe(true);       // org admin
    expect(perms.has('scans.schedule')).toBe(true);     // org admin
    expect(perms.has('repos.manage')).toBe(true);       // org admin

    // Should NOT have permissions not in either role
    expect(perms.has('admin.system')).toBe(false);
    // users.create is now part of org Admin permissions
    expect(perms.has('users.create')).toBe(true);
  });

  it('takes the union of multiple team roles in the same org', async () => {
    const user = await storage.users.createUser('multi-team', 'pass', 'executive');
    const org = await storage.organizations.createOrg({ name: 'MultiOrg', slug: 'multi-team' });

    const orgRoles = (await storage.roles.listRoles(org.id)).filter((r) => r.orgId === org.id);
    const memberRole = orgRoles.find((r) => r.name === 'Member');
    const viewerRole = orgRoles.find((r) => r.name === 'Viewer');

    // Create two teams with different roles
    const team1 = await storage.teams.createTeam({
      name: 'Team A', description: '', orgId: org.id, roleId: memberRole!.id,
    });
    const team2 = await storage.teams.createTeam({
      name: 'Team B', description: '', orgId: org.id, roleId: viewerRole!.id,
    });
    await storage.teams.addTeamMember(team1.id, user.id);
    await storage.teams.addTeamMember(team2.id, user.id);

    const perms = await storage.roles.getEffectivePermissions(user.id, org.id);

    // Union of executive + Member + Viewer
    expect(perms.has('scans.create')).toBe(true);   // from Member
    expect(perms.has('reports.view')).toBe(true);    // from all
    expect(perms.has('trends.view')).toBe(true);     // from executive + Member
  });

  it('returns only global perms when user has no teams in the org', async () => {
    const user = await storage.users.createUser('no-team', 'pass', 'executive');
    const org = await storage.organizations.createOrg({ name: 'NoTeamOrg', slug: 'no-team' });

    const perms = await storage.roles.getEffectivePermissions(user.id, org.id);

    // Only global executive perms (3)
    expect(perms.size).toBe(3);
  });

  it('ignores teams with no role_id', async () => {
    const user = await storage.users.createUser('norole-team', 'pass', 'executive');
    const org = await storage.organizations.createOrg({ name: 'NoRoleOrg', slug: 'norole' });

    // Create team without a role
    const team = await storage.teams.createTeam({
      name: 'No Role Team', description: '', orgId: org.id,
    });
    await storage.teams.addTeamMember(team.id, user.id);

    const perms = await storage.roles.getEffectivePermissions(user.id, org.id);

    // Only global executive perms, no org additions
    expect(perms.size).toBe(3);
  });
});

describe('resolveEffectivePermissions helper', () => {
  it('admin always gets all permissions', async () => {
    const perms = await resolveEffectivePermissions(
      storage.roles,
      'any-user-id',
      'admin',
      'any-org-id',
    );
    expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
  });

  it('delegates to getEffectivePermissions for non-admin', async () => {
    const user = await storage.users.createUser('resolve-helper', 'pass', 'user');
    const perms = await resolveEffectivePermissions(
      storage.roles,
      user.id,
      'user',
    );
    const userRole = await storage.roles.getRoleByName('user');
    expect(perms.size).toBe(userRole!.permissions.length);
  });
});
