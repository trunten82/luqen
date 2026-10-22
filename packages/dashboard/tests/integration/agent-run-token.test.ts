/**
 * SESS-02 and SESS-03: an assistant answer stream writes only while it is the conversation's current
 * run. A newer stream of the same conversation (another tab, or another dashboard process) replaces the
 * run, and the replaced stream stores nothing further: no tool call, no tool result, no action awaiting
 * confirmation, no final answer and no stopped reply, and its stream ends with done aborted. A stop by
 * the user does not replace the run, so the stopped reply is still kept (tests/agent/agent-service-stop-persist.test.ts).
 *
 * The routes and the assistant are the real in-process chain (tests/helpers/agent-route-chain.ts); only
 * the model is scripted, and the holds come from tests/helpers/agent-turn-holds.ts. A second AgentService
 * with its own registry of running turns over the same database stands in for a second dashboard
 * process: its registry cannot abort a turn of this process, so only the store can end that turn, which
 * is the reason the run is recorded in the store and not in a map in memory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentService, type AgentStreamTurn } from '../../src/agent/agent-service.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { storedPermissionsOrNone } from '../../src/auth/stored-caller.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import type { SseFrame } from '../../src/agent/sse-frames.js';
import type { ScriptStep, TurnResult } from '../helpers/agent-chain.js';
import { buildRouteHarness, ROUTE_SITE, type RouteHarness } from '../helpers/agent-route-chain.js';
import { heldStep, streamingStep, holdDispatchOnce, waitUntil } from '../helpers/agent-turn-holds.js';

const SAME_QUESTION = 'SAME-QUESTION';

function listReports(id: string, text = ''): ScriptStep {
  return { text, toolCalls: [{ id, name: 'dashboard_list_reports', args: {} }] };
}

describe('SESS-02 an answer stream that a newer stream replaced writes nothing further', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Run Token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A and an empty conversation of A's. */
  async function start(): Promise<{ ownerId: string; conversationId: string }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-run-token-owner', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    return { ownerId: owner.userId, conversationId: conv.id };
  }

  /** Every row of the conversation with its content, oldest first. */
  function contentRows(conversationId: string): Array<{ role: string; status: string; content: string }> {
    const rows = h.chain.storage.getRawDatabase()
      .prepare('SELECT role, status, content FROM agent_messages WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as Array<{ role: string; status: string; content: string | null }>;
    return rows.map((r) => ({ ...r, content: r.content ?? '' }));
  }

  function shapeWithText(conversationId: string): string[] {
    return contentRows(conversationId).map((r) => `${r.role}:${r.status}:${r.content}`);
  }

  /** A second dashboard process: its own registry of running turns, the same database, a model answering `answer`. */
  function otherProcess(answer: ScriptStep): AgentService {
    const llm = {
      streamAgentConversation: async (): Promise<AgentStreamTurn> =>
        ({ text: answer.text, toolCalls: [...answer.toolCalls] }) as AgentStreamTurn,
    };
    return new AgentService({
      storage: h.chain.storage,
      llm: llm as never,
      allTools: DASHBOARD_TOOL_METADATA,
      dispatcher: h.chain.dispatcher,
      resolvePermissions: (userId, orgId) => storedPermissionsOrNone(h.chain.storage, userId, orgId),
      config: { agentDisplayNameDefault: 'Assistant' },
      titleGenerator: async () => {
        throw new Error('no title in the run token tests');
      },
      turnRegistry: new ActiveTurnRegistry(),
    });
  }

  async function runOther(service: AgentService, ownerId: string, conversationId: string): Promise<SseFrame[]> {
    const frames: SseFrame[] = [];
    await service.runTurn({
      conversationId,
      userId: ownerId,
      orgId: h.orgId,
      userMessage: SAME_QUESTION,
      emit: (f: SseFrame) => frames.push(f),
      signal: new AbortController().signal,
    });
    return frames;
  }

  function endsAborted(turn: TurnResult): void {
    expect(turn.frames[turn.frames.length - 1]).toEqual({ type: 'done', aborted: true });
    expect(turn.frames.filter((f) => f.type === 'done' && (f as { aborted?: boolean }).aborted !== true)).toEqual([]);
  }

  it('SESS-02 a second stream of the same question keeps no stopped reply of the first', async () => {
    const { ownerId, conversationId } = await start();
    const step = streamingStep({ text: 'T1-LATE', toolCalls: [] }, 'T1-PARTIAL');
    h.chain.script([step.entry, { text: 'T2-ANSWER', toolCalls: [] }]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => step.options() !== undefined, 'the streaming model step');
      await h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
      // The in-process takeover happened: the registry aborted the first run.
      expect(step.options()!.signal.aborted).toBe(true);
    } finally {
      step.release();
      turn = await first;
    }

    expect(shapeWithText(conversationId)).toEqual([`user:sent:${SAME_QUESTION}`, 'assistant:sent:T2-ANSWER']);
    expect(contentRows(conversationId).filter((r) => r.status === 'stopped')).toEqual([]);
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === 'message_stopped')).toEqual([]);
    endsAborted(turn);
  });

  it('SESS-02 a second stream of the same question writes no tool result of the first', async () => {
    const { ownerId, conversationId } = await start();
    const dispatch = holdDispatchOnce(h.chain.dispatcher);
    h.chain.script([listReports('l1'), { text: 'T2-ANSWER', toolCalls: [] }]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the held tool run');
      await h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
      expect(dispatch.ctx()!.signal.aborted).toBe(true);
    } finally {
      dispatch.release();
      turn = await first;
    }

    expect(contentRows(conversationId).map((r) => `${r.role}:${r.status}`)).toEqual(['user:sent', 'assistant:sent', 'assistant:sent']);
    expect(contentRows(conversationId)[2]!.content).toBe('T2-ANSWER');
    expect(h.chain.toolRows(conversationId)).toEqual([]);
    // The tool ran, and the audit records what ran.
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === 'dashboard_list_reports')).toHaveLength(1);
    endsAborted(turn);
  });

  it('SESS-02 a run replaced by another process writes no final answer', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: 'T1-LATE-ANSWER', toolCalls: [] });
    h.chain.script([held.entry]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
      // Premise: nothing in this process ended the first run.
      expect(held.options()!.signal.aborted).toBe(false);
    } finally {
      held.release();
      turn = await first;
    }

    expect(shapeWithText(conversationId)).toEqual([`user:sent:${SAME_QUESTION}`, 'assistant:sent:T2-OTHER-PROCESS']);
    endsAborted(turn);
  });

  it('SESS-02 a run replaced by another process leaves no action awaiting confirmation', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: '', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE } }] });
    h.chain.script([held.entry]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
      expect(held.options()!.signal.aborted).toBe(false);
    } finally {
      held.release();
      turn = await first;
    }

    expect(contentRows(conversationId).filter((r) => r.status === 'pending_confirmation')).toEqual([]);
    expect(turn.frames.filter((f) => f.type === 'pending_confirmation')).toEqual([]);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    endsAborted(turn);
  });

  it('SESS-02 a run replaced by another process records no tool call and runs no tool', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep(listReports('l9'));
    h.chain.script([held.entry]);
    const dispatch = vi.spyOn(h.chain.dispatcher, 'dispatch');
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
      expect(held.options()!.signal.aborted).toBe(false);
    } finally {
      held.release();
      turn = await first;
    }

    const calls = h.chain.storage.getRawDatabase()
      .prepare("SELECT id FROM agent_messages WHERE conversation_id = ? AND tool_call_json LIKE '%l9%'")
      .all(conversationId);
    expect(calls).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(h.chain.toolRows(conversationId)).toEqual([]);
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === 'dashboard_list_reports')).toEqual([]);
    endsAborted(turn);
  });
});

describe('SESS-03 a turn on a deleted conversation runs nothing', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Run Token Deleted');
  });
  afterEach(async () => {
    await h.close();
  });

  it('SESS-03 a turn on a deleted conversation calls no model and writes nothing', async () => {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-run-deleted-owner', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    await h.chain.storage.conversations.appendMessage({
      conversationId: conv.id, role: 'user', content: 'A-QUESTION', status: 'sent',
    });
    expect(await h.chain.storage.conversations.softDeleteConversation(conv.id, h.orgId, owner.userId)).toBe(true);
    const modelCalls = h.chain.history.length;
    const rowCount = h.rows(conv.id).length;

    h.chain.script([{ text: 'MUST-NOT-BE-ASKED', toolCalls: [] }]);
    const turn = await h.chain.runTurn(owner.userId, h.orgId, 'A-QUESTION', conv.id);

    expect(turn.frames).toEqual([{ type: 'done', aborted: true }]);
    expect(h.chain.history.length).toBe(modelCalls);
    expect(h.rows(conv.id).length).toBe(rowCount);
  });
});
