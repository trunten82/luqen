import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { dataApiRoutes } from '../../src/routes/api/data.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  cleanup: () => void;
}

async function createTestServer(orgId = 'system'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-data-api-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-data-reports-${randomUUID()}`);
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
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: orgId };
  });

  await dataApiRoutes(server, storage);
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
  orgId = 'system',
  extraUpdates: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId,
  });
  await ctx.storage.scans.updateScan(id, { status: 'completed', ...extraUpdates });
  return id;
}

async function makeCompletedScanWithReport(
  ctx: TestContext,
  siteUrl = 'https://example.com',
  report: Record<string, unknown> = {},
): Promise<string> {
  const id = await makeCompletedScan(ctx, siteUrl);
  const jsonPath = join(ctx.reportsDir, `report-${id}.json`);
  await writeFile(jsonPath, JSON.stringify(report), 'utf-8');
  await ctx.storage.scans.updateScan(id, { jsonReportPath: jsonPath });
  return id;
}

describe('Data API routes', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  // ── GET /api/v1/scans ───────────────────────────────────────────────────

  describe('GET /api/v1/scans', () => {
    it('returns paginated JSON with total', async () => {
      await makeCompletedScan(ctx);
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(2);
    });

    it('only returns completed scans', async () => {
      await makeCompletedScan(ctx);
      // queued scan
      await ctx.storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://queued.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });

    it('filters by siteUrl query param', async () => {
      await makeCompletedScan(ctx, 'https://alpha.com');
      await makeCompletedScan(ctx, 'https://beta.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?siteUrl=alpha' });
      const body = response.json() as { data: Array<{ siteUrl: string }>; total: number };
      expect(body.total).toBe(1);
      expect(body.data[0].siteUrl).toBe('https://alpha.com');
    });

    it('respects limit and offset parameters', async () => {
      for (let i = 0; i < 5; i++) {
        await makeCompletedScan(ctx, `https://site${i}.com`);
      }

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?limit=2&offset=0' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(5);
      expect(body.data).toHaveLength(2);
    });

    it('does not expose jsonReportPath or error fields', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans' });
      const body = response.json() as { data: Array<Record<string, unknown>> };
      const scan = body.data[0];
      expect(scan['jsonReportPath']).toBeUndefined();
      expect(scan['error']).toBeUndefined();
    });

    it('handles invalid limit gracefully (uses default)', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?limit=abc' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });

    it('handles negative limit (uses default)', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?limit=-5' });
      expect(response.statusCode).toBe(200);
    });

    it('handles invalid offset gracefully (uses 0)', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?offset=abc' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });

    it('handles negative offset (uses 0)', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?offset=-10' });
      expect(response.statusCode).toBe(200);
    });

    it('clamps limit to MAX_LIMIT (1000)', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?limit=9999' });
      expect(response.statusCode).toBe(200);
    });

    it('filters by from date', async () => {
      await makeCompletedScan(ctx);

      // Future date should return 0 results
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?from=2099-01-01' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(0);
    });

    it('filters by to date', async () => {
      await makeCompletedScan(ctx);

      // Past date should return 0 results
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?to=2000-01-01' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(0);
    });

    it('ignores invalid from date', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?from=not-a-date' });
      const body = response.json() as { data: unknown[]; total: number };
      // Invalid date is ignored, so all scans are returned
      expect(body.total).toBe(1);
    });

    it('ignores invalid to date', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?to=not-a-date' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });

    it('returns empty data when offset exceeds total', async () => {
      await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans?offset=100' });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
      expect(body.data).toHaveLength(0);
    });
  });

  // ── GET /api/v1/scans/:id ───────────────────────────────────────────────

  describe('GET /api/v1/scans/:id', () => {
    it('returns a single scan by id', async () => {
      const id = await makeCompletedScan(ctx, 'https://single.com');

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}` });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { id: string; siteUrl: string; summary: unknown } };
      expect(body.data.id).toBe(id);
      expect(body.data.siteUrl).toBe('https://single.com');
      expect('summary' in body.data).toBe(true);
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans/non-existent-id' });
      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Scan not found');
    });

    it('returns null summary when no report file', async () => {
      const id = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}` });
      const body = response.json() as { data: { summary: null } };
      expect(body.data.summary).toBeNull();
    });

    it('returns summary from report file when available', async () => {
      const report = {
        summary: { url: 'https://example.com', pagesScanned: 3, totalIssues: 10 },
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}` });
      const body = response.json() as { data: { summary: { pagesScanned: number } } };
      expect(body.data.summary).toBeDefined();
      expect(body.data.summary.pagesScanned).toBe(3);
    });

    it('returns 404 when scan belongs to different org', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com', 'other-org');

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}` });
      expect(response.statusCode).toBe(404);
    });

    it('does not expose jsonReportPath in single scan response', async () => {
      const id = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}` });
      const body = response.json() as { data: Record<string, unknown> };
      expect(body.data['jsonReportPath']).toBeUndefined();
    });
  });

  // ── GET /api/v1/scans/:id/issues ────────────────────────────────────────

  describe('GET /api/v1/scans/:id/issues', () => {
    it('returns empty data when no report file', async () => {
      const id = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans/non-existent-id/issues' });
      expect(response.statusCode).toBe(404);
    });

    it('returns paginated issues from report file', async () => {
      const report = {
        summary: { url: 'https://example.com', pagesScanned: 1, totalIssues: 2 },
        pages: [
          {
            url: 'https://example.com',
            issueCount: 2,
            issues: [
              { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
              { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading', selector: 'h3', context: '<h3>' },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(2);
    });

    it('filters issues by severity', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 3,
            issues: [
              { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img' },
              { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading issue', selector: 'h3' },
              { type: 'error', code: 'WCAG2AA.2_4_1', message: 'Skip link', selector: 'a' },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues?severity=error` });
      const body = response.json() as { data: Array<{ type: string }>; total: number };
      expect(body.total).toBe(2);
      expect(body.data.every((i) => i.type === 'error')).toBe(true);
    });

    it('filters issues by criterion', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 2,
            issues: [
              { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', wcagCriterion: '1.1.1' },
              { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading', selector: 'h3', wcagCriterion: '1.3.1' },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues?criterion=1.1.1` });
      const body = response.json() as { data: Array<{ wcagCriterion: string }>; total: number };
      expect(body.total).toBe(1);
      expect(body.data[0].wcagCriterion).toBe('1.1.1');
    });

    it('filters by both severity and criterion', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 3,
            issues: [
              { type: 'error', code: 'C1', message: 'A', selector: 'a', wcagCriterion: '1.1.1' },
              { type: 'warning', code: 'C2', message: 'B', selector: 'b', wcagCriterion: '1.1.1' },
              { type: 'error', code: 'C3', message: 'C', selector: 'c', wcagCriterion: '2.1.1' },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues?severity=error&criterion=1.1.1` });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(1);
    });

    it('paginates issues with limit and offset', async () => {
      const issues = Array.from({ length: 5 }, (_, i) => ({
        type: 'error',
        code: `C${i}`,
        message: `Issue ${i}`,
        selector: `s${i}`,
      }));
      const report = {
        pages: [{ url: 'https://example.com', issueCount: 5, issues }],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues?limit=2&offset=1` });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(5);
      expect(body.data).toHaveLength(2);
    });

    it('flattens issues from multiple pages', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com/page1',
            issueCount: 1,
            issues: [{ type: 'error', code: 'C1', message: 'Issue 1', selector: 'a' }],
          },
          {
            url: 'https://example.com/page2',
            issueCount: 1,
            issues: [{ type: 'warning', code: 'C2', message: 'Issue 2', selector: 'b' }],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      const body = response.json() as { data: Array<{ pageUrl: string }>; total: number };
      expect(body.total).toBe(2);
      expect(body.data[0].pageUrl).toBe('https://example.com/page1');
      expect(body.data[1].pageUrl).toBe('https://example.com/page2');
    });

    it('returns empty when report has no pages', async () => {
      const report = { summary: { url: 'https://example.com' } };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('includes regulations and wcag fields in issue output', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 1,
            issues: [
              {
                type: 'error',
                code: 'C1',
                message: 'Missing alt',
                selector: 'img',
                wcagCriterion: '1.1.1',
                wcagTitle: 'Non-text Content',
                regulations: [{ shortName: 'ADA', url: 'https://ada.gov' }],
              },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      const body = response.json() as { data: Array<Record<string, unknown>> };
      const issue = body.data[0];
      expect(issue['wcagCriterion']).toBe('1.1.1');
      expect(issue['wcagTitle']).toBe('Non-text Content');
      expect(issue['regulations']).toHaveLength(1);
    });
  });

  // ── GET /api/v1/trends ──────────────────────────────────────────────────

  describe('GET /api/v1/trends', () => {
    it('returns 400 when siteUrl is missing', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends' });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toBe('siteUrl query parameter is required');
    });

    it('returns 400 when siteUrl is empty string', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=' });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when siteUrl is whitespace only', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=%20%20' });
      expect(response.statusCode).toBe(400);
    });

    it('returns trend data for a siteUrl', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=trend-site.com' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('returns empty data array when no matching scans', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=no-such-site.com' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('filters trends by from date', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=trend-site.com&from=2099-01-01' });
      const body = response.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('filters trends by to date', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=trend-site.com&to=2000-01-01' });
      const body = response.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('ignores invalid from date in trends', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=trend-site.com&from=invalid' });
      const body = response.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('trend data includes expected fields', async () => {
      await makeCompletedScan(ctx, 'https://trend-site.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=trend-site.com' });
      const body = response.json() as { data: Array<Record<string, unknown>> };
      const point = body.data[0];
      expect(point).toHaveProperty('date');
      expect(point).toHaveProperty('totalIssues');
      expect(point).toHaveProperty('errors');
      expect(point).toHaveProperty('warnings');
      expect(point).toHaveProperty('notices');
      expect(point).toHaveProperty('pagesScanned');
      expect(point).toHaveProperty('confirmedViolations');
    });
  });

  // ── GET /api/v1/compliance-summary ──────────────────────────────────────

  describe('GET /api/v1/compliance-summary', () => {
    it('returns empty data when no scans exist', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns compliance summary for a specific siteUrl', async () => {
      await makeCompletedScan(ctx, 'https://compliance.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary?siteUrl=https://compliance.com' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Array<Record<string, unknown>> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]['siteUrl']).toBe('https://compliance.com');
    });

    it('returns latest scan per unique site_url when no siteUrl filter', async () => {
      await makeCompletedScan(ctx, 'https://site-a.com');
      await makeCompletedScan(ctx, 'https://site-b.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary' });
      const body = response.json() as { data: Array<Record<string, unknown>> };
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('includes jurisdiction data from compliance matrix', async () => {
      const report = {
        compliance: {
          summary: { passing: 5, failing: 2, totalConfirmedViolations: 3 },
          matrix: {
            'us-ada': {
              jurisdictionId: 'us-ada',
              jurisdictionName: 'US - ADA',
              status: 'fail',
              confirmedViolations: 2,
              needsReview: 1,
            },
            'eu-eaa': {
              jurisdictionId: 'eu-eaa',
              jurisdictionName: 'EU - EAA',
              reviewStatus: 'fail',
              confirmedViolations: 1,
              needsReview: 0,
            },
          },
        },
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://compliance.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary?siteUrl=https://compliance.com' });
      const body = response.json() as { data: Array<{ jurisdictions: Array<Record<string, unknown>> }> };
      const summary = body.data[0];
      expect(summary.jurisdictions).toHaveLength(2);
      expect(summary.jurisdictions[0]['jurisdictionName']).toBe('US - ADA');
      expect(summary.jurisdictions[0]['status']).toBe('fail');
      // eu-eaa has no status but reviewStatus is 'fail', so status should be 'fail'
      expect(summary.jurisdictions[1]['status']).toBe('fail');
    });

    it('returns pass status when reviewStatus is not fail', async () => {
      const report = {
        compliance: {
          matrix: {
            'au-dda': {
              jurisdictionId: 'au-dda',
              jurisdictionName: 'AU - DDA',
              reviewStatus: 'pass',
            },
          },
        },
      };
      await makeCompletedScanWithReport(ctx, 'https://status-test.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary?siteUrl=https://status-test.com' });
      const body = response.json() as { data: Array<{ jurisdictions: Array<Record<string, unknown>> }> };
      const jurisdiction = body.data[0].jurisdictions[0];
      expect(jurisdiction['status']).toBe('pass');
    });

    it('includes scan metadata in summary', async () => {
      await makeCompletedScan(ctx, 'https://meta-test.com');

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary?siteUrl=https://meta-test.com' });
      const body = response.json() as { data: Array<Record<string, unknown>> };
      const summary = body.data[0];
      expect(summary).toHaveProperty('scanId');
      expect(summary).toHaveProperty('siteUrl');
      expect(summary).toHaveProperty('standard');
      expect(summary).toHaveProperty('scannedAt');
      expect(summary).toHaveProperty('totalIssues');
      expect(summary).toHaveProperty('errors');
      expect(summary).toHaveProperty('warnings');
      expect(summary).toHaveProperty('notices');
      expect(summary).toHaveProperty('confirmedViolations');
      expect(summary).toHaveProperty('jurisdictions');
    });

    it('returns empty jurisdictions when no compliance matrix', async () => {
      const report = { summary: { url: 'https://example.com' } };
      await makeCompletedScanWithReport(ctx, 'https://no-matrix.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/compliance-summary?siteUrl=https://no-matrix.com' });
      const body = response.json() as { data: Array<{ jurisdictions: unknown[] }> };
      expect(body.data[0].jurisdictions).toHaveLength(0);
    });
  });

  // ── GET /api/v1/scans/:id/fixes ─────────────────────────────────────────

  describe('GET /api/v1/scans/:id/fixes', () => {
    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/scans/non-existent/fixes' });
      expect(response.statusCode).toBe(404);
    });

    it('returns empty fixes when no report file', async () => {
      const id = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number; connectedRepo: unknown };
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
      expect(body.connectedRepo).toBeNull();
    });

    it('returns empty fixes when report has no pages', async () => {
      const report = { summary: { url: 'https://example.com' } };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns fix suggestions for matching issues', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 1,
            issues: [
              {
                type: 'error',
                code: 'WCAG2AA.1_1_1',
                message: 'Img element missing an alt attribute.',
                selector: 'img.hero',
                wcagCriterion: '1.1.1',
              },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { data: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBeGreaterThan(0);
      expect(body.data[0]['criterion']).toBe('1.1.1');
      expect(body.data[0]['title']).toBeDefined();
      expect(body.data[0]['description']).toBeDefined();
      expect(body.data[0]['codeExample']).toBeDefined();
      expect(body.data[0]['pageUrl']).toBe('https://example.com');
    });

    it('deduplicates fixes by fingerprint', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 2,
            issues: [
              {
                type: 'error',
                code: 'WCAG2AA.1_1_1',
                message: 'Img element missing an alt attribute.',
                selector: 'img.hero',
                wcagCriterion: '1.1.1',
              },
              {
                type: 'error',
                code: 'WCAG2AA.1_1_1',
                message: 'Img element missing an alt attribute.',
                selector: 'img.hero', // Same selector = same fingerprint
                wcagCriterion: '1.1.1',
              },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { data: unknown[]; total: number };
      // Should be deduplicated to 1
      expect(body.total).toBe(1);
    });

    it('includes mcp and a2a metadata in response', async () => {
      const report = {
        pages: [{ url: 'https://example.com', issueCount: 1, issues: [{ code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'Missing alt', type: 'error', selector: 'img', context: '<img>', runner: 'htmlcs', fixSuggestions: [{ criterion: '1.1.1', title: 'Add alt', description: 'Add alt attr' }] }] }],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { mcpTools: string[]; a2aHint: string };
      expect(body.mcpTools).toContain('luqen_propose_fixes');
      expect(body.mcpTools).toContain('luqen_apply_fix');
      expect(body.a2aHint).toBeDefined();
    });

    it('returns null connectedRepo when no repo is connected', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 1,
            issues: [
              {
                type: 'error',
                code: 'C1',
                message: 'Img element missing an alt attribute.',
                selector: 'img',
                wcagCriterion: '1.1.1',
              },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { connectedRepo: unknown; data: Array<Record<string, unknown>> };
      expect(body.connectedRepo).toBeNull();
      if (body.data.length > 0) {
        expect(body.data[0]['repoPath']).toBeNull();
        expect(body.data[0]['repoUrl']).toBeNull();
        expect(body.data[0]['branch']).toBeNull();
      }
    });

    it('skips issues with no matching fix suggestion', async () => {
      const report = {
        pages: [
          {
            url: 'https://example.com',
            issueCount: 1,
            issues: [
              {
                type: 'error',
                code: 'CUSTOM',
                message: 'Some custom issue that has no fix suggestion',
                selector: 'div',
                wcagCriterion: '99.99.99',
              },
            ],
          },
        ],
      };
      const id = await makeCompletedScanWithReport(ctx, 'https://example.com', report);

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(0);
    });

    it('returns 404 when scan belongs to different org', async () => {
      const id = await makeCompletedScan(ctx, 'https://example.com', 'other-org');

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/fixes` });
      expect(response.statusCode).toBe(404);
    });
  });
});
