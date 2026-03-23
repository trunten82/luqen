import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { trendRoutes } from '../../src/routes/trends.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['trends.view']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-trends-${randomUUID()}.db`);
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

  await trendRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

async function makeScan(
  ctx: TestContext,
  overrides: {
    siteUrl?: string;
    status?: 'queued' | 'running' | 'completed' | 'failed';
    orgId?: string;
    errors?: number;
    warnings?: number;
    notices?: number;
    totalIssues?: number;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: overrides.orgId ?? 'system',
  });

  const updateFields: Record<string, unknown> = {};
  if (overrides.status !== undefined) updateFields['status'] = overrides.status;
  if (overrides.errors !== undefined) updateFields['errors'] = overrides.errors;
  if (overrides.warnings !== undefined) updateFields['warnings'] = overrides.warnings;
  if (overrides.notices !== undefined) updateFields['notices'] = overrides.notices;
  if (overrides.totalIssues !== undefined) updateFields['totalIssues'] = overrides.totalIssues;

  if (Object.keys(updateFields).length > 0) {
    await ctx.storage.scans.updateScan(id, updateFields as Parameters<typeof ctx.storage.scans.updateScan>[1]);
  }

  return id;
}

describe('Trend Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /reports/trends', () => {
    it('renders trend page with trends.hbs template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('trends.hbs');
    });

    it('renders trend page with scan data', async () => {
      await makeScan(ctx, {
        siteUrl: 'https://example.com',
        status: 'completed',
        errors: 2,
        warnings: 3,
        notices: 1,
        totalIssues: 6,
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { trendData: unknown[]; hasTrends: boolean } };
      expect(body.data.trendData).toHaveLength(1);
      expect(body.data.hasTrends).toBe(true);
    });

    it('includes only completed scans in trend data', async () => {
      // Completed scan — should appear in trendData
      await makeScan(ctx, { siteUrl: 'https://completed.com', status: 'completed' });
      // Queued scan — getTrendData only returns completed scans
      await makeScan(ctx, { siteUrl: 'https://queued.com', status: 'queued' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { trendData: Array<{ siteUrl: string }> } };
      const siteUrls = body.data.trendData.map((t) => t.siteUrl);
      expect(siteUrls).toContain('https://completed.com');
      expect(siteUrls).not.toContain('https://queued.com');
    });

    it('scopes trend data to the user\'s org', async () => {
      // Scan in user's org (system)
      await makeScan(ctx, { siteUrl: 'https://myorg.com', status: 'completed', orgId: 'system' });
      // Scan in another org — should not appear
      await makeScan(ctx, { siteUrl: 'https://otherorg.com', status: 'completed', orgId: 'other-org' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { trendData: Array<{ siteUrl: string }> } };
      const siteUrls = body.data.trendData.map((t) => t.siteUrl);
      expect(siteUrls).toContain('https://myorg.com');
      expect(siteUrls).not.toContain('https://otherorg.com');
    });

    it('returns 200 with empty trend data when no scans exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { trendData: unknown[]; hasTrends: boolean; orgScore: number } };
      expect(body.data.trendData).toHaveLength(0);
      expect(body.data.hasTrends).toBe(false);
      expect(body.data.orgScore).toBe(100);
    });

    it('includes orgTotals and siteScores in template data', async () => {
      await makeScan(ctx, { status: 'completed', errors: 1, warnings: 2, notices: 0, totalIssues: 3 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });

      const body = response.json() as {
        data: {
          orgTotals: unknown[];
          siteScores: unknown[];
          summaryTable: unknown[];
        };
      };
      expect(Array.isArray(body.data.orgTotals)).toBe(true);
      expect(Array.isArray(body.data.siteScores)).toBe(true);
      expect(Array.isArray(body.data.summaryTable)).toBe(true);
    });

    it('returns 200 even without trends.view permission (no explicit perm check in route)', async () => {
      // The trends route does not do a server-side permission check;
      // access control is enforced at the auth guard layer, not inside the handler.
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'GET',
        url: '/reports/trends',
      });
      noPerm.cleanup();
      // Route itself does not return 403 — it renders the page regardless
      expect(response.statusCode).toBe(200);
    });
  });
});
