import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { compareRoutes } from '../../src/routes/compare.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['reports.compare']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-compare-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-compare-reports-${randomUUID()}`);
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
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await compareRoutes(server, storage);
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
  const jsonReportPath = join(ctx.reportsDir, `report-${id}.json`);

  // Write minimal JSON report file
  const reportJson = JSON.stringify({
    summary: {
      url: siteUrl,
      pagesScanned: 1,
      pagesFailed: 0,
      totalIssues: 2,
      byLevel: { error: 1, warning: 1, notice: 0 },
    },
    pages: [
      {
        url: siteUrl,
        issueCount: 2,
        issues: [
          { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
          { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading order', selector: 'h3', context: '<h3>' },
        ],
      },
    ],
    errors: [],
  });
  writeFileSync(jsonReportPath, reportJson, 'utf-8');

  await ctx.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });

  await ctx.storage.scans.updateScan(id, {
    status: 'completed',
    jsonReportPath,
  });

  return id;
}

describe('Compare Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /reports/compare', () => {
    it('returns 400 when query params a and b are missing', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/compare',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('"a" and "b"');
    });

    it('returns 400 when only param a is provided', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/compare?a=some-id',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when only param b is provided', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/compare?b=some-id',
      });

      expect(response.statusCode).toBe(400);
    });

    it('handles missing scan IDs gracefully — returns 404 when scan A does not exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/compare?a=non-existent-a&b=non-existent-b',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Scan A not found');
    });

    it('returns 404 when scan B does not exist', async () => {
      const idA = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/compare?a=${idA}&b=non-existent-b`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Scan B not found');
    });

    it('returns 400 when scan A is not completed', async () => {
      // Create a queued (not completed) scan
      const idA = randomUUID();
      await ctx.storage.scans.createScan({
        id: idA,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });
      const idB = await makeCompletedScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/compare?a=${idA}&b=${idB}`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Scan A does not have a completed report');
    });

    it('compares two scans and renders report-compare.hbs template', async () => {
      const idA = await makeCompletedScan(ctx, 'https://site-a.com');
      const idB = await makeCompletedScan(ctx, 'https://site-b.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/compare?a=${idA}&b=${idB}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('report-compare.hbs');
    });

    it('includes diff data in template when comparing two scans', async () => {
      const idA = await makeCompletedScan(ctx, 'https://site-a.com');
      const idB = await makeCompletedScan(ctx, 'https://site-b.com');

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/compare?a=${idA}&b=${idB}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          scanA: { id: string };
          scanB: { id: string };
          diff: { addedCount: number; removedCount: number; unchangedCount: number };
        };
      };
      expect(body.data.scanA.id).toBe(idA);
      expect(body.data.scanB.id).toBe(idB);
      expect(body.data.diff).toBeDefined();
      expect(typeof body.data.diff.addedCount).toBe('number');
      expect(typeof body.data.diff.removedCount).toBe('number');
      expect(typeof body.data.diff.unchangedCount).toBe('number');
    });

    it('returns 200 even without reports.compare permission (no explicit perm check in route)', async () => {
      // The compare route itself does not enforce permissions server-side;
      // that is handled by the global auth guard layer outside this handler.
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'GET',
        url: '/reports/compare',
      });
      noPerm.cleanup();
      // No params → 400, not 403 — confirms there is no permission check in the route
      expect(response.statusCode).toBe(400);
    });
  });
});
