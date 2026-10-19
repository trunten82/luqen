/**
 * Teams are created in and moved to only an organization the caller administers.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and drives only real cookie
 * routes. An org Owner of Fabrikam may create teams in Fabrikam and keep them there; the team forms
 * offer a non-global caller only their own organization, and the routes hold the same rule, so a team
 * never carries its members or its bound role into another organization at an org Owner's request. A
 * global administrator places teams in any organization.
 *
 * Every step's status is recorded in the assertion message, so a chain that stopped early says where.
 * The final assertions read the stored rows, not the responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Owner-42!';

let h: McpOauthHarness;

interface SeededOwner {
  readonly orgId: string;
  readonly ownerId: string;
  readonly username: string;
  readonly ownerRoleId: string;
}

/** A fresh org with an Owner whose global role is 'user' (Owners team + org membership 'owner'). */
async function seedOrgOwner(name: string, slug: string): Promise<SeededOwner> {
  const org = await h.seed.organizations.createOrg({ name, slug });
  const username = `${slug}-owner`;
  const owner = await h.seed.users.createUser(username, PASSWORD, 'user');
  const ownerRole = await h.seed.roles.getRoleByNameAndOrg('Owner', org.id);
  const team = await h.seed.teams.createTeam({ name: `${slug}-owners`, description: '', orgId: org.id, roleId: ownerRole!.id });
  await h.seed.teams.addTeamMember(team.id, owner.id);
  await h.seed.organizations.addMember(org.id, owner.id, 'owner');
  return { orgId: org.id, ownerId: owner.id, username, ownerRoleId: ownerRole!.id };
}

async function orgIdOfTeam(name: string, orgIds: readonly string[]): Promise<string | null> {
  for (const orgId of [...orgIds, 'system']) {
    const team = await h.seed.teams.getTeamByName(name, orgId);
    if (team !== null) return team.orgId;
  }
  return null;
}

beforeAll(async () => {
  h = await startMcpOauthHarness('team-org');
  await h.seed.users.createUser('fabrikam-global-admin', PASSWORD, 'admin');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('team organization: teams are created in and moved to the organization the caller administers', () => {
  it('team organization: an org owner moves a team only within the organization they administer', async () => {
    const fabrikam = await seedOrgOwner('Fabrikam C1', 'fabrikam-c1');
    const northwind = await seedOrgOwner('Northwind C1', 'northwind-c1');
    const trail: string[] = [];
    const login = await h.login(fabrikam.username, PASSWORD);
    trail.push(`login=${login.status}`);
    const switched = await h.switchOrg(login.session, fabrikam.orgId);
    trail.push(`switch=${switched.status}`);
    const created = await h.postForm(switched.session, '/admin/teams', { name: 'fabrikam-c1-ops', roleId: fabrikam.ownerRoleId });
    trail.push(`createTeam=${created.status}`);
    const team = await h.seed.teams.getTeamByName('fabrikam-c1-ops', fabrikam.orgId);
    trail.push(`team=${team === null ? 'none' : 'found'}`);
    let session = created.session;
    if (team !== null) {
      const member = await h.postForm(session, `/admin/teams/${team.id}/members`, { userId: fabrikam.ownerId });
      trail.push(`member=${member.status}`);
      const moved = await h.postForm(member.session, `/admin/teams/${team.id}/org`, { organizationId: northwind.orgId });
      trail.push(`move=${moved.status}`);
      session = moved.session;
      if (moved.status < 400) {
        const intoNorthwind = await h.switchOrg(session, northwind.orgId);
        trail.push(`switchNorthwind=${intoNorthwind.status}`);
        const roles = await h.app.inject({ method: 'GET', url: '/admin/roles', cookies: { session: intoNorthwind.session.cookie } });
        trail.push(`northwindRoles=${roles.statusCode}`);
      }
    }

    expect(team?.id, trail.join(' ')).toBeDefined();
    expect((await h.seed.teams.getTeam(team!.id))?.orgId, trail.join(' ')).toBe(fabrikam.orgId);
    const orgs = (await h.seed.organizations.getUserOrgs(fabrikam.ownerId)).map((o) => o.id);
    expect(orgs, trail.join(' ')).not.toContain(northwind.orgId);
    const inNorthwind = await h.seed.roles.getEffectivePermissions(fabrikam.ownerId, northwind.orgId);
    expect(inNorthwind.has('admin.org'), trail.join(' ')).toBe(false);
    expect(inNorthwind.has('admin.roles'), trail.join(' ')).toBe(false);
  }, 60_000);

  it('team organization: an org owner creates a team only in the organization they administer', async () => {
    const fabrikam = await seedOrgOwner('Fabrikam C2', 'fabrikam-c2');
    const northwind = await seedOrgOwner('Northwind C2', 'northwind-c2');
    const trail: string[] = [];
    const login = await h.login(fabrikam.username, PASSWORD);
    trail.push(`login=${login.status}`);
    const switched = await h.switchOrg(login.session, fabrikam.orgId);
    trail.push(`switch=${switched.status}`);
    const created = await h.postForm(switched.session, '/admin/teams', { name: 'fabrikam-c2-outpost', organizationId: northwind.orgId });
    trail.push(`createTeam=${created.status}`);

    expect(await h.seed.teams.getTeamByName('fabrikam-c2-outpost', northwind.orgId), trail.join(' ')).toBeNull();
    const ownCreate = await h.postForm(created.session, '/admin/teams', { name: 'fabrikam-c2-own', organizationId: fabrikam.orgId });
    trail.push(`createOwn=${ownCreate.status}`);
    expect((await h.seed.teams.getTeamByName('fabrikam-c2-own', fabrikam.orgId))?.orgId, trail.join(' ')).toBe(fabrikam.orgId);
  }, 60_000);

  it('team organization: a team leaves its organization only at a global admin request', async () => {
    const fabrikam = await seedOrgOwner('Fabrikam C3', 'fabrikam-c3');
    const trail: string[] = [];
    const login = await h.login(fabrikam.username, PASSWORD);
    trail.push(`login=${login.status}`);
    const switched = await h.switchOrg(login.session, fabrikam.orgId);
    trail.push(`switch=${switched.status}`);
    const created = await h.postForm(switched.session, '/admin/teams', { name: 'fabrikam-c3-ops' });
    trail.push(`createTeam=${created.status}`);
    const team = await h.seed.teams.getTeamByName('fabrikam-c3-ops', fabrikam.orgId);
    trail.push(`team=${team === null ? 'none' : 'found'}`);
    if (team !== null) {
      const moved = await h.postForm(created.session, `/admin/teams/${team.id}/org`, { organizationId: '' });
      trail.push(`moveToNone=${moved.status}`);
    }

    expect(team?.id, trail.join(' ')).toBeDefined();
    expect((await h.seed.teams.getTeam(team!.id))?.orgId, trail.join(' ')).toBe(fabrikam.orgId);
  }, 60_000);

  it('team organization: a global admin moves and creates teams in any organization', async () => {
    const fabrikam = await seedOrgOwner('Fabrikam C4', 'fabrikam-c4');
    const northwind = await seedOrgOwner('Northwind C4', 'northwind-c4');
    const team = await h.seed.teams.createTeam({ name: 'fabrikam-c4-ops', description: '', orgId: fabrikam.orgId });
    const trail: string[] = [];
    const login = await h.login('fabrikam-global-admin', PASSWORD);
    trail.push(`login=${login.status}`);
    const moved = await h.postForm(login.session, `/admin/teams/${team.id}/org`, { organizationId: northwind.orgId });
    trail.push(`move=${moved.status}`);
    const created = await h.postForm(moved.session, '/admin/teams', { name: 'northwind-c4-ops', organizationId: northwind.orgId });
    trail.push(`createTeam=${created.status}`);

    expect((await h.seed.teams.getTeam(team.id))?.orgId, trail.join(' ')).toBe(northwind.orgId);
    expect(await orgIdOfTeam('northwind-c4-ops', [fabrikam.orgId, northwind.orgId]), trail.join(' ')).toBe(northwind.orgId);
  }, 60_000);
});
