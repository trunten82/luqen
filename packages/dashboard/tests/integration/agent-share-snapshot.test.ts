/**
 * HARD-21: a shared conversation shows the conversation up to and including the answer it was shared
 * from. What the owner typed or received after that answer is not on the page, and a link whose shared
 * answer was replaced (retried, or its question edited) or that carries no shared answer stops resolving.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts);
 * only the model is scripted. Member A owns the conversation, member B is a colleague in the same
 * organization who opens the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

const FIRST_QUESTION = 'FIRST-QUESTION-SNAPSHOT';
const FIRST_ANSWER = 'FIRST-ANSWER-SNAPSHOT';
const LATER_QUESTION = 'LATER-TYPED-SNAPSHOT';
const LATER_ANSWER = 'LATER-ANSWER-SNAPSHOT';

describe('HARD-21 shared conversation snapshots', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Snapshot');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A's first turn and the assistant row of it, plus a colleague B. */
  async function firstTurn(): Promise<{ ownerId: string; colleagueId: string; conversationId: string; answerId: string }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-colleague', 'viewer', 'Member');
    h.chain.script([{ text: FIRST_ANSWER, toolCalls: [] }]);
    const turn = await h.chain.runTurn(owner.userId, h.orgId, FIRST_QUESTION);
    const answer = h.rows(turn.conversationId).find((r) => r.role === 'assistant');
    if (answer === undefined) throw new Error('fixture: the first turn left no assistant row');
    return { ownerId: owner.userId, colleagueId: colleague.userId, conversationId: turn.conversationId, answerId: answer.id };
  }

  it('HARD-21 a shared conversation shows the conversation up to the shared answer', async () => {
    const { ownerId, colleagueId, conversationId, answerId } = await firstTurn();
    const created = await h.post(`/agent/conversations/${conversationId}/messages/${answerId}/share`, ownerId);
    expect(created.status).toBe(201);

    // Every row so far is moved one minute back, so what follows is strictly later than the shared answer.
    h.chain.storage.getRawDatabase()
      .prepare(`UPDATE agent_messages SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-1 minute')
                WHERE conversation_id = ?`)
      .run(conversationId);
    h.chain.script([{ text: LATER_ANSWER, toolCalls: [] }]);
    await h.chain.runTurn(ownerId, h.orgId, LATER_QUESTION, conversationId);

    const own = await h.get(`/agent/conversations/${conversationId}`, ownerId);
    expect(own.text).toContain(LATER_QUESTION);
    expect(own.text).toContain(LATER_ANSWER);

    const page = await h.get(String(created.body['url']), colleagueId);

    expect(page.status).toBe(200);
    expect(page.text).toContain(FIRST_QUESTION);
    expect(page.text).toContain(FIRST_ANSWER);
    expect(page.text).not.toContain(LATER_QUESTION);
    expect(page.text).not.toContain(LATER_ANSWER);
  });

  it('HARD-21 a shared conversation stops resolving when its shared answer is replaced', async () => {
    const { ownerId, colleagueId, conversationId, answerId } = await firstTurn();
    const created = await h.post(`/agent/conversations/${conversationId}/messages/${answerId}/share`, ownerId);
    expect(created.status).toBe(201);
    const retried = await h.post(`/agent/conversations/${conversationId}/messages/${answerId}/retry`, ownerId);
    expect(retried.status).toBe(200);

    const replaced = await h.get(String(created.body['url']), colleagueId);

    expect(replaced.status).toBe(404);
    expect(replaced.text).toContain('share_not_found');
    expect(replaced.text).not.toContain(FIRST_ANSWER);

    const unanchored = await h.chain.storage.shareLinks.createShareLink({
      conversationId,
      orgId: h.orgId,
      anchorMessageId: null,
      createdByUserId: ownerId,
    });
    const noAnchor = await h.get(`/agent/share/${unanchored.id}`, colleagueId);

    expect(noAnchor.status).toBe(404);
    expect(noAnchor.text).toContain('share_not_found');
  });
});
