/**
 * Phase 31 — ConversationRepository contract tests.
 *
 * Covers APER-01 success criteria:
 *   - SC-1: a conversation row survives a simulated restart (temp-file
 *     sqlite, disconnect, reopen, re-query).
 *   - SC-2: rolling-window maintenance at write-time. When a 21st user
 *     turn is appended, messages from the oldest turn flip to
 *     `in_window = 0` in the same transaction; `pending_confirmation`
 *     and `streaming` rows stay in-window regardless of age.
 *   - SC-4: `pending_confirmation` persists across a restart.
 *
 * Harness pattern copied from tests/repositories/role-repository.test.ts
 * (temp-file sqlite, applyMigrations, per-test cleanup).
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
// Group A — basic CRUD (APER-01 / SC-1)
// ---------------------------------------------------------------------------

describe('SqliteConversationRepository — create + read', () => {
  it('createConversation returns a conversation with id + timestamps populated', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });

    expect(conv.id).toMatch(/^[0-9a-f-]{36}$/); // UUID shape
    expect(conv.userId).toBe(userId);
    expect(conv.orgId).toBe(orgA);
    expect(conv.title).toBeNull();
    expect(conv.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(conv.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(conv.lastMessageAt).toBeNull();
  });

  it('createConversation persists title when provided', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'My chat thread',
    });
    expect(conv.title).toBe('My chat thread');

    const fetched = await storage.conversations.getConversation(conv.id, orgA);
    expect(fetched?.title).toBe('My chat thread');
  });

  it('getConversation round-trips and returns null for unknown id', async () => {
    const created = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const fetched = await storage.conversations.getConversation(
      created.id,
      orgA,
    );
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);

    const missing = await storage.conversations.getConversation(
      'no-such-id',
      orgA,
    );
    expect(missing).toBeNull();
  });

  it('getConversation returns null when orgId does not match (cross-org isolation, T-31-01)', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const fetchedWrongOrg = await storage.conversations.getConversation(
      conv.id,
      orgB,
    );
    expect(fetchedWrongOrg).toBeNull();
  });

  it('listForUser returns only that user+org combo ordered by last activity DESC', async () => {
    const c1 = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'first',
    });
    const c2 = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'second',
    });
    // append a message to c1 so it becomes most recent
    await new Promise((r) => setTimeout(r, 5));
    await storage.conversations.appendMessage({
      conversationId: c1.id,
      role: 'user',
      content: 'hello',
    });

    const list = await storage.conversations.listForUser(userId, orgA);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(c1.id);
    expect(list[1]!.id).toBe(c2.id);
  });

  it('listForUser returns [] for a different orgId (cross-org isolation, T-31-02)', async () => {
    await storage.conversations.createConversation({ userId, orgId: orgA });
    const listWrongOrg = await storage.conversations.listForUser(userId, orgB);
    expect(listWrongOrg).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group B — appendMessage basics
// ---------------------------------------------------------------------------

describe('SqliteConversationRepository — appendMessage basics', () => {
  it('appendMessage persists the row and bumps conversation.updated_at + last_message_at', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const priorUpdatedAt = conv.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    const msg = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'hi',
    });

    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.conversationId).toBe(conv.id);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hi');
    expect(msg.status).toBe('sent');
    expect(msg.inWindow).toBe(true);

    const refreshed = await storage.conversations.getConversation(
      conv.id,
      orgA,
    );
    expect(refreshed?.updatedAt).not.toBe(priorUpdatedAt);
    expect(refreshed?.lastMessageAt).not.toBeNull();
    expect(refreshed?.lastMessageAt).toBe(refreshed?.updatedAt);
  });

  it('a new user message is inserted with in_window = 1 by default', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const msg = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'hi',
    });
    expect(msg.inWindow).toBe(true);
  });

  it('getWindow returns only in_window = 1 rows ordered created_at ASC', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const m1 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'one',
    });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'two',
    });

    const window = await storage.conversations.getWindow(conv.id);
    expect(window.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(window.every((m) => m.inWindow)).toBe(true);
  });

  it('getFullHistory returns all rows including those flipped to in_window = 0', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    // push 22 user turns so the first 2 will fall out of window
    for (let i = 0; i < 22; i++) {
      await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'user',
        content: `turn ${i}`,
      });
      // ensure strictly increasing created_at
      await new Promise((r) => setTimeout(r, 2));
    }

    const window = await storage.conversations.getWindow(conv.id);
    const full = await storage.conversations.getFullHistory(conv.id);

    expect(full.length).toBe(22);
    expect(window.length).toBeLessThan(full.length);
  });
});

// ---------------------------------------------------------------------------
// Group C — rolling window policy (APER-01 / SC-2)
// ---------------------------------------------------------------------------

describe('SqliteConversationRepository — rolling window policy', () => {
  it('21st user turn flips the oldest turn to in_window = 0', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });

    // 20 completed turns: each turn = 1 user + 1 assistant row => 40 rows.
    const firstTurnIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const u = await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'user',
        content: `u${i}`,
      });
      await new Promise((r) => setTimeout(r, 2));
      const a = await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: `a${i}`,
      });
      await new Promise((r) => setTimeout(r, 2));
      if (i === 0) {
        firstTurnIds.push(u.id, a.id);
      }
    }

    // Before the 21st user turn, the whole history is in window.
    const windowBefore = await storage.conversations.getWindow(conv.id);
    expect(windowBefore.length).toBe(40);

    // 21st user message — should flip the oldest turn (rows 1 + 2) to
    // in_window = 0.
    await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'u21',
    });

    const windowAfter = await storage.conversations.getWindow(conv.id);
    const fullAfter = await storage.conversations.getFullHistory(conv.id);
    expect(fullAfter.length).toBe(41);

    const windowIds = new Set(windowAfter.map((m) => m.id));
    for (const id of firstTurnIds) {
      expect(windowIds.has(id)).toBe(false);
    }
    // The newest 20 turns (40 rows) + new user message = 41 — but the
    // old oldest turn is out, so window = 41 - 2 = 39.
    expect(windowAfter.length).toBe(39);
  });

  it('25 user-only turns → window returns only last 20', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    for (let i = 0; i < 25; i++) {
      await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'user',
        content: `u${i}`,
      });
      await new Promise((r) => setTimeout(r, 2));
    }

    const window = await storage.conversations.getWindow(conv.id);
    const full = await storage.conversations.getFullHistory(conv.id);

    expect(full.length).toBe(25);
    // After the 21st-25th user messages, the 1st-5th rows should all
    // have fallen out of the window.
    expect(window.length).toBe(20);
    // Confirm the 5 oldest rows are out-of-window.
    const windowIds = new Set(window.map((m) => m.id));
    const oldest5 = full.slice(0, 5);
    for (const m of oldest5) {
      expect(windowIds.has(m.id)).toBe(false);
    }
  });

  it('pending_confirmation message stays in_window even after being pushed out by user turns', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });

    // One pending_confirmation message, very old.
    const pending = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      content: 'awaiting approval',
      status: 'pending_confirmation',
    });
    await new Promise((r) => setTimeout(r, 2));

    // 25 user turns push it well past the 20-turn boundary.
    for (let i = 0; i < 25; i++) {
      await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'user',
        content: `u${i}`,
      });
      await new Promise((r) => setTimeout(r, 2));
    }

    const window = await storage.conversations.getWindow(conv.id);
    const pendingInWindow = window.find((m) => m.id === pending.id);
    expect(pendingInWindow).toBeDefined();
    expect(pendingInWindow?.status).toBe('pending_confirmation');
    expect(pendingInWindow?.inWindow).toBe(true);
  });

  it('streaming message stays in_window even after being pushed past the boundary', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });

    const streamingMsg = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'partial tokens...',
      status: 'streaming',
    });
    await new Promise((r) => setTimeout(r, 2));

    for (let i = 0; i < 25; i++) {
      await storage.conversations.appendMessage({
        conversationId: conv.id,
        role: 'user',
        content: `u${i}`,
      });
      await new Promise((r) => setTimeout(r, 2));
    }

    const window = await storage.conversations.getWindow(conv.id);
    const streamingInWindow = window.find((m) => m.id === streamingMsg.id);
    expect(streamingInWindow).toBeDefined();
    expect(streamingInWindow?.status).toBe('streaming');
    expect(streamingInWindow?.inWindow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group D — pending_confirmation survives restart (APER-01 / SC-4)
// ---------------------------------------------------------------------------

describe('SqliteConversationRepository — restart durability (SC-4)', () => {
  it('a pending_confirmation row is recoverable after disconnect + reopen', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const pending = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      content: 'tool call awaiting approval',
      toolCallJson: JSON.stringify({ tool: 'delete_org', args: { id: 'x' } }),
      status: 'pending_confirmation',
    });

    // Simulate service restart.
    await storage.disconnect();
    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();

    // Seed user is still there (FK cascade didn't fire) and the
    // pending_confirmation row is still present with status intact.
    const reopened = await storage.conversations.getConversation(
      conv.id,
      orgA,
    );
    expect(reopened).not.toBeNull();
    expect(reopened?.id).toBe(conv.id);

    const history = await storage.conversations.getFullHistory(conv.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.id).toBe(pending.id);
    expect(history[0]!.status).toBe('pending_confirmation');
    expect(history[0]!.inWindow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group E — updateMessageStatus (APER-01 / SC-4 transition)
// ---------------------------------------------------------------------------

describe('SqliteConversationRepository — updateMessageStatus', () => {
  it('transitions pending_confirmation → approved', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const pending = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      content: 'awaiting',
      status: 'pending_confirmation',
    });

    await storage.conversations.updateMessageStatus(pending.id, 'approved');

    const history = await storage.conversations.getFullHistory(conv.id);
    const row = history.find((m) => m.id === pending.id);
    expect(row?.status).toBe('approved');
  });

  it('persists toolResultJson on status change when provided', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const pending = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({ tool: 'scan', args: { url: 'x' } }),
    });

    await storage.conversations.updateMessageStatus(
      pending.id,
      'failed',
      JSON.stringify({ error: 'timeout after 30s' }),
    );

    const history = await storage.conversations.getFullHistory(conv.id);
    const row = history.find((m) => m.id === pending.id);
    expect(row?.status).toBe('failed');
    expect(row?.toolResultJson).toContain('timeout after 30s');
  });

  it('preserves existing toolResultJson when not provided on status change', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    const existingResult = JSON.stringify({ data: 'original' });
    const pending = await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'tool',
      status: 'pending_confirmation',
      toolResultJson: existingResult,
    });

    await storage.conversations.updateMessageStatus(pending.id, 'approved');

    const history = await storage.conversations.getFullHistory(conv.id);
    const row = history.find((m) => m.id === pending.id);
    expect(row?.status).toBe('approved');
    expect(row?.toolResultJson).toBe(existingResult);
  });
});
