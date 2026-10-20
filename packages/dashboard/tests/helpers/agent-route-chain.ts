/**
 * The assistant's routes over the real in-process chain (tests/helpers/agent-chain.ts): a bare
 * Fastify server with the agent routes registered over the chain's real dispatcher and service, and
 * a pre-handler that signs in whichever user the `x-test-user` header names, in one organization.
 *
 * Only the model is scripted. A paused action is made by a turn in which the model calls
 * dashboard_scan_site, which is destructive and so pauses before it runs.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { buildAgentChain, type AgentChain } from './agent-chain.js';

export const ROUTE_PUBLIC_URL = 'https://dashboard.example.com';
export const ROUTE_SITE = 'https://fabrikam.example/';

export interface StoredRow {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly toolCallJson: string | null;
  readonly toolResultJson: string | null;
}

export interface RouteHarness {
  readonly chain: AgentChain;
  readonly orgId: string;
  readonly server: FastifyInstance;
  /**
   * A POST as `userId`; a JSON body when `options.body` is given. `x-test-org` in the headers makes
   * the request act in that organization and `x-test-permissions` (a comma list) stamps the
   * request's permissions.
   */
  post(
    path: string,
    userId: string,
    options?: { body?: Record<string, unknown>; headers?: Record<string, string> },
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  get(
    path: string,
    userId: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ status: number; text: string }>;
  row(messageId: string): StoredRow | undefined;
  /** Every message row of a conversation, oldest first. */
  rows(conversationId: string): StoredRow[];
  /** A turn in which the model asks to scan ROUTE_SITE with `args`; returns the paused message. */
  pauseScan(userId: string, args: Record<string, unknown>): Promise<{ conversationId: string; messageId: string }>;
  close(): Promise<void>;
}

export async function buildRouteHarness(orgName: string): Promise<RouteHarness> {
  const chain = await buildAgentChain();
  const orgId = await chain.createOrg(orgName);
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.addHook('preHandler', async (request) => {
    const id = request.headers['x-test-user'];
    if (typeof id === 'string' && id.length > 0) {
      const actingOrg = request.headers['x-test-org'];
      request.user = {
        id,
        username: 'tester',
        role: 'viewer',
        currentOrgId: typeof actingOrg === 'string' && actingOrg.length > 0 ? actingOrg : orgId,
      };
    }
    const granted = request.headers['x-test-permissions'];
    if (typeof granted === 'string' && granted.length > 0) {
      (request as unknown as Record<string, unknown>)['permissions'] = new Set(granted.split(','));
    }
  });
  await registerAgentRoutes(server, {
    agentService: chain.service,
    dispatcher: chain.dispatcher,
    storage: chain.storage,
    publicUrl: ROUTE_PUBLIC_URL,
    turnRegistry: new ActiveTurnRegistry(),
  });
  await server.ready();
  const raw = chain.storage.getRawDatabase();
  type DbRow = { id: string; role: string; status: string; tool_call_json: string | null; tool_result_json: string | null };
  const toRow = (r: DbRow): StoredRow => ({
    id: r.id, role: r.role, status: r.status, toolCallJson: r.tool_call_json, toolResultJson: r.tool_result_json,
  });
  return {
    chain,
    orgId,
    server,
    async post(path, userId, options) {
      const res = await server.inject({
        method: 'POST',
        url: path,
        headers: { 'x-test-user': userId, ...(options?.headers ?? {}) },
        ...(options?.body !== undefined ? { payload: options.body } : {}),
      });
      return { status: res.statusCode, body: (res.body.length > 0 ? res.json() : {}) as Record<string, unknown> };
    },
    async get(path, userId, options) {
      const res = await server.inject({
        method: 'GET',
        url: path,
        headers: { 'x-test-user': userId, ...(options?.headers ?? {}) },
      });
      return { status: res.statusCode, text: res.body };
    },
    row(messageId) {
      const r = raw.prepare('SELECT id, role, status, tool_call_json, tool_result_json FROM agent_messages WHERE id = ?')
        .get(messageId) as DbRow | undefined;
      return r === undefined ? undefined : toRow(r);
    },
    rows(conversationId) {
      const rs = raw
        .prepare(`SELECT id, role, status, tool_call_json, tool_result_json FROM agent_messages
                  WHERE conversation_id = ? ORDER BY created_at, rowid`)
        .all(conversationId) as DbRow[];
      return rs.map(toRow);
    },
    async pauseScan(userId, args) {
      chain.script([{ text: 'Starting.', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE, ...args } }] }]);
      const turn = await chain.runTurn(userId, orgId, 'scan the site');
      const frame = turn.frames.find((f) => f.type === 'pending_confirmation') as { messageId?: string } | undefined;
      if (frame?.messageId === undefined) throw new Error('harness: the turn did not pause for confirmation');
      return { conversationId: turn.conversationId, messageId: frame.messageId };
    },
    async close() {
      await server.close();
      await chain.cleanup();
    },
  };
}
