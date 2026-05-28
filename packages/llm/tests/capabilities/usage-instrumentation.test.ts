/**
 * Phase 72-02 — Capability usage instrumentation.
 *
 * Asserts each capability records exactly one usage row per provider
 * call attempt, success or error.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { executeGenerateFix } from '../../src/capabilities/generate-fix.js';
import { executeAnalyseReport } from '../../src/capabilities/analyse-report.js';
import { executeExtractRequirements } from '../../src/capabilities/extract-requirements.js';
import { executeDiscoverBranding } from '../../src/capabilities/discover-branding.js';
import { executeAgentConversation } from '../../src/capabilities/agent-conversation.js';
import type { LLMProviderAdapter, CompletionResult, StreamFrame } from '../../src/providers/types.js';

let adapter: SqliteAdapter;
let dbPath: string;
let providerId: string;
let modelId: string;

function makeProviderAdapter(opts: {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  throwError?: Error;
  streamFrames?: StreamFrame[];
}): LLMProviderAdapter {
  return {
    type: 'openai',
    async connect() {},
    async disconnect() {},
    async healthCheck() { return true; },
    async listModels() { return []; },
    async complete(): Promise<CompletionResult> {
      if (opts.throwError) throw opts.throwError;
      return {
        text: opts.text ?? '{}',
        usage: {
          inputTokens: opts.inputTokens ?? 100,
          outputTokens: opts.outputTokens ?? 50,
        },
      };
    },
    async *completeStream(): AsyncIterable<StreamFrame> {
      if (opts.streamFrames) {
        for (const f of opts.streamFrames) yield f;
      }
    },
  };
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `llm-usage-cap-${randomUUID()}.db`);
  adapter = new SqliteAdapter(dbPath);
  await adapter.initialize();
  // Seed a provider + model + capability assignment for every capability.
  const provider = await adapter.createProvider({
    name: 'TestOpenAI',
    type: 'openai',
    baseUrl: 'http://test',
    apiKey: 'sk-test',
  });
  providerId = provider.id;
  const model = await adapter.createModel({
    providerId,
    modelId: 'gpt-4o-mini',
    displayName: 'Test GPT-4o mini',
    capabilities: [],
  });
  modelId = model.id;
  const caps = [
    'generate-fix', 'extract-requirements', 'analyse-report',
    'discover-branding', 'agent-conversation', 'generate-notification-content',
  ] as const;
  for (const c of caps) {
    await adapter.assignCapability({ capability: c, modelId, priority: 0 });
  }
});

afterEach(async () => {
  await adapter.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('generate-fix records usage', () => {
  it('writes one ok row with correct token counts', async () => {
    const fakeAdapter = makeProviderAdapter({
      text: '{"fixedHtml":"<p>fixed</p>","explanation":"e","effort":"low"}',
      inputTokens: 200, outputTokens: 80,
    });
    await executeGenerateFix(
      adapter,
      () => fakeAdapter,
      {
        wcagCriterion: '1.1.1', issueMessage: 'missing alt',
        htmlContext: '<img>', orgId: 'org-1',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('generate-fix');
    expect(rows[0].orgId).toBe('org-1');
    expect(rows[0].providerId).toBe(providerId);
    expect(rows[0].modelId).toBe(modelId);
    expect(rows[0].promptTokens).toBe(200);
    expect(rows[0].completionTokens).toBe(80);
    expect(rows[0].totalTokens).toBe(280);
    expect(rows[0].status).toBe('ok');
  });

  it('writes error rows for failing attempts', async () => {
    const fakeAdapter = makeProviderAdapter({ throwError: new TypeError('boom') });
    await expect(
      executeGenerateFix(
        adapter,
        () => fakeAdapter,
        { wcagCriterion: '1.1.1', issueMessage: 'x', htmlContext: '<x>', orgId: 'org-1' },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow();
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].errorClass).toBe('TypeError');
    expect(rows[0].promptTokens).toBe(0);
    expect(rows[0].completionTokens).toBe(0);
  });
});

describe('analyse-report records usage', () => {
  it('writes one ok row', async () => {
    const fakeAdapter = makeProviderAdapter({
      text: '{"keyFindings":["a"],"recommendations":["b"],"riskSummary":"r"}',
      inputTokens: 500, outputTokens: 200,
    });
    await executeAnalyseReport(
      adapter,
      () => fakeAdapter,
      {
        siteUrl: 'https://example.com',
        totalIssues: 5,
        issuesList: [],
        complianceSummary: 's',
        recurringPatterns: [],
        orgId: 'org-1',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('analyse-report');
    expect(rows[0].totalTokens).toBe(700);
  });
});

describe('extract-requirements records usage', () => {
  it('writes one ok row', async () => {
    const fakeAdapter = makeProviderAdapter({
      text: '[]',
      inputTokens: 300, outputTokens: 10,
    });
    await executeExtractRequirements(
      adapter,
      () => fakeAdapter,
      {
        content: 'reg text',
        regulationId: 'r1',
        regulationName: 'R1',
        jurisdictionId: 'EU',
        orgId: 'org-1',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('extract-requirements');
    expect(rows[0].promptTokens).toBe(300);
  });
});

describe('agent-conversation records usage', () => {
  it('writes one ok row from done frame', async () => {
    const fakeAdapter = makeProviderAdapter({
      streamFrames: [
        { type: 'token', text: 'hello' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 25 } },
      ],
    });
    const iter = executeAgentConversation(
      adapter,
      () => fakeAdapter,
      {
        orgId: 'org-1',
        userId: 'u1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        agentDisplayName: 'TestBot',
      },
    );
    for await (const _frame of iter) { /* drain */ }
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('agent-conversation');
    expect(rows[0].promptTokens).toBe(50);
    expect(rows[0].completionTokens).toBe(25);
    expect(rows[0].status).toBe('ok');
  });

  it('writes an error row when stream-open fails', async () => {
    const fakeAdapter: LLMProviderAdapter = {
      type: 'openai',
      async connect() { throw new Error('connect refused'); },
      async disconnect() {},
      async healthCheck() { return true; },
      async listModels() { return []; },
      async complete() { throw new Error('n/a'); },
      async *completeStream(): AsyncIterable<StreamFrame> {},
    };
    const iter = executeAgentConversation(
      adapter,
      () => fakeAdapter,
      {
        orgId: 'org-1',
        userId: 'u1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        agentDisplayName: 'TestBot',
      },
    );
    await expect(async () => { for await (const _f of iter) { /* */ } }).rejects.toThrow();
    const rows = await adapter.listUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].errorClass).toBe('Error');
  });
});

describe('discover-branding records usage', () => {
  it('writes one ok row', async () => {
    const fakeAdapter = makeProviderAdapter({
      text: '{"brandName":"Test","colors":[],"fonts":[],"voice":""}',
      inputTokens: 1000, outputTokens: 50,
    });
    await executeDiscoverBranding(
      adapter,
      () => fakeAdapter,
      {
        url: 'https://example.com',
        htmlContent: '<html><body>hi</body></html>',
        cssContent: '',
        orgId: 'org-1',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );
    const rows = await adapter.listUsage();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const llmRow = rows.find((r) => r.capability === 'discover-branding');
    expect(llmRow).toBeDefined();
    expect(llmRow!.promptTokens).toBe(1000);
  });
});
