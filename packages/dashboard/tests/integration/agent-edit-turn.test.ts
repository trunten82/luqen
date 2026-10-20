/**
 * HARD-21: editing the most recent question replaces that question and its whole answer: the
 * assistant's tool-call rows, the tool results, an action awaiting confirmation and the final answer.
 * A share link to that answer ends, the owner's conversation and the model's next window hold none of
 * the replaced rows, a paused action of it can no longer be approved (and keeps its arguments
 * redacted), and the edit's audit row lists every replaced row. Retrying an answer replaces that answer
 * only: its link ends and the turn's tool results stay, so the new answer is written from them without
 * running a tool again.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts);
 * only the model is scripted. Member A owns the conversation, member B is a colleague in the same
 * organization who opens the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness, type StoredRow } from '../helpers/agent-route-chain.js';

const TOOL_QUESTION = 'TOOL-TURN-QUESTION';
const TOOL_ANSWER = 'TOOL-TURN-ANSWER';
const PLAIN_QUESTION = 'PLAIN-QUESTION';
const PLAIN_ANSWER = 'PLAIN-ANSWER';
const EDITED_QUESTION = 'EDITED-QUESTION';
const EDITED_ANSWER = 'EDITED-ANSWER';
const RETRIED_ANSWER = 'RETRIED-ANSWER';
const PAUSED_HEADER = 'Bearer placeholder-edited-turn';

interface Turn {
  readonly ownerId: string;
  readonly colleagueId: string;
  readonly conversationId: string;
  readonly rows: readonly StoredRow[];
  readonly questionId: string;
  readonly answerId: string;
}

describe('HARD-21 an edited question replaces its whole answer', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Edited Turn');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  async function members(): Promise<{ ownerId: string; colleagueId: string }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-edit-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-edit-colleague', 'viewer', 'Member');
    return { ownerId: owner.userId, colleagueId: colleague.userId };
  }

  /** A's turn that lists reports and then answers; its rows, question and final answer. */
  async function toolTurn(): Promise<Turn> {
    const { ownerId, colleagueId } = await members();
    h.chain.script([
      { text: '', toolCalls: [{ id: 'l1', name: 'dashboard_list_reports', args: {} }] },
      { text: TOOL_ANSWER, toolCalls: [] },
    ]);
    const turn = await h.chain.runTurn(ownerId, h.orgId, TOOL_QUESTION);
    const rows = h.rows(turn.conversationId);
    // Fixture premise (recorded in the evidence): question, tool calls, tool result, final answer.
    expect(rows.map((r) => `${r.role}:${r.status}`)).toEqual(['user:sent', 'assistant:sent', 'tool:sent', 'assistant:sent']);
    return { ownerId, colleagueId, conversationId: turn.conversationId, rows, questionId: rows[0]!.id, answerId: rows[3]!.id };
  }

  async function share(turn: Turn): Promise<string> {
    const created = await h.post(`/agent/conversations/${turn.conversationId}/messages/${turn.answerId}/share`, turn.ownerId);
    expect(created.status).toBe(201);
    const url = String(created.body['url']);
    const open = await h.get(url, turn.colleagueId);
    expect(open.status).toBe(200); // positive control: the link resolves before the change
    return url;
  }

  async function edit(turn: { ownerId: string; conversationId: string; questionId: string }): Promise<void> {
    const res = await h.post(`/agent/conversations/${turn.conversationId}/messages/${turn.questionId}/edit-resend`, turn.ownerId, {
      body: { content: EDITED_QUESTION },
    });
    expect(res.status).toBe(200);
  }

  /** The messages the model received on its most recent call. */
  function lastModelInput(): Array<{ role?: unknown; content?: unknown }> {
    return (h.chain.history[h.chain.history.length - 1] ?? []) as Array<{ role?: unknown; content?: unknown }>;
  }

  function editAuditArgs(conversationId: string): Record<string, unknown> {
    const row = h.chain.storage.getRawDatabase()
      .prepare("SELECT args_json FROM agent_audit_log WHERE conversation_id = ? AND tool_name = 'message_edit_resend'")
      .get(conversationId) as { args_json: string } | undefined;
    expect(row).toBeDefined();
    return JSON.parse(row!.args_json) as Record<string, unknown>;
  }

  it('HARD-21 editing the question of a turn that used a tool ends the share link of its answer', async () => {
    const turn = await toolTurn();
    const url = await share(turn);

    await edit(turn);

    const after = await h.get(url, turn.colleagueId);
    expect(after.status).toBe(404);
    expect(after.text).toContain('share_not_found');
    expect(after.text).not.toContain(TOOL_ANSWER);
  });

  it('HARD-21 editing the question of a turn that used a tool removes the whole answer from the conversation', async () => {
    const turn = await toolTurn();

    await edit(turn);

    for (const r of turn.rows) expect(h.row(r.id)?.status, `${r.role} ${r.id}`).toBe('superseded');
    const own = await h.get(`/agent/conversations/${turn.conversationId}`, turn.ownerId);
    expect(own.status).toBe(200);
    expect(own.text).toContain(EDITED_QUESTION);
    expect(own.text).not.toContain(TOOL_ANSWER);
    for (const r of turn.rows) expect(own.text, r.id).not.toContain(r.id);

    const args = editAuditArgs(turn.conversationId);
    expect(args['supersededMessageIds']).toEqual(turn.rows.map((r) => r.id));
    expect(args['supersededAssistantId']).toBe(turn.rows[1]!.id);

    h.chain.script([{ text: EDITED_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(turn.ownerId, h.orgId, EDITED_QUESTION, turn.conversationId);
    const input = lastModelInput();
    expect(input.some((m) => m.role === 'user' && m.content === EDITED_QUESTION)).toBe(true);
    expect(JSON.stringify(input)).not.toContain(TOOL_ANSWER);
    expect(input.filter((m) => m.role === 'tool')).toEqual([]);
  });

  it('HARD-21 editing the question of a turn without tools replaces its answer', async () => {
    const { ownerId, colleagueId } = await members();
    h.chain.script([{ text: PLAIN_ANSWER, toolCalls: [] }]);
    const run = await h.chain.runTurn(ownerId, h.orgId, PLAIN_QUESTION);
    const rows = h.rows(run.conversationId);
    expect(rows.map((r) => `${r.role}:${r.status}`)).toEqual(['user:sent', 'assistant:sent']);
    const turn: Turn = { ownerId, colleagueId, conversationId: run.conversationId, rows, questionId: rows[0]!.id, answerId: rows[1]!.id };
    const url = await share(turn);

    await edit(turn);

    expect(h.row(turn.questionId)?.status).toBe('superseded');
    expect(h.row(turn.answerId)?.status).toBe('superseded');
    const link = await h.get(url, colleagueId);
    expect(link.status).toBe(404);
    expect(link.text).toContain('share_not_found');
    const own = await h.get(`/agent/conversations/${turn.conversationId}`, ownerId);
    expect(own.text).toContain(EDITED_QUESTION);
    expect(own.text).not.toContain(PLAIN_ANSWER);
  });

  it('HARD-21 an action paused in the answer to an edited question can no longer be approved', async () => {
    const { ownerId } = await members();
    const paused = await h.pauseScan(ownerId, {});
    const question = h.rows(paused.conversationId).find((r) => r.role === 'user');
    expect(question).toBeDefined();
    expect(h.row(paused.messageId)?.status).toBe('pending_confirmation');

    await edit({ ownerId, conversationId: paused.conversationId, questionId: question!.id });

    const confirm = await h.post(`/agent/confirm/${paused.messageId}`, ownerId);
    expect(confirm.status).toBe(409);
    expect(confirm.body['error']).toBe('not_pending');
    expect(h.row(paused.messageId)?.status).toBe('superseded');
    expect(h.chain.scanStart).not.toHaveBeenCalled();
  });

  it('HARD-21 an action paused in the answer to an edited question keeps its arguments redacted', async () => {
    const { ownerId } = await members();
    const paused = await h.pauseScan(ownerId, { headers: { Authorization: PAUSED_HEADER } });
    // Positive control: while it awaits confirmation the paused row keeps its arguments as given.
    expect(h.row(paused.messageId)?.toolCallJson ?? '').toContain(PAUSED_HEADER);
    const question = h.rows(paused.conversationId).find((r) => r.role === 'user');

    await edit({ ownerId, conversationId: paused.conversationId, questionId: question!.id });

    const stored = h.row(paused.messageId);
    expect(stored?.status).toBe('superseded');
    expect(stored?.toolCallJson ?? '').toContain('dashboard_scan_site');
    expect(stored?.toolCallJson ?? '').not.toContain(PAUSED_HEADER);
  });

  it('HARD-21 retrying the answer of a turn that used a tool ends its share link and keeps the tool results', async () => {
    const turn = await toolTurn();
    const url = await share(turn);

    const retried = await h.post(`/agent/conversations/${turn.conversationId}/messages/${turn.answerId}/retry`, turn.ownerId);
    expect(retried.status).toBe(200);

    const link = await h.get(url, turn.colleagueId);
    expect(link.status).toBe(404);
    expect(link.text).toContain('share_not_found');
    for (const r of turn.rows.slice(0, 3)) expect(h.row(r.id)?.status, `${r.role} ${r.id}`).toBe('sent');
    expect(h.row(turn.answerId)?.status).toBe('superseded');

    const usersBefore = h.rows(turn.conversationId).filter((r) => r.role === 'user').length;
    h.chain.script([{ text: RETRIED_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(turn.ownerId, h.orgId, TOOL_QUESTION, turn.conversationId);
    expect(h.rows(turn.conversationId).filter((r) => r.role === 'user')).toHaveLength(usersBefore);
    const input = lastModelInput();
    expect(input.some((m) => m.role === 'tool')).toBe(true);
    expect(JSON.stringify(input)).not.toContain(TOOL_ANSWER);
  });
});
