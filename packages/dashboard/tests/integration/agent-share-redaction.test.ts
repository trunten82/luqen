/**
 * HARD-21: a shared conversation shows its stored tool calls with secret-named values redacted, paused
 * ones included, and only the conversation's owner can create a share link for it.
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the share routes run over
 * it as tests/helpers/agent-route-chain.ts builds them. Two members of one organization stand in for
 * the owner and the colleague who opens the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

const PLACEHOLDER = 'Bearer placeholder-share';

describe('HARD-21 shared conversations', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Share');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** Member A pauses a scan and has an assistant message to anchor a share on. */
  async function ownerWithPausedScan(): Promise<{
    ownerId: string; colleagueId: string; conversationId: string; anchorId: string;
  }> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-colleague', 'viewer', 'Member');
    const { conversationId } = await h.pauseScan(owner.userId, { headers: { Authorization: PLACEHOLDER, 'X-Trace': 'kept' } });
    const anchor = await h.chain.storage.conversations.appendMessage({
      conversationId, role: 'assistant', content: 'I am waiting for your confirmation.', status: 'sent',
    });
    return { ownerId: owner.userId, colleagueId: colleague.userId, conversationId, anchorId: anchor.id };
  }

  function shareLinkCount(): number {
    const raw = h.chain.storage.getRawDatabase();
    return (raw.prepare('SELECT COUNT(*) AS n FROM agent_share_links').get() as { n: number }).n;
  }

  it('HARD-21 a shared conversation shows paused action arguments redacted', async () => {
    const { ownerId, colleagueId, conversationId, anchorId } = await ownerWithPausedScan();
    const created = await h.post(`/agent/conversations/${conversationId}/messages/${anchorId}/share`, ownerId);
    expect(created.status).toBe(201);

    const page = await h.get(String(created.body['url']), colleagueId);

    expect(page.status).toBe(200);
    // The paused row is on the page (its details block), with the marker where the value was.
    expect(page.text).toContain('Tool call details');
    expect(page.text).toContain(REDACTED);
    expect(page.text).not.toContain('placeholder-share');
    // Values whose names are not secret stay readable.
    expect(page.text).toContain('kept');
    // The stored row itself is unchanged: the owner can still confirm what they were shown.
    const stored = h.rows(conversationId).find((r) => r.status === 'pending_confirmation');
    expect(stored?.toolCallJson).toContain(PLACEHOLDER);
  });

  it('HARD-21 only the owner of a conversation can share it', async () => {
    const { colleagueId, conversationId, anchorId } = await ownerWithPausedScan();

    const refused = await h.post(`/agent/conversations/${conversationId}/messages/${anchorId}/share`, colleagueId);

    expect(refused.status).toBe(404);
    expect(refused.body['error']).toBe('conversation_not_found');
    expect(shareLinkCount()).toBe(0);
  });

  it('HARD-21 the owner of a conversation can share it', async () => {
    const { ownerId, conversationId, anchorId } = await ownerWithPausedScan();

    const created = await h.post(`/agent/conversations/${conversationId}/messages/${anchorId}/share`, ownerId);

    expect(created.status).toBe(201);
    expect(shareLinkCount()).toBe(1);
  });
});
