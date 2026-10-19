/**
 * HARD-21: the assistant's conversation messages store tool-call arguments with secret-named values
 * redacted (src/db/agent-audit-redaction.ts, the rule the agent audit uses), through the one
 * repository write every tool-call row takes: the assistant's tool-calls row, each tool row, a
 * paused action's row and the rows its confirmation writes.
 *
 * The tool itself receives the arguments as the model gave them. A paused action is confirmed with
 * its arguments as stored: no destructive tool declares a secret-named argument, and the destructive
 * tool arguments whose names the caller chooses are listed (tests/agent/destructive-tool-arguments.test.ts).
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the confirm route runs
 * over the real dispatcher, as tests/integration/agent-confirm-permissions.test.ts builds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';

const PUBLIC_URL = 'https://dashboard.example.com';

interface StoredCallRow {
  readonly role: string;
  readonly status: string;
  readonly toolCallJson: string;
}

describe('HARD-21 conversation messages keep no secret argument values', () => {
  let chain: AgentChain;
  let orgId: string;
  let server: FastifyInstance;

  function storedCallRows(conversationId: string): StoredCallRow[] {
    const rows = chain.storage.getRawDatabase()
      .prepare(`SELECT role, status, tool_call_json FROM agent_messages
                WHERE conversation_id = ? AND tool_call_json IS NOT NULL ORDER BY created_at, rowid`)
      .all(conversationId) as Array<{ role: string; status: string; tool_call_json: string }>;
    return rows.map((r) => ({ role: r.role, status: r.status, toolCallJson: r.tool_call_json }));
  }

  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Messages');
    server = Fastify({ logger: false });
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
  });
  afterEach(async () => {
    await server.close();
    await chain.cleanup();
    vi.unstubAllGlobals();
  });

  it('HARD-21 conversation messages store secret named tool arguments redacted', async () => {
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    const value = 'Placeholder-Value-42!';
    chain.script([
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

    const turn = await chain.runTurn(adminId, orgId, 'create a user');

    const rows = storedCallRows(turn.conversationId);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool']);
    for (const r of rows) {
      expect(r.toolCallJson).not.toContain(value);
      expect(r.toolCallJson).toContain(REDACTED);
    }
    const toolCall = JSON.parse(rows[1]!.toolCallJson) as { args: Record<string, unknown> };
    expect(toolCall.args).toEqual({ username: 'fabrikam-new-user', password: REDACTED, role: 'viewer' });
    // The tool received the value the model gave: the user exists with that password.
    expect(await chain.storage.users.getUserByUsername('fabrikam-new-user')).not.toBeNull();
    expect(await chain.storage.users.verifyPassword('fabrikam-new-user', value)).toBe(true);
  });

  it('HARD-21 a paused action runs with its arguments after confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const member = await chain.addOrgUser(orgId, 'fabrikam-member', 'viewer', 'Member');
    const siteUrl = 'https://fabrikam.example/';
    const value = 'placeholder-key-value-7';
    chain.script([
      { text: 'Starting.', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl, apiKey: value } }] },
    ]);
    const turn = await chain.runTurn(member.userId, orgId, 'scan the site');
    const frame = turn.frames.find((f) => f.type === 'pending_confirmation') as { messageId?: string } | undefined;
    expect(frame?.messageId).toBeDefined();

    const pending = storedCallRows(turn.conversationId).find((r) => r.status === 'pending_confirmation');
    expect(pending).toBeDefined();
    expect(pending!.toolCallJson).not.toContain(value);
    expect((JSON.parse(pending!.toolCallJson) as { args: Record<string, unknown> }).args).toEqual({ siteUrl, apiKey: REDACTED });

    const res = await server.inject({
      method: 'POST', url: `/agent/confirm/${frame!.messageId!}`, headers: { 'x-test-user': member.userId },
    });

    expect(res.statusCode).toBe(202);
    expect(chain.scanStart).toHaveBeenCalledTimes(1);
    const started = chain.scanStart.mock.calls[0]![0] as { siteUrl?: string };
    expect(started.siteUrl).toBe(siteUrl);
    for (const r of storedCallRows(turn.conversationId)) expect(r.toolCallJson).not.toContain(value);
  });
});
