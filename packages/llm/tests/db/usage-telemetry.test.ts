/**
 * Phase 72-01 — Per-inference usage telemetry on the LLM DB adapter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';

let adapter: SqliteAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `llm-usage-${randomUUID()}.db`);
  adapter = new SqliteAdapter(dbPath);
  await adapter.initialize();
});

afterEach(async () => {
  await adapter.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('recordUsage', () => {
  it('persists a successful inference', async () => {
    const rec = await adapter.recordUsage({
      capability: 'generate-fix',
      orgId: 'org-1',
      providerId: 'prv-1',
      providerType: 'openai',
      modelId: 'mdl-1',
      modelName: 'gpt-4o-mini',
      promptTokens: 500,
      completionTokens: 120,
      latencyMs: 850,
      status: 'ok',
    });

    expect(rec.id).toBeDefined();
    expect(rec.occurredAt).toBeDefined();
    expect(rec.orgId).toBe('org-1');
    expect(rec.capability).toBe('generate-fix');
    expect(rec.providerType).toBe('openai');
    expect(rec.totalTokens).toBe(620);
    expect(rec.status).toBe('ok');
    expect(rec.errorClass).toBeNull();
  });

  it('persists an error inference with errorClass', async () => {
    const rec = await adapter.recordUsage({
      capability: 'analyse-report',
      orgId: 'org-1',
      providerId: 'prv-1',
      providerType: 'anthropic',
      modelId: 'mdl-2',
      modelName: 'claude-3.5-sonnet',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 4200,
      status: 'error',
      errorClass: 'TimeoutError',
    });

    expect(rec.status).toBe('error');
    expect(rec.errorClass).toBe('TimeoutError');
    expect(rec.totalTokens).toBe(0);
  });

  it('allows orgId=null for system-scope calls', async () => {
    const rec = await adapter.recordUsage({
      capability: 'extract-requirements',
      providerId: 'prv-1',
      providerType: 'ollama',
      modelId: 'mdl-3',
      modelName: 'llama3.2',
      promptTokens: 1200,
      completionTokens: 300,
      latencyMs: 9000,
      status: 'ok',
    });
    expect(rec.orgId).toBeNull();
  });

  it('round-trips agent trace correlation fields', async () => {
    const rec = await adapter.recordUsage({
      capability: 'agent-conversation',
      orgId: 'org-1',
      providerId: 'prv-1',
      providerType: 'anthropic',
      modelId: 'mdl-2',
      modelName: 'claude-3.5-sonnet',
      promptTokens: 50,
      completionTokens: 800,
      latencyMs: 2300,
      status: 'ok',
      agentConvId: 'conv-abc',
      agentMsgId: 'msg-xyz',
    });
    expect(rec.agentConvId).toBe('conv-abc');
    expect(rec.agentMsgId).toBe('msg-xyz');
  });
});

describe('listUsage', () => {
  async function seed(): Promise<void> {
    // Three distinct timestamps via natural insertion order — listUsage
    // orders by occurred_at DESC.
    await adapter.recordUsage({
      capability: 'generate-fix', orgId: 'org-a',
      providerId: 'p1', providerType: 'openai',
      modelId: 'm1', modelName: 'gpt-4o-mini',
      promptTokens: 100, completionTokens: 50, latencyMs: 500, status: 'ok',
    });
    await new Promise((r) => setTimeout(r, 5));
    await adapter.recordUsage({
      capability: 'analyse-report', orgId: 'org-a',
      providerId: 'p2', providerType: 'anthropic',
      modelId: 'm2', modelName: 'claude-3.5-sonnet',
      promptTokens: 200, completionTokens: 60, latencyMs: 800, status: 'ok',
    });
    await new Promise((r) => setTimeout(r, 5));
    await adapter.recordUsage({
      capability: 'generate-fix', orgId: 'org-b',
      providerId: 'p1', providerType: 'openai',
      modelId: 'm1', modelName: 'gpt-4o-mini',
      promptTokens: 80, completionTokens: 40, latencyMs: 400, status: 'error',
      errorClass: 'RateLimitError',
    });
  }

  it('returns all rows in occurred_at DESC order with no filter', async () => {
    await seed();
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(3);
    // Most recent first
    expect(rows[0].orgId).toBe('org-b');
    expect(rows[2].orgId).toBe('org-a');
    expect(rows[2].capability).toBe('generate-fix');
  });

  it('filters by orgId', async () => {
    await seed();
    const rows = await adapter.listUsage({ orgId: 'org-a' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.orgId === 'org-a')).toBe(true);
  });

  it('filters by capability', async () => {
    await seed();
    const rows = await adapter.listUsage({ capability: 'generate-fix' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.capability === 'generate-fix')).toBe(true);
  });

  it('respects limit', async () => {
    await seed();
    const rows = await adapter.listUsage({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it('filters by time window (inclusive)', async () => {
    await seed();
    const all = await adapter.listUsage();
    const middleTime = all[1].occurredAt;
    const fromMid = await adapter.listUsage({ from: middleTime });
    expect(fromMid).toHaveLength(2);
    expect(fromMid.every((r) => r.occurredAt >= middleTime)).toBe(true);
  });

  it('returns empty list when no rows match', async () => {
    await seed();
    const rows = await adapter.listUsage({ orgId: 'org-unknown' });
    expect(rows).toHaveLength(0);
  });
});
