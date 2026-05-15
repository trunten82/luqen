import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { manualTestRoutes } from '../../src/routes/manual-tests.js';
import { MANUAL_CRITERIA } from '../../src/manual-criteria.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = ['manual_testing'],
  userOverride?: { role: string; currentOrgId: string },
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-manual-tests-${randomUUID()}.db`);
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

  const userRole = userOverride?.role ?? 'admin';
  const userOrgId = userOverride?.currentOrgId ?? 'system';
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: userRole, currentOrgId: userOrgId };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await manualTestRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

async function makeScan(ctx: TestContext, orgId = 'system'): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId,
  });
  return id;
}

// Pick the first criterion from the list for test data
const FIRST_CRITERION = MANUAL_CRITERIA[0];

describe('Manual Test Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /reports/:id/manual', () => {
    it('renders manual-tests.hbs checklist for a valid scan', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('manual-tests.hbs');
    });

    it('includes scan data in template', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });

      const body = response.json() as { data: { scan: { id: string; siteUrl: string } } };
      expect(body.data.scan.id).toBe(scanId);
      expect(body.data.scan.siteUrl).toBe('https://example.com');
    });

    it('includes manualItems and partialItems in template data', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });

      const body = response.json() as {
        data: {
          manualItems: Array<{ id: string; status: string }>;
          partialItems: Array<{ id: string; status: string }>;
          stats: { tested: number; percentage: number };
        };
      };
      expect(Array.isArray(body.data.manualItems)).toBe(true);
      expect(Array.isArray(body.data.partialItems)).toBe(true);
      // All items should default to 'untested' when no results saved
      for (const item of body.data.manualItems) {
        expect(item.status).toBe('untested');
      }
      expect(body.data.stats.tested).toBe(0);
      expect(body.data.stats.percentage).toBe(0);
    });

    it('handles non-existent scan — returns 404', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/non-existent-id/manual',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Report not found');
    });

    it('returns 404 when non-admin user opens a scan belonging to another org', async () => {
      // Spin up a fresh server where the user role is NOT admin — the admin
      // bypass in the cross-org guard should not apply, so the 404 is the
      // correct privacy outcome.
      const otherCtx = await createTestServer(['manual_testing'], {
        role: 'member',
        currentOrgId: 'org-a',
      });
      const scanId = await makeScan(otherCtx, 'other-org');
      const response = await otherCtx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });
      otherCtx.cleanup();
      expect(response.statusCode).toBe(404);
    });

    // Phase 55 task 5 — UAT 2026-05-15: an admin who opens a cross-org report
    // could see the report-detail page (reports.ts has an admin bypass) but
    // got 404 on the Manual Testing button. Mirror the guard so the surfaces
    // are consistent.
    it('admin role can open Manual Testing for a scan in another org (regression for UAT 404)', async () => {
      const scanId = await makeScan(ctx, 'other-org');
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('manual-tests.hbs');
    });

    it('returns 200 even without manual_testing permission (no explicit perm check in route)', async () => {
      const noPerm = await createTestServer([]);
      const scanId = await makeScan(noPerm);

      const response = await noPerm.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/manual`,
      });
      noPerm.cleanup();
      // Route does not enforce permissions — auth guard handles that at a higher level
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /reports/:id/manual', () => {
    it('upserts a test result and returns HTML for HTMX swap', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=pass&notes=Looks+good`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain(FIRST_CRITERION.id);
    });

    it('persists the test result in storage', async () => {
      const scanId = await makeScan(ctx);

      await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=fail`,
      });

      const results = await ctx.storage.manualTests.getManualTests(scanId);
      expect(results).toHaveLength(1);
      expect(results[0].criterionId).toBe(FIRST_CRITERION.id);
      expect(results[0].status).toBe('fail');
    });

    it('returns 404 for non-existent scan', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/reports/non-existent-id/manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=pass`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when criterionId is missing', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'status=pass',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('criterionId');
    });

    it('returns 400 for invalid status value', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=invalid`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Invalid status');
    });

    it('returns 400 for unknown criterion ID', async () => {
      const scanId = await makeScan(ctx);

      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'criterionId=99.99.99&status=pass',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('Unknown criterion');
    });

    it('upserts — updating an existing result changes its status', async () => {
      const scanId = await makeScan(ctx);
      const payload = `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=pass`;

      // First save — pass
      await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload,
      });

      // Second save — fail (upsert)
      await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/manual`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `criterionId=${encodeURIComponent(FIRST_CRITERION.id)}&status=fail`,
      });

      const results = await ctx.storage.manualTests.getManualTests(scanId);
      // Should still be a single row, updated to 'fail'
      const forCriterion = results.filter((r) => r.criterionId === FIRST_CRITERION.id);
      expect(forCriterion).toHaveLength(1);
      expect(forCriterion[0].status).toBe('fail');
    });
  });
});
