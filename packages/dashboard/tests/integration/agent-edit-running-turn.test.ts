/**
 * HARD-21: an edit, a retry or a delete that lands while the assistant is still answering ends that
 * turn, and nothing more of the replaced or withdrawn answer is kept: no tool result, no reply, no
 * stopped reply, no final answer after the step limit and no new action awaiting confirmation. Each row
 * of a turn is written after the row it follows and only while that row is on the conversation's active
 * branch of a conversation that is not deleted. A turn's end removes only its own entry in the registry
 * of running turns, so a second edit still ends the turn that answers the first one.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts),
 * which share one registry of running turns with the service as the server does; only the model is
 * scripted. A held model step or tool run is released in a `finally` and its turn awaited there, and the
 * abort flag is asserted before that, so a turn that was not ended fails by assertion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentStreamOptions } from '../../src/agent/agent-service.js';
import type { ToolCallInput, ToolDispatchContext } from '../../src/agent/tool-dispatch.js';
import type { ScriptEntry, ScriptStep, TurnResult } from '../helpers/agent-chain.js';
import { buildRouteHarness, ROUTE_SITE, type RouteHarness } from '../helpers/agent-route-chain.js';

const QUESTION = 'RUNNING-QUESTION';
const EDITED_QUESTION = 'EDITED-QUESTION';
const EDITED_AGAIN = 'EDITED-AGAIN';
const EDITED_ANSWER = 'EDITED-ANSWER';
const OLD_ANSWER = 'OLD-ANSWER';
const PARTIAL_OLD = 'PARTIAL-OLD';
const FORCED_OLD_ANSWER = 'FORCED-OLD-ANSWER';
const RETRIED_ANSWER = 'RETRIED-ANSWER';

interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open: () => open() };
}

/** A model step that records the provider options, waits for release and then answers `answer`, whatever the abort says. */
function heldStep(answer: ScriptStep): { entry: ScriptEntry; release(): void; options(): AgentStreamOptions | undefined } {
  const g = gate();
  let seen: AgentStreamOptions | undefined;
  return {
    entry: (_history, options) => {
      seen = options;
      return g.promise.then(() => answer);
    },
    release: g.open,
    options: () => seen,
  };
}

/**
 * A model step that streams `token` (when given) and waits: it rejects with an AbortError when the signal
 * aborts, the way a provider does, and answers `answer` when it is released first.
 */
function streamingStep(answer: ScriptStep, token?: string): { entry: ScriptEntry; release(): void; options(): AgentStreamOptions | undefined } {
  const g = gate();
  let seen: AgentStreamOptions | undefined;
  return {
    entry: (_history, options) => {
      seen = options;
      if (token !== undefined) options.onFrame({ type: 'token', text: token });
      return new Promise<ScriptStep>((resolve, reject) => {
        const onAbort = (): void => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (options.signal.aborted) { onAbort(); return; }
        options.signal.addEventListener('abort', onAbort, { once: true });
        void g.promise.then(() => resolve(answer));
      });
    },
    release: g.open,
    options: () => seen,
  };
}

function listReports(id: string, text = ''): ScriptStep {
  return { text, toolCalls: [{ id, name: 'dashboard_list_reports', args: {} }] };
}

/** Waits, bounded in event-loop turns, until `ready` holds. */
async function waitUntil(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 5000 && !ready(); i++) await new Promise((r) => setImmediate(r));
  if (!ready()) throw new Error(`the turn did not reach ${what}`);
}

describe('HARD-21 a change that lands while the assistant answers ends the turn and keeps nothing of the old answer', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Running Turn');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A and an empty conversation of A's. */
  async function start(): Promise<{ ownerId: string; conversationId: string }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-running-owner', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    return { ownerId: owner.userId, conversationId: conv.id };
  }

  /** The tool run of the next dispatch waits for release, then runs. */
  function holdDispatch(): { release(): void; ctx(): ToolDispatchContext | undefined } {
    const dispatcher = h.chain.dispatcher;
    const real = dispatcher.dispatch.bind(dispatcher);
    const g = gate();
    let seen: ToolDispatchContext | undefined;
    vi.spyOn(dispatcher, 'dispatch').mockImplementationOnce(async (call: ToolCallInput, ctx: ToolDispatchContext) => {
      seen = ctx;
      await g.promise;
      return real(call, ctx);
    });
    return { release: g.open, ctx: () => seen };
  }

  async function edit(ownerId: string, conversationId: string, questionId: string, content = EDITED_QUESTION): Promise<void> {
    const res = await h.post(`/agent/conversations/${conversationId}/messages/${questionId}/edit-resend`, ownerId, {
      body: { content },
    });
    expect(res.status).toBe(200);
  }

  function shape(conversationId: string): string[] {
    return h.rows(conversationId).map((r) => `${r.role}:${r.status}`);
  }

  /** Every row of the conversation with its content, oldest first. */
  function contentRows(conversationId: string): Array<{ id: string; role: string; status: string; content: string }> {
    const rows = h.chain.storage.getRawDatabase()
      .prepare('SELECT id, role, status, content FROM agent_messages WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as Array<{ id: string; role: string; status: string; content: string | null }>;
    return rows.map((r) => ({ ...r, content: r.content ?? '' }));
  }

  /** The rows after the active question `question`, by role, status and content. */
  function rowsAfter(conversationId: string, question: string): string[] {
    const rows = contentRows(conversationId);
    const at = rows.findIndex((r) => r.role === 'user' && r.content === question && r.status !== 'superseded');
    expect(at, `the active question ${question}`).toBeGreaterThanOrEqual(0);
    return rows.slice(at + 1).map((r) => `${r.role}:${r.status}:${r.content}`);
  }

  function lastModelInput(): Array<{ role?: unknown; content?: unknown }> {
    return (h.chain.history[h.chain.history.length - 1] ?? []) as Array<{ role?: unknown; content?: unknown }>;
  }

  async function ownView(ownerId: string, conversationId: string): Promise<string> {
    const own = await h.get(`/agent/conversations/${conversationId}`, ownerId);
    expect(own.status).toBe(200);
    return own.text;
  }

  it('HARD-21 editing a question while its answer is being written ends the turn and keeps nothing of the old answer', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: OLD_ANSWER, toolCalls: [] });
    h.chain.script([listReports('l1'), held.entry]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    let turn: TurnResult | undefined;
    let before: string[] = [];
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      // Fixture premise (recorded in the evidence): question, tool calls, tool result.
      expect(shape(conversationId)).toEqual(['user:sent', 'assistant:sent', 'tool:sent']);
      before = h.rows(conversationId).map((r) => r.id);
      await edit(ownerId, conversationId, before[0]!);
      expect(held.options()!.signal.aborted).toBe(true);
    } finally {
      held.release();
      turn = await running;
    }

    expect(turn.frames[turn.frames.length - 1]).toEqual({ type: 'done', aborted: true });
    expect(turn.frames.filter((f) => f.type === 'error')).toEqual([]);
    for (const id of before) expect(h.row(id)?.status, id).toBe('superseded');
    expect(rowsAfter(conversationId, EDITED_QUESTION)).toEqual([]);
    const view = await ownView(ownerId, conversationId);
    expect(view).toContain(EDITED_QUESTION);
    expect(view).not.toContain(OLD_ANSWER);

    h.chain.script([{ text: EDITED_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(ownerId, h.orgId, EDITED_QUESTION, conversationId);
    const input = lastModelInput();
    expect(input.some((m) => m.role === 'user' && m.content === EDITED_QUESTION)).toBe(true);
    expect(JSON.stringify(input)).not.toContain(OLD_ANSWER);
    expect(input.filter((m) => m.role === 'tool')).toEqual([]);
  });

  it('HARD-21 a tool result of a turn whose question was edited is not written after the new answer', async () => {
    const { ownerId, conversationId } = await start();
    const dispatch = holdDispatch();
    h.chain.script([listReports('l1')]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the held tool run');
      // Fixture premise (recorded in the evidence): question, tool calls.
      expect(shape(conversationId)).toEqual(['user:sent', 'assistant:sent']);
      await edit(ownerId, conversationId, h.rows(conversationId)[0]!.id);
      h.chain.script([{ text: EDITED_ANSWER, toolCalls: [] }]);
      await h.chain.runTurn(ownerId, h.orgId, EDITED_QUESTION, conversationId);
    } finally {
      dispatch.release();
      await running;
    }

    expect(rowsAfter(conversationId, EDITED_QUESTION)).toEqual([`assistant:sent:${EDITED_ANSWER}`]);
  });

  it('HARD-21 editing a question while the assistant streams its answer keeps no stopped reply of the old answer', async () => {
    const { ownerId, conversationId } = await start();
    const step = streamingStep({ text: PARTIAL_OLD, toolCalls: [] }, PARTIAL_OLD);
    h.chain.script([step.entry]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    try {
      await waitUntil(() => step.options() !== undefined, 'the streaming model step');
      // Fixture premise (recorded in the evidence): the question only.
      expect(shape(conversationId)).toEqual(['user:sent']);
      await edit(ownerId, conversationId, h.rows(conversationId)[0]!.id);
      expect(step.options()!.signal.aborted).toBe(true);
    } finally {
      step.release();
      await running;
    }

    expect(rowsAfter(conversationId, EDITED_QUESTION)).toEqual([]);
    expect(contentRows(conversationId).filter((r) => r.content.includes(PARTIAL_OLD) && r.status !== 'superseded')).toEqual([]);
    expect(await ownView(ownerId, conversationId)).not.toContain(PARTIAL_OLD);
    expect(h.chain.auditRows(conversationId).filter((r) => r.toolName === 'message_stopped')).toEqual([]);
  });

  it('HARD-21 editing a question while the assistant chooses its next step leaves no action awaiting confirmation', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: '', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE } }] });
    h.chain.script([listReports('l1'), held.entry]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      // Fixture premise (recorded in the evidence): question, tool calls, tool result.
      expect(shape(conversationId)).toEqual(['user:sent', 'assistant:sent', 'tool:sent']);
      await edit(ownerId, conversationId, h.rows(conversationId)[0]!.id);
    } finally {
      held.release();
      turn = await running;
    }

    expect(h.rows(conversationId).filter((r) => r.status === 'pending_confirmation')).toEqual([]);
    expect(turn.frames.filter((f) => f.type === 'pending_confirmation')).toEqual([]);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(rowsAfter(conversationId, EDITED_QUESTION)).toEqual([]);
  });

  it('HARD-21 editing a question while the assistant writes its final answer after the step limit keeps no final answer', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: FORCED_OLD_ANSWER, toolCalls: [] });
    h.chain.script([listReports('l1'), listReports('l2'), listReports('l3'), listReports('l4'), listReports('l5'), held.entry]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    try {
      await waitUntil(() => held.options() !== undefined, 'the forced final model call');
      // Fixture premise (recorded in the evidence): the question, then five tool-call rows each with its result.
      expect(shape(conversationId)).toEqual(['user:sent', ...Array.from({ length: 5 }, () => ['assistant:sent', 'tool:sent']).flat()]);
      expect(h.chain.offered[h.chain.offered.length - 1]).toEqual([]);
      await edit(ownerId, conversationId, h.rows(conversationId)[0]!.id);
    } finally {
      held.release();
      await running;
    }

    expect(rowsAfter(conversationId, EDITED_QUESTION)).toEqual([]);
    expect(await ownView(ownerId, conversationId)).not.toContain(FORCED_OLD_ANSWER);
  });

  it('HARD-21 retrying a reply while its tool runs ends the turn and writes no tool result', async () => {
    const { ownerId, conversationId } = await start();
    const dispatch = holdDispatch();
    h.chain.script([listReports('l1', 'CHECKING-REPORTS')]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    let modelCalls = 0;
    let rows: string[] = [];
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the held tool run');
      // Fixture premise (recorded in the evidence): question, the tool-call row narrating CHECKING-REPORTS.
      expect(shape(conversationId)).toEqual(['user:sent', 'assistant:sent']);
      rows = h.rows(conversationId).map((r) => r.id);
      modelCalls = h.chain.history.length;
      const retried = await h.post(`/agent/conversations/${conversationId}/messages/${rows[1]!}/retry`, ownerId);
      expect(retried.status).toBe(200);
      expect(dispatch.ctx()!.signal?.aborted).toBe(true);
    } finally {
      dispatch.release();
      await running;
    }

    expect(h.row(rows[1]!)?.status).toBe('superseded');
    expect(h.row(rows[0]!)?.status).toBe('sent');
    expect(h.rows(conversationId).filter((r) => r.role === 'tool' && r.status !== 'superseded')).toEqual([]);
    expect(h.chain.history).toHaveLength(modelCalls);

    h.chain.script([{ text: RETRIED_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    expect(lastModelInput().filter((m) => m.role === 'tool')).toEqual([]);
  });

  it('HARD-21 a second edit ends the turn that answers the first edit', async () => {
    const { ownerId, conversationId } = await start();
    const dispatch = holdDispatch();
    h.chain.script([listReports('l1')]);
    const first = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    const step = streamingStep({ text: 'SECOND-TURN-ANSWER', toolCalls: [] });
    let second: Promise<TurnResult> | undefined;
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the held tool run');
      await edit(ownerId, conversationId, h.rows(conversationId)[0]!.id);
      h.chain.script([step.entry]);
      second = h.chain.runTurn(ownerId, h.orgId, EDITED_QUESTION, conversationId);
      await waitUntil(() => step.options() !== undefined, 'the model step of the second turn');
      dispatch.release();
      await first;
      const edited = contentRows(conversationId).find((r) => r.role === 'user' && r.content === EDITED_QUESTION);
      await edit(ownerId, conversationId, edited!.id, EDITED_AGAIN);
      expect(step.options()!.signal.aborted).toBe(true);
    } finally {
      dispatch.release();
      step.release();
      await first;
      if (second !== undefined) await second;
    }
  });

  it('HARD-21 deleting a conversation while the assistant chooses its next step ends the turn and leaves no action awaiting confirmation', async () => {
    const { ownerId, conversationId } = await start();
    const held = heldStep({ text: '', toolCalls: [{ id: 's1', name: 'dashboard_scan_site', args: { siteUrl: ROUTE_SITE } }] });
    h.chain.script([listReports('l1'), held.entry]);
    const running = h.chain.runTurn(ownerId, h.orgId, QUESTION, conversationId);
    let turn: TurnResult | undefined;
    try {
      await waitUntil(() => held.options() !== undefined, 'the held model step');
      // Fixture premise (recorded in the evidence): question, tool calls, tool result.
      expect(shape(conversationId)).toEqual(['user:sent', 'assistant:sent', 'tool:sent']);
      const deleted = await h.post(`/agent/conversations/${conversationId}/delete`, ownerId);
      expect(deleted.status).toBe(200);
      expect(held.options()!.signal.aborted).toBe(true);
    } finally {
      held.release();
      turn = await running;
    }

    expect(h.rows(conversationId).filter((r) => r.status === 'pending_confirmation')).toEqual([]);
    expect(turn.frames.filter((f) => f.type === 'pending_confirmation')).toEqual([]);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
  });
});
