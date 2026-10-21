/**
 * HARD-21 end to end: a signed-in session answers every request for its stored principal.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts): users sign in through POST /login
 * and keep their session cookie; the test then changes the stored state through a second storage
 * adapter on the same database file (active flag, user row, role, API key, organization membership)
 * and reads what the next request with the SAME cookie answers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';

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

/**
 * Sign in through POST /login from `remoteAddress` (the sign-in route allows ten attempts per
 * address in 15 minutes; these tests sign in from their own address) and return the session with a
 * page CSRF token issued for it.
 */
async function signInFrom(fields: Record<string, string>, remoteAddress: string): Promise<HarnessSession> {
  const page = await h.app.inject({ method: 'GET', url: '/login', remoteAddress });
  const anonymous = page.cookies.find((c) => c.name === 'session')?.value ?? '';
  const login = await h.app.inject({
    method: 'POST', url: '/login', remoteAddress, cookies: { session: anonymous },
    headers: { 'x-csrf-token': csrfOf(page.body) }, payload: fields,
  });
  expect(login.statusCode, `login=${login.statusCode}`).toBe(302);
  const cookie = login.cookies.find((c) => c.name === 'session')?.value ?? '';
  const account = await get(cookie, '/account');
  return { cookie: account.cookies.find((c) => c.name === 'session')?.value ?? cookie, csrf: csrfOf(account.body) };
}

function csrfOf(html: string): string {
  return /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
}

const SECOND_ADDRESS = '127.0.0.2';

/** A system administrator key; returns its secret and row id. */
async function systemAdminKey(label: string): Promise<{ readonly key: string; readonly id: string }> {
  const key = generateApiKey();
  const id = storeApiKey(h.seed.getRawDatabase(), key, label, 'admin');
  return { key, id };
}

/** The organization a session's request acts in, as GET /orgs/current reports it. */
async function currentOrgOf(cookie: string): Promise<string | null> {
  const res = await get(cookie, '/orgs/current');
  expect(res.statusCode, `orgs/current=${res.statusCode}`).toBe(200);
  return (res.json() as { currentOrgId: string | null }).currentOrgId;
}

/** The org of a scan as the session's org-scoped GraphQL read answers it (null when not readable). */
async function scanOrgThrough(cookie: string, scanId: string): Promise<string | null> {
  const res = await h.app.inject({
    method: 'POST', url: '/graphql', cookies: { session: cookie },
    headers: { 'content-type': 'application/json' },
    payload: { query: 'query Q($id: ID!) { scan(id: $id) { orgId } }', variables: { id: scanId } },
  });
  expect(res.statusCode, `graphql=${res.statusCode}`).toBe(200);
  return (res.json() as { data?: { scan?: { orgId?: string } | null } }).data?.scan?.orgId ?? null;
}

/** An organization the user belongs to through org_members and the org's Member team. */
async function joinOrg(orgId: string, userId: string, tag: string): Promise<string> {
  const memberRole = await h.seed.roles.getRoleByNameAndOrg('Member', orgId);
  const team = await h.seed.teams.createTeam({ name: `${tag}-members`, description: '', orgId, ...(memberRole !== null ? { roleId: memberRole.id } : {}) });
  await h.seed.teams.addTeamMember(team.id, userId);
  await h.seed.organizations.addMember(orgId, userId, 'member');
  return team.id;
}

async function leaveOrg(orgId: string, userId: string, teamId: string): Promise<void> {
  await h.seed.teams.removeTeamMember(teamId, userId);
  await h.seed.organizations.removeMember(orgId, userId);
}

const pause = async (): Promise<void> => await new Promise((r) => setTimeout(r, 5));

describe('HARD-21 an api key session answers for its key', () => {
  it('HARD-21 an api key session ends once its key is revoked', async () => {
    const { key, id } = await systemAdminKey('Fabrikam s5');
    const session = await signInFrom({ apiKey: key }, SECOND_ADDRESS);
    const before = await get(session.cookie, '/account');
    const trail = [`before=${before.statusCode}`];
    expect(before.statusCode, trail.join(' ')).toBe(200); // positive control: the key session works

    await h.seed.apiKeys.revokeKey(id);
    const after = await get(session.cookie, '/account');
    trail.push(`after=${after.statusCode} location=${String(after.headers.location)}`);

    expect(after.statusCode, trail.join(' ')).toBe(302);
    expect(String(after.headers.location), trail.join(' ')).toMatch(/^\/login/);
  }, 60_000);

  it('HARD-21 an api key session ends once its key expires', async () => {
    const { key, id } = await systemAdminKey('Fabrikam s6');
    const session = await signInFrom({ apiKey: key }, SECOND_ADDRESS);
    const before = await get(session.cookie, '/account');
    const trail = [`before=${before.statusCode}`];
    expect(before.statusCode, trail.join(' ')).toBe(200); // positive control

    h.seed.getRawDatabase().prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), id);
    const after = await get(session.cookie, '/account');
    trail.push(`after=${after.statusCode} location=${String(after.headers.location)}`);

    expect(after.statusCode, trail.join(' ')).toBe(302);
    expect(String(after.headers.location), trail.join(' ')).toMatch(/^\/login/);
  }, 60_000);

  it('HARD-21 an api key session answers while its key is active', async () => {
    const { key } = await systemAdminKey('Fabrikam s7');
    const session = await signInFrom({ apiKey: key }, SECOND_ADDRESS);
    const first = await get(session.cookie, '/account');
    const second = await get(session.cookie, '/admin/api-keys');
    const trail = `first=${first.statusCode} second=${second.statusCode}`;

    expect(first.statusCode, trail).toBe(200);
    expect(second.statusCode, trail).toBe(200);
  }, 60_000);
});

describe('HARD-21 a session acts only in an organization of its user', () => {
  it('HARD-21 a session acts only in an organization its user belongs to', async () => {
    const user = await h.seed.users.createUser('northwind-s8', PASSWORD, 'user');
    const northwind = await h.seed.organizations.createOrg({ name: 'Northwind S8', slug: 'northwind-s8' });
    await pause();
    const fabrikam = await h.seed.organizations.createOrg({ name: 'Fabrikam S8', slug: 'fabrikam-s8' });
    await joinOrg(northwind.id, user.id, 'northwind-s8');
    const fabrikamTeam = await joinOrg(fabrikam.id, user.id, 'fabrikam-s8');
    const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
    await h.seed.scans.createScan({
      id: scanId, siteUrl: 'https://fabrikam.example/', standard: 'WCAG2AA', jurisdictions: [], regulations: [],
      createdBy: 'seed', createdAt: new Date().toISOString(), orgId: fabrikam.id,
    });
    const session = await signInFrom({ username: 'northwind-s8', password: PASSWORD }, SECOND_ADDRESS);
    const switched = await h.switchOrg(session, fabrikam.id);
    const trail = [`switch=${switched.status}`];
    const cookie = switched.session.cookie;
    const before = await currentOrgOf(cookie);
    const readBefore = await scanOrgThrough(cookie, scanId);
    trail.push(`before=${before === fabrikam.id ? 'fabrikam' : String(before)} read=${readBefore === fabrikam.id ? 'fabrikam' : String(readBefore)}`);
    expect(before, trail.join(' ')).toBe(fabrikam.id); // positive control: the session acts in Fabrikam
    expect(readBefore, trail.join(' ')).toBe(fabrikam.id);

    await leaveOrg(fabrikam.id, user.id, fabrikamTeam);
    const after = await currentOrgOf(cookie);
    const readAfter = await scanOrgThrough(cookie, scanId);
    trail.push(`after=${after === northwind.id ? 'northwind' : after === fabrikam.id ? 'fabrikam' : String(after)} read=${String(readAfter === fabrikam.id ? 'fabrikam' : readAfter)}`);

    expect(after, trail.join(' ')).toBe(northwind.id);
    expect(readAfter, trail.join(' ')).toBeNull();
  }, 60_000);

  it('HARD-21 a session forgets an organization its user left', async () => {
    const user = await h.seed.users.createUser('northwind-s9', PASSWORD, 'user');
    const northwind = await h.seed.organizations.createOrg({ name: 'Northwind S9', slug: 'northwind-s9' });
    await pause();
    const fabrikam = await h.seed.organizations.createOrg({ name: 'Fabrikam S9', slug: 'fabrikam-s9' });
    await joinOrg(northwind.id, user.id, 'northwind-s9');
    const fabrikamTeam = await joinOrg(fabrikam.id, user.id, 'fabrikam-s9');
    const session = await signInFrom({ username: 'northwind-s9', password: PASSWORD }, SECOND_ADDRESS);
    const switched = await h.switchOrg(session, fabrikam.id);
    const name = (id: string | null): string => (id === northwind.id ? 'northwind' : id === fabrikam.id ? 'fabrikam' : String(id));
    const trail = [`switch=${switched.status}`];
    let cookie = switched.session.cookie;
    const before = await currentOrgOf(cookie);
    trail.push(`before=${name(before)}`);
    expect(before, trail.join(' ')).toBe(fabrikam.id); // positive control

    await leaveOrg(fabrikam.id, user.id, fabrikamTeam);
    const afterLeaving = await get(cookie, '/orgs/current');
    cookie = afterLeaving.cookies.find((c) => c.name === 'session')?.value ?? cookie;
    trail.push(`left=${name((afterLeaving.json() as { currentOrgId: string | null }).currentOrgId)}`);
    await h.seed.organizations.addMember(fabrikam.id, user.id, 'member');
    const afterReturning = await currentOrgOf(cookie);
    trail.push(`returned=${name(afterReturning)}`);

    expect(afterReturning, trail.join(' ')).toBe(northwind.id);
  }, 60_000);

  it('HARD-21 a session of a user who left every organization acts in no organization', async () => {
    const user = await h.seed.users.createUser('contoso-s10', PASSWORD, 'user');
    const contoso = await h.seed.organizations.createOrg({ name: 'Contoso S10', slug: 'contoso-s10' });
    const contosoTeam = await joinOrg(contoso.id, user.id, 'contoso-s10');
    const session = await signInFrom({ username: 'contoso-s10', password: PASSWORD }, SECOND_ADDRESS);
    const switched = await h.switchOrg(session, contoso.id);
    const cookie = switched.session.cookie;
    const before = await currentOrgOf(cookie);
    const trail = [`switch=${switched.status} before=${before === contoso.id ? 'contoso' : String(before)}`];
    expect(before, trail.join(' ')).toBe(contoso.id); // positive control

    await leaveOrg(contoso.id, user.id, contosoTeam);
    const after = await currentOrgOf(cookie);
    trail.push(`after=${after === contoso.id ? 'contoso' : String(after)}`);

    expect(after, trail.join(' ')).toBeNull();
  }, 60_000);
});

describe('HARD-21 an ended session is recorded once', () => {
  it('HARD-21 a replayed ended session cookie writes one audit row', async () => {
    const user = await h.seed.users.createUser('fabrikam-se1', PASSWORD, 'user');
    const session = await signInFrom({ username: 'fabrikam-se1', password: PASSWORD }, '127.0.0.4');
    await h.seed.users.deactivateUser(user.id);

    const answers = new Map<number, number>();
    const replay = async (index: number, extra: Record<string, string>): Promise<void> => {
      const forwarded = index % 2 === 0 ? `203.0.113.${(index >> 1) % 256}` : `198.51.100.${(index >> 1) % 256}`;
      const res = await h.app.inject({
        method: 'GET', url: '/account', remoteAddress: '127.0.0.1', cookies: { session: session.cookie },
        headers: { 'x-forwarded-for': forwarded, ...extra },
      });
      answers.set(res.statusCode, (answers.get(res.statusCode) ?? 0) + 1);
    };
    for (let i = 0; i < 1000; i += 1) await replay(i, {});
    for (let i = 0; i < 100; i += 1) await replay(i, { authorization: 'Bearer not-a-key' });
    const rows = sessionEndedRows(user.id);
    const trail = `answers=${JSON.stringify([...answers])} rows=${rows.length}`;

    expect(answers.get(429) ?? 0, trail).toBe(0);
    expect(answers.get(302), trail).toBe(1100);
    expect(rows, trail).toEqual([{ details: 'inactive_user', actor_id: user.id }]);
  }, 120_000);

  it('HARD-21 each ended session writes its own audit row', async () => {
    const user = await h.seed.users.createUser('fabrikam-se2', PASSWORD, 'user');
    const first = await signInFrom({ username: 'fabrikam-se2', password: PASSWORD }, '127.0.0.5');
    const second = await signInFrom({ username: 'fabrikam-se2', password: PASSWORD }, '127.0.0.5');
    await h.seed.users.deactivateUser(user.id);

    for (const session of [first, second]) {
      for (let i = 0; i < 5; i += 1) {
        const res = await get(session.cookie, '/account');
        expect(res.statusCode, `replay ${i}`).toBe(302);
      }
    }
    const rows = sessionEndedRows(user.id);

    expect(rows.length, JSON.stringify(rows)).toBe(2);
  }, 60_000);
});

describe('HARD-21 a request acts in its own organization only', () => {
  async function orgAs(headers: Record<string, string>, cookie?: string): Promise<{ readonly status: number; readonly orgId: string | null }> {
    const res = await h.app.inject({
      method: 'GET', url: '/orgs/current', headers,
      ...(cookie !== undefined ? { cookies: { session: cookie } } : {}),
    });
    return { status: res.statusCode, orgId: res.statusCode === 200 ? (res.json() as { currentOrgId: string | null }).currentOrgId : null };
  }

  it('HARD-21 an api key request reports no organization from a session cookie it carries', async () => {
    const user = await h.seed.users.createUser('fabrikam-or1', PASSWORD, 'user');
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam OR1', slug: 'fabrikam-or1' });
    await h.seed.organizations.addMember(org.id, user.id, 'member');
    const session = await signInFrom({ username: 'fabrikam-or1', password: PASSWORD }, '127.0.0.6');
    const switched = await h.switchOrg(session, org.id);
    const cookie = switched.session.cookie;
    const { key } = await systemAdminKey('Fabrikam or1');

    const ownCookie = await currentOrgOf(cookie);
    const withKey = await orgAs({ authorization: `Bearer ${key}` }, cookie);
    const trail = `ownCookie=${String(ownCookie)} withKey=${withKey.status}/${String(withKey.orgId)} switched=${switched.status}`;

    expect(ownCookie, trail).toBe(org.id); // positive control: the cookie stores the organization
    expect(withKey.status, trail).toBe(200);
    expect(withKey.orgId, trail).toBeNull();
  }, 60_000);

  it('HARD-21 an api key session acts in no organization named by a request header', async () => {
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam OR2', slug: 'fabrikam-or2' });
    const { key } = await systemAdminKey('Fabrikam or2');
    const session = await signInFrom({ apiKey: key }, '127.0.0.7');

    const plain = await orgAs({}, session.cookie);
    const named = await orgAs({ 'x-org-id': org.id }, session.cookie);
    const trail = `plain=${plain.status}/${String(plain.orgId)} named=${named.status}/${String(named.orgId)}`;

    expect(plain.orgId, trail).toBeNull();
    expect(named.status, trail).toBe(200);
    expect(named.orgId, trail).toBeNull();
  }, 60_000);

  it('HARD-21 an api key request acts in the organization its header names', async () => {
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam OR3', slug: 'fabrikam-or3' });
    const { key } = await systemAdminKey('Fabrikam or3');

    const named = await orgAs({ authorization: `Bearer ${key}`, 'x-org-id': org.id });
    const trail = `named=${named.status}/${String(named.orgId)}`;

    expect(named.status, trail).toBe(200);
    expect(named.orgId, trail).toBe(org.id);
  }, 60_000);
});

describe('HARD-21 every cookie of a session idle-expires', () => {
  it('HARD-21 the cookie a sign in returns expires after the idle limit', async () => {
    const priorLimit = process.env['SESSION_EXPIRY_MINUTES'];
    process.env['SESSION_EXPIRY_MINUTES'] = '1';
    let short: McpOauthHarness | undefined;
    try {
      short = await startMcpOauthHarness('session-idle');
    } finally {
      if (priorLimit === undefined) delete process.env['SESSION_EXPIRY_MINUTES'];
      else process.env['SESSION_EXPIRY_MINUTES'] = priorLimit;
    }
    try {
      const server = short;
      await server.seed.users.createUser('fabrikam-sc1', PASSWORD, 'user');
      const remoteAddress = '127.0.0.8';
      const page = await server.app.inject({ method: 'GET', url: '/login', remoteAddress });
      const anonymous = page.cookies.find((c) => c.name === 'session')?.value ?? '';
      const login = await server.app.inject({
        method: 'POST', url: '/login', remoteAddress, cookies: { session: anonymous },
        headers: { 'x-csrf-token': csrfOf(page.body) }, payload: { username: 'fabrikam-sc1', password: PASSWORD },
      });
      const signInCookie = login.cookies.find((c) => c.name === 'session')?.value ?? '';
      // One request with a copy of the sign-in cookie: the cookie that request returns is a later one.
      const used = await server.app.inject({ method: 'GET', url: '/account', cookies: { session: signInCookie } });
      const laterCookie = used.cookies.find((c) => c.name === 'session')?.value ?? '';

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 61_000));
      const fromSignIn = await server.app.inject({ method: 'GET', url: '/account', cookies: { session: signInCookie } });
      const fromLater = await server.app.inject({ method: 'GET', url: '/account', cookies: { session: laterCookie } });
      const trail = `login=${login.statusCode} used=${used.statusCode} signIn=${fromSignIn.statusCode} ${String(fromSignIn.headers.location)} later=${fromLater.statusCode} ${String(fromLater.headers.location)}`;

      expect(login.statusCode, trail).toBe(302);
      expect(used.statusCode, trail).toBe(200); // positive control: the sign-in cookie works before the limit
      expect(fromSignIn.statusCode, trail).toBe(302);
      expect(String(fromSignIn.headers.location), trail).toBe('/login?expired=1');
      expect(fromLater.statusCode, trail).toBe(302);
      expect(String(fromLater.headers.location), trail).toBe('/login?expired=1');
    } finally {
      vi.useRealTimers();
      await short.close();
    }
  }, 120_000);
});
