/**
 * HARD-21 end to end: every /api/v1/mcp request requires the MCP use permission (mcp.use) in the
 * token's organization, read from the stored user's current permissions.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and mints through the real OAuth
 * flow. The subject's global role ('viewer', no stored permission row) grants nothing, so its only
 * mcp.use comes from a custom organization role bound to its team; the test then changes that role's
 * stored permissions and reads what the endpoint answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Reader-42!';

let h: McpOauthHarness;

interface SeededReader {
  readonly orgId: string;
  readonly userId: string;
  readonly username: string;
  readonly roleId: string;
}

/** A fresh org and a member with global role 'viewer' whose org role grants mcp.use and reports.view. */
async function seedReader(tag: string): Promise<SeededReader> {
  const org = await h.seed.organizations.createOrg({ name: `Fabrikam ${tag}`, slug: `fabrikam-mu-${tag}` });
  const username = `fabrikam-reader-${tag}`;
  const user = await h.seed.users.createUser(username, PASSWORD, 'viewer');
  const role = await h.seed.roles.createRole({
    name: `fabrikam-${tag}-mcp`, description: '', permissions: ['mcp.use', 'reports.view'], orgId: org.id,
  });
  const team = await h.seed.teams.createTeam({ name: `fabrikam-${tag}-team`, description: '', orgId: org.id, roleId: role.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(org.id, user.id, 'member');
  return { orgId: org.id, userId: user.id, username, roleId: role.id };
}

/** Sign in, switch to the reader's org and mint a read token through the real OAuth flow. */
async function mintFor(reader: SeededReader, trail: string[]): Promise<string | undefined> {
  const login = await h.login(reader.username, PASSWORD);
  trail.push(`login=${login.status}`);
  const switched = await h.switchOrg(login.session, reader.orgId);
  trail.push(`switch=${switched.status}`);
  const minted = await h.mintToken(switched.session, ['read']);
  for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
  return minted.token;
}

function dropPermission(roleId: string, permission: string): number {
  return h.seed.getRawDatabase()
    .prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission = ?')
    .run(roleId, permission).changes;
}

beforeAll(async () => {
  h = await startMcpOauthHarness('mcp-use');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-21 every MCP request requires the MCP use permission', () => {
  it('HARD-21 an MCP token stops answering once its user loses the MCP use permission', async () => {
    const reader = await seedReader('t1');
    const trail: string[] = [];
    const token = await mintFor(reader, trail);
    expect(token, trail.join(' ')).toBeDefined();
    const before = await h.listTools(token!);
    trail.push(`before=${before.status}/${before.names.length}`);
    expect(before.status, trail.join(' ')).toBe(200); // positive control: the token answers while mcp.use is held
    expect(before.names, trail.join(' ')).toContain('dashboard_list_reports');

    expect(dropPermission(reader.roleId, 'mcp.use'), trail.join(' ')).toBe(1);
    const after = await h.listTools(token!);
    const call = await h.callTool(token!, 'dashboard_list_reports', {});
    trail.push(`after=${after.status}/${after.names.length} call=${call.status} www=${after.wwwAuthenticate}`);

    expect(after.status, trail.join(' ')).toBe(403);
    expect(after.wwwAuthenticate, trail.join(' ')).toContain('error="insufficient_scope"');
    expect(after.wwwAuthenticate, trail.join(' ')).toContain('error_description="no_mcp_use"');
    expect(after.names, trail.join(' ')).toEqual([]);
    expect(call.status, trail.join(' ')).toBe(403);
  }, 60_000);

  it('HARD-21 an MCP token answers while its user holds the MCP use permission', async () => {
    const reader = await seedReader('t1b');
    const trail: string[] = [];
    const token = await mintFor(reader, trail);
    expect(token, trail.join(' ')).toBeDefined();
    // An unrelated permission change leaves mcp.use in place.
    expect(dropPermission(reader.roleId, 'reports.view'), trail.join(' ')).toBe(1);
    const listed = await h.listTools(token!);
    trail.push(`list=${listed.status}/${listed.names.length} www=${listed.wwwAuthenticate}`);

    expect(listed.status, trail.join(' ')).toBe(200);
    expect(listed.wwwAuthenticate, trail.join(' ')).toBe('');
  }, 60_000);
});
