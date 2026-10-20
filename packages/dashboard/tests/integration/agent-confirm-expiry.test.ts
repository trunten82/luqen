/**
 * HARD-21: a paused action older than 24 hours is never run by a confirmation. The confirmation
 * declines it exactly as the hourly sweep does (the same claim, the same expired result row, a
 * summary audit row) and answers 409 expired; a younger action runs.
 *
 * The chain is the real in-process assistant (tests/helpers/agent-chain.ts); the confirm route runs
 * over it as tests/helpers/agent-route-chain.ts builds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PENDING_CONFIRMATION_TTL_MS } from '../../src/agent/pending-expiry.js';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

const MINUTE = 60 * 1000;
const PLACEHOLDER = 'Bearer placeholder-age';

describe('HARD-21 a paused action is confirmed only within 24 hours', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Confirm Age');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  /** A paused scan whose row was created `ageMs` ago. */
  async function pausedFor(ageMs: number): Promise<{ userId: string; conversationId: string; messageId: string }> {
    const member = await h.chain.addOrgUser(h.orgId, 'fabrikam-member', 'viewer', 'Member');
    const { conversationId, messageId } = await h.pauseScan(member.userId, { headers: { Authorization: PLACEHOLDER } });
    h.chain.storage.getRawDatabase()
      .prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - ageMs).toISOString(), messageId);
    return { userId: member.userId, conversationId, messageId };
  }

  it('HARD-21 a paused action older than 24 hours is declined when it is confirmed', async () => {
    const { userId, conversationId, messageId } = await pausedFor(PENDING_CONFIRMATION_TTL_MS + MINUTE);

    const res = await h.post(`/agent/confirm/${messageId}`, userId);

    expect(res.status).toBe(409);
    expect(res.body['error']).toBe('expired');
    expect(h.chain.scanStart).not.toHaveBeenCalled();
    const stored = h.row(messageId);
    expect(stored?.status).toBe('denied');
    expect(stored?.toolCallJson).not.toContain('placeholder-age');
    const expiredRows = h.rows(conversationId).filter((r) => (r.toolResultJson ?? '').includes('expired'));
    expect(expiredRows).toHaveLength(1);
    const audit = await h.chain.storage.audit.query({ action: 'agent.pending_expired' });
    expect(audit.entries).toHaveLength(1);
    expect(JSON.parse(String(audit.entries[0]!.details))).toEqual({ count: 1, trigger: 'confirm' });
  });

  it('HARD-21 the audit entry of an action declined on confirm names the user and the action', async () => {
    const { userId, messageId } = await pausedFor(PENDING_CONFIRMATION_TTL_MS + MINUTE);

    const res = await h.post(`/agent/confirm/${messageId}`, userId);

    expect(res.status).toBe(409);
    const audit = await h.chain.storage.audit.query({ action: 'agent.pending_expired' });
    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries[0]!;
    expect(entry.actorId).toBe(userId);
    expect(entry.resourceId).toBe(messageId);
    expect(entry.actor).toBe('tester');
    expect(entry.orgId).toBe(h.orgId);
    expect(JSON.parse(String(entry.details))).toEqual({ count: 1, trigger: 'confirm' });
  });

  it('HARD-21 a paused action younger than 24 hours runs when it is confirmed', async () => {
    const { userId, messageId } = await pausedFor(PENDING_CONFIRMATION_TTL_MS - MINUTE);

    const res = await h.post(`/agent/confirm/${messageId}`, userId);

    expect(res.status).toBe(202);
    expect(h.chain.scanStart).toHaveBeenCalledTimes(1);
    expect((await h.chain.storage.audit.query({ action: 'agent.pending_expired' })).entries).toHaveLength(0);
  });
});
