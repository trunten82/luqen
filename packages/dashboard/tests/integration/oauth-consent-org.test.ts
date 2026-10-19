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
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
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

async function authorizeRequest(): Promise<AuthorizeRequest> {
  const clientId = await h.clientId();
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
    expect(rowCount('SELECT COUNT(*) AS n FROM oauth_consents WHERE user_id = ?', 'api-key'), trail.join(' ')).toBe(0);
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
