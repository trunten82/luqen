/**
 * SESS-02 at the store, over TWO connections on one WAL database file: the shape a second dashboard
 * process has. A run-checked row insert reads the conversation's run token and inserts in one
 * transaction. The transaction takes the write lock before it reads the token, so another connection
 * cannot replace the run between the check and the insert; a row of a replaced run is refused as a
 * withdrawn answer (WithdrawnAnswerError), never as a database error.
 *
 * The interleaving is produced by running the second connection's write at the moment the first
 * connection's token check has run (a wrapper around that one statement). That stands in for another
 * process committing at that instant; the statements are the production ones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

let dir: string;
let first: SqliteStorageAdapter;
let second: SqliteStorageAdapter;
let userId: string;
const orgId = 'org-fabrikam-two-connections';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'test-run-token-two-connections-'));
  const dbPath = join(dir, 'dashboard.db');
  first = new SqliteStorageAdapter(dbPath);
  await first.migrate();
  second = new SqliteStorageAdapter(dbPath);
  // The second connection does not wait for the lock: a write it cannot take at once fails at once.
  second.getRawDatabase().pragma('busy_timeout = 0');
  const user = await first.users.createUser(`u-${randomUUID()}`, 'pass123', 'user');
  userId = user.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await second.disconnect();
  await first.disconnect();
  rmSync(dir, { recursive: true, force: true });
});

function rowCount(conversationId: string): number {
  const r = first.getRawDatabase()
    .prepare('SELECT COUNT(*) AS n FROM agent_messages WHERE conversation_id = ?')
    .get(conversationId) as { n: number };
  return r.n;
}

function storedRunId(conversationId: string): string | null {
  const r = second.getRawDatabase()
    .prepare('SELECT active_run_id FROM agent_conversations WHERE id = ?')
    .get(conversationId) as { active_run_id: string | null };
  return r.active_run_id;
}

async function conversationWithQuestion(): Promise<{ conversationId: string; questionId: string }> {
  const conv = await first.conversations.createConversation({ userId, orgId });
  const q = await first.conversations.appendMessage({
    conversationId: conv.id, role: 'user', content: 'question for Fabrikam',
  });
  return { conversationId: conv.id, questionId: q.id };
}

/** Runs `between` once, right after the first connection's run-token check of its next insert. */
function afterTokenCheck(between: () => void): void {
  const raw: Database.Database = first.getRawDatabase();
  const realPrepare = raw.prepare.bind(raw);
  let fired = false;
  vi.spyOn(raw, 'prepare').mockImplementation(((sql: string) => {
    const stmt = realPrepare(sql);
    if (fired || !sql.includes('active_run_id = @runId')) return stmt;
    return {
      get: (...args: unknown[]) => {
        const row = (stmt.get as (...a: unknown[]) => unknown)(...args);
        fired = true;
        between();
        return row;
      },
    } as unknown as Database.Statement;
  }) as typeof raw.prepare);
}

describe('SESS-02 a run token over two connections on one database file', () => {
  it('SESS-02 a second connection cannot replace the run between the token check and the insert', async () => {
    const { conversationId, questionId } = await conversationWithQuestion();
    const r1 = await first.conversations.beginRun(conversationId);
    expect(typeof r1).toBe('string');
    const before = rowCount(conversationId);

    let takeover: Promise<string | null> | undefined;
    afterTokenCheck(() => {
      takeover = second.conversations.beginRun(conversationId);
    });
    const written = await Promise.allSettled([
      first.conversations.appendMessage({
        conversationId, role: 'assistant', content: 'answer', followsMessageId: questionId, runId: r1 as string,
      }),
    ]);
    expect(takeover).toBeDefined();
    const [taken] = await Promise.allSettled([takeover as Promise<string | null>]);

    // The insert never fails as a database error: it ran under the write lock with the token it checked.
    const failure = written[0].status === 'rejected' ? written[0].reason as { name?: string; code?: string } : undefined;
    expect(failure === undefined ? 'written' : `${failure.name ?? ''} ${failure.code ?? ''}`).toBe('written');
    expect(rowCount(conversationId)).toBe(before + 1);
    // The other connection could not take the run inside that transaction.
    expect(taken!.status).toBe('rejected');
    expect(((taken as PromiseRejectedResult).reason as { code?: string }).code).toBe('SQLITE_BUSY');
    expect(storedRunId(conversationId)).toBe(r1);
  });

  it('SESS-02 a row of a run replaced through a second connection is refused as a withdrawn answer', async () => {
    const { conversationId, questionId } = await conversationWithQuestion();
    const r1 = await first.conversations.beginRun(conversationId);
    const r2 = await second.conversations.beginRun(conversationId);
    expect(typeof r2).toBe('string');
    expect(r2).not.toBe(r1);
    const before = rowCount(conversationId);

    await expect(
      first.conversations.appendMessage({
        conversationId, role: 'assistant', content: 'late', followsMessageId: questionId, runId: r1 as string,
      }),
    ).rejects.toMatchObject({ name: 'WithdrawnAnswerError' });
    expect(rowCount(conversationId)).toBe(before);

    // positive control: the current run writes through the other connection
    await second.conversations.appendMessage({
      conversationId, role: 'assistant', content: 'current', followsMessageId: questionId, runId: r2 as string,
    });
    expect(rowCount(conversationId)).toBe(before + 1);
  });
});
