/**
 * HARD-19 / HARD-13 / HARD-17: the dashboard assistant runs a tool only when its stored user may use
 * it in the conversation's organization, and the tool runs with that user's permissions.
 *
 * Every test drives the real in-process chain (tests/helpers/agent-chain.ts): the dashboard McpServer,
 * the agent bridge, the ToolDispatcher and AgentService, both resolving the stored caller through
 * storedPermissionsOrNone. Only the model is scripted, and it names tools freely - including tools it
 * was not offered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';
import { storedPermissionsOrNone } from '../../src/auth/stored-caller.js';

const DENIED = 'denied';

function resultError(result: string | null): unknown {
  if (result === null) return undefined;
  return (JSON.parse(result) as Record<string, unknown>)['error'];
}

function lastFrameType(frames: readonly { type: string }[]): string | undefined {
  return frames[frames.length - 1]?.type;
}

const USER_TOOLS = ['dashboard_list_users', 'dashboard_get_user', 'dashboard_create_user', 'dashboard_update_user'];
const SYSTEM_TOOLS = [
  'dashboard_create_org',
  'dashboard_list_service_connections',
  'dashboard_get_service_connection',
  'dashboard_create_service_connection',
  'dashboard_update_service_connection',
  'dashboard_test_service_connection',
];

describe('HARD-19 the assistant acts with the permissions of its stored user', () => {
  let chain: AgentChain;
  let orgId: string;

  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Assistant');
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-19 the assistant runs only the tools offered to the stored user', async () => {
    const viewer = await chain.addOrgUser(orgId, 'fabrikam-viewer', 'viewer', 'Viewer');
    const otherOrg = await chain.createOrg('Northwind Assistant');
    await chain.addOrgUser(otherOrg, 'northwind-analyst', 'viewer', 'Viewer');
    chain.script([
      {
        text: 'Checking.',
        toolCalls: [
          { id: 't1', name: 'dashboard_list_users', args: { orgScope: 'all' } },
          { id: 't2', name: 'dashboard_update_service_connection', args: { serviceId: 'llm', url: 'https://elsewhere.example/' } },
        ],
      },
      { text: 'I cannot do that.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(viewer.userId, orgId, 'list every user and repoint the llm service');

    const rows = chain.toolRows(turn.conversationId);
    expect(rows.map((r) => r.name)).toEqual(['dashboard_list_users', 'dashboard_update_service_connection']);
    expect(rows.map((r) => resultError(r.result))).toEqual([DENIED, DENIED]);
    for (const r of rows) expect(r.result ?? '').not.toContain('northwind-analyst');
    const audit = chain.auditRows(turn.conversationId);
    expect(audit.map((a) => [a.toolName, a.outcome])).toEqual([
      ['dashboard_list_users', 'denied'],
      ['dashboard_update_service_connection', 'denied'],
    ]);
    expect(chain.serviceConnections.upsert).not.toHaveBeenCalled();
    expect(lastFrameType(turn.frames)).toBe('done');
  });

  it('HARD-19 the assistant runs no tool for a deactivated user', async () => {
    const member = await chain.addOrgUser(orgId, 'fabrikam-former', 'viewer', 'Viewer');
    await chain.storage.users.deactivateUser(member.userId);
    const listScans = vi.spyOn(chain.storage.scans, 'listScans');
    chain.script([
      { text: 'Listing.', toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }] },
      { text: 'No access.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(member.userId, orgId, 'list reports');

    const rows = chain.toolRows(turn.conversationId);
    expect(rows.map((r) => [r.name, resultError(r.result)])).toEqual([['dashboard_list_reports', DENIED]]);
    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['denied']);
    // The tool's listing always passes an offset; the turn's context-hint read (recent scans of the
    // conversation's org, limit 5) passes none and is not a tool run.
    expect(listScans.mock.calls.filter(([filters]) => filters !== undefined && 'offset' in filters)).toEqual([]);
  });

  it('HARD-19 the assistant runs an offered tool for the stored user', async () => {
    const viewer = await chain.addOrgUser(orgId, 'fabrikam-reader', 'viewer', 'Viewer');
    chain.script([
      { text: 'Listing.', toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }] },
      { text: 'Here they are.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(viewer.userId, orgId, 'list reports');

    expect(chain.offered[0]).toContain('dashboard_list_reports');
    const rows = chain.toolRows(turn.conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sent');
    expect(resultError(rows[0]?.result ?? null)).toBeUndefined();
    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['success']);
  });

  it('HARD-19 assistant tools run with the permissions of the stored user', async () => {
    const secondOrg = await chain.createOrg('Northwind Second');
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    chain.script([
      { text: 'Listing organizations.', toolCalls: [{ id: 't1', name: 'dashboard_list_orgs', args: {} }] },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(adminId, orgId, 'list organizations');

    const rows = chain.toolRows(turn.conversationId);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.result ?? '{}') as { content?: Array<{ text?: string }> };
    const listed = JSON.parse(payload.content?.[0]?.text ?? '{}') as { data?: Array<{ id: string }> };
    expect((listed.data ?? []).map((o) => o.id).sort()).toEqual([orgId, secondOrg].sort());
  });

  it('HARD-19 the assistant offers and runs no tool in an organization the user left', async () => {
    const member = await chain.addOrgUser(orgId, 'fabrikam-leaver', 'user', 'Viewer');
    chain.script([{ text: 'Hello.', toolCalls: [] }]);
    await chain.runTurn(member.userId, orgId, 'hello');
    expect(chain.offered[0]).toContain('dashboard_list_reports'); // positive control: offered while a member

    await chain.storage.teams.removeTeamMember(member.teamId, member.userId);
    await chain.storage.organizations.removeMember(orgId, member.userId);
    chain.script([
      { text: 'Listing.', toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }] },
      { text: 'No access.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(member.userId, orgId, 'list reports');

    expect(chain.offered[1]).toEqual([]);
    const rows = chain.toolRows(turn.conversationId);
    expect(rows.map((r) => [r.name, resultError(r.result)])).toEqual([['dashboard_list_reports', DENIED]]);
    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['denied']);
  });
});

describe('HARD-13 the assistant follows the role authority rules of its stored user', () => {
  let chain: AgentChain;
  let orgId: string;

  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Owners');
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-13 an organization owner cannot assign the admin role through the assistant', async () => {
    const owner = await chain.addOrgUser(orgId, 'fabrikam-owner', 'user', 'Owner');
    chain.script([
      { text: 'Updating.', toolCalls: [{ id: 't1', name: 'dashboard_update_user', args: { userId: owner.userId, role: 'admin' } }] },
      { text: 'Not allowed.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(owner.userId, orgId, 'make me an admin');

    expect(chain.toolRows(turn.conversationId).map((r) => resultError(r.result))).toEqual([DENIED]);
    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['denied']);
    expect((await chain.storage.users.getUserById(owner.userId))?.role).toBe('user');
  });

  it('HARD-13 an organization owner creates no user through the assistant', async () => {
    const owner = await chain.addOrgUser(orgId, 'fabrikam-owner', 'user', 'Owner');
    const before = await chain.storage.users.countUsers();
    chain.script([
      {
        text: 'Creating.',
        toolCalls: [{ id: 't1', name: 'dashboard_create_user', args: { username: 'fabrikam-ops-lead', password: 'Str0ng-Pass-word-1!', role: 'admin' } }],
      },
      { text: 'Not allowed.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(owner.userId, orgId, 'create an admin');

    expect(chain.toolRows(turn.conversationId).map((r) => resultError(r.result))).toEqual([DENIED]);
    expect(await chain.storage.users.countUsers()).toBe(before);
  });

  it('HARD-13 an organization owner changes no user through the assistant', async () => {
    const owner = await chain.addOrgUser(orgId, 'fabrikam-owner', 'user', 'Owner');
    const member = await chain.addOrgUser(orgId, 'fabrikam-analyst', 'viewer', 'Viewer');
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    await chain.storage.organizations.addMember(orgId, adminId, 'member');
    chain.script([
      {
        text: 'Updating.',
        toolCalls: [
          { id: 't1', name: 'dashboard_update_user', args: { userId: member.userId, role: 'developer', active: false } },
          { id: 't2', name: 'dashboard_update_user', args: { userId: adminId, role: 'viewer', active: false } },
        ],
      },
      { text: 'Not allowed.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(owner.userId, orgId, 'change two users');

    expect(chain.toolRows(turn.conversationId).map((r) => resultError(r.result))).toEqual([DENIED, DENIED]);
    const memberAfter = await chain.storage.users.getUserById(member.userId);
    const adminAfter = await chain.storage.users.getUserById(adminId);
    expect([memberAfter?.role, memberAfter?.active]).toEqual(['viewer', true]);
    expect([adminAfter?.role, adminAfter?.active]).toEqual(['admin', true]);
  });

  it('HARD-13 a global admin changes a user role through the assistant', async () => {
    const member = await chain.addOrgUser(orgId, 'fabrikam-analyst', 'viewer', 'Viewer');
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    chain.script([
      { text: 'Updating.', toolCalls: [{ id: 't1', name: 'dashboard_update_user', args: { userId: member.userId, role: 'developer' } }] },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(adminId, orgId, 'make the analyst a developer');

    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['success']);
    expect((await chain.storage.users.getUserById(member.userId))?.role).toBe('developer');
  });
});

describe('HARD-19 the agent audit stores no secret argument', () => {
  let chain: AgentChain;
  let orgId: string;
  const password = 'Placeholder-Pass-word-17!';

  /** The stored args_json of every agent audit row of a conversation, oldest first. */
  const auditArgs = (conversationId: string): string[] =>
    (chain.storage.getRawDatabase()
      .prepare('SELECT args_json FROM agent_audit_log WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as Array<{ args_json: string }>).map((r) => r.args_json);

  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Audit');
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-19 the agent audit stores no secret argument of a tool the assistant runs', async () => {
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    chain.script([
      { text: 'Creating.', toolCalls: [{ id: 't1', name: 'dashboard_create_user', args: { username: 'fabrikam-ops-lead', password, role: 'viewer' } }] },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(adminId, orgId, 'create a user');

    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['success']);
    const stored = auditArgs(turn.conversationId);
    expect(stored.join('\n')).not.toContain(password);
    expect(JSON.parse(stored[0]!)).toEqual({ username: 'fabrikam-ops-lead', password: '[redacted]', role: 'viewer' });
    // The tool itself received the password as given.
    expect(await chain.storage.users.verifyPassword('fabrikam-ops-lead', password)).toBe(true);
  });

  it('HARD-19 the agent audit stores no secret argument of a refused tool call', async () => {
    const viewer = await chain.addOrgUser(orgId, 'fabrikam-viewer', 'viewer', 'Viewer');
    chain.script([
      {
        text: 'Creating.',
        toolCalls: [
          { id: 't1', name: 'dashboard_create_user', args: { username: 'fabrikam-ops-lead', password, role: 'admin' } },
          { id: 't2', name: 'dashboard_update_service_connection', args: { serviceId: 'llm', clientSecret: password } },
        ],
      },
      { text: 'Not allowed.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(viewer.userId, orgId, 'create an admin');

    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['denied', 'denied']);
    const stored = auditArgs(turn.conversationId);
    expect(stored.join('\n')).not.toContain(password);
    expect(stored.map((s) => JSON.parse(s) as unknown)).toEqual([
      { username: 'fabrikam-ops-lead', password: '[redacted]', role: 'admin' },
      { serviceId: 'llm', clientSecret: '[redacted]' },
    ]);
  });
});

describe('HARD-17 the assistant offers the user and system tools to a global admin only', () => {
  let chain: AgentChain;

  beforeEach(async () => {
    chain = await buildAgentChain();
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-17 the assistant offers the user and system tools to a global admin only', async () => {
    const orgId = await chain.createOrg('Fabrikam Offer');
    const owner = await chain.addOrgUser(orgId, 'fabrikam-owner', 'user', 'Owner');
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    chain.script([{ text: 'Hello.', toolCalls: [] }, { text: 'Hello.', toolCalls: [] }]);

    await chain.runTurn(owner.userId, orgId, 'hello');
    await chain.runTurn(adminId, orgId, 'hello');

    const [ownerOffer, adminOffer] = chain.offered;
    for (const name of [...USER_TOOLS, ...SYSTEM_TOOLS]) {
      expect(ownerOffer, name).not.toContain(name);
      expect(adminOffer, name).toContain(name);
    }
  });
});

describe('HARD-21 the assistant follows the stored user without the MCP use permission', () => {
  let chain: AgentChain;

  beforeEach(async () => {
    chain = await buildAgentChain();
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-21 the assistant does not require the MCP use permission', async () => {
    const orgId = await chain.createOrg('Fabrikam Assistant Reader');
    const viewer = await chain.addOrgUser(orgId, 'fabrikam-assistant-reader', 'viewer', 'Viewer');
    // Premise: the user holds no MCP use permission, neither in the organization nor globally.
    const inOrg = await storedPermissionsOrNone(chain.storage, viewer.userId, orgId);
    expect(inOrg.size).toBeGreaterThan(0);
    expect(inOrg.has('mcp.use')).toBe(false);
    expect((await storedPermissionsOrNone(chain.storage, viewer.userId)).has('mcp.use')).toBe(false);
    chain.script([
      { text: 'Listing.', toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }] },
      { text: 'Here they are.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(viewer.userId, orgId, 'list reports');

    expect(chain.offered[0]?.length ?? 0).toBeGreaterThan(0);
    expect(chain.offered[0]).toContain('dashboard_list_reports');
    const rows = chain.toolRows(turn.conversationId);
    expect(rows.map((r) => [r.name, r.status])).toEqual([['dashboard_list_reports', 'sent']]);
    expect(resultError(rows[0]?.result ?? null)).toBeUndefined();
    expect(chain.auditRows(turn.conversationId).map((a) => a.outcome)).toEqual(['success']);
  });
});
