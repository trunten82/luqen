/**
 * HARD-19: a paused assistant action is confirmed through POST /agent/confirm/:messageId and declined
 * through POST /agent/deny/:messageId. The routes run over the real in-process chain
 * (tests/helpers/agent-chain.ts): the pending row is created by AgentService for the conversation's
 * user, and the confirm dispatches through the real ToolDispatcher, which resolves the stored user's
 * permissions at confirm time.
 *
 * The requesting user is injected per request from the x-test-user header (the test substitute for
 * the session preHandler, as tests/routes/agent.test.ts does).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';

const PUBLIC_URL = 'https://dashboard.example.com';

interface Harness {
  chain: AgentChain;
  server: FastifyInstance;
  orgId: string;
  confirm(userId: string, messageId: string): Promise<{ status: number; body: Record<string, unknown> }>;
  deny(userId: string, messageId: string): Promise<{ status: number; body: Record<string, unknown> }>;
  /** Runs a turn in which the model asks to scan a site; returns the pending message id. */
  pauseOnSiteScan(userId: string): Promise<{ conversationId: string; messageId: string }>;
  pendingStatus(messageId: string): string | undefined;
}

async function buildHarness(): Promise<Harness> {
  const chain = await buildAgentChain();
  const orgId = await chain.createOrg('Fabrikam Confirm');
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
  const post = async (path: string, userId: string) => {
    const res = await server.inject({ method: 'POST', url: path, headers: { 'x-test-user': userId } });
    return { status: res.statusCode, body: (res.body.length > 0 ? res.json() : {}) as Record<string, unknown> };
  };
  const raw = chain.storage.getRawDatabase();
  return {
    chain,
    server,
    orgId,
    confirm: (userId, messageId) => post(`/agent/confirm/${messageId}`, userId),
    deny: (userId, messageId) => post(`/agent/deny/${messageId}`, userId),
    async pauseOnSiteScan(userId) {
      chain.script([
        { text: 'Starting.', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: 'https://example.com' } }] },
      ]);
      const turn = await chain.runTurn(userId, orgId, 'scan the site');
      const frame = turn.frames.find((f) => f.type === 'pending_confirmation') as { messageId?: string } | undefined;
      if (frame?.messageId === undefined) throw new Error('harness: the turn did not pause for confirmation');
      return { conversationId: turn.conversationId, messageId: frame.messageId };
    },
    pendingStatus(messageId) {
      const row = raw.prepare('SELECT status FROM agent_messages WHERE id = ?').get(messageId) as { status: string } | undefined;
      return row?.status;
    },
  };
}

describe('HARD-19 confirming a paused assistant action', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.server.close();
    await h.chain.cleanup();
    vi.unstubAllGlobals();
  });

  it('HARD-19 a confirmed action runs only while the confirming user may use the tool', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseOnSiteScan(member.userId);
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Viewer');

    const res = await h.confirm(member.userId, messageId);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'denied' });
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(h.pendingStatus(messageId)).toBe('pending_confirmation');
  });

  it('HARD-19 a confirmed action does not run for a deactivated user', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseOnSiteScan(member.userId);
    await h.chain.storage.users.deactivateUser(member.userId);

    const res = await h.confirm(member.userId, messageId);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'denied' });
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(h.pendingStatus(messageId)).toBe('pending_confirmation');
  });

  it('HARD-19 only the user of the conversation can confirm or decline its pending action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-colleague', 'viewer', 'Member');
    const { messageId } = await h.pauseOnSiteScan(member.userId);

    const foreignConfirm = await h.confirm(colleague.userId, messageId);
    const foreignDeny = await h.deny(colleague.userId, messageId);

    expect([foreignConfirm.status, foreignConfirm.body]).toEqual([404, { error: 'pending_not_found' }]);
    expect([foreignDeny.status, foreignDeny.body]).toEqual([404, { error: 'pending_not_found' }]);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(h.pendingStatus(messageId)).toBe('pending_confirmation');

    const own = await h.confirm(member.userId, messageId);
    expect(own.status).toBe(202);
  });

  it('HARD-15 a member confirms a scan through the assistant and it draws from the shared start limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { messageId } = await h.pauseOnSiteScan(member.userId);

    const res = await h.confirm(member.userId, messageId);

    expect(res.status).toBe(202);
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);
    expect(h.chain.createScan).toHaveBeenCalledTimes(1);
    expect(h.chain.startStore.get(`user:${member.userId}`)).toHaveLength(1);
  });

  it('HARD-19 every confirm attempt is recorded in the agent audit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseOnSiteScan(member.userId);
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Viewer');

    const refused = await h.confirm(member.userId, messageId);
    expect(refused.status).toBe(403);
    expect(h.chain.auditRows(conversationId).map((a) => [a.toolName, a.outcome, a.userId])).toEqual([
      ['dashboard_scan_site', 'denied', member.userId],
    ]);

    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Member');
    const ran = await h.confirm(member.userId, messageId);
    expect(ran.status).toBe(202);
    expect(h.chain.auditRows(conversationId).map((a) => [a.toolName, a.outcome, a.conversationId])).toEqual([
      ['dashboard_scan_site', 'denied', conversationId],
      ['dashboard_scan_site', 'success', conversationId],
    ]);
  });
});
