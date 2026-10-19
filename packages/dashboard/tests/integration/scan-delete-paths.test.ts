/**
 * HARD-18: every path that deletes a scan follows the one delete rule (src/services/scan-delete-access.ts):
 * the caller holds reports.delete or is the signed-in user who started the scan (never an API key), and the
 * scan belongs to the caller's current organization ('system' for a caller outside every organization),
 * unless the caller is a global administrator.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and drives the REST delete
 * (DELETE /api/v1/scans/:id), GraphQL deleteScan and the report page delete (DELETE /reports/:id) with
 * password sessions and API keys. Every assertion reads the stored scan back, never only the response.
 * Organization names, user names and site hosts are placeholders (Fabrikam / Northwind, *.example).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from '../../src/auth/api-key.js';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Delete-42!';
const OWNER = 'fabrikam-delete-owner';
const MEMBER = 'fabrikam-delete-member';
const SOLO = 'solo-delete-user';
const GLOBAL_ADMIN = 'delete-global-admin';
const NORTHWIND_OWNER = 'northwind-delete-owner';

let h: McpOauthHarness;
let fabrikamId: string;
let northwindId: string;
let orgAdminKey: string;
let readOnlyKey: string;
const sessions = new Map<string, HarnessSession>();

/** A caller: a password session (by user name) or an API key. */
type Credential = { readonly session: string } | { readonly key: string };

const tokenOf = (html: string): string | undefined => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];

async function addOrgUser(orgId: string, username: string, globalRole: string, orgRole: string, membership: string): Promise<void> {
  const user = await h.seed.users.createUser(username, PASSWORD, globalRole);
  const role = await h.seed.roles.getRoleByNameAndOrg(orgRole, orgId);
  const team = await h.seed.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: role!.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(orgId, user.id, membership);
}

async function seedScan(orgId: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  await h.seed.scans.createScan({
    id, siteUrl: 'https://fabrikam.example', standard: 'WCAG2AA', jurisdictions: [],
    createdBy, createdAt: new Date().toISOString(), orgId,
  });
  return id;
}

const scanExists = async (id: string): Promise<boolean> => (await h.seed.scans.getScan(id)) !== null;

/** A browser's session after sign-in: the cookie and the page token of an authenticated page. */
async function sessionOf(username: string): Promise<HarnessSession> {
  const cached = sessions.get(username);
  if (cached !== undefined) return cached;
  const login = await h.login(username, PASSWORD);
  expect(login.status, `login ${username}`).toBe(302);
  const page = await h.app.inject({ method: 'GET', url: '/reports', cookies: { session: login.session.cookie } });
  const cookie = page.cookies.find((c) => c.name === 'session')?.value ?? login.session.cookie;
  const session = { cookie, csrf: tokenOf(page.body) ?? login.session.csrf };
  sessions.set(username, session);
  return session;
}

async function headersOf(cred: Credential): Promise<{ headers: Record<string, string>; cookies: Record<string, string> }> {
  if ('key' in cred) return { headers: { 'x-api-key': cred.key }, cookies: {} };
  const s = await sessionOf(cred.session);
  return { headers: { 'x-csrf-token': s.csrf }, cookies: { session: s.cookie } };
}

/** DELETE /api/v1/scans/:id; returns the status. */
async function restDelete(cred: Credential, id: string): Promise<number> {
  const { headers, cookies } = await headersOf(cred);
  return (await h.app.inject({ method: 'DELETE', url: `/api/v1/scans/${id}`, headers, cookies })).statusCode;
}

/** GraphQL deleteScan; returns the status and the first error message (or 'deleted'). */
async function graphqlDelete(cred: Credential, id: string): Promise<string> {
  const { headers, cookies } = await headersOf(cred);
  const res = await h.app.inject({
    method: 'POST', url: '/graphql', cookies,
    headers: { ...headers, 'content-type': 'application/json' },
    payload: { query: 'mutation Del($id: ID!) { deleteScan(id: $id) }', variables: { id } },
  });
  let body: { data?: { deleteScan?: boolean } | null; errors?: Array<{ message?: string }> } = {};
  try {
    body = res.json() as typeof body;
  } catch {
    body = {};
  }
  return `${res.statusCode}:${body.data?.deleteScan === true ? 'deleted' : body.errors?.[0]?.message ?? 'no-answer'}`;
}

/** DELETE /reports/:id; returns the status. */
async function pageDelete(cred: Credential, id: string): Promise<number> {
  const { headers, cookies } = await headersOf(cred);
  return (await h.app.inject({ method: 'DELETE', url: `/reports/${id}`, headers, cookies })).statusCode;
}

beforeAll(async () => {
  h = await startMcpOauthHarness('scan-delete');
  fabrikamId = (await h.seed.organizations.createOrg({ name: 'Fabrikam Delete', slug: 'fabrikam-delete' })).id;
  northwindId = (await h.seed.organizations.createOrg({ name: 'Northwind Delete', slug: 'northwind-delete' })).id;
  await addOrgUser(fabrikamId, OWNER, 'user', 'Owner', 'owner');
  // The global role 'executive' holds no reports.delete, so this Member holds none in Fabrikam.
  await addOrgUser(fabrikamId, MEMBER, 'executive', 'Member', 'member');
  await h.seed.users.createUser(SOLO, PASSWORD, 'user');
  await h.seed.users.createUser(GLOBAL_ADMIN, PASSWORD, 'admin');
  orgAdminKey = generateApiKey();
  await h.seed.apiKeys.storeKey(orgAdminKey, 'fabrikam-delete-admin-key', fabrikamId, 'admin');
  readOnlyKey = generateApiKey();
  await h.seed.apiKeys.storeKey(readOnlyKey, 'delete-read-only-key', 'system', 'read-only');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-18 scan delete paths', () => {
  it('HARD-18 the api delete refuses a member who neither holds reports delete nor started the scan', async () => {
    const id = await seedScan(fabrikamId, OWNER);
    const status = await restDelete({ session: MEMBER }, id);
    expect(status).toBe(403);
    expect(await scanExists(id)).toBe(true);
  }, 60_000);

  it('HARD-18 the api delete lets the signed in user who started the scan delete it', async () => {
    const id = await seedScan(fabrikamId, MEMBER);
    const status = await restDelete({ session: MEMBER }, id);
    expect(status).toBe(200);
    expect(await scanExists(id)).toBe(false);
  }, 60_000);

  it('HARD-18 an organization admin api key deletes a scan of its organization through the api', async () => {
    const id = await seedScan(fabrikamId, OWNER);
    expect(await restDelete({ key: orgAdminKey }, id)).toBe(200);
    expect(await scanExists(id)).toBe(false);
    // An organization key works on the /api endpoints only: GraphQL and the report page refuse it.
    const other = await seedScan(fabrikamId, OWNER);
    const trail = [`graphql=${await graphqlDelete({ key: orgAdminKey }, other)}`, `page=${await pageDelete({ key: orgAdminKey }, other)}`];
    expect(trail).toEqual(['graphql=403:no-answer', 'page=403']);
    expect(await scanExists(other)).toBe(true);
  }, 60_000);

  it('HARD-18 a read only api key deletes no scan through any path', async () => {
    // A scan recorded as started by 'api-key', the user name every key signs in under.
    const id = await seedScan('system', 'api-key');
    const trail = [
      `rest=${await restDelete({ key: readOnlyKey }, id)}`,
      `graphql=${await graphqlDelete({ key: readOnlyKey }, id)}`,
      `page=${await pageDelete({ key: readOnlyKey }, id)}`,
    ];
    expect(await scanExists(id), trail.join(' ')).toBe(true);
    expect(trail[0]).toBe('rest=403');
    expect(trail[1]).toMatch(/^graphql=\d+:Forbidden/);
    expect(trail[2]).toBe('page=403');
  }, 60_000);
});
