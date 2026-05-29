/**
 * Phase 77 — summarizeUsage SQL aggregation.
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
  dbPath = join(tmpdir(), `llm-summary-${randomUUID()}.db`);
  adapter = new SqliteAdapter(dbPath);
  await adapter.initialize();
});

afterEach(async () => {
  await adapter.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

async function seed(): Promise<void> {
  await adapter.recordUsage({
    capability: 'generate-fix', orgId: 'org-a',
    providerId: 'p1', providerType: 'openai',
    modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini',
    promptTokens: 1000, completionTokens: 500, latencyMs: 500, status: 'ok',
  });
  await adapter.recordUsage({
    capability: 'generate-fix', orgId: 'org-a',
    providerId: 'p1', providerType: 'openai',
    modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini',
    promptTokens: 2000, completionTokens: 800, latencyMs: 700, status: 'ok',
  });
  await adapter.recordUsage({
    capability: 'analyse-report', orgId: 'org-a',
    providerId: 'p2', providerType: 'anthropic',
    modelId: 'claude-3.5-sonnet', modelName: 'Claude 3.5 Sonnet',
    promptTokens: 500, completionTokens: 1000, latencyMs: 1100, status: 'ok',
  });
  await adapter.recordUsage({
    capability: 'generate-fix', orgId: 'org-b',
    providerId: 'p1', providerType: 'openai',
    modelId: 'unknown-future-model', modelName: 'Mystery Model',
    promptTokens: 100, completionTokens: 50, latencyMs: 300, status: 'error',
    errorClass: 'RateLimitError',
  });
}

describe('summarizeUsage', () => {
  it('groups by capability and sums costs/tokens', async () => {
    await seed();
    const summary = await adapter.summarizeUsage({}, 'capability');
    const fix = summary.find((r) => r.key === 'generate-fix');
    const analyse = summary.find((r) => r.key === 'analyse-report');
    expect(fix).toBeDefined();
    expect(fix!.callCount).toBe(3);
    expect(fix!.okCount).toBe(2);
    expect(fix!.errorCount).toBe(1);
    expect(fix!.promptTokens).toBe(3100);
    expect(fix!.completionTokens).toBe(1350);
    expect(fix!.unpricedRows).toBe(1);
    expect(analyse!.callCount).toBe(1);
  });

  it('groups by model (denormalised modelName)', async () => {
    await seed();
    const summary = await adapter.summarizeUsage({}, 'model');
    const gpt = summary.find((r) => r.key === 'GPT-4o mini');
    expect(gpt).toBeDefined();
    expect(gpt!.callCount).toBe(2);
    expect(gpt!.totalTokens).toBe(4300);
  });

  it('groups by provider', async () => {
    await seed();
    const summary = await adapter.summarizeUsage({}, 'provider');
    const openai = summary.find((r) => r.key === 'openai');
    expect(openai!.callCount).toBe(3);
    const anthropic = summary.find((r) => r.key === 'anthropic');
    expect(anthropic!.callCount).toBe(1);
  });

  it('groups by org (and renders NULL/empty as `system`)', async () => {
    await seed();
    await adapter.recordUsage({
      capability: 'generate-fix',
      providerId: 'p1', providerType: 'openai',
      modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini',
      promptTokens: 10, completionTokens: 10, latencyMs: 100, status: 'ok',
    });
    const summary = await adapter.summarizeUsage({}, 'org');
    const system = summary.find((r) => r.key === 'system');
    expect(system).toBeDefined();
    expect(system!.callCount).toBe(1);
  });

  it('groups by day (YYYY-MM-DD prefix)', async () => {
    await seed();
    const summary = await adapter.summarizeUsage({}, 'day');
    // All four seed rows occurred today — one day key only.
    expect(summary).toHaveLength(1);
    expect(summary[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(summary[0].callCount).toBe(4);
  });

  it('honours the capability filter before aggregation', async () => {
    await seed();
    const summary = await adapter.summarizeUsage({ capability: 'generate-fix' }, 'provider');
    const openai = summary.find((r) => r.key === 'openai');
    expect(openai!.callCount).toBe(3);
    // Anthropic only has analyse-report rows; it should not appear.
    expect(summary.find((r) => r.key === 'anthropic')).toBeUndefined();
  });

  it('returns empty list when no rows match', async () => {
    const summary = await adapter.summarizeUsage({ orgId: 'nope' }, 'capability');
    expect(summary).toHaveLength(0);
  });
});
