/**
 * Team membership follows organization membership on every route that adds a user to a team.
 * Through the REAL createServer and real cookie routes (tests/helpers/mcp-oauth-harness.ts).
 *
 * The four routes that add a user to a team share one rule (services/team-membership-scope.ts):
 *   - POST /admin/teams/:id/members                              (team page Add Member)
 *   - POST /admin/organizations/:id/members/add-to-team          (organization members page)
 *   - POST /admin/organizations/:id/members/:userId/move-team    (organization members page)
 *   - POST /api/v1/teams/:teamId/members                         (REST API)
 *
 * For each route: a Fabrikam Owner cannot bind a Northwind user or a user who belongs to no
 * organization (refused, nothing written), can bind Fabrikam's own teamless member, and a global
 * administrator can still bind anyone. Then: a refused bind leaves the Owner unable to reset that
 * user's password.
 *
 * Public repo: Fabrikam and Northwind placeholders only. Logins per file: 2 (the login route is rate
 * limited).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { loadTranslations } from '../../src/i18n/index.js';

const PASSWORD = 'Fabrikam-Scope-42!';
const SCOPE_MESSAGE = 'This user cannot be added to this team';

let h: McpOauthHarness;
let fabrikamId: string;
let northwindTeamId: string;
let owner: HarnessSession;
let globalAdmin: HarnessSession;
const ids = new Map<string, string>();

type Route = 'team-page' | 'add-to-team' | 'move-team' | 'api';
const ROUTES: readonly Route[] = ['team-page', 'add-to-team', 'move-team', 'api'];

async function seedUser(username: string): Promise<string> {
  const user = await h.seed.users.createUser(username, PASSWORD, 'user');
  ids.set(username, user.id);
  return user.id;
}

async function fabrikamTeam(name: string): Promise<string> {
  return (await h.seed.teams.createTeam({ name, description: '', orgId: fabrikamId })).id;
}

async function memberIdsOf(teamId: string): Promise<string[]> {
  return ((await h.seed.teams.getTeam(teamId))?.members ?? []).map((m) => m.userId);
}

function formHeaders(session: HarnessSession): Record<string, string> {
  return { 'x-csrf-token': session.csrf, 'content-type': 'application/x-www-form-urlencoded', 'hx-request': 'true' };
}

/** Bind `userId` to `teamId` through one of the four routes. */
async function bind(route: Route, session: HarnessSession, teamId: string, userId: string) {
  const cookies = { session: session.cookie };
  switch (route) {
    case 'team-page':
      return await h.app.inject({ method: 'POST', url: `/admin/teams/${teamId}/members`, cookies,
        headers: formHeaders(session), payload: new URLSearchParams({ userId }).toString() });
    case 'add-to-team':
      return await h.app.inject({ method: 'POST', url: `/admin/organizations/${fabrikamId}/members/add-to-team`, cookies,
        headers: formHeaders(session), payload: new URLSearchParams({ userId, teamId }).toString() });
    case 'move-team':
      return await h.app.inject({ method: 'POST', url: `/admin/organizations/${fabrikamId}/members/${userId}/move-team`, cookies,
        headers: formHeaders(session), payload: new URLSearchParams({ teamId }).toString() });
    case 'api':
      return await h.app.inject({ method: 'POST', url: `/api/v1/teams/${teamId}/members`, cookies,
        headers: { 'x-csrf-token': session.csrf, 'content-type': 'application/json' },
        payload: JSON.stringify({ user_id: userId, role: 'member' }) });
  }
}

async function resetPassword(session: HarnessSession, userId: string) {
  return await h.app.inject({ method: 'POST', url: `/admin/dashboard-users/${userId}/reset-password`,
    cookies: { session: session.cookie }, headers: formHeaders(session),
    payload: new URLSearchParams({ newPassword: 'Owner-Chosen-99!x', confirmPassword: 'Owner-Chosen-99!x' }).toString() });
}

beforeAll(async () => {
  loadTranslations();
  h = await startMcpOauthHarness('team-member-scope-routes');
  const fabrikam = await h.seed.organizations.createOrg({ name: 'Fabrikam Scope', slug: 'fabrikam-scope' });
  const northwind = await h.seed.organizations.createOrg({ name: 'Northwind Scope', slug: 'northwind-scope' });
  fabrikamId = fabrikam.id;

  const ownerId = await seedUser('fabrikam-scope-owner');
  const ownerRole = await h.seed.roles.getRoleByNameAndOrg('Owner', fabrikam.id);
  const owners = await h.seed.teams.createTeam({ name: 'fabrikam-scope-owners', description: '', orgId: fabrikam.id, roleId: ownerRole!.id });
  await h.seed.teams.addTeamMember(owners.id, ownerId);
  await h.seed.organizations.addMember(fabrikam.id, ownerId, 'owner');

  // Per route (and for the password reset case), its own outside users, so a broken guard on one
  // route cannot bind a user another route's test relies on: a Northwind member in a Northwind team,
  // a Northwind direct member in no team, and a user in no organization and no team.
  northwindTeamId = (await h.seed.teams.createTeam({ name: 'northwind-scope-staff', description: '', orgId: northwind.id })).id;
  for (const suffix of [...ROUTES, 'chain']) {
    const northwindMember = await seedUser(`northwind-scope-member-${suffix}`);
    await h.seed.teams.addTeamMember(northwindTeamId, northwindMember);
    await h.seed.organizations.addMember(northwind.id, northwindMember, 'member');
    await h.seed.organizations.addMember(northwind.id, await seedUser(`northwind-scope-teamless-${suffix}`), 'member');
    await seedUser(`scope-unbound-${suffix}`);
    await seedUser(`scope-admin-target-${suffix}`);
  }

  // Fabrikam's own members: one teamless direct member per route (each is bound once), and one in a team.
  for (const route of ROUTES) {
    await h.seed.organizations.addMember(fabrikam.id, await seedUser(`fabrikam-scope-teamless-${route}`), 'member');
  }
  const reviewer = await seedUser('fabrikam-scope-reviewer');
  const reviewers = await fabrikamTeam('fabrikam-scope-reviewers');
  await h.seed.teams.addTeamMember(reviewers, reviewer);
  await h.seed.organizations.addMember(fabrikam.id, reviewer, 'member');

  await h.seed.users.createUser('fabrikam-scope-admin', PASSWORD, 'admin');

  const ownerLogin = await h.login('fabrikam-scope-owner', PASSWORD);
  expect(ownerLogin.status, 'login owner').toBe(302);
  const switched = await h.switchOrg(ownerLogin.session, fabrikam.id);
  expect(switched.status, 'switch owner').toBeLessThan(400);
  owner = switched.session;
  const adminLogin = await h.login('fabrikam-scope-admin', PASSWORD);
  expect(adminLogin.status, 'login global admin').toBe(302);
  globalAdmin = adminLogin.session;
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('team membership follows organization membership on every route', () => {
  for (const route of ROUTES) {
    it(`TEAM-SCOPE ${route}: an Owner cannot bind a user from another organization or from none`, async () => {
      const teamId = await fabrikamTeam(`fabrikam-scope-refuse-${route}`);
      const trail: string[] = [];
      for (const username of [`northwind-scope-member-${route}`, `northwind-scope-teamless-${route}`, `scope-unbound-${route}`]) {
        const res = await bind(route, owner, teamId, ids.get(username)!);
        trail.push(`${username}=${res.statusCode}`);
        expect(res.statusCode, trail.join(' ')).toBe(403);
        expect(res.body, trail.join(' ')).toContain(SCOPE_MESSAGE);
      }
      expect(await memberIdsOf(teamId), trail.join(' ')).toEqual([]);
      // move-team removes before it adds: the refused user keeps their Northwind team.
      expect(await memberIdsOf(northwindTeamId), trail.join(' ')).toContain(ids.get(`northwind-scope-member-${route}`));
    }, 60_000);

    it(`TEAM-SCOPE ${route}: an Owner binds the organization's own teamless member`, async () => {
      const teamId = await fabrikamTeam(`fabrikam-scope-accept-${route}`);
      const userId = ids.get(`fabrikam-scope-teamless-${route}`)!;
      const res = await bind(route, owner, teamId, userId);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      expect(await memberIdsOf(teamId)).toContain(userId);
    }, 60_000);

    it(`TEAM-SCOPE ${route}: a global administrator still binds a user from another organization`, async () => {
      const teamId = await fabrikamTeam(`fabrikam-scope-admin-${route}`);
      const userId = ids.get(`scope-admin-target-${route}`)!;
      const res = await bind(route, globalAdmin, teamId, userId);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      expect(await memberIdsOf(teamId)).toContain(userId);
    }, 60_000);
  }

  it('TEAM-SCOPE api: an Owner still changes the role of a current member', async () => {
    const teamId = await fabrikamTeam('fabrikam-scope-role');
    const reviewer = ids.get('fabrikam-scope-reviewer')!;
    await h.seed.teams.addTeamMember(teamId, reviewer);
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/teams/${teamId}/members`, cookies: { session: owner.cookie },
      headers: { 'x-csrf-token': owner.csrf, 'content-type': 'application/json' },
      payload: JSON.stringify({ user_id: reviewer, role: 'admin' }) });
    expect(res.statusCode, res.body).toBe(200);
    const member = ((await h.seed.teams.getTeam(teamId))?.members ?? []).find((m) => m.userId === reviewer);
    expect(member?.role).toBe('admin');
  }, 60_000);

  it('TEAM-SCOPE a refused bind leaves the Owner unable to reset that user password', async () => {
    // Positive control: the Owner may reset the password of Fabrikam's own team member.
    const control = await resetPassword(owner, ids.get('fabrikam-scope-reviewer')!);
    expect(control.statusCode, control.body).toBe(200);
    for (const username of ['northwind-scope-teamless-chain', 'scope-unbound-chain']) {
      const userId = ids.get(username)!;
      const before = await resetPassword(owner, userId);
      expect(before.statusCode, `${username} before`).toBe(403);
      const teamId = await fabrikamTeam(`fabrikam-scope-chain-${username}`);
      const bound = await bind('api', owner, teamId, userId);
      expect(bound.statusCode, `${username} bind`).toBe(403);
      const after = await resetPassword(owner, userId);
      expect(after.statusCode, `${username} after`).toBe(403);
      expect(await h.seed.users.verifyPassword(username, PASSWORD), `${username} password unchanged`).toBe(true);
    }
  }, 60_000);
});
