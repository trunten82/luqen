import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { executeAnalyseReport, parseAnalyseReportResponse } from '../../src/capabilities/analyse-report.js';
import { buildAnalyseReportPrompt } from '../../src/prompts/analyse-report.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../src/capabilities/types.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';

const TEST_DB = '/tmp/llm-analyse-report-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const VALID_RESPONSE = JSON.stringify({
  executiveSummary: 'The site has 3 critical WCAG violations requiring immediate attention.',
  keyFindings: [
    'Missing alt text on 12 images',
    'Insufficient colour contrast on navigation',
    'Missing form labels',
  ],
  patterns: [
    'Alt text missing across all pages — systemic issue',
    'Colour contrast failures limited to nav component',
  ],
  priorities: [
    'Fix alt text (affects all pages, low effort)',
    'Fix form labels (medium effort)',
  ],
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

describe('executeAnalyseReport', () => {
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
      capabilities: ['analyse-report'],
    });
    modelId = model.id;
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  it('throws CapabilityNotConfiguredError when no model assigned to analyse-report', async () => {
    const emptyDb = new SqliteAdapter('/tmp/llm-analyse-report-empty-test.db');
    await emptyDb.initialize();

    const factory = vi.fn();

    await expect(
      executeAnalyseReport(
        emptyDb,
        factory,
        {
          siteUrl: 'https://example.com',
          totalIssues: 5,
          issuesList: [],
          complianceSummary: '',
          recurringPatterns: [],
          orgId: 'no-such-org',
        },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityNotConfiguredError);

    await emptyDb.close();
    if (existsSync('/tmp/llm-analyse-report-empty-test.db')) {
      unlinkSync('/tmp/llm-analyse-report-empty-test.db');
    }
  });

  it('returns { data: { executiveSummary, keyFindings, patterns, priorities }, model, provider, attempts } when LLM returns valid JSON', async () => {
    await db.assignCapability({ capability: 'analyse-report', modelId, priority: 1 });

    const adapter = makeAdapter([{ text: VALID_RESPONSE }]);
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeAnalyseReport(
      db,
      factory,
      {
        siteUrl: 'https://example.com',
        totalIssues: 3,
        issuesList: [
          { criterion: '1.1.1', message: 'Missing alt text', count: 12, level: 'error' },
        ],
        complianceSummary: 'Non-compliant',
        recurringPatterns: [],
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.data.executiveSummary).toBe('The site has 3 critical WCAG violations requiring immediate attention.');
    expect(result.data.keyFindings).toHaveLength(3);
    expect(result.data.patterns).toHaveLength(2);
    expect(result.data.priorities).toHaveLength(2);
    expect(result.model).toBe('Llama 3.2');
    expect(result.provider).toBe('Test Ollama');
    expect(result.attempts).toBe(1);
  });

  it('retries on error and throws CapabilityExhaustedError after all models exhausted', async () => {
    const allFailOrgId = 'analyse-report-all-fail-org';
    await db.assignCapability({ capability: 'analyse-report', modelId, priority: 1, orgId: allFailOrgId });

    const adapter = makeAdapter([
      new Error('fail 1'),
      new Error('fail 2'),
      new Error('fail 3'),
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    await expect(
      executeAnalyseReport(
        db,
        factory,
        {
          siteUrl: 'https://example.com',
          totalIssues: 3,
          issuesList: [],
          complianceSummary: '',
          recurringPatterns: [],
          orgId: allFailOrgId,
        },
        { maxRetries: 2, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityExhaustedError);
  });

  it('applies prompt override template when org override exists', async () => {
    const overrideOrgId = 'analyse-report-override-org';
    await db.assignCapability({ capability: 'analyse-report', modelId, priority: 1, orgId: overrideOrgId });
    await db.setPromptOverride(
      'analyse-report',
      'CUSTOM: {{siteUrl}} | {{totalIssues}} | {{issuesList}} | {{complianceSummary}} | {{recurringPatterns}}',
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

    await executeAnalyseReport(
      db,
      factory,
      {
        siteUrl: 'https://example.com',
        totalIssues: 5,
        issuesList: [{ criterion: '1.1.1', message: 'Missing alt text', count: 5, level: 'error' }],
        complianceSummary: 'Non-compliant',
        recurringPatterns: ['Alt text missing repeatedly'],
        orgId: overrideOrgId,
      },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedPrompt).toContain('CUSTOM:');
    expect(capturedPrompt).toContain('https://example.com');
    expect(capturedPrompt).toContain('5');
    expect(capturedPrompt).toContain('Missing alt text');
    expect(capturedPrompt).toContain('Non-compliant');
    expect(capturedPrompt).toContain('Alt text missing repeatedly');
  });
});

describe('parseAnalyseReportResponse', () => {
  it('returns safe defaults for malformed JSON', () => {
    const result = parseAnalyseReportResponse('not valid json {{{');
    expect(result.executiveSummary).toBe('');
    expect(result.keyFindings).toEqual([]);
    expect(result.patterns).toEqual([]);
    expect(result.priorities).toEqual([]);
  });

  it('returns parsed values for valid JSON', () => {
    const result = parseAnalyseReportResponse(VALID_RESPONSE);
    expect(result.executiveSummary).toBe('The site has 3 critical WCAG violations requiring immediate attention.');
    expect(result.keyFindings).toHaveLength(3);
  });
});

describe('buildAnalyseReportPrompt', () => {
  it('includes totalIssues and issuesList in the returned string', () => {
    const prompt = buildAnalyseReportPrompt({
      siteUrl: 'https://example.com',
      totalIssues: 10,
      issuesList: [
        { criterion: '1.1.1', message: 'Missing alt text', count: 5, level: 'error' },
        { criterion: '1.4.3', message: 'Insufficient contrast', count: 3, level: 'error' },
      ],
      complianceSummary: 'Non-compliant with WCAG 2.1 AA',
      recurringPatterns: [],
    });

    expect(prompt).toContain('10');
    expect(prompt).toContain('1.1.1');
    expect(prompt).toContain('Missing alt text');
    expect(prompt).toContain('https://example.com');
  });

  it('truncates issuesList to MAX_ISSUES_COUNT entries when given more than the limit', () => {
    const manyIssues = Array.from({ length: 50 }, (_, i) => ({
      criterion: `1.1.${i}`,
      message: `Issue ${i}`,
      count: i + 1,
      level: 'error',
    }));

    const prompt = buildAnalyseReportPrompt({
      siteUrl: 'https://example.com',
      totalIssues: 50,
      issuesList: manyIssues,
      complianceSummary: '',
      recurringPatterns: [],
    });

    // Should contain truncation notice since 50 > MAX_ISSUES_COUNT (30)
    expect(prompt).toContain('additional issues omitted');
    // Should contain the top 30 items (highest count = index 49..20)
    expect(prompt).toContain('Issue 49');
  });
});
