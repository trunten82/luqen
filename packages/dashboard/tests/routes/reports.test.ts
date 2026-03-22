import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestServer, type TestContext } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

async function makeScan(ctx: TestContext, overrides: { createdBy?: string; status?: 'queued' | 'running' | 'completed' | 'failed'; siteUrl?: string } = {}) {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: overrides.createdBy ?? 'testuser',
    createdAt: new Date().toISOString(),
  });

  if (overrides.status !== undefined && overrides.status !== 'queued') {
    await ctx.storage.scans.updateScan(id, { status: overrides.status });
  }

  return id;
}

describe('Report routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /reports', () => {
    it('returns 200 with reports-list template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('reports-list.hbs');
    });

    it('includes scan list in template data', async () => {
      await makeScan(ctx);
      await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      const body = response.json() as { data: { scans: unknown[] } };
      expect(body.data.scans).toHaveLength(2);
    });

    it('filters by query string q', async () => {
      await makeScan(ctx, { siteUrl: 'https://alpha.com' });
      await makeScan(ctx, { siteUrl: 'https://beta.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?q=alpha',
      });

      const body = response.json() as { data: { scans: Array<{ siteUrl: string }> } };
      expect(body.data.scans).toHaveLength(1);
      expect(body.data.scans[0].siteUrl).toBe('https://alpha.com');
    });

    it('filters by status', async () => {
      const id1 = await makeScan(ctx, { status: 'completed' });
      await makeScan(ctx, { status: 'failed' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?status=completed',
      });

      const body = response.json() as { data: { scans: Array<{ id: string }> } };
      expect(body.data.scans).toHaveLength(1);
      expect(body.data.scans[0].id).toBe(id1);
    });

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await makeScan(ctx);
      }

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?limit=3&offset=0',
      });

      const body = response.json() as { data: { scans: unknown[]; hasNext: boolean } };
      // returns limit+1 to detect hasNext, so max 3 shown
      expect(body.data.scans.length).toBeLessThanOrEqual(3);
    });
  });

  describe('GET /reports/:id', () => {
    it('returns 200 with report-detail template', async () => {
      const id = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('report-detail.hbs');
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('includes scan data in template', async () => {
      const id = await makeScan(ctx, { siteUrl: 'https://mysite.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      const body = response.json() as { data: { scan: { id: string; siteUrl: string } } };
      expect(body.data.scan.id).toBe(id);
      expect(body.data.scan.siteUrl).toBe('https://mysite.com');
    });

    it('renders reportData from JSON file when scan is completed and JSON exists', async () => {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const id = await makeScan(ctx, { status: 'completed' });
      const jsonPath = join(ctx.config.reportsDir, `report-${id}.json`);
      const reportJson = JSON.stringify({
        summary: {
          url: 'https://mysite.com',
          pagesScanned: 1,
          pagesFailed: 0,
          totalIssues: 2,
          byLevel: { error: 1, warning: 1, notice: 0 },
        },
        pages: [
          { url: 'https://mysite.com', issueCount: 2, issues: [
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
            { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading order', selector: 'h3', context: '<h3>' },
          ]},
        ],
        errors: [],
      });
      await writeFile(jsonPath, reportJson, 'utf-8');
      await ctx.storage.scans.updateScan(id, { jsonReportPath: jsonPath });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { reportData: { summary: { totalIssues: number } } } };
      expect(body.data.reportData).not.toBeNull();
      expect(body.data.reportData.summary.totalIssues).toBe(2);
    });

    it('renders null reportData when scan is queued', async () => {
      const id = await makeScan(ctx, { status: 'queued' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      const body = response.json() as { data: { reportData: null } };
      expect(body.data.reportData).toBeNull();
    });
  });

  describe('DELETE /reports/:id', () => {
    it('returns 403 when request has no authenticated user', async () => {
      const id = await makeScan(ctx, { createdBy: 'testuser' });

      // Without auth middleware in test server, request.user is undefined.
      // undefined?.role !== 'admin' && scan.createdBy !== undefined?.username → 403.
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/reports/${id}`,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/reports/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when user is not admin and not the owner', async () => {
      // Create a scan owned by 'owner'
      const id = randomUUID();
      await ctx.storage.scans.createScan({
        id,
        siteUrl: 'https://owner.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'owner',
        createdAt: new Date().toISOString(),
      });

      // In the test server, request.user is undefined (no auth middleware).
      // undefined?.username !== 'owner' and undefined?.role !== 'admin' → 403.
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/reports/${id}`,
      });

      expect(response.statusCode).toBe(403);
    });
  });

});
