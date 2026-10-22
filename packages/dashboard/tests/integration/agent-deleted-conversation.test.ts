/**
 * SESS-01 and SESS-03: a deleted conversation stays ended. The routes are the real ones over the real
 * in-process chain (tests/helpers/agent-route-chain.ts); only the model is scripted. A hold makes the
 * delete land inside a confirmation's permission decision, the state a resolver with real I/O reaches
 * (the hold is released in a `finally`; it changes the timing of production code, nothing else).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';
import { holdDispatchOnce, waitUntil } from '../helpers/agent-turn-holds.js';

const TEST_SECRET = 'fabrikam-token-deleted';
const FAR_FUTURE = '9999-12-31T00:00:00.000Z';

describe('SESS-01 and SESS-03 a deleted conversation stays ended', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Deleted Conversation');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  it('SESS-01 a confirmation refused while its conversation is deleted does not return the action to pending', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-deleted-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, {
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });
    const held = holdDispatchOnce(h.chain.dispatcher);
    const confirming = h.post(`/agent/confirm/${messageId}`, member.userId);
    try {
      await waitUntil(() => held.ctx() !== undefined, 'the held permission decision');
      const deleted = await h.post(`/agent/conversations/${conversationId}/delete`, member.userId);
      expect(deleted.status).toBe(200);
      // A permission change during the held decision: the real dispatcher now refuses the call.
      await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Viewer');
    } finally {
      held.release();
    }
    const refused = await confirming;

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'denied' });
    const row = h.row(messageId);
    expect(row?.status).toBe('sent');
    expect(row?.toolCallJson ?? '').not.toContain(TEST_SECRET);
    const pending = await h.chain.storage.conversations.listPendingMessagesBefore(FAR_FUTURE);
    expect(pending.map((p) => p.id)).not.toContain(messageId);

    // Only the conversation's deletion can refuse what follows.
    await h.chain.bindTeamToOrgRole(member.teamId, h.orgId, 'Member');
    const again = await h.post(`/agent/confirm/${messageId}`, member.userId);
    expect([404, 409]).toContain(again.status);
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    expect(h.row(messageId)?.status).not.toBe('pending_confirmation');
  });

  it('SESS-01 an action of a deleted conversation is not found by a confirmation or a decline', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-deleted-member-b', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, {});
    const deleted = await h.post(`/agent/conversations/${conversationId}/delete`, member.userId);
    expect(deleted.status).toBe(200);

    const confirmed = await h.post(`/agent/confirm/${messageId}`, member.userId);
    const declined = await h.post(`/agent/deny/${messageId}`, member.userId);

    expect([confirmed.status, confirmed.body]).toEqual([404, { error: 'pending_not_found' }]);
    expect([declined.status, declined.body]).toEqual([404, { error: 'pending_not_found' }]);
    expect(h.row(messageId)?.status).toBe('denied');
    expect(h.chain.scanStart).not.toHaveBeenCalled();
  });

  it('SESS-03 the answer stream of a deleted conversation answers not found and calls no model', async () => {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-deleted-owner', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    await h.chain.storage.conversations.appendMessage({ conversationId: conv.id, role: 'user', content: 'DELETED-QUESTION', status: 'sent' });
    const deleted = await h.post(`/agent/conversations/${conv.id}/delete`, owner.userId);
    expect(deleted.status).toBe(200);
    const modelCalls = h.chain.history.length;
    const rowCount = h.rows(conv.id).length;

    const res = await h.get(`/agent/stream/${conv.id}`, owner.userId);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual({ error: 'conversation_not_found' });
    expect(h.chain.history.length).toBe(modelCalls);
    expect(h.rows(conv.id).length).toBe(rowCount);
  });

  it('SESS-03 a retry whose conversation is deleted after the owner check answers not found and changes nothing', async () => {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-deleted-retrier', 'viewer', 'Member');
    const conversations = h.chain.storage.conversations;
    const conv = await conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    const question = await conversations.appendMessage({ conversationId: conv.id, role: 'user', content: 'RETRY-QUESTION', status: 'sent' });
    const answer = await conversations.appendMessage({
      conversationId: conv.id, role: 'assistant', content: 'RETRY-ANSWER', status: 'sent', followsMessageId: question.id,
    });
    // The delete lands after the route's owner check, before the retry's own transaction.
    const realSupersede = conversations.supersedeLatestAnswer.bind(conversations);
    const supersede = vi.spyOn(conversations, 'supersedeLatestAnswer').mockImplementationOnce(async (input) => {
      expect(await conversations.softDeleteConversation(conv.id, h.orgId, owner.userId)).toBe(true);
      return realSupersede(input);
    });

    const res = await h.post(`/agent/conversations/${conv.id}/messages/${answer.id}/retry`, owner.userId);

    expect(supersede).toHaveBeenCalledTimes(1);
    expect([res.status, res.body]).toEqual([404, { error: 'conversation_not_found' }]);
    expect(h.row(answer.id)?.status).toBe('sent');
    expect(h.chain.auditRows(conv.id).filter((r) => r.toolName === 'message_retried')).toEqual([]);
  });

  it('SESS-03 a message posted to a deleted conversation answers not found and stores nothing', async () => {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-deleted-poster', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    await h.chain.storage.conversations.appendMessage({ conversationId: conv.id, role: 'user', content: 'DELETED-QUESTION', status: 'sent' });
    const deleted = await h.post(`/agent/conversations/${conv.id}/delete`, owner.userId);
    expect(deleted.status).toBe(200);
    const rowCount = h.rows(conv.id).length;
    const conversationCount = (h.chain.storage.getRawDatabase()
      .prepare('SELECT COUNT(*) AS n FROM agent_conversations WHERE user_id = ?')
      .get(owner.userId) as { n: number }).n;

    // The reply of a stored message is an HTML fragment, so the request is injected directly.
    const res = await h.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'x-test-user': owner.userId },
      payload: { conversationId: conv.id, content: 'POSTED-AFTER-DELETE' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'conversation_not_found' });
    expect(res.headers['x-conversation-id']).toBeUndefined();
    expect(h.rows(conv.id).length).toBe(rowCount);
    const posted = h.chain.storage.getRawDatabase()
      .prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE content = 'POSTED-AFTER-DELETE'")
      .get() as { n: number };
    expect(posted.n).toBe(0);
    const conversationsAfter = (h.chain.storage.getRawDatabase()
      .prepare('SELECT COUNT(*) AS n FROM agent_conversations WHERE user_id = ?')
      .get(owner.userId) as { n: number }).n;
    expect(conversationsAfter).toBe(conversationCount);
  });
});
