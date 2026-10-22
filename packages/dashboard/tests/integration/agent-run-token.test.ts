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
import { AgentService, type AgentStreamOptions, type AgentStreamTurn } from '../../src/agent/agent-service.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { storedPermissionsOrNone } from '../../src/auth/stored-caller.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import type { SseFrame } from '../../src/agent/sse-frames.js';
import type { ScriptEntry, ScriptStep, TurnResult } from '../helpers/agent-chain.js';
import { buildRouteHarness, ROUTE_SITE, type RouteHarness } from '../helpers/agent-route-chain.js';
import { gate, heldStep, streamingStep, holdDispatchOnce, waitUntil } from '../helpers/agent-turn-holds.js';

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

  it('SESS-02 a second stream of the same question starts from the question alone', async () => {
    const { ownerId, conversationId } = await start();
    const dispatch = holdDispatchOnce(h.chain.dispatcher);
    h.chain.script([listReports('l1'), { text: 'T2-ANSWER', toolCalls: [] }]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the held tool run');
      await h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    } finally {
      dispatch.release();
      await first;
    }

    const roles = (messages: readonly unknown[]): unknown[] => messages.map((m) => (m as { role?: unknown }).role);
    // The second stream's model call (the second of the test) saw the question alone.
    expect(roles(h.chain.history[1]!)).toEqual(['user']);

    h.chain.script([{ text: 'T3-ANSWER', toolCalls: [] }]);
    await h.chain.runTurn(ownerId, h.orgId, 'NEXT-QUESTION', conversationId);
    const next = h.chain.history[h.chain.history.length - 1]!;
    expect(roles(next)).toEqual(['user', 'assistant', 'user']);
    expect(next.some((m) => 'toolCalls' in (m as object))).toBe(false);
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

  /** A service of this process with its own registry, a scripted model and `config` over the defaults. */
  function serviceWith(entries: readonly ScriptEntry[], config: Record<string, unknown>): AgentService {
    const queue = [...entries];
    const llm = {
      streamAgentConversation: async (_input: unknown, options: AgentStreamOptions): Promise<AgentStreamTurn> => {
        const entry = queue.shift();
        const next = entry === undefined
          ? { text: 'done', toolCalls: [] }
          : typeof entry === 'function' ? await entry([], options) : entry;
        return { text: next.text, toolCalls: [...next.toolCalls] } as AgentStreamTurn;
      },
    };
    return new AgentService({
      storage: h.chain.storage,
      llm: llm as never,
      allTools: DASHBOARD_TOOL_METADATA,
      dispatcher: h.chain.dispatcher,
      resolvePermissions: (userId, orgId) => storedPermissionsOrNone(h.chain.storage, userId, orgId),
      config: { agentDisplayNameDefault: 'Assistant', ...config },
      titleGenerator: async () => {
        throw new Error('no title in the run token tests');
      },
      turnRegistry: new ActiveTurnRegistry(),
    });
  }

  it('SESS-02 a run replaced by another process writes no error row when its model call then fails', async () => {
    const { ownerId, conversationId } = await start();
    const failing = gate();
    let reached = false;
    h.chain.script([async () => {
      reached = true;
      await failing.promise;
      throw new Error('FABRIKAM-PROVIDER-DOWN');
    }]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => reached, 'the held failing model step');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
    } finally {
      failing.open();
      turn = await first;
    }

    expect(shapeWithText(conversationId)).toEqual([`user:sent:${SAME_QUESTION}`, 'assistant:sent:T2-OTHER-PROCESS']);
    expect(contentRows(conversationId).filter((r) => r.status === 'failed')).toEqual([]);
    // The replaced run may still send its error frame (the frame is sent before the refused row).
    expect(turn.frames.filter((f) => f.type === 'error')).toHaveLength(1);
  });

  it('SESS-02 a run replaced by another process writes no compaction summary and moves no row out of the window', async () => {
    const { ownerId, conversationId } = await start();
    const conversations = h.chain.storage.conversations;
    // Seven earlier turns, one more than compaction keeps, then the question of this turn.
    for (let i = 1; i <= 7; i++) {
      await conversations.appendMessage({ conversationId, role: 'user', content: `EARLIER-QUESTION-${i} ${'x'.repeat(200)}`, status: 'sent' });
      await conversations.appendMessage({ conversationId, role: 'assistant', content: `EARLIER-ANSWER-${i} ${'y'.repeat(200)}`, status: 'sent' });
    }
    await conversations.appendMessage({ conversationId, role: 'user', content: SAME_QUESTION, status: 'sent' });
    const outOfWindow = (): number => (h.chain.storage.getRawDatabase()
      .prepare('SELECT COUNT(*) AS n FROM agent_messages WHERE conversation_id = ? AND in_window = 0')
      .get(conversationId) as { n: number }).n;
    expect(outOfWindow()).toBe(0);

    const summarise = heldStep({ text: '[summary] T1-SUMMARY', toolCalls: [] });
    const local = serviceWith([summarise.entry, { text: 'T1-ANSWER', toolCalls: [] }], { modelMaxTokens: 200 });
    const first = runOther(local, ownerId, conversationId);
    let frames: SseFrame[] = [];
    try {
      await waitUntil(() => summarise.options() !== undefined, 'the held summarisation step');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
      expect(summarise.options()!.signal.aborted).toBe(false);
    } finally {
      summarise.release();
      frames = await first;
    }

    expect(contentRows(conversationId).filter((r) => r.content.startsWith('[summary]'))).toEqual([]);
    expect(outOfWindow()).toBe(0);
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === '__compaction__')).toEqual([]);
    expect(contentRows(conversationId).filter((r) => r.content === 'T1-ANSWER')).toEqual([]);
    expect(contentRows(conversationId).at(-1)?.content).toBe('T2-OTHER-PROCESS');
    expect(frames[frames.length - 1]).toEqual({ type: 'done', aborted: true });
  });

  it('SESS-02 a run replaced by another process writes no forced final answer at the step limit', async () => {
    const { ownerId, conversationId } = await start();
    const forced = heldStep({ text: 'T1-FORCED-ANSWER', toolCalls: [] });
    h.chain.script([listReports('c1'), listReports('c2'), listReports('c3'), listReports('c4'), listReports('c5'), forced.entry]);
    const first = h.chain.runTurn(ownerId, h.orgId, SAME_QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => forced.options() !== undefined, 'the held forced final answer');
      await runOther(otherProcess({ text: 'T2-OTHER-PROCESS', toolCalls: [] }), ownerId, conversationId);
      expect(forced.options()!.signal.aborted).toBe(false);
    } finally {
      forced.release();
      turn = await first;
    }

    // Premise: the turn reached the step limit (the five tool runs before the takeover are kept).
    expect(turn.frames.some((f) => f.type === 'tool_completed' && (f as { toolCallId?: string }).toolCallId === '__loop__')).toBe(true);
    expect(contentRows(conversationId).filter((r) => r.content === 'T1-FORCED-ANSWER')).toEqual([]);
    expect(contentRows(conversationId).at(-1)?.content).toBe('T2-OTHER-PROCESS');
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === '__loop__')).toEqual([]);
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

describe('SESS-02 and SESS-03 a refused question write ends the turn cleanly', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Run Token Question');
  });
  afterEach(async () => {
    await h.close();
    vi.restoreAllMocks();
  });

  /**
   * A turn on an empty conversation, so the turn writes its question itself. `between` runs on the turn's
   * first read of the window, after the turn began its run and before it writes the question: the state a
   * second process, or a storage with real I/O, reaches when the run changes in that gap.
   */
  async function turnWithGap(between: (ownerId: string, conversationId: string) => Promise<void>): Promise<{
    conversationId: string;
    frames: SseFrame[];
    thrown: unknown;
    detached: boolean;
  }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-run-question-owner', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    const conversations = h.chain.storage.conversations;
    const realGetWindow = conversations.getWindow.bind(conversations);
    vi.spyOn(conversations, 'getWindow').mockImplementationOnce(async (id: string) => {
      await between(owner.userId, conv.id);
      return realGetWindow(id);
    });
    h.chain.script([{ text: 'MUST-NOT-BE-ASKED', toolCalls: [] }]);
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const frames: SseFrame[] = [];
    let thrown: unknown;
    try {
      await h.chain.service.runTurn({
        conversationId: conv.id,
        userId: owner.userId,
        orgId: h.orgId,
        userMessage: 'A-NEW-QUESTION',
        emit: (f: SseFrame) => frames.push(f),
        signal: controller.signal,
      });
    } catch (err) {
      thrown = err;
    }
    const detached = removed.mock.calls.some(([type]) => type === 'abort');
    return { conversationId: conv.id, frames, thrown, detached };
  }

  it('SESS-02 a question write refused because a newer run began ends with done aborted and releases the turn', async () => {
    const modelCalls = h.chain.history.length;
    const turn = await turnWithGap(async (_ownerId, conversationId) => {
      expect(await h.chain.storage.conversations.beginRun(conversationId)).not.toBeNull();
    });

    expect(turn.thrown).toBeUndefined();
    expect(turn.frames).toEqual([{ type: 'done', aborted: true }]);
    expect(h.chain.turnRegistry.isActive(turn.conversationId)).toBe(false);
    expect(turn.detached).toBe(true);
    expect(h.chain.history.length).toBe(modelCalls);
    expect(h.rows(turn.conversationId)).toEqual([]);
  });

  it('SESS-03 a question write refused because the conversation was deleted ends with done aborted and releases the turn', async () => {
    const modelCalls = h.chain.history.length;
    const turn = await turnWithGap(async (ownerId, conversationId) => {
      expect(await h.chain.storage.conversations.softDeleteConversation(conversationId, h.orgId, ownerId)).toBe(true);
    });

    expect(turn.thrown).toBeUndefined();
    expect(turn.frames).toEqual([{ type: 'done', aborted: true }]);
    expect(h.chain.turnRegistry.isActive(turn.conversationId)).toBe(false);
    expect(turn.detached).toBe(true);
    expect(h.chain.history.length).toBe(modelCalls);
    expect(h.rows(turn.conversationId)).toEqual([]);
  });
});
