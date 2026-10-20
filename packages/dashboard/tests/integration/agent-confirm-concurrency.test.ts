/**
 * HARD-21: a paused action leaves pending_confirmation through one conditional write, so however many
 * requests arrive together exactly one wins. Three confirmations run the action once (one 202, the
 * others 409 not_pending); three declines resolve it once.
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the confirm and decline
 * routes run over it as tests/helpers/agent-route-chain.ts builds them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

describe('HARD-21 a paused action is resolved once', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Concurrency');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  it('HARD-21 concurrent confirmations run a paused action once', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, {});

    const answers = await Promise.all([1, 2, 3].map(() => h.post(`/agent/confirm/${messageId}`, member.userId)));

    expect(answers.map((a) => a.status).sort()).toEqual([202, 409, 409]);
    for (const a of answers.filter((x) => x.status === 409)) expect(a.body['error']).toBe('not_pending');
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);
    const results = h.rows(conversationId).filter((r) => r.role === 'tool' && r.toolResultJson !== null);
    expect(results).toHaveLength(1);
    expect(h.row(messageId)?.status).toBe('sent');
  });

  it('HARD-21 concurrent declines resolve a paused action once', async () => {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, {});

    const answers = await Promise.all([1, 2, 3].map(() => h.post(`/agent/deny/${messageId}`, member.userId)));

    expect(answers.map((a) => a.status).sort()).toEqual([202, 409, 409]);
    for (const a of answers.filter((x) => x.status === 409)) expect(a.body['error']).toBe('not_pending');
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    const declined = h.rows(conversationId).filter((r) => (r.toolResultJson ?? '').includes('user_denied'));
    expect(declined).toHaveLength(1);
    expect(h.row(messageId)?.status).toBe('denied');
  });
});
