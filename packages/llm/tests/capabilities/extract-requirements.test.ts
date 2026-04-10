import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { executeExtractRequirements } from '../../src/capabilities/extract-requirements.js';
import { buildExtractionPrompt } from '../../src/prompts/extract-requirements.js';
import { parsePromptSegments } from '../../src/prompts/segments.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../src/capabilities/types.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'llm-cap-exec-test-'));
const TEST_DB = join(TEST_DIR, 'test.db');

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const VALID_RESPONSE = JSON.stringify({
  wcagVersion: '2.1',
  wcagLevel: 'AA',
  criteria: [{ criterion: '1.1.1', obligation: 'mandatory' }],
  confidence: 0.9,
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

describe('executeExtractRequirements', () => {
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
      capabilities: ['extract-requirements'],
    });
    modelId = model.id;
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  it('executes successfully with assigned model', async () => {
    // orgId defaults to '' in the DB when not specified
    await db.assignCapability({ capability: 'extract-requirements', modelId, priority: 1 });

    const adapter = makeAdapter([{ text: VALID_RESPONSE }]);
    const factory = vi.fn().mockReturnValue(adapter);

    // No orgId passed → getModelsForCapability uses '' (system scope)
    const result = await executeExtractRequirements(
      db,
      factory,
      {
        content: 'Test accessibility regulation content',
        regulationId: 'REG-001',
        regulationName: 'Test Regulation',
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.data.wcagVersion).toBe('2.1');
    expect(result.data.wcagLevel).toBe('AA');
    expect(result.data.criteria).toHaveLength(1);
    expect(result.model).toBe('Llama 3.2');
    expect(result.provider).toBe('Test Ollama');
    expect(result.attempts).toBe(1);
  });

  it('throws CapabilityNotConfiguredError when no model assigned', async () => {
    // Use a fresh db with no assignments for this capability+orgId combo
    const emptyDb = new SqliteAdapter('/tmp/llm-cap-exec-empty-test.db');
    await emptyDb.initialize();

    const factory = vi.fn();

    await expect(
      executeExtractRequirements(
        emptyDb,
        factory,
        {
          content: 'content',
          regulationId: 'REG-001',
          regulationName: 'Test',
          orgId: 'no-such-org',
        },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityNotConfiguredError);

    await emptyDb.close();
    if (existsSync('/tmp/llm-cap-exec-empty-test.db')) unlinkSync('/tmp/llm-cap-exec-empty-test.db');
  });

  it('retries on failure and succeeds', async () => {
    const adapter = makeAdapter([
      new Error('transient error'),
      { text: VALID_RESPONSE },
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    // Relies on the assignment from the previous test (system scope, no orgId)
    const result = await executeExtractRequirements(
      db,
      factory,
      {
        content: 'Retry test content',
        regulationId: 'REG-002',
        regulationName: 'Retry Regulation',
      },
      { maxRetries: 2, retryDelayMs: 0 },
    );

    expect(result.data.wcagVersion).toBe('2.1');
    expect(result.attempts).toBe(2);
  });

  it('falls through to next priority model', async () => {
    // Create a second provider and model
    const provider2 = await db.createProvider({
      name: 'Fallback Ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11435',
      timeout: 30,
    });
    const model2 = await db.createModel({
      providerId: provider2.id,
      modelId: 'mistral',
      displayName: 'Mistral',
      capabilities: ['extract-requirements'],
    });

    const fallbackOrgId = 'fallback-test-org';
    await db.assignCapability({ capability: 'extract-requirements', modelId, priority: 1, orgId: fallbackOrgId });
    await db.assignCapability({ capability: 'extract-requirements', modelId: model2.id, priority: 2, orgId: fallbackOrgId });


    let callCount = 0;
    const factory = vi.fn().mockImplementation(() => ({
      type: 'mock',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      complete: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          // First model always fails
          throw new Error('primary model unavailable');
        }
        // Second model succeeds
        return { text: VALID_RESPONSE, usage: { inputTokens: 10, outputTokens: 50 } };
      }),
    }));

    const result = await executeExtractRequirements(
      db,
      factory,
      { content: 'content', regulationId: 'REG-003', regulationName: 'Test', orgId: fallbackOrgId },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.model).toBe('Mistral');
    expect(result.provider).toBe('Fallback Ollama');
  });

  it('throws CapabilityExhaustedError when all models fail', async () => {
    const allFailOrgId = 'all-fail-org';
    await db.assignCapability({ capability: 'extract-requirements', modelId, priority: 1, orgId: allFailOrgId });

    const adapter = makeAdapter([
      new Error('fail 1'),
      new Error('fail 2'),
      new Error('fail 3'),
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    await expect(
      executeExtractRequirements(
        db,
        factory,
        { content: 'content', regulationId: 'REG-004', regulationName: 'Test', orgId: allFailOrgId },
        { maxRetries: 2, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityExhaustedError);
  });

  it('uses prompt override when available', async () => {
    const overrideOrgId = 'override-org';
    await db.assignCapability({ capability: 'extract-requirements', modelId, priority: 1, orgId: overrideOrgId });
    await db.setPromptOverride(
      'extract-requirements',
      'CUSTOM TEMPLATE: {content} for regulation {regulationId} named {regulationName}',
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

    await executeExtractRequirements(
      db,
      factory,
      {
        content: 'my content here',
        regulationId: 'REG-OVERRIDE',
        regulationName: 'Override Test',
        orgId: overrideOrgId,
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedPrompt).toContain('CUSTOM TEMPLATE:');
    expect(capturedPrompt).toContain('my content here');
    expect(capturedPrompt).toContain('REG-OVERRIDE');
    expect(capturedPrompt).toContain('Override Test');
  });
});

describe('buildExtractionPrompt', () => {
  it('contains output-format and variable-injection fence markers', () => {
    const prompt = buildExtractionPrompt('sample regulation content', {
      regulationId: 'REG-001',
      regulationName: 'Test Regulation',
    });

    expect(prompt).toContain('<!-- LOCKED:output-format -->');
    expect(prompt).toContain('<!-- LOCKED:variable-injection -->');
    expect(prompt).toContain('<!-- /LOCKED -->');
  });

  it('has at least 2 locked segments when parsed', () => {
    const prompt = buildExtractionPrompt('sample content', {
      regulationId: 'REG-001',
      regulationName: 'Test Regulation',
    });

    const segments = parsePromptSegments(prompt);
    const lockedCount = segments.filter((s) => s.type === 'locked').length;
    expect(lockedCount).toBeGreaterThanOrEqual(2);
  });
});
