/**
 * HARD-21 end to end: a signed-in session answers every request for its stored principal.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts): users sign in through POST /login
 * and keep their session cookie; the test then changes the stored state through a second storage
 * adapter on the same database file (active flag, user row, role, API key, organization membership)
 * and reads what the next request with the SAME cookie answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Session-42!';

let h: McpOauthHarness;

beforeAll(async () => {
  h = await startMcpOauthHarness('session-stored-user');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

/** One GET with the given session cookie. */
async function get(cookie: string, url: string): Promise<LightMyRequestResponse> {
  return await h.app.inject({ method: 'GET', url, cookies: { session: cookie } });
}

/** Sign a stored user in and return the session cookie. */
async function signIn(username: string): Promise<string> {
  const login = await h.login(username, PASSWORD);
  expect(login.status, `login=${login.status}`).toBe(302);
  return login.session.cookie;
}

/** A stored user who belongs to one organization (org-scoped /api routes answer for a member). */
async function memberOfOne(username: string, orgName: string, slug: string): Promise<{ readonly id: string }> {
  const user = await h.seed.users.createUser(username, PASSWORD, 'user');
  const org = await h.seed.organizations.createOrg({ name: orgName, slug });
  await h.seed.organizations.addMember(org.id, user.id, 'member');
  return user;
}

/** The session.ended audit rows written for `userId`. */
function sessionEndedRows(userId: string): Array<{ details: string | null; actor_id: string | null }> {
  return h.seed.getRawDatabase()
    .prepare("SELECT details, actor_id FROM audit_log WHERE action = 'session.ended' AND actor_id = ?")
    .all(userId) as Array<{ details: string | null; actor_id: string | null }>;
}

describe('HARD-21 a session answers for its stored user', () => {
  it('HARD-21 a session ends on the next request once its user is deactivated', async () => {
    const user = await memberOfOne('fabrikam-s1', 'Fabrikam S1', 'fabrikam-s1');
    const cookie = await signIn('fabrikam-s1');
    const pageBefore = await get(cookie, '/account');
    const apiBefore = await get(cookie, '/api/v1/entitlement');
    const trail = [`before page=${pageBefore.statusCode} api=${apiBefore.statusCode}`];
    expect(pageBefore.statusCode, trail.join(' ')).toBe(200); // positive control: the session works
    expect(apiBefore.statusCode, trail.join(' ')).not.toBe(401);

    await h.seed.users.deactivateUser(user.id);
    const page = await get(cookie, '/account');
    const api = await get(cookie, '/api/v1/entitlement');
    trail.push(`after page=${page.statusCode} location=${String(page.headers.location)} api=${api.statusCode}`);

    expect(page.statusCode, trail.join(' ')).toBe(302);
    expect(String(page.headers.location), trail.join(' ')).toMatch(/^\/login/);
    expect(api.statusCode, trail.join(' ')).toBe(401);
  }, 60_000);

  it('HARD-21 a session ends on the next request once its user is deleted', async () => {
    const user = await memberOfOne('fabrikam-s2', 'Fabrikam S2', 'fabrikam-s2');
    const cookie = await signIn('fabrikam-s2');
    const pageBefore = await get(cookie, '/account');
    const apiBefore = await get(cookie, '/api/v1/entitlement');
    const trail = [`before page=${pageBefore.statusCode} api=${apiBefore.statusCode}`];
    expect(pageBefore.statusCode, trail.join(' ')).toBe(200); // positive control: the session works
    expect(apiBefore.statusCode, trail.join(' ')).not.toBe(401);

    expect(await h.seed.users.deleteUser(user.id)).toBe(true);
    const page = await get(cookie, '/account');
    const api = await get(cookie, '/api/v1/entitlement');
    trail.push(`after page=${page.statusCode} location=${String(page.headers.location)} api=${api.statusCode}`);

    expect(page.statusCode, trail.join(' ')).toBe(302);
    expect(String(page.headers.location), trail.join(' ')).toMatch(/^\/login/);
    expect(api.statusCode, trail.join(' ')).toBe(401);
  }, 60_000);

  it('HARD-21 a session loses the admin role on the next request after a demotion', async () => {
    const user = await h.seed.users.createUser('northwind-s3', PASSWORD, 'admin');
    const cookie = await signIn('northwind-s3');
    const before = await get(cookie, '/admin/dashboard-users');
    const trail = [`before=${before.statusCode}`];
    expect(before.statusCode, trail.join(' ')).toBe(200); // positive control: the admin page answers

    await h.seed.users.updateUserRole(user.id, 'user');
    const after = await get(cookie, '/admin/dashboard-users');
    trail.push(`after=${after.statusCode}`);

    expect(after.statusCode, trail.join(' ')).toBe(403);
  }, 60_000);

  it('HARD-21 a session holds the admin role on the next request after a promotion', async () => {
    const user = await h.seed.users.createUser('northwind-s4', PASSWORD, 'user');
    const cookie = await signIn('northwind-s4');
    const before = await get(cookie, '/admin/api-keys');
    const trail = [`before=${before.statusCode}`];
    expect(before.statusCode, trail.join(' ')).toBe(403); // the global-only page is closed to the user role

    await h.seed.users.updateUserRole(user.id, 'admin');
    const after = await get(cookie, '/admin/api-keys');
    trail.push(`after=${after.statusCode}`);

    expect(after.statusCode, trail.join(' ')).toBe(200);
  }, 60_000);

  it('HARD-21 a refused session reaches the sign in page', async () => {
    const user = await h.seed.users.createUser('contoso-s11', PASSWORD, 'user');
    let cookie = await signIn('contoso-s11');
    await h.seed.users.deactivateUser(user.id);

    let url = '/login';
    const trail: string[] = [];
    let res = await get(cookie, url);
    let redirects = 0;
    while (res.statusCode === 302 && redirects < 5) {
      redirects += 1;
      cookie = res.cookies.find((c) => c.name === 'session')?.value ?? cookie;
      url = String(res.headers.location);
      trail.push(`302->${url}`);
      res = await get(cookie, url);
    }
    trail.push(`final=${res.statusCode} url=${url}`);

    expect(redirects, trail.join(' ')).toBeLessThanOrEqual(2);
    expect(res.statusCode, trail.join(' ')).toBe(200);
    expect(url.split('?')[0], trail.join(' ')).toBe('/login');
  }, 60_000);

  it('HARD-21 a refused session writes one audit row', async () => {
    const user = await h.seed.users.createUser('contoso-s12', PASSWORD, 'user');
    const cookie = await signIn('contoso-s12');
    expect(sessionEndedRows(user.id)).toEqual([]);
    await h.seed.users.deactivateUser(user.id);

    const page = await get(cookie, '/account');
    const rows = sessionEndedRows(user.id);
    const trail = `page=${page.statusCode} rows=${JSON.stringify(rows)}`;

    expect(page.statusCode, trail).toBe(302);
    expect(rows, trail).toEqual([{ details: 'inactive_user', actor_id: user.id }]);
  }, 60_000);
});
