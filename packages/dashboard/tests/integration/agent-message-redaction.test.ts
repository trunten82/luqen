/**
 * HARD-21: the assistant's conversation messages store tool-call arguments with secret-named values
 * redacted (src/db/agent-audit-redaction.ts, the rule the agent audit uses), through the one
 * repository write every tool-call row takes: the assistant's tool-calls row, each tool row and the
 * rows a confirmation or a decline writes.
 *
 * A paused action's row is the one exception while it awaits confirmation: it keeps its arguments as
 * given, so the confirmation runs exactly the action the user was shown. The write that moves the row
 * out of pending_confirmation (confirm, decline) stores its arguments redacted; a confirmation the
 * dispatcher refuses returns the row to pending_confirmation with its arguments as they were.
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the confirm and decline
 * routes run over the real dispatcher, as tests/integration/agent-confirm-permissions.test.ts builds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';

const PUBLIC_URL = 'https://dashboard.example.com';
const SITE = 'https://fabrikam.example/';
const BEARER = 'Bearer t';

interface StoredCallRow {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly toolCallJson: string;
}

interface Harness {
  readonly chain: AgentChain;
  readonly orgId: string;
  readonly server: FastifyInstance;
  post(path: string, userId: string): Promise<{ status: number; body: Record<string, unknown> }>;
  storedCallRows(conversationId: string): StoredCallRow[];
  row(messageId: string): StoredCallRow | undefined;
  auditArgs(conversationId: string): string[];
  /** A turn in which the model asks to scan SITE with `args`; returns the paused message. */
  pauseScan(userId: string, args: Record<string, unknown>): Promise<{ conversationId: string; messageId: string }>;
}

async function buildHarness(): Promise<Harness> {
  const chain = await buildAgentChain();
  const orgId = await chain.createOrg('Fabrikam Messages');
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.addHook('preHandler', async (request) => {
    const id = request.headers['x-test-user'];
    if (typeof id === 'string' && id.length > 0) {
      request.user = { id, username: 'tester', role: 'viewer', currentOrgId: orgId };
    }
  });
  await registerAgentRoutes(server, {
    agentService: chain.service,
    dispatcher: chain.dispatcher,
    storage: chain.storage,
    publicUrl: PUBLIC_URL,
    turnRegistry: new ActiveTurnRegistry(),
  });
  await server.ready();
  const raw = chain.storage.getRawDatabase();
  const toRow = (r: { id: string; role: string; status: string; tool_call_json: string }): StoredCallRow =>
    ({ id: r.id, role: r.role, status: r.status, toolCallJson: r.tool_call_json });
  return {
    chain,
    orgId,
    server,
    async post(path, userId) {
      const res = await server.inject({ method: 'POST', url: path, headers: { 'x-test-user': userId } });
      return { status: res.statusCode, body: (res.body.length > 0 ? res.json() : {}) as Record<string, unknown> };
    },
    storedCallRows(conversationId) {
      const rows = raw
        .prepare(`SELECT id, role, status, tool_call_json FROM agent_messages
                  WHERE conversation_id = ? AND tool_call_json IS NOT NULL ORDER BY created_at, rowid`)
        .all(conversationId) as Array<{ id: string; role: string; status: string; tool_call_json: string }>;
      return rows.map(toRow);
    },
    row(messageId) {
      const r = raw.prepare('SELECT id, role, status, tool_call_json FROM agent_messages WHERE id = ?')
        .get(messageId) as { id: string; role: string; status: string; tool_call_json: string } | undefined;
      return r === undefined ? undefined : toRow(r);
    },
    auditArgs(conversationId) {
      const rows = raw
        .prepare('SELECT args_json FROM agent_audit_log WHERE conversation_id = ? ORDER BY created_at, rowid')
        .all(conversationId) as Array<{ args_json: string }>;
      return rows.map((r) => r.args_json);
    },
    async pauseScan(userId, args) {
      chain.script([{ text: 'Starting.', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args }] }]);
      const turn = await chain.runTurn(userId, orgId, 'scan the site');
      const frame = turn.frames.find((f) => f.type === 'pending_confirmation') as { messageId?: string } | undefined;
      if (frame?.messageId === undefined) throw new Error('harness: the turn did not pause for confirmation');
      return { conversationId: turn.conversationId, messageId: frame.messageId };
    },
  };
}

function argsOf(row: StoredCallRow | undefined): Record<string, unknown> | undefined {
  return row === undefined ? undefined : (JSON.parse(row.toolCallJson) as { args: Record<string, unknown> }).args;
}

describe('HARD-21 conversation messages keep no secret argument values', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.server.close();
    await h.chain.cleanup();
    vi.unstubAllGlobals();
  });

  it('HARD-21 conversation messages store secret named tool arguments redacted', async () => {
    const adminId = await h.chain.addUser('fabrikam-global-admin', 'admin');
    const value = 'Placeholder-Value-42!';
    h.chain.script([
      {
        text: 'Creating the user.',
        toolCalls: [{
          id: 'u1',
          name: 'dashboard_create_user',
          args: { username: 'fabrikam-new-user', password: value, role: 'viewer' },
        }],
      },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await h.chain.runTurn(adminId, h.orgId, 'create a user');

    const rows = h.storedCallRows(turn.conversationId);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool']);
    for (const r of rows) {
      expect(r.toolCallJson).not.toContain(value);
      expect(r.toolCallJson).toContain(REDACTED);
    }
    expect(argsOf(rows[1])).toEqual({ username: 'fabrikam-new-user', password: REDACTED, role: 'viewer' });
    // The tool received the value the model gave: the user exists with that password.
    expect(await h.chain.storage.users.getUserByUsername('fabrikam-new-user')).not.toBeNull();
    expect(await h.chain.storage.users.verifyPassword('fabrikam-new-user', value)).toBe(true);
  });

  it('HARD-21 a paused action runs with its arguments after confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const value = 'placeholder-key-value-7';
    const { conversationId, messageId } = await h.pauseScan(member.userId, { siteUrl: SITE, apiKey: value });

    // While it awaits confirmation the paused row holds the arguments as given.
    expect(argsOf(h.row(messageId))).toEqual({ siteUrl: SITE, apiKey: value });

    const res = await h.post(`/agent/confirm/${messageId}`, member.userId);

    expect(res.status).toBe(202);
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);
    const started = h.chain.scanStart.mock.calls[0]![0] as { siteUrl?: string };
    expect(started.siteUrl).toBe(SITE);
    for (const r of h.storedCallRows(conversationId)) expect(r.toolCallJson).not.toContain(value);
  });
});

describe('HARD-21 a paused scan keeps its arguments until it is resolved', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.server.close();
    await h.chain.cleanup();
    vi.unstubAllGlobals();
  });

  const SCAN_ARGS = { siteUrl: SITE, headers: { Authorization: BEARER, 'X-Trace': 'kept' } };

  it('HARD-21 a paused scan is stored with its header values while it awaits confirmation', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseScan(member.userId, SCAN_ARGS);

    const row = h.row(messageId);
    expect(row?.status).toBe('pending_confirmation');
    expect(argsOf(row)).toEqual(SCAN_ARGS);
  });

  it('HARD-21 a confirmed scan sends the header values it was paused with', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseScan(member.userId, SCAN_ARGS);

    const res = await h.post(`/agent/confirm/${messageId}`, member.userId);

    expect(res.status).toBe(202);
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);
    const started = h.chain.scanStart.mock.calls[0]![0] as { siteUrl?: string; headers?: Record<string, string> };
    expect(started.siteUrl).toBe(SITE);
    expect(started.headers).toEqual({ Authorization: BEARER, 'X-Trace': 'kept' });
  });

  it('HARD-21 a confirmed scan leaves its paused row redacted', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, SCAN_ARGS);

    const res = await h.post(`/agent/confirm/${messageId}`, member.userId);

    expect(res.status).toBe(202);
    const row = h.row(messageId);
    expect(row?.status).toBe('sent');
    expect(argsOf(row)).toEqual({ siteUrl: SITE, headers: { Authorization: REDACTED, 'X-Trace': 'kept' } });
    for (const r of h.storedCallRows(conversationId)) expect(r.toolCallJson).not.toContain(BEARER);
  });

  it('HARD-21 a declined scan leaves its paused row redacted', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, SCAN_ARGS);

    const res = await h.post(`/agent/deny/${messageId}`, member.userId);

    expect(res.status).toBe(202);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    const row = h.row(messageId);
    expect(row?.status).toBe('denied');
    expect(argsOf(row)).toEqual({ siteUrl: SITE, headers: { Authorization: REDACTED, 'X-Trace': 'kept' } });
    for (const r of h.storedCallRows(conversationId)) expect(r.toolCallJson).not.toContain(BEARER);
  });

  it('HARD-21 a scan whose confirmation fails leaves its paused row redacted', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseScan(member.userId, SCAN_ARGS);
    // A storage fault while the dispatcher reads the confirming user's organizations.
    vi.spyOn(h.chain.storage.organizations, 'getUserOrgs').mockRejectedValue(new Error('storage unavailable'));

    const res = await h.post(`/agent/confirm/${messageId}`, member.userId);

    expect(res.status).toBe(500);
    const row = h.row(messageId);
    expect(row?.status).toBe('failed');
    expect(argsOf(row)).toEqual({ siteUrl: SITE, headers: { Authorization: REDACTED, 'X-Trace': 'kept' } });
  });

  it('HARD-21 a scan refused at confirmation stays paused with its header values', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseScan(member.userId, SCAN_ARGS);
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Viewer');

    const refused = await h.post(`/agent/confirm/${messageId}`, member.userId);
    expect(refused.status).toBe(403);
    expect(h.row(messageId)?.status).toBe('pending_confirmation');
    expect(argsOf(h.row(messageId))).toEqual(SCAN_ARGS);

    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Member');
    const ran = await h.post(`/agent/confirm/${messageId}`, member.userId);
    expect(ran.status).toBe(202);
    const started = h.chain.scanStart.mock.calls[0]![0] as { headers?: Record<string, string> };
    expect(started.headers).toEqual({ Authorization: BEARER, 'X-Trace': 'kept' });
  });

  it('HARD-21 the agent audit stores the paused scan headers redacted', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, SCAN_ARGS);
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Viewer');
    expect((await h.post(`/agent/confirm/${messageId}`, member.userId)).status).toBe(403);
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Member');
    expect((await h.post(`/agent/confirm/${messageId}`, member.userId)).status).toBe(202);

    const stored = h.auditArgs(conversationId);
    expect(stored).toHaveLength(2);
    for (const a of stored) {
      expect(a).not.toContain(BEARER);
      expect(JSON.parse(a)).toEqual({ siteUrl: SITE, headers: { Authorization: REDACTED, 'X-Trace': 'kept' } });
    }
  });
});
