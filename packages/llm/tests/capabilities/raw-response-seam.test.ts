/**
 * HARNESS-06: the raw model response text is now carried on
 * `CapabilityResult<T>.rawText`, as a SIBLING of `data`, from both
 * `executeGenerateFix` and `executeAnalyseVisual`.
 *
 * Two concerns, two describe blocks:
 *
 *  1. `rawText` is populated correctly and separates a genuine model verdict
 *     from a parser-manufactured one (direct function calls — real db, real
 *     capability functions, a hand-built adapter, no mocking of the
 *     capability modules themselves).
 *
 *  2. `rawText` never reaches an HTTP or MCP response body. This is proven
 *     at the ARTIFACT (the actual response bytes over a real Fastify
 *     `app.inject` call and a real MCP `tools/call`), not by reading the
 *     source — a source grep would pass even if a route accidentally
 *     spread the whole `capResult`. To keep the REAL (unmocked)
 *     `executeGenerateFix`/`executeAnalyseVisual` in the loop for this
 *     proof, only `providers/registry.js`'s `createAdapter` is mocked, so a
 *     controllable fixture adapter is what the real capability functions
 *     call into.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import type { LLMProviderAdapter, CompletionResult } from '../../src/providers/types.js';

// Only the provider registry is mocked. executeGenerateFix/executeAnalyseVisual
// stay real everywhere in this file — including through the HTTP routes and
// the MCP tool handlers, both of which resolve their adapter via
// `createAdapter(provider.type)`.
vi.mock('../../src/providers/registry.js', () => ({
  createAdapter: vi.fn(),
  getSupportedTypes: vi.fn(() => ['ollama']),
}));

import { createAdapter } from '../../src/providers/registry.js';
import { executeGenerateFix } from '../../src/capabilities/generate-fix.js';
import { executeAnalyseVisual } from '../../src/capabilities/analyse-visual.js';

const mockCreateAdapter = vi.mocked(createAdapter);

function fixtureAdapterReturning(text: string): LLMProviderAdapter {
  return {
    type: 'fixture',
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => true,
    listModels: async () => [],
    complete: async (): Promise<CompletionResult> => ({
      text,
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

describe('raw-response seam (HARNESS-06)', () => {
  describe('rawText population — direct calls, real db, real parsers', () => {
    const TEST_DB = '/tmp/llm-raw-response-seam-direct-test.db';
    let db: SqliteAdapter;

    function cleanup(): void {
      if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    }

    beforeAll(async () => {
      cleanup();
      db = new SqliteAdapter(TEST_DB);
      await db.initialize();

      const provider = await db.createProvider({
        name: 'Direct Test Provider',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      const genFixModel = await db.createModel({
        providerId: provider.id,
        modelId: 'gen-fix-model',
        displayName: 'Gen Fix Model',
        capabilities: ['generate-fix'],
      });
      await db.assignCapability({ capability: 'generate-fix', modelId: genFixModel.id, priority: 0 });

      const visualModel = await db.createModel({
        providerId: provider.id,
        modelId: 'visual-model',
        displayName: 'Visual Model',
        capabilities: ['analyse-visual'],
      });
      await db.assignCapability({ capability: 'analyse-visual', modelId: visualModel.id, priority: 0 });
    });

    afterAll(async () => {
      await db.close();
      cleanup();
    });

    it('executeGenerateFix: rawText is byte-identical to the adapter text for a well-formed response', async () => {
      const wellFormed = JSON.stringify({
        fixedHtml: '<img src="photo.jpg" alt="A dog">',
        explanation: 'Added alt text per 1.1.1.',
        effort: 'low',
      });
      const adapter = fixtureAdapterReturning(wellFormed);

      const result = await executeGenerateFix(
        db,
        () => adapter,
        { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img src="photo.jpg">' },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      expect(result.rawText).toBe(wellFormed);
      expect(result.data.fixedHtml).toBe('<img src="photo.jpg" alt="A dog">');
    });

    it('executeGenerateFix: rawText is preserved unchanged for a MALFORMED response, even though the parsed data degrades to empty/medium', async () => {
      const malformed = 'the model rambled instead of returning JSON, sorry about that';
      const adapter = fixtureAdapterReturning(malformed);

      const result = await executeGenerateFix(
        db,
        () => adapter,
        { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img src="photo.jpg">' },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      // Degraded parse (generate-fix.ts's catch block).
      expect(result.data.fixedHtml).toBe('');
      expect(result.data.explanation).toBe('');
      expect(result.data.effort).toBe('medium');
      // The raw text is untouched by the degradation, and the two now disagree
      // in a way a caller can actually observe.
      expect(result.rawText).toBe(malformed);
      expect(result.rawText).not.toBe(result.data.fixedHtml);
    });

    it('executeAnalyseVisual: rawText is byte-identical to the adapter text for a well-formed response', async () => {
      const wellFormed = JSON.stringify({
        verdict: 'issue',
        findings: [{ description: 'Low contrast heading', wcagCriterion: '1.3.1', confidence: 'high' }],
      });
      const adapter = fixtureAdapterReturning(wellFormed);

      const result = await executeAnalyseVisual(
        db,
        () => adapter,
        { check: 'alt-text', image: { mediaType: 'image/png', data: 'AAAA' }, context: 'ctx' },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      expect(result.rawText).toBe(wellFormed);
      expect(result.data.verdict).toBe('issue');
    });

    it('executeAnalyseVisual: rawText separates a genuine clean pass from a parseable-but-verdict-less response that ALSO becomes "pass" (analyse-visual.ts:51-53, deliberately unmodified)', async () => {
      // Parses cleanly (valid JSON) but the model never asserted a verdict
      // and reported no findings. The production default at :51-53 computes
      // `findings.length > 0 ? 'issue' : 'pass'` — so this becomes 'pass',
      // structurally identical at the parsed layer to a genuine clean pass.
      // Only rawText tells them apart.
      const verdictLess = JSON.stringify({ findings: [] });
      const adapter = fixtureAdapterReturning(verdictLess);

      const result = await executeAnalyseVisual(
        db,
        () => adapter,
        { check: 'alt-text', image: { mediaType: 'image/png', data: 'AAAA' }, context: 'ctx' },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      // Measured, deliberately unmodified production behaviour — DO NOT fix.
      expect(result.data.verdict).toBe('pass');
      // rawText shows no verdict was ever present in the response.
      expect(result.rawText).toBe(verdictLess);
      expect(JSON.parse(result.rawText as string)).not.toHaveProperty('verdict');
    });
  });

  describe('non-leakage — HTTP and MCP payloads never carry rawText (runtime-observed, not source-inspected)', () => {
    const TEST_DB = '/tmp/llm-raw-response-seam-http-test.db';
    const SENTINEL = 'ZZ_RAWTEXT_SENTINEL_9f1c3a_DO_NOT_LEAK';
    // Not valid JSON — guarantees the sentinel can only surface via a leaked
    // rawText field, never via a parsed `data` field that happens to echo it.
    const SENTINEL_RESPONSE = `not-json ${SENTINEL} not-json`;

    let app: Awaited<ReturnType<typeof createServer>>;
    let readToken: string;

    function cleanup(): void {
      if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    }

    beforeAll(async () => {
      cleanup();
      const db = new SqliteAdapter(TEST_DB);
      await db.initialize();

      const provider = await db.createProvider({
        name: 'HTTP Test Provider',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      const genFixModel = await db.createModel({
        providerId: provider.id,
        modelId: 'gen-fix-model',
        displayName: 'Gen Fix Model',
        capabilities: ['generate-fix'],
      });
      await db.assignCapability({ capability: 'generate-fix', modelId: genFixModel.id, priority: 0 });

      const visualModel = await db.createModel({
        providerId: provider.id,
        modelId: 'visual-model',
        displayName: 'Visual Model',
        capabilities: ['analyse-visual'],
      });
      await db.assignCapability({ capability: 'analyse-visual', modelId: visualModel.id, priority: 0 });

      process.env['DASHBOARD_JWKS_URL'] = '';

      const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
      const privateKeyPem = await exportPKCS8(privateKey);
      const publicKeyPem = await exportSPKI(publicKey);
      const { createTokenVerifier } = await import('../../src/auth/oauth.js');
      const signToken = await createTokenSigner(privateKeyPem);
      const verifyToken = await createTokenVerifier(publicKeyPem);

      app = await createServer({ db, signToken, verifyToken, tokenExpiry: '1h', logger: false });
      await app.ready();

      readToken = await signToken({ sub: 'test-user', scopes: ['read'], expiresIn: '1h' });

      mockCreateAdapter.mockReturnValue(fixtureAdapterReturning(SENTINEL_RESPONSE));
    });

    afterAll(async () => {
      await app.close();
      cleanup();
    });

    it('POST /api/v1/generate-fix does not leak the sentinel rawText', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SENTINEL);
      const parsed = res.json() as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(parsed, 'rawText')).toBe(false);
    });

    it('POST /api/v1/analyse-visual does not leak the sentinel rawText', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-visual',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { check: 'alt-text', image: { mediaType: 'image/png', data: 'AAAA' }, context: 'ctx' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SENTINEL);
      const parsed = res.json() as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(parsed, 'rawText')).toBe(false);
    });

    function toolsCallPayload(name: string, args: Record<string, unknown>, id: number): unknown {
      return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
    }

    function parseSseOrJson(body: string): Record<string, unknown> {
      const trimmed = body.trim();
      if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
      const dataLine = trimmed
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
      if (dataLine == null) throw new Error(`No SSE data line in body: ${body}`);
      return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    }

    it('MCP llm_generate_fix tool payload does not leak the sentinel rawText', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          authorization: `Bearer ${readToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        payload: toolsCallPayload('llm_generate_fix', {
          wcagCriterion: '1.1.1',
          issueMessage: 'Missing alt text',
          htmlContext: '<img>',
        }, 11),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SENTINEL);
      const parsed = parseSseOrJson(res.body);
      const result = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
      const text = result?.content?.[0]?.text ?? '';
      expect(text).not.toContain(SENTINEL);
      const payload = JSON.parse(text) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(payload, 'rawText')).toBe(false);
    });

    it('MCP llm_analyse_visual tool payload does not leak the sentinel rawText', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          authorization: `Bearer ${readToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        payload: toolsCallPayload('llm_analyse_visual', {
          check: 'alt-text',
          imageBase64: 'AAAA',
          mediaType: 'image/png',
          context: 'ctx',
        }, 12),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SENTINEL);
      const parsed = parseSseOrJson(res.body);
      const result = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
      const text = result?.content?.[0]?.text ?? '';
      expect(text).not.toContain(SENTINEL);
      const payload = JSON.parse(text) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(payload, 'rawText')).toBe(false);
    });
  });
});
