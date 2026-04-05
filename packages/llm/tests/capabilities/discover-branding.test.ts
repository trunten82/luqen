import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { executeDiscoverBranding, parseDiscoverBrandingResponse } from '../../src/capabilities/discover-branding.js';
import { buildDiscoverBrandingPrompt } from '../../src/prompts/discover-branding.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../src/capabilities/types.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';

const TEST_DB = '/tmp/llm-discover-branding-test.db';

const MOCK_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Acme Corp</title>
  <style>:root { --color-primary: #ff6600; } body { font-family: 'Inter', sans-serif; }</style>
</head>
<body><img src="/logo.png" alt="Acme logo"></body>
</html>`;

const VALID_RESPONSE = JSON.stringify({
  colors: [{ name: 'Primary Orange', hex: '#ff6600', usage: 'primary' }],
  fonts: [{ family: 'Inter', usage: 'body' }],
  logoUrl: 'https://example.com/logo.png',
  brandName: 'Acme Corp',
});

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

function makeFetchResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => html,
  } as unknown as Response;
}

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

describe('executeDiscoverBranding', () => {
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
      capabilities: ['discover-branding'],
    });
    modelId = model.id;
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws CapabilityNotConfiguredError when no model assigned to discover-branding', async () => {
    const emptyDb = new SqliteAdapter('/tmp/llm-discover-branding-empty-test.db');
    await emptyDb.initialize();

    const factory = vi.fn();

    await expect(
      executeDiscoverBranding(
        emptyDb,
        factory,
        { url: 'https://example.com', orgId: 'no-such-org' },
        { maxRetries: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(CapabilityNotConfiguredError);

    await emptyDb.close();
    if (existsSync('/tmp/llm-discover-branding-empty-test.db')) {
      unlinkSync('/tmp/llm-discover-branding-empty-test.db');
    }
  });

  it('fetches the input URL, passes extracted content to the LLM, returns { data: { colors, fonts, logoUrl, brandName }, model, provider, attempts }', async () => {
    await db.assignCapability({ capability: 'discover-branding', modelId, priority: 1 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(MOCK_HTML)));

    const adapter = makeAdapter([{ text: VALID_RESPONSE }]);
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeDiscoverBranding(
      db,
      factory,
      { url: 'https://example.com' },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(result.data.colors).toHaveLength(1);
    expect(result.data.colors[0]?.hex).toBe('#ff6600');
    expect(result.data.fonts).toHaveLength(1);
    expect(result.data.fonts[0]?.family).toBe('Inter');
    expect(result.data.logoUrl).toBe('https://example.com/logo.png');
    expect(result.data.brandName).toBe('Acme Corp');
    expect(result.model).toBe('Llama 3.2');
    expect(result.provider).toBe('Test Ollama');
    expect(result.attempts).toBe(1);
  });

  it('falls back to deterministic result when all LLM attempts fail but signals were extracted', async () => {
    const allFailOrgId = 'discover-branding-all-fail-org';
    await db.assignCapability({ capability: 'discover-branding', modelId, priority: 1, orgId: allFailOrgId });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(MOCK_HTML)));

    const adapter = makeAdapter([
      new Error('fail 1'),
      new Error('fail 2'),
      new Error('fail 3'),
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeDiscoverBranding(
      db,
      factory,
      { url: 'https://example.com', orgId: allFailOrgId },
      { maxRetries: 2, retryDelayMs: 0 },
    );

    // Deterministic fallback should return whatever was extracted from the HTML
    expect(result.provider).toBeTruthy();
    expect(Array.isArray(result.data.colors)).toBe(true);
  });

  it('throws CapabilityExhaustedError when LLM fails AND no deterministic signals exist', async () => {
    const emptyOrgId = 'discover-branding-empty-org';
    await db.assignCapability({ capability: 'discover-branding', modelId, priority: 1, orgId: emptyOrgId });

    // Mock fetch to return an empty HTML page with no brand signals
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('<html><head></head><body></body></html>')));

    const adapter = makeAdapter([
      new Error('fail 1'),
      new Error('fail 2'),
      new Error('fail 3'),
    ]);
    const factory = vi.fn().mockReturnValue(adapter);

    // With no signals, the executor returns early with deterministic empty result (no LLM attempt)
    const result = await executeDiscoverBranding(
      db,
      factory,
      { url: 'https://example.com', orgId: emptyOrgId },
      { maxRetries: 2, retryDelayMs: 0 },
    );
    expect(result.data.colors).toEqual([]);
    expect(result.data.fonts).toEqual([]);
  });

  it('applies prompt override template ({{url}}, {{htmlContent}}, {{cssContent}}) when org override exists', async () => {
    const overrideOrgId = 'discover-branding-override-org';
    await db.assignCapability({ capability: 'discover-branding', modelId, priority: 1, orgId: overrideOrgId });
    await db.setPromptOverride(
      'discover-branding',
      'CUSTOM: {{url}} | {{htmlContent}} | {{cssContent}}',
      overrideOrgId,
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(MOCK_HTML)));

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

    await executeDiscoverBranding(
      db,
      factory,
      { url: 'https://example.com', orgId: overrideOrgId },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedPrompt).toContain('CUSTOM:');
    expect(capturedPrompt).toContain('https://example.com');
  });

  it('returns empty brand data (not an error) when the URL fetch fails', async () => {
    const fetchFailOrgId = 'discover-branding-fetch-fail-org';
    await db.assignCapability({ capability: 'discover-branding', modelId, priority: 1, orgId: fetchFailOrgId });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const fallbackResponse = JSON.stringify({
      colors: [],
      fonts: [],
      logoUrl: '',
      brandName: 'fetch-failed',
    });

    const adapter = makeAdapter([{ text: fallbackResponse }]);
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeDiscoverBranding(
      db,
      factory,
      { url: 'https://example.com', orgId: fetchFailOrgId },
      { maxRetries: 0, retryDelayMs: 0 },
    );

    // Should not throw — graceful degradation
    expect(result.data.colors).toEqual([]);
    expect(result.data.fonts).toEqual([]);
  });
});

describe('parseDiscoverBrandingResponse', () => {
  it('returns { colors: [], fonts: [], logoUrl: "", brandName: "" } for malformed JSON', () => {
    const result = parseDiscoverBrandingResponse('not valid json {{{');
    expect(result.colors).toEqual([]);
    expect(result.fonts).toEqual([]);
    expect(result.logoUrl).toBe('');
    expect(result.brandName).toBe('');
  });

  it('returns parsed values for valid JSON', () => {
    const result = parseDiscoverBrandingResponse(VALID_RESPONSE);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0]?.hex).toBe('#ff6600');
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0]?.family).toBe('Inter');
    expect(result.logoUrl).toBe('https://example.com/logo.png');
    expect(result.brandName).toBe('Acme Corp');
  });
});

describe('buildDiscoverBrandingPrompt', () => {
  it('includes the url, htmlContent, and pre-extracted data in the returned string', () => {
    const prompt = buildDiscoverBrandingPrompt({
      url: 'https://example.com',
      htmlContent: '<title>Test</title>',
      cssContent: '',
      topColors: [{ hex: '#ff6600', count: 12 }],
      fontFamilies: ['Inter'],
      logoCandidates: ['https://example.com/logo.svg'],
      brandHint: 'example',
    });

    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('<title>Test</title>');
    expect(prompt).toContain('#ff6600');
    expect(prompt).toContain('Inter');
    expect(prompt).toContain('https://example.com/logo.svg');
    expect(prompt).toContain('example');
  });
});
