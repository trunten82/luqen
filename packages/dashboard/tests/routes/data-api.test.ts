import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
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

async function createTestServer(): Promise<TestContext> {
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
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
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

async function makeCompletedScan(ctx: TestContext, siteUrl = 'https://example.com'): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });
  await ctx.storage.scans.updateScan(id, { status: 'completed' });
  return id;
}

describe('Data API routes', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

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
  });

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
  });

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
      const { writeFile } = await import('node:fs/promises');
      const id = await makeCompletedScan(ctx);
      const jsonPath = join(ctx.reportsDir, `report-${id}.json`);
      const reportJson = JSON.stringify({
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
      });
      await writeFile(jsonPath, reportJson, 'utf-8');
      await ctx.storage.scans.updateScan(id, { jsonReportPath: jsonPath });

      const response = await ctx.server.inject({ method: 'GET', url: `/api/v1/scans/${id}/issues` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[]; total: number };
      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(2);
    });
  });

  describe('GET /api/v1/trends', () => {
    it('returns 400 when siteUrl is missing', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/api/v1/trends' });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toBe('siteUrl query parameter is required');
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
  });
});
