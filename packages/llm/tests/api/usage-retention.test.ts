/**
 * Phase 76 — Usage retention helper + purge integration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import {
  computeCutoffIso,
  purgeOnce,
  resolveRetentionDays,
} from '../../src/api/usage-retention.js';

let adapter: SqliteAdapter;
let dbPath: string;
let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  dbPath = join(tmpdir(), `llm-retention-${randomUUID()}.db`);
  adapter = new SqliteAdapter(dbPath);
  await adapter.initialize();
  log = { info: vi.fn(), warn: vi.fn() };
  delete process.env['LLM_USAGE_RETENTION_DAYS'];
});

afterEach(async () => {
  await adapter.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('resolveRetentionDays', () => {
  it('defaults to 90 days when env unset', () => {
    expect(resolveRetentionDays()).toBe(90);
  });
  it('parses LLM_USAGE_RETENTION_DAYS as a positive integer', () => {
    process.env['LLM_USAGE_RETENTION_DAYS'] = '30';
    expect(resolveRetentionDays()).toBe(30);
  });
  it('accepts 0 (disables purge)', () => {
    process.env['LLM_USAGE_RETENTION_DAYS'] = '0';
    expect(resolveRetentionDays()).toBe(0);
  });
  it('falls back to 90 on garbage', () => {
    process.env['LLM_USAGE_RETENTION_DAYS'] = 'not-a-number';
    expect(resolveRetentionDays()).toBe(90);
  });
  it('falls back to 90 on negative input', () => {
    process.env['LLM_USAGE_RETENTION_DAYS'] = '-5';
    expect(resolveRetentionDays()).toBe(90);
  });
});

describe('computeCutoffIso', () => {
  it('returns ISO `retentionDays` days before `now`', () => {
    const now = new Date('2026-05-29T00:00:00.000Z');
    expect(computeCutoffIso(30, now)).toBe('2026-04-29T00:00:00.000Z');
    expect(computeCutoffIso(0, now)).toBe('2026-05-29T00:00:00.000Z');
  });
});

describe('purgeUsageBefore (sqlite adapter)', () => {
  async function seedAt(occurredAt: string): Promise<void> {
    // Use the internal connection to bypass the auto-now in recordUsage.
    const db = (adapter as unknown as { conn: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }).conn;
    db.prepare(
      `INSERT INTO llm_usage (
        id, occurred_at, org_id, capability,
        provider_id, provider_type, model_id, model_name,
        prompt_tokens, completion_tokens, total_tokens, latency_ms,
        status
      ) VALUES (?, ?, ?, 'generate-fix', 'p1', 'openai', 'm1', 'gpt-4o-mini', 100, 50, 150, 200, 'ok')`,
    ).run(randomUUID(), occurredAt, 'org-1');
  }

  it('deletes rows older than the cutoff and leaves newer rows alone', async () => {
    await seedAt('2024-01-01T00:00:00.000Z');
    await seedAt('2024-06-01T00:00:00.000Z');
    await seedAt('2026-05-01T00:00:00.000Z');
    const purged = await adapter.purgeUsageBefore('2025-01-01T00:00:00.000Z');
    expect(purged).toBe(2);
    const remaining = await adapter.listUsage();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].occurredAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('returns 0 when nothing matches', async () => {
    await seedAt('2026-05-01T00:00:00.000Z');
    expect(await adapter.purgeUsageBefore('2020-01-01T00:00:00.000Z')).toBe(0);
  });
});

describe('purgeOnce', () => {
  async function recordAtOldAge(daysOld: number): Promise<void> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const db = (adapter as unknown as { conn: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }).conn;
    db.prepare(
      `INSERT INTO llm_usage (
        id, occurred_at, org_id, capability,
        provider_id, provider_type, model_id, model_name,
        prompt_tokens, completion_tokens, total_tokens, latency_ms,
        status
      ) VALUES (?, ?, ?, 'generate-fix', 'p1', 'openai', 'm1', 'gpt-4o-mini', 100, 50, 150, 200, 'ok')`,
    ).run(randomUUID(), cutoff, 'org-1');
  }

  it('returns 0 (no-op) when retentionDays is 0', async () => {
    await recordAtOldAge(365);
    const purged = await purgeOnce(adapter, log, 0);
    expect(purged).toBe(0);
    const remaining = await adapter.listUsage();
    expect(remaining).toHaveLength(1);
  });

  it('purges rows older than retentionDays', async () => {
    await recordAtOldAge(100);
    await recordAtOldAge(30);
    const purged = await purgeOnce(adapter, log, 90);
    expect(purged).toBe(1);
    const remaining = await adapter.listUsage();
    expect(remaining).toHaveLength(1);
  });
});
