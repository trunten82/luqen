import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { resolveEffectiveRoles } from '../../src/permissions.js';

let storage: SqliteStorageAdapter;
let dbPath: string;

async function seedOrg(slug: string): Promise<string> {
  const org = await storage.organizations.createOrg({ name: slug, slug });
  return org.id;
}

async function seedUserMembership(orgId: string, userId: string, role: string): Promise<void> {
  await storage.organizations.addMember(orgId, userId, role);
}

async function findOrgRole(name: string, orgId: string): Promise<string> {
  // Default roles (Owner/Admin/Member/Viewer) are auto-created per org by
  // createOrg(); look them up by name + org rather than re-create.
  const roles = await storage.roles.listRoles(orgId);
  const match = roles.find((r) => r.name === name);
  if (match === undefined) throw new Error(`no ${name} role in org ${orgId}`);
  return match.id;
}

async function seedTeamWithRole(
  homeOrgId: string,
  name: string,
  roleId: string,
): Promise<string> {
  const t = await storage.teams.createTeam({
    name,
    description: '',
    orgId: homeOrgId,
    roleId,
  });
  return t.id;
}

function deps() {
  return {
    organizations: storage.organizations,
    teams: storage.teams,
    teamOrgLinks: storage.teamOrgLinks,
    roles: storage.roles,
  };
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('resolveEffectiveRoles', () => {
  it('returns empty list when the user has no org memberships and no teams', async () => {
    const result = await resolveEffectiveRoles(deps(), 'u-unknown');
    expect(result).toEqual([]);
  });

  it('returns the user\'s org-level role when no teams contribute', async () => {
    const orgId = await seedOrg('org-a');
    await seedUserMembership(orgId, 'u-alice', 'Member');

    const result = await resolveEffectiveRoles(deps(), 'u-alice');
    expect(result).toHaveLength(1);
    expect(result[0].orgId).toBe(orgId);
    expect(result[0].role).toBe('Member');
    expect(result[0].sources).toEqual([{ kind: 'org', role: 'Member' }]);
  });

  it('MAX-aggregates: a team Admin role overrides the user\'s org-level Viewer', async () => {
    const orgId = await seedOrg('org-a');
    await seedUserMembership(orgId, 'u-alice', 'Viewer');
    const adminRoleId = await findOrgRole('Admin', orgId);
    const teamId = await seedTeamWithRole(orgId, 'Compliance', adminRoleId);
    await storage.teams.addTeamMember(teamId, 'u-alice', 'member');

    const result = await resolveEffectiveRoles(deps(), 'u-alice');
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('Admin');
    expect(result[0].sources.length).toBe(2);
    expect(result[0].sources.some((s) => s.kind === 'org' && s.role === 'Viewer')).toBe(true);
    expect(result[0].sources.some((s) => s.kind === 'team' && s.teamId === teamId)).toBe(true);
  });

  it('cross-org link contributes the team\'s role to the linked org', async () => {
    const homeOrg = await seedOrg('home');
    const targetOrg = await seedOrg('target');
    await seedUserMembership(targetOrg, 'u-alice', 'Viewer');
    const adminRoleId = await findOrgRole('Admin', homeOrg);
    const teamId = await seedTeamWithRole(homeOrg, 'Compliance', adminRoleId);
    await storage.teams.addTeamMember(teamId, 'u-alice', 'member');
    await storage.teamOrgLinks.link(teamId, targetOrg, 'admin');

    const result = await resolveEffectiveRoles(deps(), 'u-alice');
    const byOrg = new Map(result.map((r) => [r.orgId, r]));
    expect(byOrg.get(targetOrg)?.role).toBe('Admin');
    // The team also contributes to its home org even when the user has no
    // membership there.
    expect(byOrg.get(homeOrg)?.role).toBe('Admin');
    expect(byOrg.get(homeOrg)?.sources.every((s) => s.kind === 'team')).toBe(true);
  });

  it('an invite that has only been issued (not accepted) does not contribute', async () => {
    const homeOrg = await seedOrg('home');
    const targetOrg = await seedOrg('target');
    await seedUserMembership(targetOrg, 'u-alice', 'Viewer');
    const adminRoleId = await findOrgRole('Admin', homeOrg);
    const teamId = await seedTeamWithRole(homeOrg, 'Compliance', adminRoleId);
    await storage.teams.addTeamMember(teamId, 'u-alice', 'member');
    await storage.teamOrgLinks.inviteCreate(teamId, targetOrg, 'home-admin');

    const result = await resolveEffectiveRoles(deps(), 'u-alice');
    const target = result.find((r) => r.orgId === targetOrg);
    expect(target?.role).toBe('Viewer');
  });

  it('declining an invite leaves the prior org role unchanged', async () => {
    const homeOrg = await seedOrg('home');
    const targetOrg = await seedOrg('target');
    await seedUserMembership(targetOrg, 'u-alice', 'Member');
    const adminRoleId = await findOrgRole('Admin', homeOrg);
    const teamId = await seedTeamWithRole(homeOrg, 'C', adminRoleId);
    await storage.teams.addTeamMember(teamId, 'u-alice', 'member');
    const invite = await storage.teamOrgLinks.inviteCreate(teamId, targetOrg, 'a');
    await storage.teamOrgLinks.inviteDecline(invite!.id, 'target-admin');

    const result = await resolveEffectiveRoles(deps(), 'u-alice');
    expect(result.find((r) => r.orgId === targetOrg)?.role).toBe('Member');
  });

  it('unlink revokes the team\'s contribution to that org', async () => {
    const homeOrg = await seedOrg('home');
    const targetOrg = await seedOrg('target');
    await seedUserMembership(targetOrg, 'u-alice', 'Viewer');
    const adminRoleId = await findOrgRole('Admin', homeOrg);
    const teamId = await seedTeamWithRole(homeOrg, 'C', adminRoleId);
    await storage.teams.addTeamMember(teamId, 'u-alice', 'member');
    await storage.teamOrgLinks.link(teamId, targetOrg, 'a');

    let result = await resolveEffectiveRoles(deps(), 'u-alice');
    expect(result.find((r) => r.orgId === targetOrg)?.role).toBe('Admin');

    await storage.teamOrgLinks.unlink(teamId, targetOrg);
    result = await resolveEffectiveRoles(deps(), 'u-alice');
    expect(result.find((r) => r.orgId === targetOrg)?.role).toBe('Viewer');
  });
});
