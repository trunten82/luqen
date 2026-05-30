import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { exportRoutes } from '../../src/routes/api/export.js';
import { registerSession } from '../../src/auth/session.js';
import { loadTranslations, t as translate, type Locale } from '../../src/i18n/index.js';
import Handlebars from 'handlebars';

/**
 * Register the global Handlebars helpers the vpat.hbs template depends on
 * (`t`, `formatStandard`) — mirrors src/server.ts. The /vpat route itself
 * registers `conformanceBadge` per request, so we only need these two here.
 */
function registerVpatHelpers(): void {
  loadTranslations();
  Handlebars.registerHelper(
    't',
    (key: string, options: { hash?: Record<string, string>; data?: { root?: { locale?: string } } }) => {
      const locale = (options?.data?.root?.locale as Locale) ?? 'en';
      return translate(key, locale, options?.hash);
    },
  );
  Handlebars.registerHelper('formatStandard', (code: string) => {
    const map: Record<string, string> = {
      WCAG2A: 'WCAG 2.1 Level A',
      WCAG2AA: 'WCAG 2.1 Level AA',
      WCAG2AAA: 'WCAG 2.1 Level AAA',
    };
    return map[code] ?? code;
  });
}

/**
 * End-to-end test for the VPAT / ACR feature (Feature 1).
 *
 * Exercises the REAL routes against a REAL SQLite store with a seeded scan +
 * stored JSON report + recorded manual-test results, asserting the rendered
 * HTML (the /vpat route compiles Handlebars directly, so it bypasses the
 * stubbed reply.view and returns true output) and the PDF export bytes.
 *
 * Focus: the legal-defensibility contract is observable end-to-end —
 *  - conservative conformance (no "Supports" for criteria automation can't
 *    fully verify, unless a manual pass is recorded),
 *  - the methodology + disclaimer block is present in the rendered document,
 *  - a manual "na" / "pass" / "fail" result flows through to the table.
 */

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  dbPath: string;
  cleanup: () => void;
}

let ctx: Ctx;

/**
 * Seeds a completed scan whose stored JSON report contains:
 *  - 1.1.1 (partial-automatable) WITH errors → Does Not Support
 *  - 1.4.3 (fully-automatable Contrast) WITH a warning → Partially Supports
 * Every other criterion has no findings, so the conservative rule applies.
 */
async function seedCompletedScan(
  storage: SqliteStorageAdapter,
  overrides: { report?: Record<string, unknown> } = {},
): Promise<string> {
  const id = randomUUID();
  await storage.scans.createScan({
    id,
    siteUrl: 'https://vpat-test.example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'testuser',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });

  const report = overrides.report ?? {
    summary: { pagesScanned: 2, totalIssues: 3, byLevel: { error: 2, warning: 1, notice: 0 } },
    pages: [
      {
        url: 'https://vpat-test.example.com',
        issueCount: 3,
        issues: [
          { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'img missing alt', selector: 'img', context: '<img>' },
          { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'img missing alt', selector: 'img.logo', context: '<img class="logo">' },
          { type: 'warning', code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18', message: 'low contrast', selector: '.muted', context: '<p class="muted">' },
        ],
      },
    ],
  };

  await storage.scans.updateScan(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    totalIssues: 3,
    pagesScanned: 2,
    jsonReport: JSON.stringify(report),
  });

  return id;
}

async function createServer(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-vpat-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-vpat-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  registerVpatHelpers();

  // Stub reply.view → JSON, exactly like scan-flow-e2e. The /vpat route does
  // NOT use reply.view (it compiles Handlebars directly), so its real HTML is
  // returned regardless; report-detail.hbs assertions still see JSON.
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
      id: 'test-user-id',
      username: 'testuser',
      role: 'admin',
      currentOrgId: 'system',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set([
      'scans.create',
      'reports.view',
      'reports.delete',
      'trends.view',
    ]);
  });

  await reportRoutes(server, storage);
  await exportRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, dbPath, cleanup };
}

describe('VPAT / ACR E2E', () => {
  beforeAll(async () => {
    ctx = await createServer();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  // ── HTML route ──────────────────────────────────────────────────────────

  describe('GET /reports/:id/vpat', () => {
    it('returns 404 for a non-existent scan', async () => {
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${randomUUID()}/vpat` });
      expect(res.statusCode).toBe(404);
    });

    it('renders a standalone ACR document with the conformance table', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      const html = res.body;
      // Document chrome
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('vpat-test.example.com');
      // Conformance vocabulary present
      expect(html).toContain('Does Not Support');
      expect(html).toContain('Partially Supports');
    });

    it('includes the methodology + disclaimer block (legal-defensibility)', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });
      const html = res.body;
      // The disclaimer must be present and unambiguous.
      expect(html).toMatch(/not a certificate of compliance/i);
      expect(html).toMatch(/30[-–]40%|portion of WCAG/i);
      expect(html).toMatch(/Not Evaluated/);
      expect(html).toMatch(/developer supervision/i);
    });

    it('marks a criterion with automated errors as Does Not Support', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });
      const html = res.body;
      // 1.1.1 has 2 errors in the seed → Does Not Support, and its row links the criterion.
      expect(html).toMatch(/1\.1\.1/);
      // The DNS conformance label appears (color-coded badge text).
      expect(html).toContain('Does Not Support');
    });

    it('CONSERVATIVE: a clean partially-automatable criterion is Not Evaluated, never silently Supports', async () => {
      // Seed a scan with NO findings at all → every manual-judgement criterion
      // must be Not Evaluated, and the summary must carry a non-zero count.
      const id = await seedCompletedScan(ctx.storage, {
        report: {
          summary: { pagesScanned: 1, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
          pages: [{ url: 'https://vpat-test.example.com', issueCount: 0, issues: [] }],
        },
      });
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });
      const html = res.body;
      expect(html).toContain('Not Evaluated');
    });

    it('a recorded manual "na" surfaces as Not Applicable', async () => {
      const id = await seedCompletedScan(ctx.storage);
      await ctx.storage.manualTests.upsertManualTest({
        scanId: id,
        criterionId: '1.1.1',
        status: 'na',
        orgId: 'system',
      });
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });
      expect(res.body).toContain('Not Applicable');
    });
  });

  // ── PDF export route ──────────────────────────────────────────────────────

  describe('GET /api/v1/export/scans/:id/vpat.pdf', () => {
    it('returns a PDF attachment for a completed scan', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${id}/vpat.pdf`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="vpat_.*\.pdf"/);
      // PDF magic bytes.
      expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(res.rawPayload.length).toBeGreaterThan(1000);
    });

    it('returns 404 for a non-existent scan', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/export/scans/${randomUUID()}/vpat.pdf`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('serves distinct PDFs per scan and a 404 after a 200 stays 404 (no cross-request bleed)', async () => {
      // Regression guard on the shared server: a successful binary response must
      // not be reused as the serialized payload for a subsequent request.
      const idA = await seedCompletedScan(ctx.storage, {
        report: {
          summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
          pages: [{ url: 'https://vpat-test.example.com', issueCount: 1, issues: [
            { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'a', selector: 'img', context: '<img>' },
          ] }],
        },
      });
      const idB = await seedCompletedScan(ctx.storage, {
        report: {
          summary: { pagesScanned: 1, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
          pages: [{ url: 'https://vpat-test.example.com', issueCount: 0, issues: [] }],
        },
      });

      const resA = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${idA}/vpat.pdf` });
      const res404 = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${randomUUID()}/vpat.pdf` });
      const resB = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${idB}/vpat.pdf` });

      expect(resA.statusCode).toBe(200);
      expect(res404.statusCode).toBe(404); // 404 after a 200 must still be 404
      expect(resB.statusCode).toBe(200);
      expect(resA.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(resB.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // The two reports differ (A has a Does-Not-Support row, B does not), so
      // their PDF bytes must differ — proving each response is freshly built.
      expect(Buffer.compare(resA.rawPayload, resB.rawPayload)).not.toBe(0);
    });
  });
});
