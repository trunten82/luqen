/**
 * The OAuth token scope binds the MCP tools end to end.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). A global administrator, whose
 * permissions cover every tool, consents to a client with the 'read' scope only. That token lists no
 * write tool, runs read tools, and every write tool it names in tools/call is refused before the tool
 * runs: the scope the user consented to is what the client may do, whatever else the user may do.
 * Because the caller is a global administrator, only the scope can stop the write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Admin-42!';

let h: McpOauthHarness;

async function listToolNames(token: string): Promise<{ status: number; names: string[] }> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  const body = res.body.trim();
  const json = body.startsWith('{')
    ? body
    : (body.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:')) ?? 'data:{}').slice('data:'.length);
  const tools = ((JSON.parse(json) as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? []);
  return { status: res.statusCode, names: tools.map((t) => t.name) };
}

beforeAll(async () => {
  h = await startMcpOauthHarness('token-scope');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('mcp scope: the consented token scope binds the mcp tools', () => {
  it('mcp scope: a read scope token reads but does not write through the mcp tools', async () => {
    await h.seed.users.createUser('fabrikam-scope-admin', PASSWORD, 'admin');
    const analyst = await h.seed.users.createUser('fabrikam-scope-analyst', PASSWORD, 'user');
    const trail: string[] = [];
    const login = await h.login('fabrikam-scope-admin', PASSWORD);
    trail.push(`login=${login.status}`);
    const minted = await h.mintToken(login.session, ['read']);
    for (const s of minted.steps) trail.push(`${s.step}=${s.status}`);
    expect(minted.token, trail.join(' ')).toBeDefined();
    const token = minted.token!;

    const listed = await listToolNames(token);
    trail.push(`tools/list=${listed.status}/${listed.names.length}`);
    const read = await h.callTool(token, 'dashboard_list_reports', {});
    trail.push(`dashboard_list_reports=${read.status}/${read.isError ? 'error' : 'ok'}`);
    const write = await h.callTool(token, 'dashboard_update_user', { userId: analyst.id, role: 'developer' });
    trail.push(`dashboard_update_user=${write.status}/${write.isError ? 'error' : 'ok'} ${write.text.slice(0, 160)}`);

    expect(listed.names, trail.join(' ')).toContain('dashboard_list_reports');
    expect(listed.names, trail.join(' ')).not.toContain('dashboard_update_user');
    expect(read.isError, trail.join(' ')).toBe(false);
    expect(write.isError, trail.join(' ')).toBe(true);
    expect((await h.seed.users.getUserById(analyst.id))?.role, trail.join(' ')).toBe('user');
  }, 60_000);
});
