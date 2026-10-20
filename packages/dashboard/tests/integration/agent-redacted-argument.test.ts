/**
 * HARD-21: a tool call whose secret-named argument holds the redaction marker is never run.
 *
 * Stored conversations show the model its own earlier calls with secret values redacted
 * (src/db/agent-audit-redaction.ts), so a call the model copies from that history carries the marker
 * where a value should be. The dispatcher refuses such a call before argument parsing and before the
 * handler and tells the model to ask the user for the value again; the assistant loop and the
 * confirmation route both dispatch through it, and a destructive call holding the marker is answered
 * the same way instead of pausing.
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the confirm route runs
 * over the real dispatcher (tests/helpers/agent-route-chain.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';
import { buildRouteHarness, ROUTE_SITE, type RouteHarness } from '../helpers/agent-route-chain.js';

interface ChainMessage {
  readonly role: string;
  readonly content?: string;
  readonly toolCalls?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly args: Record<string, unknown> }>;
}

/** The model's own most recent earlier call, as the provider received it in the history. */
function lastEarlierCall(history: readonly unknown[]): { name: string; args: Record<string, unknown> } {
  const withCalls = (history as ChainMessage[]).filter((m) => m.role === 'assistant' && (m.toolCalls ?? []).length > 0);
  const last = withCalls[withCalls.length - 1];
  const call = last?.toolCalls?.[0];
  if (call === undefined) throw new Error('test: the history holds no earlier call');
  return { name: call.name, args: call.args };
}

const LLM_CONNECTION = {
  serviceId: 'llm',
  url: 'https://llm.example.com',
  clientId: 'fabrikam-llm-client',
};

describe('HARD-21 the assistant never sends a redacted value as a value', () => {
  let chain: AgentChain;
  let orgId: string;
  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Marker');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await chain.cleanup();
    vi.unstubAllGlobals();
  });

  it('HARD-21 the assistant refuses a tool call that carries a redacted value', async () => {
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    const value = 'placeholder-llm-secret-1';
    chain.script([
      { text: 'Saving the llm connection.', toolCalls: [{ id: 'c1', name: 'dashboard_create_service_connection', args: { ...LLM_CONNECTION, clientSecret: value } }] },
      (history) => {
        const earlier = lastEarlierCall(history);
        // The history shows the model its own call with the value already stored as the marker.
        expect(earlier.args['clientSecret']).toBe(REDACTED);
        return {
          text: 'Saving the branding connection the same way.',
          toolCalls: [{ id: 'c2', name: earlier.name, args: { ...earlier.args, serviceId: 'branding' } }],
        };
      },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(adminId, orgId, 'configure the connections');

    expect(chain.serviceConnections.upsert).toHaveBeenCalledTimes(1);
    expect(chain.serviceConnections.upsert.mock.calls[0]![0]).toMatchObject({ serviceId: 'llm', clientSecret: value });
    const rows = chain.toolRows(turn.conversationId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.result).not.toContain('redacted_argument');
    expect(rows[1]!.result).toContain('redacted_argument');
    expect(rows[1]!.result).toContain('clientSecret');
    expect(rows[1]!.result).not.toContain(value);
    // The model's next input holds that result.
    const lastInput = chain.history[2]!.at(-1) as ChainMessage;
    expect(lastInput.role).toBe('tool');
    expect(lastInput.content).toContain('redacted_argument');
    const audit = chain.auditRows(turn.conversationId);
    expect(audit.map((a) => [a.outcome, a.outcomeDetail])).toEqual([['success', null], ['error', 'redacted_argument']]);
  });

  it('HARD-21 the assistant asks again for a redacted value instead of pausing an action', async () => {
    const member = await chain.addOrgUser(orgId, 'fabrikam-member', 'viewer', 'Member');
    chain.script([
      { text: 'Scanning.', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE, headers: { Authorization: REDACTED } } }] },
      { text: 'Please give me the header value again.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(member.userId, orgId, 'scan the site');

    expect(turn.frames.some((f) => f.type === 'pending_confirmation')).toBe(false);
    const raw = chain.storage.getRawDatabase();
    const pending = raw.prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE status = 'pending_confirmation'").get() as { n: number };
    expect(pending.n).toBe(0);
    const rows = chain.toolRows(turn.conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toContain('redacted_argument');
    expect(rows[0]!.result).toContain('headers.Authorization');
    expect(chain.scanStart).not.toHaveBeenCalled();
  });

  it('HARD-21 the assistant runs a tool call whose secret value was supplied', async () => {
    const adminId = await chain.addUser('fabrikam-global-admin', 'admin');
    const value = 'placeholder-llm-secret-2';
    chain.script([
      { text: 'Saving.', toolCalls: [{ id: 'c1', name: 'dashboard_create_service_connection', args: { ...LLM_CONNECTION, clientSecret: value } }] },
      { text: 'Done.', toolCalls: [] },
    ]);

    const turn = await chain.runTurn(adminId, orgId, 'save the llm connection');

    expect(chain.serviceConnections.upsert).toHaveBeenCalledTimes(1);
    expect(chain.serviceConnections.upsert.mock.calls[0]![0]).toMatchObject({ serviceId: 'llm', clientSecret: value });
    const rows = chain.toolRows(turn.conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).not.toContain('redacted_argument');
  });
});

describe('HARD-21 a confirmation never runs a redacted value', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Marker Confirm');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  it('HARD-21 a confirmation runs no action that carries a redacted value', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: member.userId, orgId: h.orgId });
    // A row paused before the dispatcher refused the marker: the call holds it in place of a value.
    const paused = await h.chain.storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({ id: 'p1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE, headers: { Authorization: REDACTED } } }),
    });

    const res = await h.post(`/agent/confirm/${paused.id}`, member.userId);

    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(h.row(paused.id)?.status).not.toBe('pending_confirmation');
    const result = h.rows(conv.id).filter((r) => r.id !== paused.id).map((r) => r.toolResultJson);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('redacted_argument');
    // A refused tool call is answered like any tool error.
    expect(res.status).toBe(202);
  });
});
