/**
 * HARD-21: only the user who started a conversation opens it, reads one of its messages, opens its
 * edit form, retries it, edits and resends it, renames it or deletes it. Another member of the
 * organization, and a global administrator acting from another organization, get "not found" and
 * nothing is written.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts);
 * only the model is scripted. Member A owns the conversation, member B is a colleague in the same
 * organization.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness, type StoredRow } from '../helpers/agent-route-chain.js';

const QUESTION = 'What is the contrast ratio for large text on the Fabrikam pricing page?';
const ANSWER = 'Large text needs a ratio of at least 3 to 1.';
const INJECTED = 'INJECTED-BY-COLLEAGUE';

interface Owned {
  readonly ownerId: string;
  readonly colleagueId: string;
  readonly conversationId: string;
  readonly userRowId: string;
  readonly assistantRowId: string;
}

describe('HARD-21 conversation owner', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Owner');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A's conversation: one scripted turn, one user row and one assistant row. */
  async function ownedConversation(): Promise<Owned> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-colleague', 'viewer', 'Member');
    h.chain.script([{ text: ANSWER, toolCalls: [] }]);
    const turn = await h.chain.runTurn(owner.userId, h.orgId, QUESTION);
    const rows = h.rows(turn.conversationId);
    const user = rows.find((r) => r.role === 'user');
    const assistant = rows.find((r) => r.role === 'assistant');
    if (user === undefined || assistant === undefined) throw new Error('fixture: the turn left no user and assistant row');
    return {
      ownerId: owner.userId,
      colleagueId: colleague.userId,
      conversationId: turn.conversationId,
      userRowId: user.id,
      assistantRowId: assistant.id,
    };
  }

  function titleOf(conversationId: string): string | null {
    const raw = h.chain.storage.getRawDatabase();
    return (raw.prepare('SELECT title FROM agent_conversations WHERE id = ?').get(conversationId) as { title: string | null }).title;
  }

  function isDeleted(conversationId: string): number {
    const raw = h.chain.storage.getRawDatabase();
    return (raw.prepare('SELECT is_deleted FROM agent_conversations WHERE id = ?').get(conversationId) as { is_deleted: number }).is_deleted;
  }

  function auditNames(conversationId: string): string[] {
    return h.chain.auditRows(conversationId).map((a) => a.toolName);
  }

  /** What the colleague's refused request must leave behind: the rows, the title, the audit trail. */
  function snapshot(conversationId: string): { rows: StoredRow[]; title: string | null; audit: string[]; deleted: number } {
    return { rows: h.rows(conversationId), title: titleOf(conversationId), audit: auditNames(conversationId), deleted: isDeleted(conversationId) };
  }

  it('HARD-21 another member cannot open a conversation', async () => {
    const { colleagueId, conversationId } = await ownedConversation();

    const res = await h.get(`/agent/conversations/${conversationId}`, colleagueId);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.text).error).toBe('conversation_not_found');
    expect(res.text).not.toContain(QUESTION);
    expect(res.text).not.toContain(ANSWER);
  });

  it('HARD-21 another member cannot read a message of a conversation', async () => {
    const { colleagueId, conversationId, userRowId } = await ownedConversation();

    const res = await h.get(`/agent/conversations/${conversationId}/messages/${userRowId}`, colleagueId);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.text).error).toBe('conversation_not_found');
    expect(res.text).not.toContain(QUESTION);
  });

  it('HARD-21 another member cannot open the edit form of a conversation', async () => {
    const { colleagueId, conversationId, userRowId } = await ownedConversation();

    const res = await h.get(`/agent/conversations/${conversationId}/messages/${userRowId}/edit-form`, colleagueId);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(QUESTION);
  });

  it('HARD-21 another member cannot retry a conversation', async () => {
    const { colleagueId, conversationId, assistantRowId } = await ownedConversation();
    const before = snapshot(conversationId);

    const res = await h.post(`/agent/conversations/${conversationId}/messages/${assistantRowId}/retry`, colleagueId);

    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('conversation_not_found');
    expect(snapshot(conversationId)).toEqual(before);
    expect(auditNames(conversationId)).not.toContain('message_retried');
  });

  it('HARD-21 another member cannot edit and resend a conversation', async () => {
    const { ownerId, colleagueId, conversationId, userRowId } = await ownedConversation();
    const before = snapshot(conversationId);

    const res = await h.post(`/agent/conversations/${conversationId}/messages/${userRowId}/edit-resend`, colleagueId, {
      body: { content: INJECTED },
    });

    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('conversation_not_found');
    expect(snapshot(conversationId)).toEqual(before);
    // The owner's next turn: what the model receives holds the owner's words and none of the colleague's.
    h.chain.script([{ text: 'Noted.', toolCalls: [] }]);
    await h.chain.runTurn(ownerId, h.orgId, 'And for normal text?', conversationId);
    const seen = JSON.stringify(h.chain.history[h.chain.history.length - 1]);
    expect(seen).toContain('And for normal text?');
    expect(seen).not.toContain(INJECTED);
  });

  it('HARD-21 another member cannot rename a conversation', async () => {
    const { colleagueId, conversationId } = await ownedConversation();
    const before = snapshot(conversationId);

    const res = await h.post(`/agent/conversations/${conversationId}/rename`, colleagueId, { body: { title: 'Renamed by a colleague' } });

    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('conversation_not_found');
    expect(titleOf(conversationId)).toBe(before.title);
    expect(snapshot(conversationId)).toEqual(before);
    expect(auditNames(conversationId)).not.toContain('conversation_renamed');
  });

  it('HARD-21 another member cannot delete a conversation', async () => {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-colleague', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(owner.userId, {});
    const before = snapshot(conversationId);

    const res = await h.post(`/agent/conversations/${conversationId}/delete`, colleague.userId);

    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('conversation_not_found');
    expect(isDeleted(conversationId)).toBe(0);
    expect(h.row(messageId)?.status).toBe('pending_confirmation');
    expect(snapshot(conversationId)).toEqual(before);
    expect(auditNames(conversationId)).not.toContain('conversation_soft_deleted');
  });

  it('HARD-21 a global administrator cannot open or delete a conversation of another user in another organization', async () => {
    const { conversationId } = await ownedConversation();
    const adminId = await h.chain.addUser('northwind-admin', 'admin');
    const northwind = await h.chain.createOrg('Northwind Owner');
    const fromNorthwind = { 'x-test-permissions': 'admin.system', 'x-test-org': northwind };
    const before = snapshot(conversationId);

    const read = await h.get(`/agent/conversations/${conversationId}`, adminId, { headers: fromNorthwind });
    const del = await h.post(`/agent/conversations/${conversationId}/delete`, adminId, { headers: fromNorthwind });

    expect(read.status).toBe(404);
    expect(read.text).not.toContain(QUESTION);
    expect(del.status).toBe(404);
    expect(isDeleted(conversationId)).toBe(0);
    expect(snapshot(conversationId)).toEqual(before);
  });

  it('HARD-21 the owner of a conversation can use every conversation route', async () => {
    const { ownerId, conversationId, userRowId, assistantRowId } = await ownedConversation();
    const base = `/agent/conversations/${conversationId}`;

    const open = await h.get(base, ownerId);
    expect(open.status).toBe(200);
    expect(open.text).toContain(QUESTION);
    const message = await h.get(`${base}/messages/${userRowId}`, ownerId);
    expect(message.status).toBe(200);
    expect(message.text).toContain(QUESTION);
    const form = await h.get(`${base}/messages/${userRowId}/edit-form`, ownerId);
    expect(form.status).toBe(200);
    expect(form.text).toContain(QUESTION);
    const retried = await h.post(`${base}/messages/${assistantRowId}/retry`, ownerId);
    expect(retried.status).toBe(200);
    const rowsBefore = h.rows(conversationId).length;
    const resent = await h.post(`${base}/messages/${userRowId}/edit-resend`, ownerId, { body: { content: 'A new question from the owner' } });
    expect(resent.status).toBe(200);
    expect(h.rows(conversationId).length).toBe(rowsBefore + 1);
    const renamed = await h.post(`${base}/rename`, ownerId, { body: { title: 'Contrast question' } });
    expect(renamed.status).toBe(200);
    expect(titleOf(conversationId)).toBe('Contrast question');
    const deleted = await h.post(`${base}/delete`, ownerId);
    expect(deleted.status).toBe(200);
    expect(isDeleted(conversationId)).toBe(1);
  });

  it('HARD-21 a global administrator can open and delete their own conversation in another organization', async () => {
    const adminId = await h.chain.addUser('northwind-admin', 'admin');
    const northwind = await h.chain.createOrg('Northwind Owner');
    const own = await h.chain.storage.conversations.createConversation({ userId: adminId, orgId: h.orgId });
    await h.chain.storage.conversations.appendMessage({ conversationId: own.id, role: 'user', content: QUESTION, status: 'sent' });
    const fromNorthwind = { 'x-test-permissions': 'admin.system', 'x-test-org': northwind };

    const read = await h.get(`/agent/conversations/${own.id}`, adminId, { headers: fromNorthwind });
    const del = await h.post(`/agent/conversations/${own.id}/delete`, adminId, { headers: fromNorthwind });

    expect(read.status).toBe(200);
    expect(read.text).toContain(QUESTION);
    expect(del.status).toBe(200);
    expect(isDeleted(own.id)).toBe(1);
  });
});
