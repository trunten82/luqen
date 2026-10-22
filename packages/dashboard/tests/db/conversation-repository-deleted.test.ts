/**
 * SESS-01 and SESS-03 at the store: a deleted conversation's paused actions never return to pending,
 * and the edit and retry transactions refuse a deleted conversation by their own check.
 *
 * Harness mirrors tests/db/conversation-repository-supersede.test.ts (temp-file SQLite, per-test
 * cleanup).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';

let storage: SqliteStorageAdapter;
let dbPath: string;
let userId: string;
const orgId = 'org-fabrikam-deleted';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-deleted-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser(`u-${randomUUID()}`, 'pass123', 'user');
  userId = user.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

interface StoredMessage { id: string; status: string; tool_call_json: string | null }

function messageRow(id: string): StoredMessage {
  return storage.getRawDatabase()
    .prepare('SELECT id, status, tool_call_json FROM agent_messages WHERE id = ?')
    .get(id) as StoredMessage;
}

describe('SESS-01 a claimed action returns to pending only while its conversation is live', () => {
  const originalCall = JSON.stringify({
    id: 'p1',
    name: 'dashboard_scan_site',
    args: { siteUrl: 'https://fabrikam.example/', headers: { Authorization: 'Bearer fabrikam-token-live' } },
  });

  async function claimedAction(): Promise<{ conversationId: string; messageId: string }> {
    const conv = await storage.conversations.createConversation({ userId, orgId });
    const row = await storage.conversations.appendMessage({
      conversationId: conv.id, role: 'tool', status: 'pending_confirmation', toolCallJson: originalCall,
    });
    expect(await storage.conversations.claimPendingMessage(row.id, 'sent')).toBe(true);
    return { conversationId: conv.id, messageId: row.id };
  }

  it('SESS-01 the reopen returns a claimed action to pending while its conversation is live', async () => {
    const { messageId } = await claimedAction();

    await storage.conversations.reopenPendingMessage(messageId, originalCall);

    const row = messageRow(messageId);
    expect(row.status).toBe('pending_confirmation');
    expect(row.tool_call_json).toBe(originalCall);
  });

  it('SESS-01 the reopen leaves a claimed action of a deleted conversation as it is', async () => {
    const { conversationId, messageId } = await claimedAction();
    expect(await storage.conversations.softDeleteConversation(conversationId, orgId, userId)).toBe(true);
    const before = messageRow(messageId);

    await storage.conversations.reopenPendingMessage(messageId, originalCall);

    const after = messageRow(messageId);
    expect(after).toEqual(before);
    expect(after.status).toBe('sent');
    expect(after.tool_call_json).toContain(REDACTED);
    expect(after.tool_call_json).not.toContain('fabrikam-token-live');
  });
});

describe('SESS-03 the edit and retry transactions refuse a deleted conversation', () => {
  // The state a transaction sees when a delete lands between the route's owner check and the
  // transaction (another dashboard process, or a storage with real I/O). Through the routes the owner
  // check answers 404 first; the store does not rely on it.
  async function deletedConversation(): Promise<{ conversationId: string; questionId: string; answerId: string }> {
    const conv = await storage.conversations.createConversation({ userId, orgId });
    const question = await storage.conversations.appendMessage({ conversationId: conv.id, role: 'user', content: 'Q1', status: 'sent' });
    const answer = await storage.conversations.appendMessage({ conversationId: conv.id, role: 'assistant', content: 'A1', status: 'sent' });
    expect(await storage.conversations.softDeleteConversation(conv.id, orgId, userId)).toBe(true);
    return { conversationId: conv.id, questionId: question.id, answerId: answer.id };
  }

  function snapshot(conversationId: string): unknown[] {
    return storage.getRawDatabase()
      .prepare('SELECT id, status, content FROM agent_messages WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId);
  }

  it('SESS-03 an edit of a deleted conversation is refused by the store and writes nothing', async () => {
    const { conversationId, questionId } = await deletedConversation();
    const before = snapshot(conversationId);

    const result = await storage.conversations.replaceLatestQuestion({
      conversationId, orgId, messageId: questionId, content: 'EDIT-IN-DELETED',
    });

    expect(result).toEqual({ ok: false, reason: 'conversation_not_found' });
    expect(snapshot(conversationId)).toEqual(before);
  });

  it('SESS-03 a retry in a deleted conversation is refused by the store and writes nothing', async () => {
    const { conversationId, answerId } = await deletedConversation();
    const before = snapshot(conversationId);

    const result = await storage.conversations.supersedeLatestAnswer({ conversationId, orgId, messageId: answerId });

    expect(result).toEqual({ ok: false, reason: 'conversation_not_found' });
    expect(snapshot(conversationId)).toEqual(before);
  });
});
