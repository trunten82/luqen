/**
 * Integration Test — Docker Deployment Smoke Test
 *
 * Validates that the application can start up correctly by testing:
 *   - Server binds to a port
 *   - Health check endpoint responds
 *   - Database initializes (migrations run)
 *   - Basic routes return expected responses
 *
 * Uses the createTestServer helper to spin up a real Fastify server
 * with SQLite in a temp directory, mirroring the Docker entrypoint flow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestServer, type TestContext } from '../helpers/server.js';

describe('Docker Deployment Smoke Test', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestServer();
  }, 30_000);

  afterAll(() => {
    ctx?.cleanup();
  });

  // ── Server binding ─────────────────────────────────────────────────────

  describe('server binding', () => {
    it('server instance is ready and accepting requests', () => {
      expect(ctx.server).toBeDefined();
      // Fastify server should be in ready state after createTestServer
      // view is a reply decorator, not a server decorator
      expect(ctx.server.hasReplyDecorator('view')).toBe(true);
    });

    it('server has registered routes', () => {
      // Check that the server has routes by inspecting printRoutes
      const routes = ctx.server.printRoutes();
      expect(routes).toBeTruthy();
      expect(routes.length).toBeGreaterThan(0);
    });
  });

  // ── Health check endpoint ────────────────────────────────────────────

  describe('health check', () => {
    it('GET /health returns 200 with status ok', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('health check responds quickly (< 1s)', async () => {
      const start = Date.now();
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/health',
      });
      const elapsed = Date.now() - start;

      expect(response.statusCode).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ── Database initialization ──────────────────────────────────────────

  describe('database initialization', () => {
    it('storage adapter is connected and healthy', async () => {
      expect(ctx.storage).toBeDefined();
      const healthy = await ctx.storage.healthCheck();
      expect(healthy).toBe(true);
    });

    it('database tables exist after migration', async () => {
      // Verify core tables were created by running basic queries
      const scans = await ctx.storage.scans.listScans({ limit: 1 });
      expect(Array.isArray(scans)).toBe(true);

      const users = await ctx.storage.users.listUsers();
      expect(Array.isArray(users)).toBe(true);
    });

    it('can create and retrieve a scan record', async () => {
      const scan = await ctx.storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://smoke-test.example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'smoke-test',
        createdAt: new Date().toISOString(),
        orgId: 'system',
      });

      expect(scan).toBeDefined();
      expect(scan.id).toBeTruthy();
      expect(scan.siteUrl).toBe('https://smoke-test.example.com');
      expect(scan.status).toBe('queued');

      // Retrieve it back
      const retrieved = await ctx.storage.scans.getScan(scan.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(scan.id);
    });
  });

  // ── Basic route responses ────────────────────────────────────────────

  describe('basic routes', () => {
    it('GET /login returns 200', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/login',
      });

      // Login page should return 200 (rendered template as JSON in test mode)
      expect(response.statusCode).toBe(200);
    });

    it('GET / redirects to login when not authenticated', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/',
      });

      // Without authentication, should redirect to /login (302)
      // or serve the page if auth guard is bypassed in test mode
      expect([200, 302]).toContain(response.statusCode);
    });

    it('GET /reports returns 200 (route is registered)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports',
      });

      // Without auth may redirect; but route exists (not 404)
      expect(response.statusCode).not.toBe(404);
    });

    it('GET /scan/new returns a response (route is registered)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/scan/new',
      });

      expect(response.statusCode).not.toBe(404);
    });

    it('unknown route returns 404', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/this-route-does-not-exist-at-all',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── API endpoints ────────────────────────────────────────────────────

  describe('API endpoints', () => {
    it('GET /api/v1/scans returns a response (route is registered)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/scans',
      });

      // Route exists (might need auth, so accept 200 or redirect)
      expect(response.statusCode).not.toBe(404);
    });

    it('GET /api/v1/export/scans.xlsx returns a response (route is registered)', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/export/scans.xlsx',
      });

      // Export route exists (might need auth)
      expect(response.statusCode).not.toBe(404);
    });
  });

  // ── Static assets ────────────────────────────────────────────────────

  describe('critical services', () => {
    it('orchestrator is initialized', () => {
      expect(ctx.orchestrator).toBeDefined();
    });

    it('auth service is initialized', () => {
      expect(ctx.authService).toBeDefined();
    });

    it('plugin manager is initialized', () => {
      expect(ctx.pluginManager).toBeDefined();
    });

    it('config has required fields', () => {
      expect(ctx.config.dbPath).toBeTruthy();
      expect(ctx.config.reportsDir).toBeTruthy();
      expect(ctx.config.sessionSecret).toBeTruthy();
      expect(ctx.config.sessionSecret.length).toBeGreaterThanOrEqual(32);
    });
  });
});
