/**
 * HARD-21: the rows written after a paused action is resolved (the result of a confirmation, of a decline
 * and of an expiry) are written only while the paused row is on the conversation's active branch, and no
 * status writer moves a superseded row. An action approved before its question was edited still runs (it
 * was approved), and nothing of it reaches the edited conversation; one that then fails stays withdrawn.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts);
 * only the model is scripted. A held tool run is released in a `finally` and its request awaited there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PENDING_CONFIRMATION_TTL_MS } from '../../src/agent/pending-expiry.js';
import type { ToolCallInput, ToolDispatchContext } from '../../src/agent/tool-dispatch.js';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

const EDITED_QUESTION = 'EDITED-QUESTION';
const EDITED_ANSWER = 'EDITED-ANSWER';
const HOUR = 60 * 60 * 1000;

interface Paused {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly questionId: string;
}

describe('HARD-21 a paused action resolved while its question is edited adds nothing to the edited conversation', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Resolve After Edit');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A's turn paused on a scan: its paused row and its question. */
  async function paused(): Promise<Paused> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-resolve-owner', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(owner.userId, {});
    // Fixture premise (recorded in the evidence): the question, then the paused action.
    expect(h.rows(conversationId).map((r) => `${r.role}:${r.status}`)).toEqual(['user:sent', 'tool:pending_confirmation']);
    return { ownerId: owner.userId, conversationId, messageId, questionId: h.rows(conversationId)[0]!.id };
  }

  /** The tool run of the next dispatch waits for release, then runs, or throws when `fail` is set. */
  function holdDispatch(fail: boolean): { release(): void; ctx(): ToolDispatchContext | undefined } {
    const dispatcher = h.chain.dispatcher;
    const real = dispatcher.dispatch.bind(dispatcher);
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { open = resolve; });
    let seen: ToolDispatchContext | undefined;
    vi.spyOn(dispatcher, 'dispatch').mockImplementationOnce(async (call: ToolCallInput, ctx: ToolDispatchContext) => {
      seen = ctx;
      await held;
      if (fail) throw new Error('planted failure');
      return real(call, ctx);
    });
    return { release: () => open(), ctx: () => seen };
  }

  async function waitUntil(ready: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 5000 && !ready(); i++) await new Promise((r) => setImmediate(r));
    if (!ready()) throw new Error(`the request did not reach ${what}`);
  }

  function editPath(p: Paused): string {
    return `/agent/conversations/${p.conversationId}/messages/${p.questionId}/edit-resend`;
  }

  /** The next claim of the paused action runs, then A's edit of the question, then the claim answers. */
  function editDuringClaim(p: Paused): { status(): number } {
    const conversations = h.chain.storage.conversations;
    const realClaim = conversations.claimPendingMessage.bind(conversations);
    let editStatus = 0;
    vi.spyOn(conversations, 'claimPendingMessage').mockImplementationOnce(async (id: string, status: 'sent' | 'denied') => {
      const won = await realClaim(id, status);
      editStatus = (await h.post(editPath(p), p.ownerId, { body: { content: EDITED_QUESTION } })).status;
      return won;
    });
    return { status: () => editStatus };
  }

  /** The rows after the active question `question`, by role, status and content. */
  function rowsAfter(conversationId: string, question: string): string[] {
    const rows = h.chain.storage.getRawDatabase()
      .prepare('SELECT role, status, content FROM agent_messages WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as Array<{ role: string; status: string; content: string | null }>;
    const at = rows.findIndex((r) => r.role === 'user' && r.content === question && r.status !== 'superseded');
    expect(at, `the active question ${question}`).toBeGreaterThanOrEqual(0);
    return rows.slice(at + 1).map((r) => `${r.role}:${r.status}:${r.content ?? ''}`);
  }

  it('HARD-21 an action approved before its question was edited writes no result into the edited conversation', async () => {
    const p = await paused();
    const dispatch = holdDispatch(false);
    const confirming = h.post(`/agent/confirm/${p.messageId}`, p.ownerId);
    let confirm: { status: number } | undefined;
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the approved tool run');
      expect(h.row(p.messageId)?.status).toBe('sent');
      const edited = await h.post(editPath(p), p.ownerId, { body: { content: EDITED_QUESTION } });
      expect(edited.status).toBe(200);
    } finally {
      dispatch.release();
      confirm = await confirming;
    }

    expect(confirm.status).toBe(202);
    expect(h.row(p.messageId)?.status).toBe('superseded');
    expect(rowsAfter(p.conversationId, EDITED_QUESTION)).toEqual([]);
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);

    h.chain.script([{ text: EDITED_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(p.ownerId, h.orgId, EDITED_QUESTION, p.conversationId);
    const input = (h.chain.history[h.chain.history.length - 1] ?? []) as Array<{ role?: unknown }>;
    expect(input.filter((m) => m.role === 'tool')).toEqual([]);
  });

  it('HARD-21 an action approved before its question was edited that then fails stays withdrawn', async () => {
    const p = await paused();
    const dispatch = holdDispatch(true);
    const confirming = h.post(`/agent/confirm/${p.messageId}`, p.ownerId);
    let confirm: { status: number } | undefined;
    try {
      await waitUntil(() => dispatch.ctx() !== undefined, 'the approved tool run');
      const edited = await h.post(editPath(p), p.ownerId, { body: { content: EDITED_QUESTION } });
      expect(edited.status).toBe(200);
    } finally {
      dispatch.release();
      confirm = await confirming;
    }

    expect(confirm.status).toBe(500);
    expect(h.row(p.messageId)?.status).toBe('superseded');
    expect(rowsAfter(p.conversationId, EDITED_QUESTION)).toEqual([]);
  });

  it('HARD-21 an action declined while its question is edited writes no result into the edited conversation', async () => {
    const p = await paused();
    const during = editDuringClaim(p);

    const deny = await h.post(`/agent/deny/${p.messageId}`, p.ownerId);

    expect(during.status()).toBe(200);
    expect(deny.status).toBe(202);
    expect(h.row(p.messageId)?.status).toBe('superseded');
    expect(rowsAfter(p.conversationId, EDITED_QUESTION)).toEqual([]);
  });

  it('HARD-21 an expired action declined while its question is edited writes no result into the edited conversation', async () => {
    const p = await paused();
    const raw = h.chain.storage.getRawDatabase();
    const rows = raw.prepare('SELECT id, created_at FROM agent_messages WHERE conversation_id = ?')
      .all(p.conversationId) as Array<{ id: string; created_at: string }>;
    const move = raw.prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?');
    for (const r of rows) move.run(new Date(Date.parse(r.created_at) - PENDING_CONFIRMATION_TTL_MS - HOUR).toISOString(), r.id);
    const during = editDuringClaim(p);

    const confirm = await h.post(`/agent/confirm/${p.messageId}`, p.ownerId);

    expect(during.status()).toBe(200);
    expect(confirm.status).toBe(409);
    expect(confirm.body['error']).toBe('expired');
    expect(h.row(p.messageId)?.status).toBe('superseded');
    expect(rowsAfter(p.conversationId, EDITED_QUESTION)).toEqual([]);
  });
});
