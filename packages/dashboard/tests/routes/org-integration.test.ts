import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { homeRoutes } from '../../src/routes/home.js';
import { scanRoutes } from '../../src/routes/scan.js';
import type { DashboardConfig } from '../../src/config.js';
import { registerSession } from '../../src/auth/session.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface OrgTestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createOrgTestServer(
  currentOrgId?: string,
): Promise<OrgTestContext> {
  const dbPath = join(tmpdir(), `test-org-int-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
  };

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const orchestrator = new ScanOrchestrator(storage, reportsDir, 2);
  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  // Inject user context BEFORE server is ready
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'test-user-id',
      username: 'testuser',
      role: 'admin',
      currentOrgId,
    };
  });

  await homeRoutes(server, storage);
  await scanRoutes(server, storage, orchestrator, config);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('Org-scoped route integration', () => {
  describe('scan creation includes orgId from user context', () => {
    let ctx: OrgTestContext;

    afterEach(() => {
      ctx.cleanup();
    });

    it('stores orgId as "system" when user has no currentOrgId', async () => {
      ctx = await createOrgTestServer(undefined);

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https://example.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(302);

      const scans = await ctx.storage.scans.listScans();
      expect(scans).toHaveLength(1);
      expect(scans[0].orgId).toBe('system');
    });

    it('stores orgId from user context when set', async () => {
      const orgId = 'org-' + randomUUID();
      ctx = await createOrgTestServer(orgId);

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/scan/new',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrl=https://example.com&standard=WCAG2AA',
      });

      expect(response.statusCode).toBe(302);

      const scans = await ctx.storage.scans.listScans();
      expect(scans).toHaveLength(1);
      expect(scans[0].orgId).toBe(orgId);
    });
  });

  describe('scan listing filters by orgId', () => {
    let ctx: OrgTestContext;

    afterEach(() => {
      ctx.cleanup();
    });

    it('home page shows only scans matching user orgId', async () => {
      const orgA = 'org-a-' + randomUUID();
      const orgB = 'org-b-' + randomUUID();

      ctx = await createOrgTestServer(orgA);

      // Create scans for two different orgs
      await ctx.storage.scans.createScan({
        id: randomUUID(), siteUrl: 'https://org-a-site.com', standard: 'WCAG2AA',
        jurisdictions: [], createdBy: 'testuser', createdAt: new Date().toISOString(), orgId: orgA,
      });

      await ctx.storage.scans.createScan({
        id: randomUUID(), siteUrl: 'https://org-b-site.com', standard: 'WCAG2AA',
        jurisdictions: [], createdBy: 'testuser', createdAt: new Date().toISOString(), orgId: orgB,
      });

      await ctx.storage.scans.createScan({
        id: randomUUID(), siteUrl: 'https://org-a-site2.com', standard: 'WCAG2AA',
        jurisdictions: [], createdBy: 'testuser', createdAt: new Date().toISOString(), orgId: orgA,
      });

      const response = await ctx.server.inject({ method: 'GET', url: '/home' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          stats: { totalScans: number };
          recentScans: Array<{ siteUrl: string }>;
        };
      };

      // Should only see orgA scans (2 scans), not orgB
      expect(body.data.stats.totalScans).toBe(2);
      expect(body.data.recentScans).toHaveLength(2);
    });

    it('home page shows all scans when user has no orgId', async () => {
      ctx = await createOrgTestServer(undefined);

      await ctx.storage.scans.createScan({
        id: randomUUID(), siteUrl: 'https://site1.com', standard: 'WCAG2AA',
        jurisdictions: [], createdBy: 'testuser', createdAt: new Date().toISOString(), orgId: 'org-x',
      });

      await ctx.storage.scans.createScan({
        id: randomUUID(), siteUrl: 'https://site2.com', standard: 'WCAG2AA',
        jurisdictions: [], createdBy: 'testuser', createdAt: new Date().toISOString(), orgId: 'org-y',
      });

      const response = await ctx.server.inject({ method: 'GET', url: '/home' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { stats: { totalScans: number } };
      };

      // Should see all scans since no org filter
      expect(body.data.stats.totalScans).toBe(2);
    });
  });
});
