import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diffReports, type NormalizedReport, type DiffResult } from '../src/compare/diff.js';
import { createTestServer, type TestContext } from './helpers/server.js';

function makeReport(
  pages: Array<{
    url: string;
    issues: Array<{ type: string; code: string; message: string; selector: string; context?: string }>;
  }>,
  byLevel?: { error: number; warning: number; notice: number },
): NormalizedReport {
  const computedLevel = byLevel ?? {
    error: pages.reduce((sum, p) => sum + p.issues.filter((i) => i.type === 'error').length, 0),
    warning: pages.reduce((sum, p) => sum + p.issues.filter((i) => i.type === 'warning').length, 0),
    notice: pages.reduce((sum, p) => sum + p.issues.filter((i) => i.type === 'notice').length, 0),
  };
  return {
    summary: { byLevel: computedLevel },
    pages: pages.map((p) => ({
      url: p.url,
      issues: p.issues,
    })),
  };
}

describe('diffReports', () => {
  describe('basic diff detection', () => {
    it('detects added issues (new in B, not in A)', async () => {
      const reportA = makeReport([]);
      const reportB = makeReport([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt text', selector: 'img' },
          ],
        },
      ]);

      const result = diffReports(reportA, reportB);

      expect(result.added).toHaveLength(1);
      expect(result.added[0].code).toBe('WCAG2AA.1_1_1');
      expect(result.added[0].pageUrl).toBe('https://example.com');
      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('detects removed issues (in A, not in B)', async () => {
      const reportA = makeReport([
        {
          url: 'https://example.com',
          issues: [
            { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading order', selector: 'h3' },
          ],
        },
      ]);
      const reportB = makeReport([]);

      const result = diffReports(reportA, reportB);

      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].code).toBe('WCAG2AA.1_3_1');
      expect(result.added).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('detects unchanged issues (present in both)', async () => {
      const issue = { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt text', selector: 'img' };
      const reportA = makeReport([{ url: 'https://example.com', issues: [issue] }]);
      const reportB = makeReport([{ url: 'https://example.com', issues: [issue] }]);

      const result = diffReports(reportA, reportB);

      expect(result.unchanged).toHaveLength(1);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects mixed changes correctly', async () => {
      const shared = { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt text', selector: 'img' };
      const onlyA = { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading order', selector: 'h3' };
      const onlyB = { type: 'notice', code: 'WCAG2AA.2_4_1', message: 'Skip link', selector: 'a' };

      const reportA = makeReport([{ url: 'https://example.com', issues: [shared, onlyA] }]);
      const reportB = makeReport([{ url: 'https://example.com', issues: [shared, onlyB] }]);

      const result = diffReports(reportA, reportB);

      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0].code).toBe('WCAG2AA.1_1_1');
      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].code).toBe('WCAG2AA.1_3_1');
      expect(result.added).toHaveLength(1);
      expect(result.added[0].code).toBe('WCAG2AA.2_4_1');
    });
  });

  describe('summary delta computation', () => {
    it('computes positive delta when B has more issues', async () => {
      const reportA = makeReport([], { error: 2, warning: 1, notice: 0 });
      const reportB = makeReport([], { error: 5, warning: 3, notice: 2 });

      const result = diffReports(reportA, reportB);

      expect(result.summaryDelta).toEqual({ errors: 3, warnings: 2, notices: 2 });
    });

    it('computes negative delta when B has fewer issues', async () => {
      const reportA = makeReport([], { error: 10, warning: 5, notice: 3 });
      const reportB = makeReport([], { error: 2, warning: 1, notice: 1 });

      const result = diffReports(reportA, reportB);

      expect(result.summaryDelta).toEqual({ errors: -8, warnings: -4, notices: -2 });
    });

    it('computes zero delta for identical summaries', async () => {
      const reportA = makeReport([], { error: 3, warning: 2, notice: 1 });
      const reportB = makeReport([], { error: 3, warning: 2, notice: 1 });

      const result = diffReports(reportA, reportB);

      expect(result.summaryDelta).toEqual({ errors: 0, warnings: 0, notices: 0 });
    });
  });

  describe('edge cases', () => {
    it('handles two empty reports', async () => {
      const reportA = makeReport([]);
      const reportB = makeReport([]);

      const result = diffReports(reportA, reportB);

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
      expect(result.summaryDelta).toEqual({ errors: 0, warnings: 0, notices: 0 });
    });

    it('handles identical reports (all unchanged)', async () => {
      const issues = [
        { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img' },
        { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading order', selector: 'h3' },
      ];
      const reportA = makeReport([{ url: 'https://example.com', issues }]);
      const reportB = makeReport([{ url: 'https://example.com', issues }]);

      const result = diffReports(reportA, reportB);

      expect(result.unchanged).toHaveLength(2);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('handles report A empty, B has issues (all added)', async () => {
      const reportA = makeReport([]);
      const reportB = makeReport([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'E1', message: 'msg1', selector: 's1' },
            { type: 'warning', code: 'W1', message: 'msg2', selector: 's2' },
          ],
        },
      ]);

      const result = diffReports(reportA, reportB);

      expect(result.added).toHaveLength(2);
      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });

    it('handles report B empty, A has issues (all removed)', async () => {
      const reportA = makeReport([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'E1', message: 'msg1', selector: 's1' },
            { type: 'notice', code: 'N1', message: 'msg3', selector: 's3' },
          ],
        },
      ]);
      const reportB = makeReport([]);

      const result = diffReports(reportA, reportB);

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(2);
      expect(result.unchanged).toHaveLength(0);
    });

    it('handles duplicate issues on the same page', async () => {
      const dup = { type: 'error', code: 'E1', message: 'msg', selector: 's' };
      const reportA = makeReport([{ url: 'https://example.com', issues: [dup, dup] }]);
      const reportB = makeReport([{ url: 'https://example.com', issues: [dup] }]);

      const result = diffReports(reportA, reportB);

      // One matched as unchanged, one in A not matched = removed
      expect(result.unchanged).toHaveLength(1);
      expect(result.removed).toHaveLength(1);
      expect(result.added).toHaveLength(0);
    });

    it('handles issues across multiple pages', async () => {
      const reportA = makeReport([
        {
          url: 'https://example.com/page1',
          issues: [{ type: 'error', code: 'E1', message: 'msg1', selector: 's1' }],
        },
      ]);
      const reportB = makeReport([
        {
          url: 'https://example.com/page1',
          issues: [{ type: 'error', code: 'E1', message: 'msg1', selector: 's1' }],
        },
        {
          url: 'https://example.com/page2',
          issues: [{ type: 'warning', code: 'W1', message: 'msg2', selector: 's2' }],
        },
      ]);

      const result = diffReports(reportA, reportB);

      expect(result.unchanged).toHaveLength(1);
      expect(result.added).toHaveLength(1);
      expect(result.added[0].pageUrl).toBe('https://example.com/page2');
      expect(result.removed).toHaveLength(0);
    });

    it('handles reports with missing byLevel (defaults to zero)', async () => {
      const reportA: NormalizedReport = {
        summary: {},
        pages: [],
      };
      const reportB: NormalizedReport = {
        summary: {},
        pages: [],
      };

      const result = diffReports(reportA, reportB);

      expect(result.summaryDelta).toEqual({ errors: 0, warnings: 0, notices: 0 });
    });

    it('matches issues by code+selector+message key, ignoring page URL', async () => {
      // Same issue appears on different pages - should still match
      const issue = { type: 'error', code: 'E1', message: 'msg', selector: 's' };
      const reportA = makeReport([{ url: 'https://example.com/old', issues: [issue] }]);
      const reportB = makeReport([{ url: 'https://example.com/new', issues: [issue] }]);

      const result = diffReports(reportA, reportB);

      expect(result.unchanged).toHaveLength(1);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });
  });
});

// ── Route integration tests ───────────────────────────────────────────────────

async function createCompletedScan(
  ctx: TestContext,
  overrides: { siteUrl?: string; errors?: number; warnings?: number; notices?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'testuser',
    createdAt: new Date().toISOString(),
  });
  await ctx.storage.scans.updateScan(id, { status: 'completed' });

  const jsonPath = join(ctx.config.reportsDir, `report-${id}.json`);
  const reportJson = JSON.stringify({
    summary: {
      url: overrides.siteUrl ?? 'https://example.com',
      pagesScanned: 1,
      pagesFailed: 0,
      totalIssues: (overrides.errors ?? 1) + (overrides.warnings ?? 0) + (overrides.notices ?? 0),
      byLevel: {
        error: overrides.errors ?? 1,
        warning: overrides.warnings ?? 0,
        notice: overrides.notices ?? 0,
      },
    },
    pages: [
      {
        url: overrides.siteUrl ?? 'https://example.com',
        issueCount: overrides.errors ?? 1,
        issues: [
          { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
        ],
      },
    ],
    errors: [],
  });
  await writeFile(jsonPath, reportJson, 'utf-8');
  await ctx.storage.scans.updateScan(id, { jsonReportPath: jsonPath });

  return id;
}

describe('Compare route (GET /reports/compare)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 400 when query params a or b are missing', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/reports/compare',
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when only a is provided', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/reports/compare?a=some-id',
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when scan A does not exist', async () => {
    const idB = await createCompletedScan(ctx);
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=nonexistent&b=${idB}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when scan B does not exist', async () => {
    const idA = await createCompletedScan(ctx);
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=${idA}&b=nonexistent`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when scan A is not completed', async () => {
    const idA = randomUUID();
    await ctx.storage.scans.createScan({
      id: idA,
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'testuser',
      createdAt: new Date().toISOString(),
    });
    const idB = await createCompletedScan(ctx);

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=${idA}&b=${idB}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 200 and renders report-compare.hbs template', async () => {
    const idA = await createCompletedScan(ctx);
    const idB = await createCompletedScan(ctx);

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=${idA}&b=${idB}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('report-compare.hbs');
  });

  it('includes diff data with correct structure', async () => {
    const idA = await createCompletedScan(ctx);
    const idB = await createCompletedScan(ctx);

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=${idA}&b=${idB}`,
    });

    const body = response.json() as {
      data: {
        scanA: { id: string };
        scanB: { id: string };
        diff: {
          added: unknown[];
          removed: unknown[];
          unchanged: unknown[];
          addedCount: number;
          removedCount: number;
          unchangedCount: number;
          summaryDelta: { errors: number; warnings: number; notices: number };
        };
      };
    };

    expect(body.data.scanA.id).toBe(idA);
    expect(body.data.scanB.id).toBe(idB);
    expect(body.data.diff).toBeDefined();
    expect(body.data.diff.summaryDelta).toBeDefined();
    expect(typeof body.data.diff.addedCount).toBe('number');
    expect(typeof body.data.diff.removedCount).toBe('number');
    expect(typeof body.data.diff.unchangedCount).toBe('number');
  });

  it('detects identical scans as all unchanged', async () => {
    const idA = await createCompletedScan(ctx);
    const idB = await createCompletedScan(ctx);

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/reports/compare?a=${idA}&b=${idB}`,
    });

    const body = response.json() as {
      data: {
        diff: { unchangedCount: number; addedCount: number; removedCount: number };
      };
    };

    // Both scans have the same single issue
    expect(body.data.diff.unchangedCount).toBe(1);
    expect(body.data.diff.addedCount).toBe(0);
    expect(body.data.diff.removedCount).toBe(0);
  });
});
