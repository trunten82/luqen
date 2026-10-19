/**
 * HARD-19 end to end: the MCP endpoint answers every request for the STORED, active user of the token.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). Tokens are either minted through
 * the real OAuth flow (register -> authorize -> consent -> token) or signed with the server's own
 * active signing key (`signToken`), so the verifier accepts them exactly as it accepts a minted one.
 * Each test then changes the stored state (role, active flag, user row, client) and reads what
 * /api/v1/mcp answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { generateApiKey } from '../../src/auth/api-key.js';

/** Tools gated by admin.users or admin.system (src/mcp/tools/admin.ts). */
const ADMIN_TOOLS = [
  'dashboard_list_users', 'dashboard_get_user', 'dashboard_create_user', 'dashboard_update_user',
  'dashboard_create_org', 'dashboard_list_service_connections', 'dashboard_get_service_connection',
  'dashboard_create_service_connection', 'dashboard_update_service_connection', 'dashboard_test_service_connection',
];

const PASSWORD = 'Fabrikam-Member-42!';

let h: McpOauthHarness;

interface SeededMember {
  readonly orgId: string;
  readonly userId: string;
  readonly username: string;
}

/** A fresh org and a member whose global role is 'user', holding mcp.use and reports.view in the org through a team. */
async function seedMember(tag: string): Promise<SeededMember> {
  const org = await h.seed.organizations.createOrg({ name: `Fabrikam ${tag}`, slug: `fabrikam-sc-${tag}` });
  const username = `fabrikam-member-${tag}`;
  const user = await h.seed.users.createUser(username, PASSWORD, 'user');
  const role = await h.seed.roles.createRole({
    name: `fabrikam-${tag}-mcp`, description: '', permissions: ['mcp.use', 'reports.view'], orgId: org.id,
  });
  const team = await h.seed.teams.createTeam({ name: `fabrikam-${tag}-team`, description: '', orgId: org.id, roleId: role.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(org.id, user.id, 'member');
  return { orgId: org.id, userId: user.id, username };
}

/** Login, switch to the member's org and mint a read/write token through the real OAuth flow. */
async function mintFor(member: SeededMember, trail: string[], clientId?: string): Promise<string | undefined> {
  const login = await h.login(member.username, PASSWORD);
  trail.push(`login=${login.status}`);
  const switched = await h.switchOrg(login.session, member.orgId);
  trail.push(`switch=${switched.status}`);
  const minted = await h.mintToken(switched.session, ['read', 'write'], clientId === undefined ? {} : { clientId });
  for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
  return minted.token;
}

beforeAll(async () => {
  h = await startMcpOauthHarness('stored-caller');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-19 the mcp endpoint answers for the stored user of the token', () => {
  it('HARD-19 a global admin demoted after the token was issued lists no admin tool', async () => {
    const admin = await h.seed.users.createUser('northwind-admin-c0', PASSWORD, 'admin');
    const trail: string[] = [];
    const login = await h.login('northwind-admin-c0', PASSWORD);
    trail.push(`login=${login.status}`);
    const minted = await h.mintToken(login.session, ['read', 'write']);
    for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
    expect(minted.token, trail.join(' ')).toBeDefined();
    const before = await h.listTools(minted.token!);
    trail.push(`before=${before.status}/${before.names.length}`);
    expect(before.names, trail.join(' ')).toContain('dashboard_list_users'); // positive control: the admin's tools are listed

    await h.seed.users.updateUserRole(admin.id, 'user');
    const after = await h.listTools(minted.token!);
    trail.push(`after=${after.status}/${after.names.length}`);

    expect(after.status, trail.join(' ')).toBe(200);
    expect(after.names.length, trail.join(' ')).toBeGreaterThan(0);
    expect(after.names.filter((n) => ADMIN_TOOLS.includes(n)), trail.join(' ')).toEqual([]);
  }, 60_000);

  it('HARD-19 a role claim in the token does not change the permissions of the caller', async () => {
    const member = await seedMember('c1');
    const token = await h.signToken({ sub: member.userId, scopes: ['read', 'write'], orgId: member.orgId, role: 'admin' });
    const listed = await h.listTools(token);
    const call = await h.callTool(token, 'dashboard_list_users', { orgScope: 'all' });
    const trail = `list=${listed.status}/${listed.names.length} call=${call.status}/${call.isError ? 'error' : 'ok'}`;

    expect(listed.status, trail).toBe(200);
    expect(listed.names, trail).toContain('dashboard_list_reports'); // positive control: the member's own tools
    expect(listed.names.filter((n) => ADMIN_TOOLS.includes(n)), trail).toEqual([]);
    expect(call.isError, trail).toBe(true);
    expect(call.text, trail).toContain('Forbidden');
  }, 60_000);

  it('HARD-19 a token of a deactivated user is refused', async () => {
    const member = await seedMember('c2');
    const trail: string[] = [];
    const token = await mintFor(member, trail);
    expect(token, trail.join(' ')).toBeDefined();
    const before = await h.listTools(token!);
    trail.push(`before=${before.status}/${before.names.length}`);
    expect(before.status, trail.join(' ')).toBe(200); // positive control: the token works while the user is active

    await h.seed.users.deactivateUser(member.userId);
    const after = await h.listTools(token!);
    const call = await h.callTool(token!, 'dashboard_list_reports', {});
    trail.push(`after=${after.status}/${after.names.length} call=${call.status}`);

    expect(after.status, trail.join(' ')).toBe(401);
    expect(after.wwwAuthenticate, trail.join(' ')).toContain('error="invalid_token"');
    expect(after.wwwAuthenticate, trail.join(' ')).toContain('error_description="inactive_user"');
    expect(after.names, trail.join(' ')).toEqual([]);
    expect(call.status, trail.join(' ')).toBe(401);
  }, 60_000);

  it('HARD-19 a token whose user no longer exists is refused', async () => {
    const gone = await h.seed.users.createUser('fabrikam-removed-c3', PASSWORD, 'user');
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam c3', slug: 'fabrikam-sc-c3' });
    const token = await h.signToken({ sub: gone.id, scopes: ['read', 'write'], orgId: org.id });
    expect(await h.seed.users.deleteUser(gone.id)).toBe(true);
    const listed = await h.listTools(token);
    const call = await h.callTool(token, 'dashboard_list_reports', {});
    const trail = `list=${listed.status}/${listed.names.length} call=${call.status}`;

    expect(listed.status, trail).toBe(401);
    expect(listed.wwwAuthenticate, trail).toContain('error="invalid_token"');
    expect(listed.wwwAuthenticate, trail).toContain('error_description="unknown_user"');
    expect(listed.names, trail).toEqual([]);
    expect(call.status, trail).toBe(401);
  }, 60_000);

  it('HARD-19 a token issued to an oauth client that was revoked is refused', async () => {
    const member = await seedMember('c4');
    const clientId = await h.newClient('c4');
    const trail: string[] = [];
    const token = await mintFor(member, trail, clientId);
    expect(token, trail.join(' ')).toBeDefined();
    const before = await h.listTools(token!);
    trail.push(`before=${before.status}/${before.names.length}`);
    expect(before.status, trail.join(' ')).toBe(200); // positive control: the token works while its client is live

    await h.seed.oauthClients.revoke(clientId);
    const after = await h.listTools(token!);
    const call = await h.callTool(token!, 'dashboard_list_reports', {});
    trail.push(`after=${after.status}/${after.names.length} call=${call.status}`);

    expect(after.status, trail.join(' ')).toBe(401);
    expect(after.wwwAuthenticate, trail.join(' ')).toContain('error_description="client_revoked"');
    expect(after.names, trail.join(' ')).toEqual([]);
    expect(call.status, trail.join(' ')).toBe(401);
  }, 60_000);

  it('HARD-19 an api key presented as a bearer token is refused on the mcp endpoint', async () => {
    const key = generateApiKey();
    await h.seed.apiKeys.storeKey(key, 'fabrikam-mcp-c5-key', 'system', 'admin');
    const listed = await h.listTools(key);
    const call = await h.callTool(key, 'dashboard_list_reports', {});
    const trail = `list=${listed.status}/${listed.names.length} call=${call.status}`;

    expect(listed.status, trail).toBe(401);
    expect(listed.names, trail).toEqual([]);
    expect(call.status, trail).toBe(401);
  }, 60_000);

  it('HARD-19 a token of a user with no permission in the token organization is refused', async () => {
    await h.seed.roles.createRole({ name: 'fabrikam-c6-none', description: '', permissions: [], orgId: 'system' });
    const user = await h.seed.users.createUser('fabrikam-member-c6', PASSWORD, 'user');
    await h.seed.users.updateUserRole(user.id, 'fabrikam-c6-none');
    const org = await h.seed.organizations.createOrg({ name: 'Fabrikam c6', slug: 'fabrikam-sc-c6' });
    const token = await h.signToken({ sub: user.id, scopes: ['read', 'write'], orgId: org.id });
    const listed = await h.listTools(token);
    const call = await h.callTool(token, 'dashboard_list_reports', {});
    const trail = `list=${listed.status}/${listed.names.length} call=${call.status}`;

    expect(listed.status, trail).toBe(403);
    expect(listed.wwwAuthenticate, trail).toContain('error="insufficient_scope"');
    expect(listed.wwwAuthenticate, trail).toContain('error_description="no_permission"');
    expect(listed.names, trail).toEqual([]);
    expect(call.status, trail).toBe(403);
  }, 60_000);
});
