/**
 * SESS-02 and SESS-03 at the store: a row of an answer stream is written only while that stream is
 * the conversation's current run of a conversation that is not deleted.
 *
 * The states below are the ones a second stream of the same conversation (in this process or in
 * another) and a delete produce: a newer beginRun replaces the token, a delete ends the conversation.
 * storage.migrate() applies every migration, so the tests run on the migrated schema.
 *
 * Harness mirrors tests/db/conversation-repository-deleted.test.ts (temp-file SQLite, per-test
 * cleanup).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

let storage: SqliteStorageAdapter;
let dbPath: string;
let userId: string;
const orgId = 'org-fabrikam-run-token';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-run-token-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser(`u-${randomUUID()}`, 'pass123', 'user');
  userId = user.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

function rowCount(conversationId: string): number {
  const r = storage.getRawDatabase()
    .prepare('SELECT COUNT(*) AS n FROM agent_messages WHERE conversation_id = ?')
    .get(conversationId) as { n: number };
  return r.n;
}

function storedRunId(conversationId: string): string | null {
  const r = storage.getRawDatabase()
    .prepare('SELECT active_run_id FROM agent_conversations WHERE id = ?')
    .get(conversationId) as { active_run_id: string | null };
  return r.active_run_id;
}

async function conversationWithQuestion(): Promise<{ conversationId: string; questionId: string }> {
  const conv = await storage.conversations.createConversation({ userId, orgId });
  const q = await storage.conversations.appendMessage({
    conversationId: conv.id, role: 'user', content: 'question for Fabrikam',
  });
  return { conversationId: conv.id, questionId: q.id };
}

describe('SESS-02 a row of a stream run is written only while that run is current', () => {
  it('SESS-02 a row of a replaced run is not written', async () => {
    const { conversationId, questionId } = await conversationWithQuestion();

    const r1 = await storage.conversations.beginRun(conversationId);
    expect(typeof r1).toBe('string');
    expect(r1).not.toBe('');
    // positive control: the current run writes
    await storage.conversations.appendMessage({
      conversationId, role: 'assistant', content: 'first', followsMessageId: questionId, runId: r1 as string,
    });
    const afterFirst = rowCount(conversationId);

    const r2 = await storage.conversations.beginRun(conversationId);
    expect(typeof r2).toBe('string');
    expect(r2).not.toBe(r1);

    await expect(
      storage.conversations.appendMessage({
        conversationId, role: 'assistant', content: 'late', followsMessageId: questionId, runId: r1 as string,
      }),
    ).rejects.toMatchObject({ name: 'WithdrawnAnswerError' });
    expect(rowCount(conversationId)).toBe(afterFirst);

    await storage.conversations.appendMessage({
      conversationId, role: 'assistant', content: 'second', followsMessageId: questionId, runId: r2 as string,
    });
    expect(rowCount(conversationId)).toBe(afterFirst + 1);
    expect(storedRunId(conversationId)).toBe(r2);
  });

  it('SESS-02 a row written without a run token follows only the predecessor rule', async () => {
    const { conversationId, questionId } = await conversationWithQuestion();
    await storage.conversations.beginRun(conversationId);

    // the confirm and decline result shape: no token, follows a live row
    const before = rowCount(conversationId);
    await storage.conversations.appendMessage({
      conversationId, role: 'tool', content: 'result', followsMessageId: questionId,
    });
    expect(rowCount(conversationId)).toBe(before + 1);

    // the predecessor rule is unchanged: a row following a superseded row is still refused
    const retired = await storage.conversations.appendMessage({
      conversationId, role: 'assistant', content: 'old answer', followsMessageId: questionId,
    });
    storage.getRawDatabase()
      .prepare("UPDATE agent_messages SET status = 'superseded' WHERE id = ?")
      .run(retired.id);
    const count = rowCount(conversationId);
    await expect(
      storage.conversations.appendMessage({
        conversationId, role: 'tool', content: 'late result', followsMessageId: retired.id,
      }),
    ).rejects.toMatchObject({ name: 'WithdrawnAnswerError' });
    expect(rowCount(conversationId)).toBe(count);
  });
});

describe('SESS-03 a run does not outlive or begin on a deleted conversation', () => {
  it('SESS-03 a run cannot begin on a deleted conversation', async () => {
    const { conversationId } = await conversationWithQuestion();
    expect(await storage.conversations.softDeleteConversation(conversationId, orgId, userId)).toBe(true);

    expect(await storage.conversations.beginRun(conversationId)).toBeNull();
    expect(storedRunId(conversationId)).toBeNull();
  });

  it('SESS-03 a run begun before its conversation was deleted writes nothing', async () => {
    const { conversationId } = await conversationWithQuestion();
    const r1 = await storage.conversations.beginRun(conversationId);
    expect(typeof r1).toBe('string');
    expect(await storage.conversations.softDeleteConversation(conversationId, orgId, userId)).toBe(true);
    const count = rowCount(conversationId);

    // the question shape: no followsMessageId, so only the run check can refuse it
    await expect(
      storage.conversations.appendMessage({
        conversationId, role: 'user', content: 'late question', runId: r1 as string,
      }),
    ).rejects.toMatchObject({ name: 'WithdrawnAnswerError' });
    expect(rowCount(conversationId)).toBe(count);
  });
});
