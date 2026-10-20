/**
 * HARD-21 end to end: OAuth consent (/oauth/authorize) acts in the organization the dashboard shows
 * for the request (request.user.currentOrgId, resolved by the org-context preHandler), names it,
 * offers to switch only to organizations the user belongs to (the org-switch predicate), and is
 * available only to a stored dashboard user.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and drives the real sign-in,
 * consent page, Allow, code exchange and /api/v1/mcp. Users and organizations carry placeholder names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';

const PASSWORD = 'Fabrikam-Consent-42!';
const REDIRECT_URI = 'https://mcp-client.example/callback';

let h: McpOauthHarness;

interface AuthorizeRequest {
  readonly url: string;
  readonly challenge: string;
  readonly clientId: string;
  readonly resource: string;
}

async function authorizeRequest(clientIdOverride?: string): Promise<AuthorizeRequest> {
  const clientId = clientIdOverride ?? await h.clientId();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const resource = `${h.publicUrl}/api/v1/mcp`;
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'read', resource,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'consent',
  });
  return { url: `/oauth/authorize?${query.toString()}`, challenge, clientId, resource };
}

/** The claims of a signed JWT (no verification: the server's own MCP endpoint verifies it). */
function claimsOf(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** A team of `orgId` bound to a new org role holding `permissions`, with `userId` as its member. */
async function teamWithRole(orgId: string, tag: string, permissions: readonly string[], userId: string): Promise<string> {
  const role = await h.seed.roles.createRole({ name: `role-${tag}`, description: '', permissions: [...permissions], orgId });
  const team = await h.seed.teams.createTeam({ name: `team-${tag}`, description: '', orgId, roleId: role.id });
  await h.seed.teams.addTeamMember(team.id, userId);
  return team.id;
}

function rowCount(sql: string, ...args: unknown[]): number {
  return (h.seed.getRawDatabase().prepare(sql).get(...args) as { n: number }).n;
}

/** The value of a hidden input of the consent page. */
function fieldOf(html: string, name: string): string | undefined {
  return new RegExp(`name="${name}"\\s+value="([^"]*)"`).exec(html)?.[1];
}

interface OpenedPage {
  readonly status: number;
  readonly body: string;
  readonly session: HarnessSession;
  readonly csrf: string | undefined;
  readonly binding: string | undefined;
}

/** GET the consent page for `req` with `session`; the session the page leaves behind carries its CSRF secret. */
async function openPage(session: HarnessSession, req: AuthorizeRequest): Promise<OpenedPage> {
  const page = await h.app.inject({ method: 'GET', url: req.url, cookies: { session: session.cookie } });
  const cookie = page.cookies.find((c) => c.name === 'session')?.value ?? session.cookie;
  const csrf = fieldOf(page.body, '_csrf');
  return { status: page.statusCode, body: page.body, session: { cookie, csrf: csrf ?? session.csrf }, csrf, binding: fieldOf(page.body, 'consent_binding') };
}

/** POST Allow for `req` as the page's form would, with `overrides` replacing or (undefined) removing a field. */
async function postAllow(
  session: HarnessSession, req: AuthorizeRequest, page: OpenedPage, overrides: Record<string, string | undefined> = {},
): Promise<{ status: number; body: string; location: string | undefined }> {
  const fields: Record<string, string | undefined> = {
    _csrf: page.csrf, client_id: req.clientId, redirect_uri: REDIRECT_URI, scope: 'read', resource: req.resource,
    state: 'consent', code_challenge: req.challenge, code_challenge_method: 'S256', approved: 'true',
    consent_binding: page.binding, ...overrides,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) params.append(k, v);
  const res = await h.app.inject({
    method: 'POST', url: '/oauth/authorize/consent', cookies: { session: session.cookie },
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: params.toString(),
  });
  return { status: res.statusCode, body: res.body, location: typeof res.headers.location === 'string' ? res.headers.location : undefined };
}

/** Two organizations, a viewer holding mcp.use in both through custom organization roles. */
async function seedTwoOrgViewer(tag: string): Promise<{ username: string; userId: string; fabrikam: string; northwind: string }> {
  const fabrikam = await h.seed.organizations.createOrg({ name: `Fabrikam RV ${tag}`, slug: `fabrikam-rv-${tag}` });
  const northwind = await h.seed.organizations.createOrg({ name: `Northwind RV ${tag}`, slug: `northwind-rv-${tag}` });
  const username = `fabrikam-consent-${tag}`;
  const user = await h.seed.users.createUser(username, PASSWORD, 'viewer');
  for (const org of [fabrikam, northwind]) {
    await h.seed.organizations.addMember(org.id, user.id, 'member');
    await teamWithRole(org.id, `${tag}-${org.slug}`, ['mcp.use', 'reports.view'], user.id);
  }
  return { username, userId: user.id, fabrikam: fabrikam.id, northwind: northwind.id };
}

/** Rows the consent flow writes for `userId` and `clientId`. */
function writes(userId: string, clientId: string): { codes: number; consents: number; registeredBy: string | null } {
  return {
    codes: rowCount('SELECT COUNT(*) AS n FROM oauth_authorization_codes WHERE user_id = ? AND client_id = ?', userId, clientId),
    consents: rowCount('SELECT COUNT(*) AS n FROM oauth_user_consents WHERE user_id = ? AND client_id = ?', userId, clientId),
    registeredBy: (h.seed.getRawDatabase().prepare('SELECT registered_by_user_id AS r FROM oauth_clients_v2 WHERE client_id = ?').get(clientId) as { r: string | null }).r,
  };
}

beforeAll(async () => {
  h = await startMcpOauthHarness('consent-org');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-21 consent acts in the organization the dashboard shows', () => {
  it('HARD-21 consent acts in the organization the dashboard shows', async () => {
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam Consent A1', slug: 'fabrikam-consent-a1' });
    const user = await h.seed.users.createUser('fabrikam-consent-a1', PASSWORD, 'viewer');
    await teamWithRole(org.id, 'a1', ['mcp.use', 'reports.view'], user.id);
    const trail: string[] = [];
    // A fresh sign-in, no organization switch: the dashboard acts in the user's only organization.
    const login = await h.login('fabrikam-consent-a1', PASSWORD);
    trail.push(`login=${login.status}`);
    expect(login.status, trail.join(' ')).toBe(302); // positive control: signed in

    const req = await authorizeRequest();
    const page = await h.app.inject({ method: 'GET', url: req.url, cookies: { session: login.session.cookie } });
    const noAccess = page.body.includes('MCP access required');
    trail.push(`authorize=${page.statusCode} noAccess=${noAccess}`);
    expect(page.statusCode, trail.join(' ')).toBe(200);
    expect(noAccess, trail.join(' ')).toBe(false);
    expect(page.body, trail.join(' ')).toMatch(/Active org<\/dt>\s*<dd>Fabrikam Consent A1<\/dd>/);

    const minted = await h.mintToken(login.session, ['read']);
    for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
    expect(minted.token, trail.join(' ')).toBeDefined();
    expect(claimsOf(minted.token!)['orgId'], trail.join(' ')).toBe(org.id);
    const listed = await h.listTools(minted.token!);
    trail.push(`list=${listed.status}/${listed.names.length}`);
    expect(listed.status, trail.join(' ')).toBe(200);
    expect(listed.names, trail.join(' ')).toContain('dashboard_list_reports');
  }, 60_000);

  it('HARD-21 consent offers only organizations the user can switch to', async () => {
    const contoso = await h.seed.organizations.createOrg({ name: 'Contoso Consent A2', slug: 'contoso-consent-a2' });
    const fabrikam = await h.seed.organizations.createOrg({ name: 'Fabrikam Consent A2', slug: 'fabrikam-consent-a2' });
    const northwind = await h.seed.organizations.createOrg({ name: 'Northwind Consent A2', slug: 'northwind-consent-a2' });
    const user = await h.seed.users.createUser('contoso-consent-a2', PASSWORD, 'viewer');
    // Contoso: a direct membership whose role grants no MCP use.
    await h.seed.organizations.addMember(contoso.id, user.id, 'member');
    await teamWithRole(contoso.id, 'a2-contoso', ['reports.view'], user.id);
    // Fabrikam: a team whose role grants MCP use; the same team is linked to Northwind, which the user
    // reaches only through that link (no membership, no team of Northwind).
    const fabrikamTeam = await teamWithRole(fabrikam.id, 'a2-fabrikam', ['mcp.use', 'reports.view'], user.id);
    await h.seed.teamOrgLinks.link(fabrikamTeam, northwind.id, user.id);
    const trail: string[] = [];
    const login = await h.login('contoso-consent-a2', PASSWORD);
    const switched = await h.switchOrg(login.session, contoso.id);
    trail.push(`login=${login.status} switch=${switched.status}`);
    expect(switched.status, trail.join(' ')).toBe(302); // positive control: acting in Contoso

    const req = await authorizeRequest();
    const page = await h.app.inject({ method: 'GET', url: req.url, cookies: { session: switched.session.cookie } });
    trail.push(`authorize=${page.statusCode}`);
    expect(page.statusCode, trail.join(' ')).toBe(200);
    expect(page.body, trail.join(' ')).toContain('MCP access required'); // positive control: no MCP use in Contoso
    expect(page.body, trail.join(' ')).toContain('<strong>Contoso Consent A2</strong>');
    expect(page.body, trail.join(' ')).toContain('Switch to Fabrikam Consent A2 and retry');
    expect(page.body, trail.join(' ')).not.toContain('Northwind Consent A2');
    expect(page.body, trail.join(' ')).not.toContain(northwind.id);
    // The offer matches the switch route: Northwind is refused there.
    const toNorthwind = await h.postForm(switched.session, '/session/switch-org', { orgId: northwind.id, returnTo: req.url });
    trail.push(`switch-northwind=${toNorthwind.status}`);
    expect(toNorthwind.status, trail.join(' ')).toBe(403);
  }, 60_000);

  it('HARD-21 consent requires a dashboard user account', async () => {
    const key = generateApiKey();
    storeApiKey(h.seed.getRawDatabase(), key, 'consent-a3', 'admin');
    const trail: string[] = [];
    const loginPage = await h.app.inject({ method: 'GET', url: '/login' });
    const anonymous = loginPage.cookies.find((c) => c.name === 'session')?.value ?? '';
    const pageCsrf = /name="csrf-token" content="([^"]+)"/.exec(loginPage.body)?.[1] ?? '';
    const login = await h.app.inject({
      method: 'POST', url: '/login', cookies: { session: anonymous }, headers: { 'x-csrf-token': pageCsrf }, payload: { apiKey: key },
    });
    trail.push(`login=${login.statusCode}`);
    expect(login.statusCode, trail.join(' ')).toBe(302); // positive control: the key session exists
    const cookie = login.cookies.find((c) => c.name === 'session')?.value ?? '';
    const account = await h.app.inject({ method: 'GET', url: '/account', cookies: { session: cookie } });
    const sessionCookie = account.cookies.find((c) => c.name === 'session')?.value ?? cookie;
    const csrf = /name="csrf-token" content="([^"]+)"/.exec(account.body)?.[1] ?? '';
    trail.push(`account=${account.statusCode} csrf=${csrf.length > 0}`);
    expect(account.statusCode, trail.join(' ')).toBe(200);

    const req = await authorizeRequest();
    const page = await h.app.inject({ method: 'GET', url: req.url, cookies: { session: sessionCookie } });
    trail.push(`authorize=${page.statusCode} ${page.body.slice(0, 120)}`);
    expect(page.statusCode, trail.join(' ')).toBe(403);
    expect(page.json(), trail.join(' ')).toEqual({ error: 'access_denied', error_description: 'dashboard_user_required' });

    const consent = await h.app.inject({
      method: 'POST', url: '/oauth/authorize/consent', cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf, client_id: req.clientId, redirect_uri: REDIRECT_URI, scope: 'read', resource: req.resource,
        state: 'consent', code_challenge: req.challenge, code_challenge_method: 'S256', approved: 'true',
      }).toString(),
    });
    trail.push(`consent=${consent.statusCode} ${consent.body.slice(0, 120)}`);
    expect(consent.statusCode, trail.join(' ')).toBe(403);
    expect(consent.json(), trail.join(' ')).toEqual({ error: 'access_denied', error_description: 'dashboard_user_required' });
    expect(rowCount('SELECT COUNT(*) AS n FROM oauth_user_consents WHERE user_id = ?', 'api-key'), trail.join(' ')).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS n FROM oauth_authorization_codes WHERE user_id = ?', 'api-key'), trail.join(' ')).toBe(0);
    expect(rowCount('SELECT COUNT(*) AS n FROM oauth_clients_v2 WHERE registered_by_user_id = ?', 'api-key'), trail.join(' ')).toBe(0);
  }, 60_000);

  it('HARD-21 consent acts in no organization for a user outside every organization', async () => {
    await h.seed.users.createUser('fabrikam-consent-a4', PASSWORD, 'user');
    const trail: string[] = [];
    const login = await h.login('fabrikam-consent-a4', PASSWORD);
    trail.push(`login=${login.status}`);
    const minted = await h.mintToken(login.session, ['read']);
    for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
    expect(minted.token, trail.join(' ')).toBeDefined();
    expect(claimsOf(minted.token!)['orgId'], trail.join(' ')).toBe('system');
    const listed = await h.listTools(minted.token!);
    trail.push(`list=${listed.status}`);
    expect(listed.status, trail.join(' ')).toBe(200);
  }, 60_000);
});

describe('HARD-21 a consent approval is checked against the organization its page named', () => {
  it('HARD-21 consent refuses an approval after the organization changed in another tab', async () => {
    const u = await seedTwoOrgViewer('cb1');
    const clientId = await h.newClient('cb1');
    const req = await authorizeRequest(clientId);
    const trail: string[] = [];
    const login = await h.login(u.username, PASSWORD);
    const inFabrikam = await h.switchOrg(login.session, u.fabrikam);
    trail.push(`login=${login.status} switch=${inFabrikam.status}`);
    expect(inFabrikam.status, trail.join(' ')).toBe(302); // positive control: acting in Fabrikam

    const page = await openPage(inFabrikam.session, req);
    trail.push(`page=${page.status} binding=${page.binding !== undefined}`);
    expect(page.status, trail.join(' ')).toBe(200);
    expect(page.body, trail.join(' ')).toMatch(/Active org<\/dt>\s*<dd>Fabrikam RV cb1<\/dd>/);
    expect(page.binding, trail.join(' ')).toBeDefined();

    // Another tab of the same session switches the organization.
    const inNorthwind = await h.switchOrg(page.session, u.northwind);
    trail.push(`switch-northwind=${inNorthwind.status}`);
    expect(inNorthwind.status, trail.join(' ')).toBe(302);

    const answer = await postAllow(inNorthwind.session, req, page);
    trail.push(`allow=${answer.status} ${answer.body.slice(0, 120)}`);
    expect(answer.status, trail.join(' ')).toBe(400);
    expect(JSON.parse(answer.body), trail.join(' ')).toEqual({ error: 'invalid_request', error_description: 'organization_changed' });
    expect(answer.location, trail.join(' ')).toBeUndefined();
    expect(writes(u.userId, clientId), trail.join(' ')).toEqual({ codes: 0, consents: 0, registeredBy: null });
  }, 60_000);

  it('HARD-21 a consent page issues its code for the organization it named', async () => {
    const u = await seedTwoOrgViewer('cb2');
    const clientId = await h.newClient('cb2');
    const trail: string[] = [];
    const login = await h.login(u.username, PASSWORD);
    const inNorthwind = await h.switchOrg(login.session, u.northwind);
    trail.push(`login=${login.status} switch=${inNorthwind.status}`);
    expect(inNorthwind.status, trail.join(' ')).toBe(302); // positive control: acting in Northwind

    const req = await authorizeRequest(clientId);
    const page = await openPage(inNorthwind.session, req);
    trail.push(`page=${page.status}`);
    expect(page.body, trail.join(' ')).toMatch(/Active org<\/dt>\s*<dd>Northwind RV cb2<\/dd>/);

    const minted = await h.mintToken(inNorthwind.session, ['read'], { clientId });
    for (const step of minted.steps) trail.push(`${step.step}=${step.status}`);
    expect(minted.token, trail.join(' ')).toBeDefined();
    expect(claimsOf(minted.token!)['orgId'], trail.join(' ')).toBe(u.northwind);
  }, 60_000);

  it('HARD-21 consent refuses an approval whose organization binding was altered', async () => {
    const u = await seedTwoOrgViewer('cb3');
    const clientId = await h.newClient('cb3');
    const req = await authorizeRequest(clientId);
    const trail: string[] = [];
    const login = await h.login(u.username, PASSWORD);
    const inFabrikam = await h.switchOrg(login.session, u.fabrikam);
    trail.push(`login=${login.status} switch=${inFabrikam.status}`);
    const page = await openPage(inFabrikam.session, req);
    trail.push(`page=${page.status}`);
    expect(page.status, trail.join(' ')).toBe(200);
    expect(page.binding, trail.join(' ')).toBeDefined();
    const original = page.binding!;
    const last = original.slice(-1);
    const altered = `${original.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(altered, trail.join(' ')).not.toBe(original);

    for (const [label, binding] of [['one character changed', altered], ['removed', undefined], ['empty', '']] as const) {
      const answer = await postAllow(inFabrikam.session, req, page, { consent_binding: binding });
      trail.push(`${label}=${answer.status}`);
      expect(answer.status, trail.join(' ')).toBe(400);
      expect(JSON.parse(answer.body), trail.join(' ')).toEqual({ error: 'invalid_request', error_description: 'organization_changed' });
      expect(writes(u.userId, clientId), trail.join(' ')).toEqual({ codes: 0, consents: 0, registeredBy: null });
    }

    // Control: the page's own binding is accepted, so the refusals above came from the binding alone.
    const accepted = await postAllow(inFabrikam.session, req, page);
    trail.push(`own-binding=${accepted.status}`);
    expect(accepted.status, trail.join(' ')).toBe(302);
    expect(writes(u.userId, clientId).codes, trail.join(' ')).toBe(1);
  }, 60_000);
});
