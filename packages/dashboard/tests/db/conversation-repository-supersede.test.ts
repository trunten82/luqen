/**
 * Phase 37 Plan 01 — markMessageStopped, markMessagesSuperseded,
 * getMessagesIncludingSuperseded.
 *
 * Org-scoped operations on agent_messages that distinguish stopped /
 * superseded turns from final ones.
 *
 * Harness mirrors tests/db/conversation-repository.test.ts (temp-file
 * SQLite + per-test cleanup).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let userId: string;
const orgA = 'org-a';
const orgB = 'org-b';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser(
    `u-${randomUUID()}`,
    'pass123',
    'user',
  );
  userId = user.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// markMessageStopped
// ---------------------------------------------------------------------------

describe('markMessageStopped', () => {
  it('flips status to "stopped" and updates content; supersededAt stays null', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const msg = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'partial...',
      status: 'streaming',
    });

    const ok = await storage.conversations.markMessageStopped(
      msg.id,
      conv.id,
      orgA,
      'partial text streamed before stop',
    );
    expect(ok).toBe(true);

    const after = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    const row = after.find((m) => m.id === msg.id)!;
    expect(row.status).toBe('stopped');
    expect(row.content).toBe('partial text streamed before stop');
    expect(row.supersededAt).toBeNull();
  });

  it('returns false for wrong org and does not mutate the row', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const msg = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'partial...',
      status: 'streaming',
    });

    const ok = await storage.conversations.markMessageStopped(
      msg.id,
      conv.id,
      orgB,
      'attempted hijack',
    );
    expect(ok).toBe(false);

    const after = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    const row = after.find((m) => m.id === msg.id)!;
    expect(row.status).toBe('streaming');
    expect(row.content).toBe('partial...');
  });

  it('returns false for a non-existent message id', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });

    const ok = await storage.conversations.markMessageStopped(
      'no-such-id',
      conv.id,
      orgA,
      'irrelevant',
    );
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markMessagesSuperseded
// ---------------------------------------------------------------------------

describe('markMessagesSuperseded', () => {
  it('marks the given ids superseded and returns the row count', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'q1',
    });
    const m2 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'a1',
      status: 'final',
    });

    const n = await storage.conversations.markMessagesSuperseded(
      [m1.id, m2.id],
      conv.id,
      orgA,
    );
    expect(n).toBe(2);

    const all = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    const r1 = all.find((m) => m.id === m1.id)!;
    const r2 = all.find((m) => m.id === m2.id)!;
    expect(r1.status).toBe('superseded');
    expect(r2.status).toBe('superseded');
    expect(typeof r1.supersededAt).toBe('string');
    expect(typeof r2.supersededAt).toBe('string');
  });

  it('is idempotent — already-superseded rows are not re-touched', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'q1',
    });

    const first = await storage.conversations.markMessagesSuperseded(
      [m1.id],
      conv.id,
      orgA,
    );
    expect(first).toBe(1);

    const second = await storage.conversations.markMessagesSuperseded(
      [m1.id],
      conv.id,
      orgA,
    );
    expect(second).toBe(0);
  });

  it('does not affect rows from a foreign-org conversation', async () => {
    const convA = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const convB = await storage.conversations.createConversation({
      userId,
      orgId: orgB,
      title: null,
    });
    const mA = await storage.conversations.appendMessage({
      conversationId: convA.id,
      role: 'user',
      content: 'a',
    });
    const mB = await storage.conversations.appendMessage({
      conversationId: convB.id,
      role: 'user',
      content: 'b',
    });

    // Try to supersede a message belonging to convB while passing convA + orgA.
    const n = await storage.conversations.markMessagesSuperseded(
      [mA.id, mB.id],
      convA.id,
      orgA,
    );
    expect(n).toBe(1); // only mA matches

    const allB = await storage.conversations.getMessagesIncludingSuperseded(
      convB.id,
      orgB,
    );
    const rB = allB.find((m) => m.id === mB.id)!;
    expect(rB.status).not.toBe('superseded');
  });

  it('returns 0 when called with an empty id array', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const n = await storage.conversations.markMessagesSuperseded(
      [],
      conv.id,
      orgA,
    );
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getWindow / getFullHistory exclude superseded by default
// ---------------------------------------------------------------------------

describe('default reads exclude superseded rows', () => {
  it('getWindow excludes superseded rows', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'old',
    });
    await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'live',
    });

    await storage.conversations.markMessagesSuperseded([m1.id], conv.id, orgA);

    const window = await storage.conversations.getWindow(conv.id);
    expect(window.find((m) => m.id === m1.id)).toBeUndefined();
    expect(window).toHaveLength(1);
    expect(window[0]!.content).toBe('live');
  });

  it('getFullHistory excludes superseded rows by default', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'old',
    });
    await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'live',
    });

    await storage.conversations.markMessagesSuperseded([m1.id], conv.id, orgA);

    const history = await storage.conversations.getFullHistory(conv.id);
    expect(history.find((m) => m.id === m1.id)).toBeUndefined();
  });

  it('getMessagesIncludingSuperseded returns all rows including superseded', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'old',
    });
    await storage.conversations.markMessagesSuperseded([m1.id], conv.id, orgA);

    const all = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    expect(all.find((m) => m.id === m1.id)).toBeDefined();
  });

  it('getMessagesIncludingSuperseded returns [] for a foreign org', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'hello',
    });

    const all = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgB,
    );
    expect(all).toEqual([]);
  });

  it('"stopped" rows remain visible to the user (default reads keep them)', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'partial',
      status: 'streaming',
    });
    await storage.conversations.markMessageStopped(
      m1.id,
      conv.id,
      orgA,
      'partial',
    );

    const window = await storage.conversations.getWindow(conv.id);
    const row = window.find((m) => m.id === m1.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe('stopped');
  });
});

// ---------------------------------------------------------------------------
// AgentMessage shape
// ---------------------------------------------------------------------------

describe('Message.supersededAt mapping', () => {
  it('is null for non-superseded rows and an ISO string after supersede', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'q',
    });

    const before = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    expect(before.find((m) => m.id === m1.id)!.supersededAt).toBeNull();

    await storage.conversations.markMessagesSuperseded([m1.id], conv.id, orgA);

    const after = await storage.conversations.getMessagesIncludingSuperseded(
      conv.id,
      orgA,
    );
    const row = after.find((m) => m.id === m1.id)!;
    expect(typeof row.supersededAt).toBe('string');
    expect(() => new Date(row.supersededAt as string).toISOString()).not.toThrow();
  });
});
