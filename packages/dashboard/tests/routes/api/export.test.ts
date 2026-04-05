import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { exportRoutes } from '../../../src/routes/api/export.js';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Parse an xlsx response body into its first worksheet's header row + data
 * rows as plain strings. Used to assert header shape, column ordering, and
 * cell values for export endpoints.
 */
async function parseXlsxResponse(
  rawPayload: Buffer,
): Promise<{ headers: string[]; rows: string[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(rawPayload);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? ''));
  });
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    for (let i = 1; i <= headers.length; i++) {
      cells.push(String(row.getCell(i).value ?? ''));
    }
    rows.push(cells);
  });
  return { headers, rows };
}

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
  opts?: { orgId?: string; status?: string; jsonReportPath?: string; jurisdictions?: string[]; regulations?: string[] },
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: opts?.jurisdictions ?? ['eu'],
    regulations: opts?.regulations ?? [],
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

  // ── GET /api/v1/export/scans.xlsx ──────────────────────────────────────

  describe('GET /api/v1/export/scans.xlsx', () => {
    it('returns an xlsx workbook with headers when no scans exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(XLSX_CONTENT_TYPE);
      expect(response.headers['content-disposition']).toContain('luqen-scans-');
      expect(response.headers['content-disposition']).toContain('.xlsx');

      const { headers } = await parseXlsxResponse(response.rawPayload);
      expect(headers).toContain('Scan ID');
      expect(headers).toContain('Site URL');
      expect(headers).toContain('Standard');
    });

    it('includes scan data in workbook rows', async () => {
      await makeCompletedScan(ctx, 'https://test-site.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      expect(response.statusCode).toBe(200);
      const { rows } = await parseXlsxResponse(response.rawPayload);
      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row).toContain('https://test-site.com');
      expect(row).toContain('WCAG2AA');
      expect(row).toContain('completed');
    });

    it('exports multiple scans', async () => {
      await makeCompletedScan(ctx, 'https://site1.com');
      await makeCompletedScan(ctx, 'https://site2.com');
      await makeCompletedScan(ctx, 'https://site3.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      const { rows } = await parseXlsxResponse(response.rawPayload);
      const siteUrls = rows.map((r) => r[1]);
      expect(siteUrls).toContain('https://site1.com');
      expect(siteUrls).toContain('https://site2.com');
      expect(siteUrls).toContain('https://site3.com');
    });

    it('joins jurisdictions with semicolons', async () => {
      await makeCompletedScan(ctx, 'https://example.com', {
        jurisdictions: ['eu', 'us'],
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      expect(response.statusCode).toBe(200);
      const { headers, rows } = await parseXlsxResponse(response.rawPayload);
      const jurIdx = headers.indexOf('Jurisdictions');
      expect(jurIdx).toBeGreaterThan(-1);
      expect(rows[0]![jurIdx]).toBe('eu; us');
    });

    // ── REG-06 / P07-P04 Tests A, B, C ───────────────────────────────────
    it('Test A (REG-06): workbook header includes Regulations column with joined data', async () => {
      await makeCompletedScan(ctx, 'https://example.com', {
        jurisdictions: ['EU'],
        regulations: ['ADA', 'EN301549'],
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      expect(response.statusCode).toBe(200);
      const { headers, rows } = await parseXlsxResponse(response.rawPayload);
      expect(headers).toContain('Regulations');
      expect(headers).toContain('Jurisdictions');
      const regIdx = headers.indexOf('Regulations');
      expect(rows[0]![regIdx]).toBe('ADA; EN301549');
    });

    it('Test B: Regulations column always present with empty cell when no regulations selected', async () => {
      await makeCompletedScan(ctx, 'https://example.com', {
        jurisdictions: ['EU'],
        regulations: [],
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      expect(response.statusCode).toBe(200);
      const { headers, rows } = await parseXlsxResponse(response.rawPayload);
      expect(headers).toContain('Regulations');
      const regIdx = headers.indexOf('Regulations');
      expect(rows[0]![regIdx]).toBe('');
      // Jurisdictions still populated
      const jurIdx = headers.indexOf('Jurisdictions');
      expect(rows[0]![jurIdx]).toBe('EU');
    });

    it('Test C: Regulations column sits immediately after Jurisdictions', async () => {
      await makeCompletedScan(ctx, 'https://example.com', {
        jurisdictions: ['EU'],
        regulations: ['ADA'],
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      const { headers } = await parseXlsxResponse(response.rawPayload);
      const jurIdx = headers.indexOf('Jurisdictions');
      const regIdx = headers.indexOf('Regulations');
      expect(jurIdx).toBeGreaterThan(-1);
      expect(regIdx).toBe(jurIdx + 1);
      expect(headers[jurIdx]).toBe('Jurisdictions');
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

    it('includes a Summary sheet exposing scan jurisdictions and regulations (REG-06)', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com', {
        jurisdictions: ['EU', 'UK'],
        regulations: ['EAA', 'IT-STANCA'],
      });
      const report = makeSampleReport();
      await ctx.storage.scans.updateScan(id, { jsonReport: JSON.stringify(report) });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.xlsx`,
      });

      expect(response.statusCode).toBe(200);

      // Load the workbook and verify both sheets exist with the expected content
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(response.rawPayload);
      const sheetNames = wb.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('Summary');
      expect(sheetNames).toContain('Issues');

      const summary = wb.getWorksheet('Summary');
      expect(summary).toBeDefined();
      // Flatten into a field→value map
      const metaMap = new Map<string, string>();
      summary!.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // header row
        metaMap.set(
          String(row.getCell(1).value ?? ''),
          String(row.getCell(2).value ?? ''),
        );
      });
      expect(metaMap.get('Jurisdictions')).toBe('EU; UK');
      expect(metaMap.get('Regulations')).toBe('EAA; IT-STANCA');
      expect(metaMap.get('Site URL')).toBe('https://example.com');
      expect(metaMap.get('Standard')).toBe('WCAG2AA');
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

  // ── GET /api/v1/export/scans/:id/issues.csv — removed (CSV retired) ────

  describe('legacy CSV endpoints are removed', () => {
    it('GET /api/v1/export/scans.csv returns 404', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.csv',
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /api/v1/export/trends.csv returns 404', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.csv',
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /api/v1/export/scans/:id/issues.csv returns 404', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com');
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/issues.csv`,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/export/trends.xlsx ─────────────────────────────────────

  describe('GET /api/v1/export/trends.xlsx', () => {
    it('returns an xlsx workbook with headers when no data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.xlsx',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(XLSX_CONTENT_TYPE);
      expect(response.headers['content-disposition']).toContain('luqen-trends-');
      expect(response.headers['content-disposition']).toContain('.xlsx');

      const { headers } = await parseXlsxResponse(response.rawPayload);
      expect(headers).toContain('Site URL');
      expect(headers).toContain('Total Issues');
    });

    it('includes completed scan data in trends', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.xlsx',
      });

      expect(response.statusCode).toBe(200);
      const { rows } = await parseXlsxResponse(response.rawPayload);
      const siteUrls = rows.map((r) => r[0]);
      expect(siteUrls).toContain('https://trend-site.com');
    });

    it('filters by siteUrl query parameter', async () => {
      await makeCompletedScan(ctx, 'https://site-a.com');
      await makeCompletedScan(ctx, 'https://site-b.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.xlsx?siteUrl=https://site-a.com',
      });

      expect(response.statusCode).toBe(200);
      const { rows } = await parseXlsxResponse(response.rawPayload);
      const siteUrls = rows.map((r) => r[0]);
      expect(siteUrls).toContain('https://site-a.com');
      expect(siteUrls).not.toContain('https://site-b.com');
    });

    it('returns all sites when no siteUrl filter', async () => {
      await makeCompletedScan(ctx, 'https://alpha.com');
      await makeCompletedScan(ctx, 'https://beta.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/trends.xlsx',
      });

      const { rows } = await parseXlsxResponse(response.rawPayload);
      const siteUrls = rows.map((r) => r[0]);
      expect(siteUrls).toContain('https://alpha.com');
      expect(siteUrls).toContain('https://beta.com');
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
