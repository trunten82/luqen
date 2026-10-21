/**
 * HARD-21: edit, retry, the message read, the edit form and share decide on the conversation's latest
 * rows however long the conversation is. Past 200 active rows the real last question can be edited and
 * an older one cannot, the real last answer can be read, retried and shared, and its link opens on the
 * 200 rows that end with it.
 *
 * The routes are the real ones over the real in-process assistant (tests/helpers/agent-route-chain.ts).
 * Member A owns the conversation, seeded through the store with 105 question and answer pairs (210 active
 * rows); member B is a colleague in the same organization who opens the link.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRouteHarness, type RouteHarness } from '../helpers/agent-route-chain.js';

const PAIRS = 105;
const EDITED_QUESTION = 'EDITED-QUESTION';

interface LongConversation {
  readonly ownerId: string;
  readonly colleagueId: string;
  readonly conversationId: string;
  /** Message id by marker (`LONG-Q-000` .. `LONG-A-104`). */
  readonly ids: ReadonlyMap<string, string>;
}

function marker(kind: 'Q' | 'A', n: number): string {
  return `LONG-${kind}-${String(n).padStart(3, '0')}`;
}

describe('HARD-21 a conversation longer than one page of messages', () => {
  let h: RouteHarness;
  beforeEach(async () => {
    h = await buildRouteHarness('Fabrikam Long Conversation');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(async () => {
    await h.close();
    vi.unstubAllGlobals();
  });

  async function longConversation(): Promise<LongConversation> {
    const owner = await h.chain.addOrgUser(h.orgId, 'fabrikam-long-owner', 'viewer', 'Member');
    const colleague = await h.chain.addOrgUser(h.orgId, 'fabrikam-long-colleague', 'viewer', 'Member');
    const conv = await h.chain.storage.conversations.createConversation({ userId: owner.userId, orgId: h.orgId });
    const ids = new Map<string, string>();
    for (let n = 0; n < PAIRS; n++) {
      for (const [kind, role] of [['Q', 'user'], ['A', 'assistant']] as const) {
        const row = await h.chain.storage.conversations.appendMessage({
          conversationId: conv.id, role, content: marker(kind, n), status: 'sent',
        });
        ids.set(marker(kind, n), row.id);
      }
    }
    // Fixture premise (recorded in the evidence): 210 active rows, one per marker.
    expect(h.rows(conv.id).filter((r) => r.status === 'sent')).toHaveLength(2 * PAIRS);
    return { ownerId: owner.userId, colleagueId: colleague.userId, conversationId: conv.id, ids };
  }

  function path(c: LongConversation, markerName: string, action = ''): string {
    return `/agent/conversations/${c.conversationId}/messages/${c.ids.get(markerName)!}${action}`;
  }

  function statuses(c: LongConversation): Map<string, string> {
    return new Map(h.rows(c.conversationId).map((r) => [r.id, r.status]));
  }

  it('HARD-21 editing the last question of a long conversation replaces its turn and only its turn', async () => {
    const c = await longConversation();
    const before = statuses(c);

    const older = await h.post(path(c, marker('Q', 99), '/edit-resend'), c.ownerId, { body: { content: EDITED_QUESTION } });
    expect(older.status).toBe(400);
    expect(older.body['error']).toBe('not_most_recent_user');
    expect(statuses(c)).toEqual(before);

    const form = await h.get(path(c, marker('Q', 104), '/edit-form'), c.ownerId);
    expect(form.status).toBe(200);
    expect(form.text).toContain(marker('Q', 104));

    const edited = await h.post(path(c, marker('Q', 104), '/edit-resend'), c.ownerId, { body: { content: EDITED_QUESTION } });
    expect(edited.status).toBe(200);
    expect(h.row(c.ids.get(marker('Q', 104))!)?.status).toBe('superseded');
    expect(h.row(c.ids.get(marker('A', 104))!)?.status).toBe('superseded');
    const others = [...c.ids.entries()].filter(([name]) => name !== marker('Q', 104) && name !== marker('A', 104));
    expect(others).toHaveLength(2 * PAIRS - 2);
    for (const [name, id] of others) expect(h.row(id)?.status, name).toBe('sent');
    const active = h.rows(c.conversationId).filter((r) => r.status !== 'superseded');
    expect(active[active.length - 1]!.id).toBe(edited.body['newUserMessageId']);
  });

  it('HARD-21 retrying the last answer of a long conversation replaces it', async () => {
    const c = await longConversation();

    const read = await h.get(path(c, marker('A', 104)), c.ownerId);
    expect(read.status).toBe(200);
    expect(read.text).toContain(marker('A', 104));

    const retried = await h.post(path(c, marker('A', 104), '/retry'), c.ownerId);
    expect(retried.status).toBe(200);
    expect(h.row(c.ids.get(marker('A', 104))!)?.status).toBe('superseded');
    expect(h.row(c.ids.get(marker('Q', 104))!)?.status).toBe('sent');
  });

  it('HARD-21 sharing the last answer of a long conversation opens it', async () => {
    const c = await longConversation();

    const created = await h.post(path(c, marker('A', 104), '/share'), c.ownerId);
    expect(created.status).toBe(201);
    const view = await h.get(String(created.body['url']), c.colleagueId);
    expect(view.status).toBe(200);
    expect(view.text).toContain(marker('A', 104));
    expect(view.text).toContain(marker('Q', 104));
  });
});
