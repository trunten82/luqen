import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import {
  executeAnalyseVisual,
  parseAnalyseVisualResponse,
} from '../../src/capabilities/analyse-visual.js';
import { CapabilityNotConfiguredError } from '../../src/capabilities/types.js';
import type { LLMProviderAdapter, CompletionOptions } from '../../src/providers/types.js';

const TEST_DB = '/tmp/llm-analyse-visual-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const PNG = { mediaType: 'image/png' as const, data: 'BASE64SCREENSHOT' };

function makeAdapter(
  responses: Array<{ text: string } | Error>,
  capturedOptions: CompletionOptions[],
): LLMProviderAdapter {
  let callIndex = 0;
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(async (_prompt: string, options: CompletionOptions) => {
      capturedOptions.push(options);
      const response = responses[callIndex];
      callIndex += 1;
      if (response instanceof Error) throw response;
      return { text: response.text, usage: { inputTokens: 80, outputTokens: 20 } };
    }),
  };
}

describe('parseAnalyseVisualResponse', () => {
  it('parses a heading-semantics issue verdict', () => {
    const text = JSON.stringify({
      verdict: 'issue',
      findings: [{ description: 'A styled div looks like an H2', wcagCriterion: '1.3.1', confidence: 'high' }],
    });
    const r = parseAnalyseVisualResponse(text, 'heading-semantics');
    expect(r.verdict).toBe('issue');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].wcagCriterion).toBe('1.3.1');
  });

  it('parses alt-text classification + suggested alt and strips markdown fences', () => {
    const text = '```json\n' + JSON.stringify({
      verdict: 'issue',
      altClassification: 'informational',
      suggestedAlt: 'Bar chart of 2025 revenue by region',
      findings: [{ description: 'Informational image missing alt', wcagCriterion: '1.1.1', confidence: 'medium' }],
    }) + '\n```';
    const r = parseAnalyseVisualResponse(text, 'alt-text');
    expect(r.altClassification).toBe('informational');
    expect(r.suggestedAlt).toBe('Bar chart of 2025 revenue by region');
  });

  it('returns uncertain verdict on unparseable text', () => {
    const r = parseAnalyseVisualResponse('the model rambled with no json', 'heading-semantics');
    expect(r.verdict).toBe('uncertain');
    expect(r.findings).toEqual([]);
  });
});

describe('executeAnalyseVisual', () => {
  let db: SqliteAdapter;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    await db.initialize();
    const provider = await db.createProvider({
      name: 'Test Vision', type: 'openai', baseUrl: 'https://api.openai.com', timeout: 30,
    });
    const model = await db.createModel({
      providerId: provider.id,
      modelId: 'gpt-4o',
      displayName: 'GPT-4o (vision)',
      capabilities: ['analyse-visual'],
    });
    await db.assignCapability({ capability: 'analyse-visual', modelId: model.id, priority: 1 });
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  it('passes the image through to the adapter via CompletionOptions.images', async () => {
    const captured: CompletionOptions[] = [];
    const adapter = makeAdapter([{ text: JSON.stringify({ verdict: 'pass', findings: [] }) }], captured);

    const result = await executeAnalyseVisual(
      db,
      () => adapter,
      { check: 'heading-semantics', image: PNG, context: '<div class="big">Section</div>', orgId: 'org-x' },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.data.verdict).toBe('pass');
    expect(captured[0].images).toEqual([PNG]);
  });

  it('throws CapabilityNotConfiguredError when no model assigned', async () => {
    const emptyDb = new SqliteAdapter('/tmp/llm-analyse-visual-empty.db');
    await emptyDb.initialize();
    await expect(
      executeAnalyseVisual(
        emptyDb,
        vi.fn(),
        { check: 'alt-text', image: PNG, context: 'x', orgId: 'no-org' },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(CapabilityNotConfiguredError);
    await emptyDb.close();
    if (existsSync('/tmp/llm-analyse-visual-empty.db')) unlinkSync('/tmp/llm-analyse-visual-empty.db');
  });
});
