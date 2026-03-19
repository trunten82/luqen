import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestServer, type TestContext } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

function makeScan(ctx: TestContext, overrides: { createdBy?: string; status?: 'queued' | 'running' | 'completed' | 'failed'; siteUrl?: string } = {}) {
  const id = randomUUID();
  ctx.db.createScan({
    id,
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: overrides.createdBy ?? 'testuser',
    createdAt: new Date().toISOString(),
  });

  if (overrides.status !== undefined && overrides.status !== 'queued') {
    ctx.db.updateScan(id, { status: overrides.status });
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
      makeScan(ctx);
      makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      const body = response.json() as { data: { scans: unknown[] } };
      expect(body.data.scans).toHaveLength(2);
    });

    it('filters by query string q', async () => {
      makeScan(ctx, { siteUrl: 'https://alpha.com' });
      makeScan(ctx, { siteUrl: 'https://beta.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?q=alpha',
      });

      const body = response.json() as { data: { scans: Array<{ siteUrl: string }> } };
      expect(body.data.scans).toHaveLength(1);
      expect(body.data.scans[0].siteUrl).toBe('https://alpha.com');
    });

    it('filters by status', async () => {
      const id1 = makeScan(ctx, { status: 'completed' });
      makeScan(ctx, { status: 'failed' });

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
        makeScan(ctx);
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
    it('returns 200 with report-view template', async () => {
      const id = makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('report-view.hbs');
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('includes scan data in template', async () => {
      const id = makeScan(ctx, { siteUrl: 'https://mysite.com' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}`,
      });

      const body = response.json() as { data: { scan: { id: string; siteUrl: string } } };
      expect(body.data.scan.id).toBe(id);
      expect(body.data.scan.siteUrl).toBe('https://mysite.com');
    });
  });

  describe('DELETE /reports/:id', () => {
    it('returns 403 when request has no authenticated user', async () => {
      const id = makeScan(ctx, { createdBy: 'testuser' });

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
      ctx.db.createScan({
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

  describe('GET /reports/:id/raw', () => {
    it('returns 404 when no html report path', async () => {
      const id = makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${id}/raw`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
