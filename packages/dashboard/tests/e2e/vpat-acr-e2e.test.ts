import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { exportRoutes } from '../../src/routes/api/export.js';
import { registerSession } from '../../src/auth/session.js';
import { loadTranslations, t as translate, type Locale } from '../../src/i18n/index.js';
import Handlebars from 'handlebars';
import JSZip from 'jszip';

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
  uploadsDir: string;
  dbPath: string;
  cleanup: () => void;
}

let ctx: Ctx;

// A minimal valid 1×1 PNG — enough for PDFKit's doc.image to embed.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Records one manual-test evidence artifact for a scan+criterion. When `bytes`
 * is supplied, the file is also written under the uploads root so the PDF
 * renderer can resolve and embed it.
 */
async function seedEvidence(
  storage: SqliteStorageAdapter,
  uploadsDir: string,
  args: { scanId: string; criterionId: string; fileName: string; mimeType: string; bytes?: Buffer },
): Promise<void> {
  if (args.bytes) {
    const dir = join(uploadsDir, 'system', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, args.fileName), args.bytes);
  }
  await storage.manualTestEvidence.addEvidence({
    scanId: args.scanId,
    criterionId: args.criterionId,
    filePath: `/uploads/system/evidence/${args.fileName}`,
    fileName: args.fileName,
    mimeType: args.mimeType,
    orgId: 'system',
  });
}

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
  const uploadsDir = join(tmpdir(), `test-vpat-uploads-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });

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
  await exportRoutes(server, storage, uploadsDir);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, uploadsDir, dbPath, cleanup };
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

    it('renders the manual-test evidence appendix with image thumbnails and document links', async () => {
      const id = await seedCompletedScan(ctx.storage);
      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.1.1', fileName: 'screenshot-alt.png', mimeType: 'image/png',
      });
      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.1.1', fileName: 'sr-transcript.pdf', mimeType: 'application/pdf',
      });
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });

      expect(res.statusCode).toBe(200);
      const html = res.body;
      // Appendix heading (i18n en) + intro.
      expect(html).toContain('Manual test evidence');
      // Image evidence rendered as a thumbnail <img> pointing at the served path.
      expect(html).toContain('<img src="/uploads/system/evidence/screenshot-alt.png"');
      // Document evidence rendered as a filename link.
      expect(html).toContain('href="/uploads/system/evidence/sr-transcript.pdf"');
      expect(html).toContain('sr-transcript.pdf');
      // The evidence-pack download button is offered when evidence exists.
      expect(html).toContain(`/api/v1/export/scans/${id}/vpat-pack.zip`);
    });

    it('omits the evidence appendix and pack button when no evidence is recorded', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({ method: 'GET', url: `/reports/${id}/vpat` });
      expect(res.body).not.toContain('Manual test evidence');
      expect(res.body).not.toContain('vpat-pack.zip');
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

    it('embeds image evidence and lists documents in the ACR PDF appendix', async () => {
      const id = await seedCompletedScan(ctx.storage);
      // Baseline PDF (no evidence) for a size comparison.
      const baseline = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${id}/vpat.pdf` });
      expect(baseline.statusCode).toBe(200);

      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.1.1', fileName: 'shot.png', mimeType: 'image/png', bytes: PNG_1X1,
      });
      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.1.1', fileName: 'notes.pdf', mimeType: 'application/pdf',
      });

      const withEv = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${id}/vpat.pdf` });
      expect(withEv.statusCode).toBe(200);
      expect(withEv.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // The evidence appendix (embedded PNG + listed document) enlarges the PDF.
      expect(withEv.rawPayload.length).toBeGreaterThan(baseline.rawPayload.length);
    });
  });

  // ── ZIP evidence pack ──────────────────────────────────────────────────────

  describe('GET /api/v1/export/scans/:id/vpat-pack.zip', () => {
    it('bundles the ACR PDF, the original evidence files (foldered by criterion) and an index', async () => {
      const id = await seedCompletedScan(ctx.storage);
      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.1.1', fileName: 'shot.png', mimeType: 'image/png', bytes: PNG_1X1,
      });
      await seedEvidence(ctx.storage, ctx.uploadsDir, {
        scanId: id, criterionId: '1.4.3', fileName: 'transcript.pdf', mimeType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4 fake transcript'),
      });

      const res = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${id}/vpat-pack.zip` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');
      expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="vpat-evidence-pack_.*\.zip"/);

      const zip = await JSZip.loadAsync(res.rawPayload);
      const names = Object.keys(zip.files);
      expect(names).toContain('accessibility-conformance-report.pdf');
      expect(names).toContain('EVIDENCE-INDEX.txt');
      expect(names).toContain('evidence/1.1.1/shot.png');
      expect(names).toContain('evidence/1.4.3/transcript.pdf');

      // The bundled report is a real PDF.
      const pdfEntry = zip.file('accessibility-conformance-report.pdf');
      expect(pdfEntry).not.toBeNull();
      const pdfBytes = await pdfEntry!.async('nodebuffer');
      expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // The index references the site and the bundled files.
      const indexEntry = zip.file('EVIDENCE-INDEX.txt');
      expect(indexEntry).not.toBeNull();
      const index = await indexEntry!.async('string');
      expect(index).toContain('vpat-test.example.com');
      expect(index).toContain('evidence/1.1.1/shot.png');
      expect(index).toContain('Files bundled: 2');
    });

    it('still produces a pack (PDF + index) when no evidence is recorded', async () => {
      const id = await seedCompletedScan(ctx.storage);
      const res = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${id}/vpat-pack.zip` });
      expect(res.statusCode).toBe(200);
      const zip = await JSZip.loadAsync(res.rawPayload);
      expect(Object.keys(zip.files)).toContain('accessibility-conformance-report.pdf');
      const indexEntry = zip.file('EVIDENCE-INDEX.txt');
      expect(indexEntry).not.toBeNull();
      expect(await indexEntry!.async('string')).toContain('No manual-test evidence');
    });

    it('returns 404 for a non-existent scan', async () => {
      const res = await ctx.server.inject({ method: 'GET', url: `/api/v1/export/scans/${randomUUID()}/vpat-pack.zip` });
      expect(res.statusCode).toBe(404);
    });
  });
});
