import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { executeGenerateFix, parseGenerateFixResponse } from '../../src/capabilities/generate-fix.js';
import { buildGenerateFixPrompt } from '../../src/prompts/generate-fix.js';
import { parsePromptSegments } from '../../src/prompts/segments.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../src/capabilities/types.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';

const TEST_DB = '/tmp/llm-gen-fix-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const VALID_RESPONSE = JSON.stringify({
  fixedHtml: '<img src="photo.jpg" alt="Team photo">',
  explanation: 'Add descriptive alt text to convey the image purpose.',
  effort: 'low',
});

function makeAdapter(responses: Array<{ text: string } | Error>): LLMProviderAdapter {
  let callIndex = 0;
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(async () => {
      const response = responses[callIndex];
      callIndex += 1;
      if (response instanceof Error) {
        throw response;
      }
      return { text: response.text, usage: { inputTokens: 10, outputTokens: 50 } };
    }),
  };
}

describe('executeGenerateFix', () => {
  let db: SqliteAdapter;
  let providerId: string;
  let modelId: string;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    await db.initialize();

    const provider = await db.createProvider({
      name: 'Test Ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      timeout: 30,
    });
    providerId = provider.id;

    const model = await db.createModel({
      providerId,
      modelId: 'llama3.2',
      displayName: 'Llama 3.2',
      capabilities: ['generate-fix'],
    });
    modelId = model.id;
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  it('throws CapabilityNotConfiguredError when no model assigned to generate-fix', async () => {
    const emptyDb = new SqliteAdapter('/tmp/llm-gen-fix-empty-test.db');
    await emptyDb.initialize();

    const factory = vi.fn();

    await expect(
      executeGenerateFix(
        emptyDb,
        factory,
        {
          wcagCriterion: '1.1.1',
          issueMessage: 'Missing alt text',
          htmlContext: '<img src="photo.jpg">',
          orgId: 'no-such-org',
        },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityNotConfiguredError);

    await emptyDb.close();
    if (existsSync('/tmp/llm-gen-fix-empty-test.db')) unlinkSync('/tmp/llm-gen-fix-empty-test.db');
  });

  it('returns { data: { fixedHtml, explanation, effort }, model, provider, attempts } when LLM returns valid JSON', async () => {
    await db.assignCapability({ capability: 'generate-fix', modelId, priority: 1 });

    const adapter = makeAdapter([{ text: VALID_RESPONSE }]);
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeGenerateFix(
      db,
      factory,
      {
        wcagCriterion: '1.1.1',
        issueMessage: 'Missing alt text',
        htmlContext: '<img src="photo.jpg">',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.data.fixedHtml).toBe('<img src="photo.jpg" alt="Team photo">');
    expect(result.data.explanation).toBe('Add descriptive alt text to convey the image purpose.');
    expect(result.data.effort).toBe('low');
    expect(result.model).toBe('Llama 3.2');
    expect(result.provider).toBe('Test Ollama');
    expect(result.attempts).toBe(1);
  });

  it('retries on error and falls through to next model (CapabilityExhaustedError after all exhausted)', async () => {
    const allFailOrgId = 'gen-fix-all-fail-org';
    await db.assignCapability({ capability: 'generate-fix', modelId, priority: 1, orgId: allFailOrgId });

    const adapter = makeAdapter([
      new Error('fail 1'),
      new Error('fail 2'),
      new Error('fail 3'),
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    await expect(
      executeGenerateFix(
        db,
        factory,
        {
          wcagCriterion: '1.1.1',
          issueMessage: 'Missing alt text',
          htmlContext: '<img src="photo.jpg">',
          orgId: allFailOrgId,
        },
        { maxRetries: 2, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityExhaustedError);
  });

  it('uses prompt override template when org override exists', async () => {
    const overrideOrgId = 'gen-fix-override-org';
    await db.assignCapability({ capability: 'generate-fix', modelId, priority: 1, orgId: overrideOrgId });
    await db.setPromptOverride(
      'generate-fix',
      'CUSTOM: {{wcagCriterion}} | {{issueMessage}} | {{htmlContext}} | {{cssContext}}',
      overrideOrgId,
    );

    let capturedPrompt = '';
    const factory = vi.fn().mockReturnValue({
      type: 'mock',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      complete: vi.fn(async (prompt: string) => {
        capturedPrompt = prompt;
        return { text: VALID_RESPONSE, usage: { inputTokens: 10, outputTokens: 50 } };
      }),
    });

    await executeGenerateFix(
      db,
      factory,
      {
        wcagCriterion: '1.1.1',
        issueMessage: 'Missing alt text',
        htmlContext: '<img src="photo.jpg">',
        cssContext: 'img { display: block; }',
        orgId: overrideOrgId,
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedPrompt).toContain('CUSTOM:');
    expect(capturedPrompt).toContain('1.1.1');
    expect(capturedPrompt).toContain('Missing alt text');
    expect(capturedPrompt).toContain('<img src="photo.jpg">');
    expect(capturedPrompt).toContain('img { display: block; }');
  });
});

describe('parseGenerateFixResponse', () => {
  it('returns { fixedHtml: "", explanation: "", effort: "medium" } for malformed JSON (graceful fallback)', () => {
    const result = parseGenerateFixResponse('not valid json {{{');
    expect(result.fixedHtml).toBe('');
    expect(result.explanation).toBe('');
    expect(result.effort).toBe('medium');
  });

  it('returns parsed values for valid JSON', () => {
    const result = parseGenerateFixResponse(VALID_RESPONSE);
    expect(result.fixedHtml).toBe('<img src="photo.jpg" alt="Team photo">');
    expect(result.effort).toBe('low');
  });
});

describe('buildGenerateFixPrompt', () => {
  it('includes wcagCriterion, issueMessage, and htmlContext in the returned string', () => {
    const prompt = buildGenerateFixPrompt({
      wcagCriterion: '1.4.3',
      issueMessage: 'Insufficient color contrast',
      htmlContext: '<p style="color: #aaa;">Light text</p>',
    });

    expect(prompt).toContain('1.4.3');
    expect(prompt).toContain('Insufficient color contrast');
    expect(prompt).toContain('<p style="color: #aaa;">Light text</p>');
  });

  it('contains output-format and variable-injection fence markers', () => {
    const prompt = buildGenerateFixPrompt({
      wcagCriterion: '1.1.1',
      issueMessage: 'Missing alt text',
      htmlContext: '<img src="test.jpg">',
    });

    expect(prompt).toContain('<!-- LOCKED:output-format -->');
    expect(prompt).toContain('<!-- LOCKED:variable-injection -->');
    expect(prompt).toContain('<!-- /LOCKED -->');
  });

  it('has at least 2 locked segments when parsed', () => {
    const prompt = buildGenerateFixPrompt({
      wcagCriterion: '1.1.1',
      issueMessage: 'Missing alt text',
      htmlContext: '<img src="test.jpg">',
    });

    const segments = parsePromptSegments(prompt);
    const lockedCount = segments.filter((s) => s.type === 'locked').length;
    expect(lockedCount).toBeGreaterThanOrEqual(2);
  });
});
