/**
 * HARD-13 end to end: who may assign the admin role through the MCP user tools.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and drives only real routes: an
 * org Owner logs in, switches to their org, builds an org role or a team through the admin pages,
 * mints a real OAuth MCP token, and calls the MCP user tools over /api/v1/mcp. The admin role is
 * given only at a global administrator's request, so whatever those steps return, the Owner's
 * STORED role afterwards is 'user' and no user the Owner created holds 'admin'.
 *
 * Every step's status is recorded in the assertion message, so a chain that stopped early says where.
 * Two controls prove the harness reaches the tools: a global admin's assignment lands, and an org
 * Owner's token runs an ordinary tool.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const USER_TOOLS = ['dashboard_list_users', 'dashboard_get_user', 'dashboard_create_user', 'dashboard_update_user'];

const PASSWORD = 'Fabrikam-Owner-42!';

let h: McpOauthHarness;
let northwindOrgId: string;

interface SeededOwner {
  readonly orgId: string;
  readonly ownerId: string;
  readonly username: string;
}

/** A fresh org with an Owner whose global role is 'user' (Owners team + org membership 'owner'). */
async function seedOrgOwner(tag: string): Promise<SeededOwner> {
  const org = await h.seed.organizations.createOrg({ name: `Fabrikam ${tag}`, slug: `fabrikam-${tag}` });
  const username = `fabrikam-owner-${tag}`;
  const owner = await h.seed.users.createUser(username, PASSWORD, 'user');
  const ownerRole = await h.seed.roles.getRoleByNameAndOrg('Owner', org.id);
  const team = await h.seed.teams.createTeam({ name: `owners-${tag}`, description: '', orgId: org.id, roleId: ownerRole!.id });
  await h.seed.teams.addTeamMember(team.id, owner.id);
  await h.seed.organizations.addMember(org.id, owner.id, 'owner');
  return { orgId: org.id, ownerId: owner.id, username };
}

/** Login, switch to the org, then bind a new team to `roleId` and join it — each step recorded. */
async function ownerJoinsTeamWithRole(
  owner: SeededOwner, trail: string[], teamName: string, roleFor: (session: HarnessSession) => Promise<string | null>,
): Promise<HarnessSession> {
  const login = await h.login(owner.username, PASSWORD);
  trail.push(`login=${login.status}`);
  const switched = await h.switchOrg(login.session, owner.orgId);
  trail.push(`switch=${switched.status}`);
  let session = switched.session;
  const roleId = await roleFor(session);
  trail.push(`role=${roleId === null ? 'none' : 'found'}`);
  if (roleId === null) return session;
  const team = await h.postForm(session, '/admin/teams', { name: teamName, roleId });
  trail.push(`team=${team.status}`);
  session = team.session;
  const created = await h.seed.teams.getTeamByName(teamName, owner.orgId);
  if (created === null) return session;
  const member = await h.postForm(session, `/admin/teams/${created.id}/members`, { userId: owner.ownerId });
  trail.push(`member=${member.status}`);
  return member.session;
}

/** The Owner creates an org role with these permissions through POST /admin/roles. */
function orgRole(owner: SeededOwner, trail: string[], name: string, permissions: readonly string[]) {
  return async (session: HarnessSession): Promise<string | null> => {
    const res = await h.postForm(session, '/admin/roles', { name, scope: 'org', permissions });
    trail.push(`createRole=${res.status}`);
    return (await h.seed.roles.getRoleByNameAndOrg(name, owner.orgId))?.id ?? null;
  };
}

async function mint(session: HarnessSession, trail: string[]): Promise<string | undefined> {
  const minted = await h.mintToken(session, ['read', 'write']);
  for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
  return minted.token;
}

async function call(token: string | undefined, trail: string[], name: string, args: Record<string, unknown>): Promise<void> {
  if (token === undefined) return;
  const res = await h.callTool(token, name, args);
  trail.push(`${name}=${res.status}/${res.isError ? 'error' : 'ok'}`);
}

beforeAll(async () => {
  h = await startMcpOauthHarness('user-tools');
  northwindOrgId = (await h.seed.organizations.createOrg({ name: 'Northwind', slug: 'northwind-user-tools' })).id;
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-13 the MCP user tools give the admin role only at a global administrator request', () => {
  it('HARD-13 an org owner stays a user through an org role with admin users and the mcp user tools', async () => {
    const owner = await seedOrgOwner('a1');
    const trail: string[] = [];
    const session = await ownerJoinsTeamWithRole(owner, trail, 'fabrikam-a1-ops-team',
      orgRole(owner, trail, 'fabrikam-a1-ops', ['admin.users', 'mcp.use', 'reports.view']));
    const token = await mint(session, trail);
    await call(token, trail, 'dashboard_update_user', { userId: owner.ownerId, role: 'admin' });
    await call(token, trail, 'dashboard_create_user', { username: 'fabrikam-ops-lead', password: PASSWORD, role: 'admin' });

    expect((await h.seed.users.getUserById(owner.ownerId))?.role, trail.join(' ')).toBe('user');
    expect((await h.seed.users.getUserByUsername('fabrikam-ops-lead'))?.role, trail.join(' ')).not.toBe('admin');
  }, 60_000);

  it('HARD-13 an org owner stays a user through a team bound to the built in admin role and the mcp user tools', async () => {
    const owner = await seedOrgOwner('a2');
    const trail: string[] = [];
    const session = await ownerJoinsTeamWithRole(owner, trail, 'fabrikam-a2-ops-team', async () => 'admin');
    const token = await mint(session, trail);
    await call(token, trail, 'dashboard_update_user', { userId: owner.ownerId, role: 'admin' });

    expect((await h.seed.users.getUserById(owner.ownerId))?.role, trail.join(' ')).toBe('user');
  }, 60_000);

  it('HARD-13 a global admin assigns the admin role through the mcp user tools', async () => {
    await h.seed.users.createUser('northwind-admin', PASSWORD, 'admin');
    const analyst = await h.seed.users.createUser('northwind-analyst', PASSWORD, 'user');
    const team = await h.seed.teams.createTeam({ name: 'northwind-analysts', description: '', orgId: northwindOrgId });
    await h.seed.teams.addTeamMember(team.id, analyst.id);
    const trail: string[] = [];
    const login = await h.login('northwind-admin', PASSWORD);
    trail.push(`login=${login.status}`);
    const token = await mint(login.session, trail);
    expect(token, trail.join(' ')).toBeDefined();
    const res = await h.callTool(token!, 'dashboard_update_user', { userId: analyst.id, role: 'admin' });
    trail.push(`update=${res.status}/${res.isError ? 'error' : 'ok'} ${res.text.slice(0, 120)}`);

    expect(res.isError, trail.join(' ')).toBe(false);
    expect((await h.seed.users.getUserById(analyst.id))?.role, trail.join(' ')).toBe('admin');
  }, 60_000);

  it('HARD-13 an org owner with mcp use lists reports through the mcp tools', async () => {
    const owner = await seedOrgOwner('a4');
    const trail: string[] = [];
    const session = await ownerJoinsTeamWithRole(owner, trail, 'fabrikam-a4-readers-team',
      orgRole(owner, trail, 'fabrikam-a4-readers', ['mcp.use', 'reports.view']));
    const token = await mint(session, trail);
    expect(token, trail.join(' ')).toBeDefined();
    const res = await h.callTool(token!, 'dashboard_list_reports', {});
    trail.push(`list=${res.status}/${res.isError ? 'error' : 'ok'} ${res.text.slice(0, 120)}`);

    expect(res.isError, trail.join(' ')).toBe(false);
  }, 60_000);
});

/** tools/list over /api/v1/mcp with the token: the names the caller is shown, or the reason none were read. */
async function listToolNames(token: string): Promise<{ readonly status: number; readonly names: readonly string[] }> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  });
  const text = res.body.trim();
  const json = text.startsWith('{')
    ? text
    : (text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:')) ?? 'data:{}').slice('data:'.length);
  const tools = (JSON.parse(json) as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? [];
  return { status: res.statusCode, names: tools.map((t) => t.name) };
}

/**
 * Rows written before the global-only rule (seeded through the repository or SQL, not the routes)
 * give the Owner neither admin.users nor admin.system: the token lists no user tool and a direct
 * call is refused, while an ordinary tool stays listed.
 */
async function expectNoUserTools(owner: SeededOwner, trail: string[]): Promise<void> {
  const login = await h.login(owner.username, PASSWORD);
  trail.push(`login=${login.status}`);
  const switched = await h.switchOrg(login.session, owner.orgId);
  trail.push(`switch=${switched.status}`);
  const token = await mint(switched.session, trail);
  expect(token, trail.join(' ')).toBeDefined();
  const listed = await listToolNames(token!);
  const userTools = listed.names.filter((n) => USER_TOOLS.includes(n));
  trail.push(`tools/list=${listed.status}/${listed.names.length} userTools=${userTools.length}`);
  const res = await h.callTool(token!, 'dashboard_list_users', { orgScope: 'all' });
  trail.push(`dashboard_list_users=${res.status}/${res.isError ? 'error' : 'ok'}`);
  expect(listed.names, trail.join(' ')).toContain('dashboard_list_reports'); // positive control
  expect(userTools, trail.join(' ')).toEqual([]);
  expect(res.isError, trail.join(' ')).toBe(true);
  expect(res.text, trail.join(' ')).toContain('Forbidden');
  expect((await h.seed.users.getUserById(owner.ownerId))?.role, trail.join(' ')).toBe('user');
}

describe('global only permissions: existing organization grants on the real server', () => {
  it('global only permissions: a token through an existing org role carrying admin users lists no user tool', async () => {
    const owner = await seedOrgOwner('e1');
    const roleId = `fabrikam-e1-legacy-${owner.orgId}`;
    const raw = h.seed.getRawDatabase();
    raw.prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(roleId, 'fabrikam-e1-legacy', '', owner.orgId, new Date().toISOString());
    for (const p of ['admin.users', 'mcp.use', 'reports.view']) {
      raw.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(roleId, p);
    }
    const team = await h.seed.teams.createTeam({ name: 'fabrikam-e1-legacy-team', description: '', orgId: owner.orgId, roleId });
    await h.seed.teams.addTeamMember(team.id, owner.ownerId);
    await expectNoUserTools(owner, []);
  }, 60_000);

  it('global only permissions: a token through an existing built in admin role binding lists no user tool', async () => {
    const owner = await seedOrgOwner('e2');
    // The built-in admin row carries mcp.use on a fresh database (migration back-fill), so this one
    // binding is enough for the Owner to authorize an MCP client in the org.
    const adminRow = await h.seed.roles.getRole('admin');
    expect(adminRow?.permissions).toContain('mcp.use');
    const team = await h.seed.teams.createTeam({ name: 'fabrikam-e2-ops-team', description: '', orgId: owner.orgId, roleId: 'admin' });
    await h.seed.teams.addTeamMember(team.id, owner.ownerId);
    await expectNoUserTools(owner, []);
  }, 60_000);
});
