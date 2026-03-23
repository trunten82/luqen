import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import { registerSession } from '../../src/auth/session.js';
import { createAuthGuard } from '../../src/auth/middleware.js';
import { dataApiRoutes } from '../../src/routes/api/data.js';
import { storeApiKey } from '../../src/auth/api-key.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env['TEST_API_KEY'] ?? 'test-key-' + '0'.repeat(48);
const SESSION_SECRET = 'test-session-secret-at-least-32b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildServer(storage: SqliteStorageAdapter, reportsDir: string): Promise<FastifyInstance> {
  const rawDb = storage.getRawDatabase();

  const registryEntries = loadRegistry();
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir: join(tmpdir(), `test-plugins-${randomUUID()}`),
    encryptionKey: SESSION_SECRET,
    registryEntries,
  });

  const authService = new AuthService(rawDb, pluginManager, storage);
  const orchestrator = new ScanOrchestrator(storage, reportsDir, 2);

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, SESSION_SECRET);

  // Auth guard (same as production server)
  const authGuard = createAuthGuard(authService);
  server.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/health') return;
    await authGuard(request, reply);
  });

  // Data API routes
  await dataApiRoutes(server, storage);

  // Health endpoint
  server.get('/health', async () => ({ status: 'ok' }));

  await server.ready();
  return server;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Data API integration', () => {
  let server: FastifyInstance;
  let storage: SqliteStorageAdapter;
  let baseUrl: string;
  let dbPath: string;
  let reportsDir: string;

  const scanIds: string[] = [];
  const ORG_ID = 'system';

  beforeAll(async () => {
    dbPath = join(tmpdir(), `test-data-api-${randomUUID()}.db`);
    reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
    mkdirSync(reportsDir, { recursive: true });

    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();

    // Store the API key in the database
    const rawDb = storage.getRawDatabase();
    storeApiKey(rawDb, API_KEY, 'integration-test');

    // Pre-seed scan records directly via the storage adapter
    for (let i = 0; i < 5; i++) {
      const scanId = randomUUID();
      scanIds.push(scanId);

      const reportPath = join(reportsDir, `${scanId}.json`);
      const report = {
        summary: {
          url: 'https://example.com',
          pagesScanned: 3,
          totalIssues: 2 + i,
          byLevel: { error: 1, warning: 1 + i, notice: 0 },
        },
        pages: [
          {
            url: 'https://example.com/page1',
            issueCount: 2 + i,
            issues: [
              {
                type: 'error',
                code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
                message: 'Img element missing alt attribute',
                selector: 'img.hero',
                wcagCriterion: '1.1.1',
                wcagTitle: 'Non-text Content',
              },
              ...(Array.from({ length: 1 + i }, (_, j) => ({
                type: 'warning',
                code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H48',
                message: `Navigation list warning ${j}`,
                selector: `nav ul:nth-child(${j})`,
                wcagCriterion: '1.3.1',
                wcagTitle: 'Info and Relationships',
              }))),
            ],
          },
        ],
      };
      writeFileSync(reportPath, JSON.stringify(report));

      await storage.scans.createScan({
        id: scanId,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: ['EU'],
        createdBy: 'test',
        createdAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
        orgId: ORG_ID,
      });

      // Mark as completed so the data API query (status='completed') returns them
      await storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        pagesScanned: 3,
        totalIssues: 2 + i,
        errors: 1,
        warnings: 1 + i,
        notices: 0,
        jsonReportPath: reportPath,
      });
    }

    server = await buildServer(storage, reportsDir);
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  }, 30_000);

  afterAll(async () => {
    await server.close();
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
  });

  // ── 1. GET /api/v1/scans — paginated JSON ──────────────────────────────
  it('returns paginated JSON with total', async () => {
    const res = await fetch(`${baseUrl}/api/v1/scans`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(5);
    expect(body.data.length).toBe(5);
  });

  // ── 2. Pagination with limit and offset ────────────────────────────────
  it('pagination works with limit=1&offset=0', async () => {
    const res = await fetch(`${baseUrl}/api/v1/scans?limit=1&offset=0`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.total).toBe(5);
  });

  // ── 3. Status filtering ────────────────────────────────────────────────
  it('status filtering returns completed scans', async () => {
    // The data API only returns completed scans by default (hardcoded WHERE status='completed')
    const res = await fetch(`${baseUrl}/api/v1/scans`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    // All returned scans should be completed
    for (const scan of body.data) {
      expect(scan.status).toBe('completed');
    }
  });

  // ── 4. GET /api/v1/scans/:id — scan details ───────────────────────────
  it('returns scan details for a valid ID', async () => {
    const scanId = scanIds[0];
    const res = await fetch(`${baseUrl}/api/v1/scans/${scanId}`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body.data.id).toBe(scanId);
    expect(body.data.siteUrl).toBe('https://example.com');
    expect(body.data).toHaveProperty('summary');
  });

  // ── 5. GET /api/v1/scans/:id — 404 for non-existent ───────────────────
  it('returns 404 for non-existent scan', async () => {
    const res = await fetch(`${baseUrl}/api/v1/scans/${randomUUID()}`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── 6. GET /api/v1/scans/:id/issues — issues with pagination ──────────
  it('returns issues with pagination', async () => {
    const scanId = scanIds[0];
    const res = await fetch(`${baseUrl}/api/v1/scans/${scanId}/issues`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThan(0);

    // Verify issue shape
    const issue = body.data[0];
    expect(issue).toHaveProperty('type');
    expect(issue).toHaveProperty('code');
    expect(issue).toHaveProperty('message');
    expect(issue).toHaveProperty('selector');
    expect(issue).toHaveProperty('pageUrl');
  });

  // ── 7. GET /api/v1/scans/:id/fixes — fix proposals ────────────────────
  it('returns fix proposals', async () => {
    const scanId = scanIds[0];
    const res = await fetch(`${baseUrl}/api/v1/scans/${scanId}/fixes`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.data)).toBe(true);
    // Fix proposals may be empty if no matching fix suggestions exist
    expect(typeof body.total).toBe('number');
  });

  // ── 8. GET /health — health status ─────────────────────────────────────
  it('returns health status', async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  // ── 9. Auth: no API key returns 401 ────────────────────────────────────
  it('returns 401 without API key', async () => {
    const res = await fetch(`${baseUrl}/api/v1/scans`);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ── 10. Auth: invalid API key returns 401 ──────────────────────────────
  it('returns 401 with invalid API key', async () => {
    const res = await fetch(`${baseUrl}/api/v1/scans`, {
      headers: { 'X-API-Key': 'invalid-key-value' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
