import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

// Boundary mock: only @luqen/core is faked. Everything below it (real
// SqliteStorageAdapter, real ScanOrchestrator, real reportRoutes) runs for real.
const { mockCreateScanner } = vi.hoisted(() => ({ mockCreateScanner: vi.fn() }));

vi.mock('@luqen/core', () => ({
  createScanner: mockCreateScanner,
  discoverUrls: vi.fn(),
  scanUrls: vi.fn(),
  WebserviceClient: vi.fn(),
  WebservicePool: vi.fn(),
  DirectScanner: vi.fn(),
  computeContentHashes: vi.fn().mockResolvedValue(new Map()),
}));

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { ScanProgressEvent } from '../../src/scanner/orchestrator.js';
import { loadTranslations } from '../../src/i18n/index.js';

loadTranslations();

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

function waitForScan(orchestrator: ScanOrchestrator, scanId: string, timeoutMs = 5000): Promise<ScanProgressEvent[]> {
  return new Promise((resolve, reject) => {
    const events: ScanProgressEvent[] = [];
    const timer = setTimeout(() => reject(new Error('Scan timed out')), timeoutMs);
    const listener = (event: ScanProgressEvent): void => {
      events.push(event);
      if (event.type === 'complete' || event.type === 'failed') {
        clearTimeout(timer);
        orchestrator.off(scanId, listener);
        resolve(events);
      }
    };
    orchestrator.on(scanId, listener);
  });
}

async function makeScanResult(pages: Array<{ url: string; issues: unknown[] }>, wafWarning?: string) {
  return {
    pages: pages.map((p) => ({ ...p, issueCount: p.issues.length })),
    summary: { pagesScanned: pages.length, byLevel: { error: 0, warning: 0, notice: 0 } },
    ...(wafWarning !== undefined ? { wafWarning } : {}),
  };
}

describe('discovery-blocked end-to-end (WAF-SURFACE-1)', () => {
  let dbPath: string;
  let reportsDir: string;
  let storage: SqliteStorageAdapter;
  let orchestrator: ScanOrchestrator;
  let server: FastifyInstance;
  let flaggedScanId: string;
  let unflaggedScanId: string;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `test-waf-e2e-${randomUUID()}.db`);
    reportsDir = join(tmpdir(), `test-waf-e2e-reports-${randomUUID()}`);
    mkdirSync(reportsDir, { recursive: true });

    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();

    orchestrator = new ScanOrchestrator(storage, reportsDir, 2);

    server = Fastify({ logger: false });
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
      request.user = { id: 'user-1', username: 'testuser', role: 'admin', currentOrgId: 'system' };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set(['reports.view', 'llm.view']);
    });
    await reportRoutes(server, storage, () => null);
    await server.ready();

    // Flagged scan: mocked scanner reports one page + a WAF challenge.
    flaggedScanId = randomUUID();
    await storage.scans.createScan({
      id: flaggedScanId,
      siteUrl: 'https://waf-example.test',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'testuser',
      createdAt: new Date().toISOString(),
      orgId: 'system',
    });
    mockCreateScanner.mockReturnValueOnce({
      scan: vi.fn().mockResolvedValue(
        await makeScanResult([{ url: 'https://waf-example.test', issues: [] }], 'W'),
      ),
    });
    const flaggedEvents = waitForScan(orchestrator, flaggedScanId);
    orchestrator.startScan(flaggedScanId, {
      siteUrl: 'https://waf-example.test',
      standard: 'WCAG2AA',
      concurrency: 2,
      jurisdictions: [],
      regulations: [],
      scanMode: 'site',
      webserviceUrl: 'http://localhost:4000',
    });
    await flaggedEvents;

    // Unflagged scan: mocked scanner reports one page, no WAF key at all.
    unflaggedScanId = randomUUID();
    await storage.scans.createScan({
      id: unflaggedScanId,
      siteUrl: 'https://clean-example.test',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'testuser',
      createdAt: new Date().toISOString(),
      orgId: 'system',
    });
    mockCreateScanner.mockReturnValueOnce({
      scan: vi.fn().mockResolvedValue(
        await makeScanResult([{ url: 'https://clean-example.test', issues: [] }]),
      ),
    });
    const unflaggedEvents = waitForScan(orchestrator, unflaggedScanId);
    orchestrator.startScan(unflaggedScanId, {
      siteUrl: 'https://clean-example.test',
      standard: 'WCAG2AA',
      concurrency: 2,
      jurisdictions: [],
      regulations: [],
      scanMode: 'site',
      webserviceUrl: 'http://localhost:4000',
    });
    await unflaggedEvents;
  }, 20000);

  afterAll(async () => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    await server.close();
  });

  it('flagged scan persists discoveryWarning on the record', async () => {
    const record = await storage.scans.getScan(flaggedScanId);
    expect(record?.discoveryWarning).toBe('waf-blocked');
    expect(record?.pagesScanned).toBe(1);
    expect(record?.status).toBe('completed');
  });

  it('flagged scan keeps discoveryWarning in list reads', async () => {
    const rows = await storage.scans.listScans({ orgId: 'system' });
    const row = rows.find((r) => r.id === flaggedScanId);
    expect(row?.discoveryWarning).toBe('waf-blocked');
  });

  it('report route hands discoveryWarning to the template', async () => {
    const response = await server.inject({ method: 'GET', url: `/reports/${flaggedScanId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string; data: { scan: { discoveryWarning?: string } } };
    expect(body.template).toBe('report-detail.hbs');
    expect(body.data.scan.discoveryWarning).toBe('waf-blocked');
  });

  it('unflagged site scan has no discoveryWarning', async () => {
    const record = await storage.scans.getScan(unflaggedScanId);
    expect(record).not.toBeNull();
    expect('discoveryWarning' in (record as object)).toBe(false);
  });

  it('unknown stored value is not surfaced', async () => {
    await storage.scans.updateScan(unflaggedScanId, { discoveryWarning: 'bogus' } as never);
    const record = await storage.scans.getScan(unflaggedScanId);
    expect('discoveryWarning' in (record as object)).toBe(false);
  });
});
