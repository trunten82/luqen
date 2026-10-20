/**
 * HARD-21: a paused action not confirmed or declined within 24 hours is declined through the
 * conditional claim (its stored arguments redacted in the same write), never earlier; deleting its
 * conversation declines it too; the sweep runs when the server starts and every hour after.
 *
 * Real SQLite storage; the sweep's clock is injected, so a row created now is "old" by moving the clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { REDACTED } from '../../src/db/agent-audit-redaction.js';
import {
  PENDING_CONFIRMATION_TTL_MS,
  PENDING_SWEEP_INTERVAL_MS,
  runPendingExpirySweep,
  startPendingExpirySweep,
} from '../../src/agent/pending-expiry.js';

const MINUTE = 60 * 1000;
const PAUSED_CALL = {
  id: 'p1',
  name: 'dashboard_scan_site',
  args: { siteUrl: 'https://fabrikam.example/', headers: { Authorization: 'Bearer placeholder-expiry', 'X-Trace': 'kept' } },
};

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

interface Fixture {
  readonly storage: SqliteStorageAdapter;
  readonly orgId: string;
  readonly userId: string;
  pause(): Promise<{ conversationId: string; messageId: string; createdAt: string }>;
  status(messageId: string): { status: string; toolCallJson: string | null };
  toolRows(conversationId: string): Array<{ status: string; toolResultJson: string | null }>;
}

describe('HARD-21 paused actions expire', () => {
  let dbPath: string;
  let f: Fixture;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test-pending-expiry-${randomUUID()}.db`);
    const storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
    const org = await storage.organizations.createOrg({ name: 'Fabrikam Expiry', slug: `fabrikam-expiry-${randomUUID().slice(0, 6)}` });
    const user = await storage.users.createUser('fabrikam-member', 'Pass-word-123!', 'viewer');
    const raw = storage.getRawDatabase();
    f = {
      storage,
      orgId: org.id,
      userId: user.id,
      async pause() {
        const conv = await storage.conversations.createConversation({ userId: user.id, orgId: org.id });
        const row = await storage.conversations.appendMessage({
          conversationId: conv.id, role: 'tool', status: 'pending_confirmation', toolCallJson: JSON.stringify(PAUSED_CALL),
        });
        return { conversationId: conv.id, messageId: row.id, createdAt: row.createdAt };
      },
      status(messageId) {
        const r = raw.prepare('SELECT status, tool_call_json FROM agent_messages WHERE id = ?').get(messageId) as
          { status: string; tool_call_json: string | null };
        return { status: r.status, toolCallJson: r.tool_call_json };
      },
      toolRows(conversationId) {
        const rs = raw.prepare(`SELECT status, tool_result_json FROM agent_messages WHERE conversation_id = ? AND role = 'tool' AND tool_result_json IS NOT NULL ORDER BY created_at, rowid`)
          .all(conversationId) as Array<{ status: string; tool_result_json: string | null }>;
        return rs.map((r) => ({ status: r.status, toolResultJson: r.tool_result_json }));
      },
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    await f.storage.disconnect();
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  });

  it('HARD-21 a paused action is declined after 24 hours', async () => {
    const { conversationId, messageId, createdAt } = await f.pause();
    const now = new Date(Date.parse(createdAt) + PENDING_CONFIRMATION_TTL_MS + MINUTE);

    const count = await runPendingExpirySweep(f.storage, log, 'startup', now);

    expect(count).toBe(1);
    const stored = f.status(messageId);
    expect(stored.status).toBe('denied');
    expect(stored.toolCallJson).not.toContain('placeholder-expiry');
    expect(JSON.parse(stored.toolCallJson as string).args.headers).toEqual({ Authorization: REDACTED, 'X-Trace': 'kept' });
    const rows = f.toolRows(conversationId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.toolResultJson as string).error).toBe('expired');
    const audit = await f.storage.audit.query({ action: 'agent.pending_expired' });
    expect(audit.entries).toHaveLength(1);
    expect(JSON.parse(String(audit.entries[0]!.details))).toEqual({ count: 1, trigger: 'startup' });
  });

  it('HARD-21 a paused action younger than 24 hours stays paused', async () => {
    const { messageId, createdAt } = await f.pause();
    const now = new Date(Date.parse(createdAt) + PENDING_CONFIRMATION_TTL_MS - MINUTE);

    const count = await runPendingExpirySweep(f.storage, log, 'interval', now);

    expect(count).toBe(0);
    const stored = f.status(messageId);
    expect(stored.status).toBe('pending_confirmation');
    expect(stored.toolCallJson).toContain('placeholder-expiry');
    expect((await f.storage.audit.query({ action: 'agent.pending_expired' })).entries).toHaveLength(0);
  });

  it('HARD-21 deleting a conversation declines its paused action', async () => {
    const { conversationId, messageId } = await f.pause();

    const deleted = await f.storage.conversations.softDeleteConversation(conversationId, f.orgId);

    expect(deleted).toBe(true);
    const stored = f.status(messageId);
    expect(stored.status).toBe('denied');
    expect(stored.toolCallJson).not.toContain('placeholder-expiry');
    expect(JSON.parse(stored.toolCallJson as string).args.headers.Authorization).toBe(REDACTED);
  });

  it('HARD-21 the paused action sweep runs at start and every hour', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const old = await f.pause();
    const young = await f.pause();
    // The clock the sweep reads starts now. At that clock the old row is 24 h 1 min old and the
    // young row 23 h 30 min old, so the young row crosses 24 h before the hourly run, not at start.
    let clockMs = Date.parse(old.createdAt);
    const raw = f.storage.getRawDatabase();
    const setCreated = (id: string, ms: number): void => {
      raw.prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?').run(new Date(ms).toISOString(), id);
    };
    setCreated(old.messageId, clockMs - PENDING_CONFIRMATION_TTL_MS - MINUTE);
    setCreated(young.messageId, clockMs - PENDING_CONFIRMATION_TTL_MS + 30 * MINUTE);

    const sweep = await startPendingExpirySweep(f.storage, log, () => new Date(clockMs));

    expect(f.status(old.messageId).status).toBe('denied');
    expect(f.status(young.messageId).status).toBe('pending_confirmation');
    // The hourly run declines the young row once it crosses 24 h.
    clockMs += PENDING_SWEEP_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(PENDING_SWEEP_INTERVAL_MS);
    await vi.waitFor(() => expect(f.status(young.messageId).status).toBe('denied'));
    // The timer does not keep the process alive.
    const timer = setIntervalSpy.mock.results[0]!.value as { hasRef(): boolean };
    expect(timer.hasRef()).toBe(false);
    sweep.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
