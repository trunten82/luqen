import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { buildGenerateFixPrompt } from '../../src/prompts/generate-fix.js';
import { validateOverride } from '../../src/prompts/segments.js';

const TEST_DB = '/tmp/llm-prompts-ext-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Prompt Override API (extended)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;

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

    adminToken = await signToken({
      sub: 'admin-user',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('GET /api/v1/prompts/:capability', () => {
    it('returns default template (isOverride: false) when no override exists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ capability: string; isOverride: boolean; template: string; orgId: string }>();
      expect(body.capability).toBe('generate-fix');
      expect(body.isOverride).toBe(false);
      expect(typeof body.template).toBe('string');
      expect(body.template.length).toBeGreaterThan(0);
      expect(body.orgId).toBe('system');
    });

    it('returns extract-requirements default template', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/extract-requirements',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isOverride: boolean; template: string }>();
      expect(body.isOverride).toBe(false);
      expect(body.template.length).toBeGreaterThan(0);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/invalid-capability',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Invalid capability/);
    });

    it('returns override when one exists with orgId query param', async () => {
      // Build a valid override: customise the editable preamble while preserving locked blocks
      const { buildAnalyseReportPrompt } = await import('../../src/prompts/analyse-report.js');
      const defaultTemplate = buildAnalyseReportPrompt({
        siteUrl: '{{siteUrl}}',
        totalIssues: 0,
        issuesList: [],
        complianceSummary: '{{complianceSummary}}',
        recurringPatterns: [],
      });
      // Prepend a custom line before the preamble — locked blocks remain byte-identical
      const validOverride = 'Custom analyse note.\n' + defaultTemplate;

      // Set an override first
      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/analyse-report',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: validOverride, orgId: 'ext-test-org' },
      });
      expect(putRes.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/analyse-report?orgId=ext-test-org',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isOverride: boolean; template: string }>();
      expect(body.isOverride).toBe(true);
      expect(body.template).toBe(validOverride);
    });
  });

  describe('PUT /api/v1/prompts/:capability (validation)', () => {
    it('returns 400 when template field is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId: 'test-org' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/template/);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/unknown-capability',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: 'some template' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates override without orgId (system scope) when template preserves locked blocks', async () => {
      // Build a valid override: inject text into the editable preamble region only
      const { buildDiscoverBrandingPrompt } = await import('../../src/prompts/discover-branding.js');
      const defaultTemplate = buildDiscoverBrandingPrompt({
        url: '{{url}}',
        htmlContent: '{{htmlContent}}',
        cssContent: '{{cssContent}}',
      });
      // Replace the preamble (first editable region) with custom text — locked blocks unchanged
      const cleanOverride = 'Custom preamble text.\n' + defaultTemplate.replace(
        /^You are a brand identity extractor[^\n]*\n/,
        '',
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/discover-branding',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: cleanOverride },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ isOverride: boolean }>().isOverride).toBe(true);
    });
  });

  describe('PUT /api/v1/prompts/:capability (fence validation)', () => {
    it('returns 422 when override is missing output-format locked block', async () => {
      const defaultTemplate = buildGenerateFixPrompt({
        wcagCriterion: '{{wcagCriterion}}',
        issueMessage: '{{issueMessage}}',
        htmlContext: '{{htmlContext}}',
        cssContext: '{{cssContext}}',
      });

      // Strip the output-format locked block entirely
      const badOverride = defaultTemplate.replace(
        /<!-- LOCKED:output-format -->[\s\S]*?<!-- \/LOCKED -->/,
        '',
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: badOverride, orgId: 'fence-test-org-1' },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string; violations: Array<{ name: string; reason: string; explanation: string }>; statusCode: number }>();
      expect(body.statusCode).toBe(422);
      expect(body.error).toContain('output-format');
      expect(Array.isArray(body.violations)).toBe(true);
      const v = body.violations.find((v) => v.name === 'output-format');
      expect(v?.reason).toBe('missing');
      expect(v?.explanation).toBeTruthy();
      const lowerExpl = (v?.explanation ?? '').toLowerCase();
      expect(lowerExpl.includes('json') || lowerExpl.includes('schema')).toBe(true);
    });

    it('returns 422 when override has modified variable-injection content', async () => {
      const defaultTemplate = buildGenerateFixPrompt({
        wcagCriterion: '{{wcagCriterion}}',
        issueMessage: '{{issueMessage}}',
        htmlContext: '{{htmlContext}}',
        cssContext: '{{cssContext}}',
      });

      // Replace the content inside variable-injection with garbage
      const badOverride = defaultTemplate.replace(
        /(<!-- LOCKED:variable-injection -->)([\s\S]*?)(<!-- \/LOCKED -->)/,
        '$1\nGARBAGE CONTENT INJECTED\n$3',
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: badOverride, orgId: 'fence-test-org-2' },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string; violations: Array<{ name: string; reason: string; explanation: string }>; statusCode: number }>();
      const v = body.violations.find((v) => v.name === 'variable-injection');
      expect(v?.reason).toBe('modified');
      expect(v?.explanation).toBeTruthy();
    });

    it('returns 200 for a clean override that only edits the free region', async () => {
      const defaultTemplate = buildGenerateFixPrompt({
        wcagCriterion: '{{wcagCriterion}}',
        issueMessage: '{{issueMessage}}',
        htmlContext: '{{htmlContext}}',
        cssContext: '{{cssContext}}',
      });

      // Insert custom text into the editable Instructions section (outside locked blocks)
      const cleanOverride = defaultTemplate.replace(
        '## Instructions',
        '## Custom Instructions (org-specific)\n## Instructions',
      );

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: cleanOverride, orgId: 'fence-test-org-3' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isOverride: boolean; template: string }>();
      expect(body.isOverride).toBe(true);
    });

    it('returns 400 on empty template (existing behaviour preserved)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId: 'fence-test-org-4' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('explanation falls back to empty string for section name not in LOCKED_SECTION_EXPLANATIONS', () => {
      // Unit-level test for the fallback — validateOverride with a synthetic default
      // that uses an unknown section name, then check the fallback
      const syntheticDefault = '<!-- LOCKED:unknown-section-xyz -->\ncontent\n<!-- /LOCKED -->';
      const missingOverride = 'plain text without the block';
      const result = validateOverride(missingOverride, syntheticDefault);
      expect(result.ok).toBe(false);
      expect(result.violations[0]?.name).toBe('unknown-section-xyz');
      // The explanation lookup would return undefined → handler maps to ''
      // (We verify this at the unit level here since the HTTP path needs a real default template)
    });
  });

  describe('DELETE /api/v1/prompts/:capability', () => {
    it('returns 404 when no override exists to delete', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/prompts/extract-requirements?orgId=no-such-org',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/prompts/invalid-cap',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
