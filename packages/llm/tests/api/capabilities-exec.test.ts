import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../src/capabilities/types.js';

// Mock all four capability executor modules
vi.mock('../../src/capabilities/generate-fix.js', () => ({
  executeGenerateFix: vi.fn(),
}));

vi.mock('../../src/capabilities/analyse-report.js', () => ({
  executeAnalyseReport: vi.fn(),
}));

vi.mock('../../src/capabilities/discover-branding.js', () => ({
  executeDiscoverBranding: vi.fn(),
}));

vi.mock('../../src/capabilities/extract-requirements.js', () => ({
  executeExtractRequirements: vi.fn(),
}));

// Import after mocking
import { executeGenerateFix } from '../../src/capabilities/generate-fix.js';
import { executeAnalyseReport } from '../../src/capabilities/analyse-report.js';
import { executeDiscoverBranding } from '../../src/capabilities/discover-branding.js';
import { executeExtractRequirements } from '../../src/capabilities/extract-requirements.js';

const mockGenerateFix = vi.mocked(executeGenerateFix);
const mockAnalyseReport = vi.mocked(executeAnalyseReport);
const mockDiscoverBranding = vi.mocked(executeDiscoverBranding);
const mockExtractRequirements = vi.mocked(executeExtractRequirements);

const TEST_DB = '/tmp/llm-cap-exec-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Capability Exec Routes', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let readToken: string;

  beforeAll(async () => {
    cleanup();
    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });

    await app.ready();

    readToken = await signToken({
      sub: 'test-user',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // ---- generate-fix ----

  describe('POST /api/v1/generate-fix', () => {
    it('returns 400 when wcagCriterion is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/wcagCriterion/);
    });

    it('returns 400 when issueMessage is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/issueMessage/);
    });

    it('returns 400 when htmlContext is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/htmlContext/);
    });

    it('returns 503 when capability not configured (CapabilityNotConfiguredError)', async () => {
      mockGenerateFix.mockRejectedValueOnce(new CapabilityNotConfiguredError('generate-fix'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 504 when all models exhausted (CapabilityExhaustedError)', async () => {
      mockGenerateFix.mockRejectedValueOnce(new CapabilityExhaustedError('generate-fix', 2));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(504);
    });

    it('returns 502 on upstream error', async () => {
      mockGenerateFix.mockRejectedValueOnce(new Error('Upstream failure'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(502);
    });

    it('returns 200 with fixedHtml/explanation/effort on success', async () => {
      mockGenerateFix.mockResolvedValueOnce({
        data: { fixedHtml: '<img alt="photo">', explanation: 'Add alt text', effort: 'low' },
        model: 'llama3.2',
        provider: 'Ollama',
        attempts: 1,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generate-fix',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { wcagCriterion: '1.1.1', issueMessage: 'Missing alt text', htmlContext: '<img>' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ fixedHtml: string; explanation: string; effort: string; model: string }>();
      expect(body.fixedHtml).toBe('<img alt="photo">');
      expect(body.explanation).toBe('Add alt text');
      expect(body.effort).toBe('low');
      expect(body.model).toBe('llama3.2');
    });
  });

  // ---- analyse-report ----

  describe('POST /api/v1/analyse-report', () => {
    it('returns 400 when siteUrl is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { totalIssues: 5, issuesList: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/siteUrl/);
    });

    it('returns 400 when totalIssues is not a number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { siteUrl: 'https://example.com', totalIssues: 'bad', issuesList: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/totalIssues/);
    });

    it('returns 400 when issuesList is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { siteUrl: 'https://example.com', totalIssues: 5 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/issuesList/);
    });

    it('returns 503 when capability not configured', async () => {
      mockAnalyseReport.mockRejectedValueOnce(new CapabilityNotConfiguredError('analyse-report'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { siteUrl: 'https://example.com', totalIssues: 5, issuesList: [] },
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 504 when all models exhausted', async () => {
      mockAnalyseReport.mockRejectedValueOnce(new CapabilityExhaustedError('analyse-report', 1));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { siteUrl: 'https://example.com', totalIssues: 5, issuesList: [] },
      });
      expect(res.statusCode).toBe(504);
    });

    it('returns 200 with summary/findings/priorities on success', async () => {
      mockAnalyseReport.mockResolvedValueOnce({
        data: { summary: 'Good site', findings: [], priorities: [] },
        model: 'gpt-4o',
        provider: 'OpenAI',
        attempts: 1,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/analyse-report',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { siteUrl: 'https://example.com', totalIssues: 5, issuesList: [] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ summary: string }>();
      expect(body.summary).toBe('Good site');
    });
  });

  // ---- discover-branding ----

  describe('POST /api/v1/discover-branding', () => {
    it('returns 400 when url is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/discover-branding',
        headers: { authorization: `Bearer ${readToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/url/);
    });

    it('returns 400 when url is not http/https', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/discover-branding',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { url: 'ftp://example.com' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/http/);
    });

    it('returns 503 when capability not configured', async () => {
      mockDiscoverBranding.mockRejectedValueOnce(new CapabilityNotConfiguredError('discover-branding'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/discover-branding',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 504 when all models exhausted', async () => {
      mockDiscoverBranding.mockRejectedValueOnce(new CapabilityExhaustedError('discover-branding', 1));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/discover-branding',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(504);
    });

    it('returns 200 with colors/fonts on success', async () => {
      mockDiscoverBranding.mockResolvedValueOnce({
        data: { colors: ['#ff0000'], fonts: ['Arial'] },
        model: 'llama3.2',
        provider: 'Ollama',
        attempts: 1,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/discover-branding',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ colors: string[]; fonts: string[] }>();
      expect(body.colors).toContain('#ff0000');
      expect(body.fonts).toContain('Arial');
    });
  });

  // ---- extract-requirements ----

  describe('POST /api/v1/extract-requirements', () => {
    it('returns 400 when content is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { regulationId: 'WCAG21', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/content/);
    });

    it('returns 400 when regulationId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/regulationId/);
    });

    it('returns 400 when regulationName is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationId: 'WCAG21' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/regulationName/);
    });

    it('returns 503 when capability not configured', async () => {
      mockExtractRequirements.mockRejectedValueOnce(new CapabilityNotConfiguredError('extract-requirements'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationId: 'WCAG21', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 504 when all models exhausted', async () => {
      mockExtractRequirements.mockRejectedValueOnce(new CapabilityExhaustedError('extract-requirements', 1));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationId: 'WCAG21', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(504);
    });

    it('returns 502 on upstream error', async () => {
      mockExtractRequirements.mockRejectedValueOnce(new Error('LLM timeout'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationId: 'WCAG21', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(502);
    });

    it('returns 200 with requirements array on success', async () => {
      mockExtractRequirements.mockResolvedValueOnce({
        data: {
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          criteria: [{ criterion: '1.1.1', obligation: 'mandatory' }],
          confidence: 0.95,
        },
        model: 'llama3.2',
        provider: 'Ollama',
        attempts: 1,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/extract-requirements',
        headers: { authorization: `Bearer ${readToken}` },
        payload: { content: 'Some text', regulationId: 'WCAG21', regulationName: 'WCAG 2.1' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ wcagVersion: string; criteria: unknown[] }>();
      expect(body.wcagVersion).toBe('2.1');
      expect(Array.isArray(body.criteria)).toBe(true);
    });
  });
});
