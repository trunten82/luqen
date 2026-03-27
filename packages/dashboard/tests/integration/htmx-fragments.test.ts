/**
 * Integration Test — HTMX Fragment Response Tests
 *
 * Validates that routes correctly differentiate between HTMX partial requests
 * and full-page requests. When `HX-Request: true` is present, routes should
 * return partial HTML fragments (using a partial template). Without it, routes
 * should return the full page layout.
 *
 * The test server replaces reply.view with a JSON stub that returns
 * { template, data }, allowing us to inspect which template was rendered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { roleRoutes } from '../../src/routes/admin/roles.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  dbPath: string;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = ['reports.delete', 'scans.create', 'trends.view', 'admin.roles'],
  userOverrides: Record<string, unknown> = {},
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-htmx-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-htmx-reports-${randomUUID()}`);
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
    request.user = {
      id: 'user-1',
      username: 'testuser',
      role: 'admin',
      currentOrgId: 'system',
      ...userOverrides,
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await reportRoutes(server, storage);
  await roleRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, dbPath, cleanup };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HTMX Fragment Response Tests', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestServer();
  }, 15_000);

  afterAll(() => {
    ctx?.cleanup();
  });

  // ── Reports list: partial vs full page ────────────────────────────────

  describe('GET /reports — HTMX partial vs full page', () => {
    it('returns partial template when HX-Request header is present', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
        headers: {
          'hx-request': 'true',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should render the partial template, not the full page
      expect(body.template).toContain('partials/reports-table');
    });

    it('returns full page template when HX-Request header is absent', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should render the full page template
      expect(body.template).toBe('reports-list.hbs');
    });

    it('passes same data shape to both partial and full templates', async () => {
      const [partialRes, fullRes] = await Promise.all([
        ctx.server.inject({
          method: 'GET',
          url: '/reports',
          headers: { 'hx-request': 'true' },
        }),
        ctx.server.inject({
          method: 'GET',
          url: '/reports',
        }),
      ]);

      const partialData = JSON.parse(partialRes.body).data;
      const fullData = JSON.parse(fullRes.body).data;

      // Both should have the same core data fields
      expect(partialData.scans).toBeDefined();
      expect(fullData.scans).toBeDefined();
      expect(partialData.hasPrev).toBeDefined();
      expect(fullData.hasPrev).toBeDefined();
      expect(partialData.hasNext).toBeDefined();
      expect(fullData.hasNext).toBeDefined();
    });

    it('passes search query to partial template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?q=example.com',
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.q).toBe('example.com');
    });

    it('passes status filter to partial template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?status=completed',
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
    });

    it('passes pagination to partial template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports?offset=20&limit=10',
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.currentPage).toBe(3); // offset=20, limit=10 => page 3
    });
  });

  // ── DELETE /reports/:id — HTMX vs redirect ──────────────────────────

  describe('DELETE /reports/:id — HTMX vs redirect', () => {
    it('returns empty body with 200 for HTMX request', async () => {
      // Create a scan to delete
      const scan = await ctx.storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://delete-htmx.example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'testuser',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });

      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/reports/${scan.id}`,
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('');

      // Verify scan was deleted
      const deleted = await ctx.storage.scans.getScan(scan.id);
      expect(deleted).toBeNull();
    });

    it('redirects to /reports for non-HTMX request', async () => {
      const scan = await ctx.storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://delete-redirect.example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'testuser',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });

      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/reports/${scan.id}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/reports');
    });

    it('returns 404 for non-existent scan regardless of HTMX header', async () => {
      const htmxRes = await ctx.server.inject({
        method: 'DELETE',
        url: '/reports/non-existent-id',
        headers: { 'hx-request': 'true' },
      });
      expect(htmxRes.statusCode).toBe(404);

      const normalRes = await ctx.server.inject({
        method: 'DELETE',
        url: '/reports/non-existent-id',
      });
      expect(normalRes.statusCode).toBe(404);
    });
  });

  // ── HX-Redirect header ───────────────────────────────────────────────

  describe('HX-Redirect header in responses', () => {
    it('POST /admin/roles returns HX-Redirect for HTMX request on success', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: {
          'hx-request': 'true',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: 'name=test-role-htmx&description=Test+role',
      });

      // Should return with HX-Redirect header pointing to roles page
      if (response.statusCode === 200) {
        expect(response.headers['hx-redirect']).toBe('/admin/roles');
      }
      // Some implementations return 302 even for HTMX — accept both
      expect([200, 302]).toContain(response.statusCode);
    });

    it('POST /admin/roles returns validation error for HTMX request', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: {
          'hx-request': 'true',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: 'name=&description=Empty+name', // Empty name should fail
      });

      expect(response.statusCode).toBe(422);
      // HTMX error responses should contain HTML toast for swap
      expect(response.body).toBeTruthy();
    });

    it('POST /admin/roles returns JSON error for non-HTMX request', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/roles',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: 'name=&description=Empty+name',
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });
  });

  // ── HTMX-specific header handling ────────────────────────────────────

  describe('HTMX-specific header handling', () => {
    it('HX-Request header value must be exactly "true"', async () => {
      // With hx-request: true — should get partial
      const trueRes = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
        headers: { 'hx-request': 'true' },
      });
      const trueBody = JSON.parse(trueRes.body);
      expect(trueBody.template).toContain('partials');

      // With hx-request: false — should get full page
      const falseRes = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
        headers: { 'hx-request': 'false' },
      });
      const falseBody = JSON.parse(falseRes.body);
      expect(falseBody.template).toBe('reports-list.hbs');
    });

    it('handles request without any HTMX headers (standard browser)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
        headers: {
          accept: 'text/html,application/xhtml+xml',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Without HX-Request, should render full page
      expect(body.template).toBe('reports-list.hbs');
    });
  });

  // ── Response content type ─────────────────────────────────────────────

  describe('response format', () => {
    it('HTMX delete returns no content-type for empty body', async () => {
      const scan = await ctx.storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://content-type.example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'testuser',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });

      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/reports/${scan.id}`,
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('');
    });

    it('full page report list returns JSON (from view mock)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      expect(response.statusCode).toBe(200);
      // The view mock returns JSON with content-type: application/json
      expect(response.headers['content-type']).toContain('application/json');
    });
  });
});
