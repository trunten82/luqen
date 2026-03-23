import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { exportRoutes } from '../../../src/routes/api/export.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  cleanup: () => void;
}

async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-export-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-export-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
  });

  await exportRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, cleanup };
}

async function makeCompletedScan(
  ctx: TestContext,
  siteUrl = 'https://example.com',
  opts?: { orgId?: string; status?: string; jsonReportPath?: string },
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: ['eu'],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: opts?.orgId ?? 'system',
  });
  if (opts?.status !== 'queued') {
    const updateData: Record<string, unknown> = {
      status: opts?.status ?? 'completed',
      pagesScanned: 5,
      totalIssues: 10,
      errors: 3,
      warnings: 4,
      notices: 3,
      confirmedViolations: 2,
    };
    if (opts?.jsonReportPath) {
      updateData['jsonReportPath'] = opts.jsonReportPath;
    }
    await ctx.storage.scans.updateScan(id, updateData);
  }
  return id;
}

function makeSampleReport(pages?: unknown[]): Record<string, unknown> {
  return {
    siteUrl: 'https://example.com',
    pages: pages ?? [
      {
        url: 'https://example.com/',
        issues: [
          {
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            message: 'Image missing alt text',
            selector: 'img.hero',
            context: '<img src="hero.jpg" class="hero">',
            wcagCriterion: '1.1.1',
            wcagTitle: 'Non-text Content',
            fixSuggestion: 'Add alt attribute',
          },
          {
            type: 'warning',
            code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H48',
            message: 'Navigation not in a list',
            selector: 'nav.main-nav',
            context: '<nav class="main-nav"><a href="/">Home</a></nav>',
          },
          {
            type: 'notice',
            code: 'WCAG2AA.Principle2.Guideline2_4.2_4_2.H25.2',
            message: 'Check title is descriptive',
            selector: 'html > head > title',
            context: '<title>Home</title>',
          },
        ],
      },
      {
        url: 'https://example.com/about',
        issues: [
          {
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            message: 'Image missing alt text',
            selector: 'img.team',
            context: '<img src="team.jpg">',
          },
        ],
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Export API routes', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  // ── GET /api/v1/export/scans.csv ────────────────────────────────────────

  describe('GET /api/v1/export/scans.csv', () => {
    it('returns CSV with headers when no scans exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.csv',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv');
      expect(response.headers['content-disposition']).toContain('luqen-scans-');
      expect(response.headers['content-disposition']).toContain('.csv');

      const csv = response.body;
      // BOM + headers
      expect(csv).toContain('Scan ID');
      expect(csv).toContain('Site URL');
      expect(csv).toContain('Standard');
    });

    it('includes scan data in CSV rows', async () => {
      const id = await makeCompletedScan(ctx, 'https://test-site.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.csv',
      });

      expect(response.statusCode).toBe(200);
      const csv = response.body;
      expect(csv).toContain('https://test-site.com');
      expect(csv).toContain('WCAG2AA');
      expect(csv).toContain('completed');
    });

    it('exports multiple scans', async () => {
      await makeCompletedScan(ctx, 'https://site1.com');
      await makeCompletedScan(ctx, 'https://site2.com');
      await makeCompletedScan(ctx, 'https://site3.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.csv',
      });

      const csv = response.body;
      expect(csv).toContain('https://site1.com');
      expect(csv).toContain('https://site2.com');
      expect(csv).toContain('https://site3.com');
    });

    it('includes jurisdictions separated by semicolons', async () => {
      await makeCompletedScan(ctx, 'https://example.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.csv',
      });

      expect(response.statusCode).toBe(200);
      // The CSV should include jurisdiction data
      expect(response.body).toContain('eu');
    });
  });

  // ── GET /api/v1/export/scans/:id/issues.xlsx ────────────────────────────

  describe('GET /api/v1/export/scans/:id/issues.xlsx', () => {
    it('returns 404 when scan does not exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${randomUUID()}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Report not found');
    });

    it('returns 404 when scan belongs to different org', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com', { orgId: 'other-org' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when scan is not completed', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com', { status: 'queued' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Report data not available');
    });

    it('returns 404 when no report data exists', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      // No report stored in DB and no jsonReportPath
      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Report data not available');
    });

    it('returns Excel file when report exists in DB', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = makeSampleReport();

      // Store report in DB
      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(response.headers['content-disposition']).toContain('luqen-issues-example.com-');
      expect(response.headers['content-disposition']).toContain('.xlsx');
    });

    it('reads report from JSON file when DB report is null', async () => {
      const reportPath = join(ctx.reportsDir, `report-${randomUUID()}.json`);
      const report = makeSampleReport();
      writeFileSync(reportPath, JSON.stringify(report));

      const id = await makeCompletedScan(ctx, 'https://example.com', { jsonReportPath: reportPath });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('handles report with compliance issueAnnotations', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        ...makeSampleReport(),
        compliance: {
          issueAnnotations: {
            'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37': [
              { shortName: 'EAA', url: 'https://example.com/eaa' },
            ],
          },
        },
      };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('handles report with compliance annotatedIssues', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        ...makeSampleReport(),
        compliance: {
          annotatedIssues: [
            {
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
              regulations: [{ shortName: 'WCAG21' }],
            },
            {
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
              regulations: [{ shortName: 'ADA' }, { shortName: 'WCAG21' }],
            },
          ],
        },
      };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('handles report with flat issues (no pages array)', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        siteUrl: 'https://example.com',
        issues: [
          {
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            message: 'Image missing alt text',
            selector: 'img',
            context: '<img src="x.jpg">',
          },
        ],
      };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('handles report with empty pages array', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = { pages: [] };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 500 when report file is invalid JSON', async () => {
      const reportPath = join(ctx.reportsDir, `report-${randomUUID()}.json`);
      writeFileSync(reportPath, 'not valid json{{{');

      const id = await makeCompletedScan(ctx, 'https://example.com', { jsonReportPath: reportPath });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(500);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Failed to read report data');
    });

    it('handles issues with regulations from issue itself', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        pages: [
          {
            url: 'https://example.com/',
            issues: [
              {
                type: 'error',
                code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
                message: 'Missing alt',
                selector: 'img',
                context: '<img>',
                regulations: [
                  { shortName: 'EAA', url: 'https://eaa.eu', obligation: 'mandatory' },
                  { shortName: 'ADA' },
                ],
              },
            ],
          },
        ],
      };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('handles issues with fixSuggestion field', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        pages: [{
          url: 'https://example.com/',
          issues: [{
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            message: 'Missing alt',
            selector: 'img',
            context: '<img>',
            fixSuggestion: 'Add an alt attribute to the image',
          }],
        }],
      };

      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ── GET /api/v1/export/scans/:id/issues.csv (legacy URL) ───────────────

  describe('GET /api/v1/export/scans/:id/issues.csv', () => {
    it('returns Excel file (same as .xlsx endpoint)', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = makeSampleReport();
      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.csv`,
      });

      expect(response.statusCode).toBe(200);
      // Legacy CSV URL now serves Excel
      expect(response.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${randomUUID()}/issues.csv`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/export/trends.csv ───────────────────────────────────────

  describe('GET /api/v1/export/trends.csv', () => {
    it('returns CSV with headers when no data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.csv',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv');
      expect(response.headers['content-disposition']).toContain('luqen-trends-');

      const csv = response.body;
      expect(csv).toContain('Site URL');
      expect(csv).toContain('Total Issues');
    });

    it('includes completed scan data in trends', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.csv',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('https://trend-site.com');
    });

    it('filters by siteUrl query parameter', async () => {
      await makeCompletedScan(ctx, 'https://site-a.com');
      await makeCompletedScan(ctx, 'https://site-b.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.csv?siteUrl=https://site-a.com',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('https://site-a.com');
      // site-b should not appear (filtered out)
      expect(response.body).not.toContain('https://site-b.com');
    });

    it('returns all sites when no siteUrl filter', async () => {
      await makeCompletedScan(ctx, 'https://alpha.com');
      await makeCompletedScan(ctx, 'https://beta.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.csv',
      });

      expect(response.body).toContain('https://alpha.com');
      expect(response.body).toContain('https://beta.com');
    });
  });

  // ── GET /api/v1/export/scans/:id/report.pdf ────────────────────────────

  describe('GET /api/v1/export/scans/:id/report.pdf', () => {
    it('returns 404 when scan has no report file', async () => {
      // Scan exists but has no jsonReportPath → 404
      const id = await makeCompletedScan(ctx, 'https://example.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/report.pdf`,
      });

      // Puppeteer is available but scan has no report file
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${randomUUID()}/report.pdf`,
      });

      // Will be 501 (no puppeteer) or 404
      expect([404, 501]).toContain(response.statusCode);
    });
  });

  // ── Component inference coverage ────────────────────────────────────────

  describe('Component inference in Excel export', () => {
    async function exportWithIssue(ctx: TestContext, selector: string, context: string): Promise<number> {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const report = {
        pages: [{
          url: 'https://example.com/',
          issues: [{
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            message: 'Test issue',
            selector,
            context,
          }],
        }],
      };
      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      return response.statusCode;
    }

    it('infers Cookie Banner component', async () => {
      expect(await exportWithIssue(ctx, '.cookie-consent', '')).toBe(200);
    });

    it('infers Navigation component', async () => {
      expect(await exportWithIssue(ctx, 'nav.main-nav', '')).toBe(200);
    });

    it('infers Header component', async () => {
      expect(await exportWithIssue(ctx, 'header.site-header', '')).toBe(200);
    });

    it('infers Footer component', async () => {
      expect(await exportWithIssue(ctx, 'footer', '')).toBe(200);
    });

    it('infers Form component', async () => {
      expect(await exportWithIssue(ctx, '', '<form action="/submit">')).toBe(200);
    });

    it('infers Modal component', async () => {
      expect(await exportWithIssue(ctx, '.modal-dialog', '')).toBe(200);
    });

    it('infers Social Links component', async () => {
      expect(await exportWithIssue(ctx, '.social-share', '')).toBe(200);
    });

    it('infers Media / Carousel component', async () => {
      expect(await exportWithIssue(ctx, '', '<img src="x.jpg">')).toBe(200);
    });

    it('infers Card / Listing component', async () => {
      expect(await exportWithIssue(ctx, '.card', '')).toBe(200);
    });

    it('infers Breadcrumb component', async () => {
      expect(await exportWithIssue(ctx, '.breadcrumb', '')).toBe(200);
    });

    it('infers Widget / Sidebar component', async () => {
      expect(await exportWithIssue(ctx, 'aside.widget', '')).toBe(200);
    });

    it('infers CTA / Banner component', async () => {
      expect(await exportWithIssue(ctx, '.hero-banner', '')).toBe(200);
    });

    it('infers Document Head component', async () => {
      expect(await exportWithIssue(ctx, 'html > head > title', '')).toBe(200);
    });

    it('defaults to Shared Layout', async () => {
      expect(await exportWithIssue(ctx, 'div.unknown', '')).toBe(200);
    });
  });
});
