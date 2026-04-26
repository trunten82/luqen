import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../../db/index.js';
import { extractCriterion, getWcagDescription } from '../wcag-enrichment.js';
import { generatePdfFromData } from '../../pdf/generator.js';
import type { PdfReportData, PdfScanMeta } from '../../pdf/generator.js';
import { normalizeReportData, inferComponent } from '../../services/report-service.js';
import type { JsonReportFile } from '../../services/report-service.js';
import ExcelJS from 'exceljs';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';

// Export endpoints stream binary buffers — schemas declare a string body and
// the correct `produces` content-type so the OpenAPI spec accurately reflects
// the response shape.
const XlsxProduces = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const PdfProduces = ['application/pdf'];

const ScanExportIdParamsSchema = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);
const TrendsExportQuerystringSchema = Type.Object(
  { siteUrl: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

// ---------------------------------------------------------------------------
// Excel helper — single source of truth for all scan-data workbook exports
// ---------------------------------------------------------------------------

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function buildXlsx(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  columnWidths?: readonly number[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luqen';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);

  ws.columns = headers.map((h, i) => ({
    header: h,
    key: `col${i}`,
    width: columnWidths?.[i] ?? 20,
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF5F6FA' },
  };

  for (const row of rows) {
    ws.addRow([...row]);
  }

  // Auto-filter across all columns, freeze header row
  ws.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + headers.length)}1`,
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function siteSlug(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// JSON report shape (minimal subset needed for Excel/CSV issue export)
// ---------------------------------------------------------------------------

interface ExportIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
  readonly fixSuggestion?: string;
  readonly regulations?: ReadonlyArray<{
    readonly shortName: string;
    readonly url?: string;
    readonly obligation?: string;
  }>;
}

interface ExportPage {
  readonly url: string;
  readonly issues: readonly ExportIssue[];
}

interface ExportReportFile {
  readonly pages?: readonly ExportPage[];
  readonly siteUrl?: string;
  readonly issues?: readonly ExportIssue[];
  readonly compliance?: {
    readonly issueAnnotations?: Record<
      string,
      ReadonlyArray<{ readonly shortName: string; readonly url?: string; readonly obligation?: string }>
    >;
    readonly annotatedIssues?: ReadonlyArray<{
      readonly code: string;
      readonly regulations?: ReadonlyArray<{ readonly shortName: string; readonly obligation?: string }>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function exportRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  // ── GET /api/v1/export/scans.xlsx ─────────────────────────────────────────
  // Scans listing workbook. Mirrors the data the legacy CSV endpoint produced
  // (retired — CSV was unreliable with quoted context strings and multi-byte
  // payloads). Excel is the only supported listing format.
  server.get(
    '/api/v1/export/scans.xlsx',
    {
      schema: {
        tags: ['export'],
        response: { 200: Type.String(), 401: ErrorEnvelope },
        produces: XlsxProduces,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const scans = await storage.scans.listScans({
        ...(orgId !== 'system' ? { orgId } : {}),
        limit: 10_000,
        offset: 0,
      });

      const headers = [
        'Scan ID',
        'Site URL',
        'Standard',
        'Status',
        'Pages Scanned',
        'Total Issues',
        'Errors',
        'Warnings',
        'Notices',
        'Confirmed Violations',
        'Jurisdictions',
        // REG-06: Regulations column positioned immediately after Jurisdictions.
        // Always emitted so the format is stable regardless of selection.
        'Regulations',
        'Created At',
        'Completed At',
      ];

      const rows = scans.map((s) => [
        s.id,
        s.siteUrl,
        s.standard,
        s.status,
        String(s.pagesScanned ?? 0),
        String(s.totalIssues ?? 0),
        String(s.errors ?? 0),
        String(s.warnings ?? 0),
        String(s.notices ?? 0),
        String(s.confirmedViolations ?? 0),
        s.jurisdictions.join('; '),
        // Mirrors the jurisdictions join separator for consistency (REG-06).
        (s.regulations ?? []).join('; '),
        s.createdAt,
        s.completedAt ?? '',
      ]);

      const buffer = await buildXlsx(
        'Scans',
        headers,
        rows,
        [38, 40, 10, 12, 12, 12, 10, 10, 10, 12, 20, 20, 22, 22],
      );
      const filename = `luqen-scans-${todayStamp()}.xlsx`;

      return reply
        .header('Content-Type', XLSX_CONTENT_TYPE)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );

  // ── GET /api/v1/export/scans/:id/issues.xlsx — per-report issues workbook
  server.get(
    '/api/v1/export/scans/:id/issues.xlsx',
    {
      schema: {
        tags: ['export'],
        params: ScanExportIdParamsSchema,
        response: {
          200: Type.String(),
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
        produces: XlsxProduces,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      let raw: ExportReportFile;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          raw = dbReport as ExportReportFile;
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          raw = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as ExportReportFile;
        } else {
          return reply.code(404).send({ error: 'Report data not available' });
        }
      } catch {
        return reply.code(500).send({ error: 'Failed to read report data' });
      }

      // Use normalizeReportData as single source of truth for enriched
      // issues (includes WCAG metadata, regulation annotations, etc.)
      const normalized = normalizeReportData(raw as JsonReportFile, scan);

      // Flatten all pages into rows (enriched pages have regulations attached)
      const pages = normalized.pages;

      // Build page occurrence counts per issue code for "Affected Pages" column
      const issuePageCounts = new Map<string, number>();
      for (const page of pages) {
        const codesOnPage = new Set<string>();
        for (const issue of page.issues) {
          codesOnPage.add(issue.code);
        }
        for (const code of codesOnPage) {
          issuePageCounts.set(code, (issuePageCounts.get(code) ?? 0) + 1);
        }
      }
      const totalPages = pages.length;

      const headers = [
        'Severity',
        'Priority',
        'WCAG Criterion',
        'WCAG Title',
        'Message',
        'Suggested Fix',
        'Selector',
        'Context',
        'Page URL',
        'Affected Pages',
        'Regulations',
        'Component',
        'Code',
      ];

      const rows: string[][] = [];

      for (const page of pages) {
        for (const issue of page.issues) {
          const criterion = issue.wcagCriterion ?? extractCriterion(issue.code);
          const wcag = criterion ? getWcagDescription(criterion) : null;
          const title = issue.wcagTitle ?? wcag?.title ?? '';

          // Regulations from enriched issue (normalizeReportData merges annotations)
          const regs = issue.regulations ?? [];
          const regNames = regs.map((r) => r.shortName).join('; ');

          // Infer component from selector + context
          const component = inferComponentForExport(issue.selector, issue.context);

          // Affected pages count for this issue code
          const affectedPages = issuePageCounts.get(issue.code) ?? 1;

          // Priority: regulatory errors first, then by severity and spread
          const severityScore = issue.type === 'error' ? 3 : issue.type === 'warning' ? 2 : 1;
          const regulatoryScore = regs.length > 0 ? 2 : 0;
          const spreadScore = affectedPages >= totalPages * 0.5 ? 1 : 0;
          const priorityNum = severityScore + regulatoryScore + spreadScore;
          const priority = priorityNum >= 5 ? 'Critical' : priorityNum >= 4 ? 'High' : priorityNum >= 3 ? 'Medium' : 'Low';

          // Suggested fix from fix engine or generate from WCAG reference
          const fixSuggestion = (issue as Record<string, unknown>).fixSuggestion as string | undefined
            ?? (wcag ? `Refer to WCAG ${criterion}: ${wcag.title} — ${wcag.url ?? ''}` : '');

          rows.push([
            issue.type,
            priority,
            criterion ?? '',
            title,
            issue.message,
            fixSuggestion,
            issue.selector,
            (issue.context ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200),
            page.url,
            `${affectedPages}/${totalPages}`,
            regNames,
            component,
            issue.code,
          ]);
        }
      }

      const filename = `luqen-issues-${siteSlug(scan.siteUrl)}-${todayStamp()}`;

      // Build workbook with a single 'Issues' sheet. Per-row severity/priority
      // colouring is specific to this sheet so it uses its own inline builder
      // rather than the shared buildXlsx helper. The Regulations column is
      // now filtered at the compliance engine layer to match the scan's
      // explicit regulation selection, so developers can pivot/filter the
      // raw grid to reconstruct scan-level context without a separate sheet.
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Luqen';
      wb.created = new Date();
      const ws = wb.addWorksheet('Issues');
      ws.columns = headers.map((h, i) => ({
        header: h,
        key: `col${i}`,
        width: [8, 8, 10, 20, 40, 40, 30, 30, 40, 10, 20, 15, 30][i] ?? 20,
      }));
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, size: 10 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F6FA' },
      };

      for (const row of rows) {
        const dataRow = ws.addRow(row);
        const sev = row[0];
        if (sev === 'error') dataRow.getCell(1).font = { color: { argb: 'FF8B1A1A' }, bold: true };
        else if (sev === 'warning') dataRow.getCell(1).font = { color: { argb: 'FF7A4F00' }, bold: true };
        const pri = row[1];
        if (pri === 'Critical') dataRow.getCell(2).font = { color: { argb: 'FF8B1A1A' }, bold: true };
        else if (pri === 'High') dataRow.getCell(2).font = { color: { argb: 'FF7A4F00' }, bold: true };
      }

      ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + headers.length)}1` };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await wb.xlsx.writeBuffer();
      return reply
        .header('Content-Type', XLSX_CONTENT_TYPE)
        .header('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
        .send(Buffer.from(buffer as ArrayBuffer));
    },
  );

  // ── GET /api/v1/export/trends.xlsx ────────────────────────────────────────
  server.get(
    '/api/v1/export/trends.xlsx',
    {
      schema: {
        tags: ['export'],
        querystring: TrendsExportQuerystringSchema,
        response: { 200: Type.String(), 401: ErrorEnvelope },
        produces: XlsxProduces,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { siteUrl?: string };
      const orgId = request.user?.currentOrgId;
      const scans = await storage.scans.getTrendData(orgId);

      const filtered = query.siteUrl
        ? scans.filter((s) => s.siteUrl === query.siteUrl)
        : scans;

      const headers = [
        'Site URL',
        'Date',
        'Pages Scanned',
        'Total Issues',
        'Errors',
        'Warnings',
        'Notices',
        'Confirmed Violations',
      ];

      const rows = filtered.map((s) => [
        s.siteUrl,
        s.createdAt,
        String(s.pagesScanned ?? 0),
        String(s.totalIssues ?? 0),
        String(s.errors ?? 0),
        String(s.warnings ?? 0),
        String(s.notices ?? 0),
        String(s.confirmedViolations ?? 0),
      ]);

      const buffer = await buildXlsx(
        'Trends',
        headers,
        rows,
        [40, 22, 14, 14, 10, 12, 10, 18],
      );
      const filename = `luqen-trends-${todayStamp()}.xlsx`;

      return reply
        .header('Content-Type', XLSX_CONTENT_TYPE)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );

  // ── GET /api/v1/export/scans/:id/report.pdf ─────────────────────────────
  server.get(
    '/api/v1/export/scans/:id/report.pdf',
    {
      schema: {
        tags: ['export'],
        params: ScanExportIdParamsSchema,
        response: {
          200: Type.String(),
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
        produces: PdfProduces,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      try {
        let reportJson: JsonReportFile | null = null;
        const dbReport = await storage.scans.getReport(scan.id);
        if (dbReport !== null) {
          reportJson = dbReport as JsonReportFile;
        } else if (scan.jsonReportPath && existsSync(scan.jsonReportPath)) {
          reportJson = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
        }

        if (reportJson === null) {
          return reply.code(404).send({ error: 'Report data not available' });
        }

        const reportData = normalizeReportData(reportJson, scan);

        const scanMeta: PdfScanMeta = {
          siteUrl: scan.siteUrl,
          standard: scan.standard,
          jurisdictions: scan.jurisdictions.join(', '),
          // REG-06: surface regulation selection in the PDF subtitle. Empty
          // string produces no segment (matches the Jurisdictions omit-when-empty pattern).
          regulations: (scan.regulations ?? []).join(', '),
          createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        };

        const pdfBuffer = await generatePdfFromData(scanMeta, reportData as PdfReportData);

        let hostname: string;
        try {
          hostname = new URL(scan.siteUrl).hostname;
        } catch {
          hostname = scan.siteUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
        }
        const filename = `luqen-report-${hostname}-${todayStamp()}.pdf`;

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(pdfBuffer);
      } catch (err) {
        request.log.error(err, 'PDF generation failed');
        return reply.code(500).send({ error: 'PDF generation failed' });
      }
    },
  );

}

// ---------------------------------------------------------------------------
// Lightweight component inference (mirrors reports.ts logic)
// ---------------------------------------------------------------------------

function inferComponentForExport(selector: string, context: string): string {
  const s = (selector + ' ' + context).toLowerCase();

  if (s.includes('cookie') || s.includes('consent') || s.includes('iubenda') || s.includes('gdpr') || s.includes('onetrust')) return 'Cookie Banner';
  if (/\bnav(igation|bar)?\b/.test(s) || s.includes('offcanvas') || s.includes('menu') || s.includes('hamburger') || s.includes('sidebar')) return 'Navigation';
  if (/\bheader\b/.test(s) || s.includes('site-header') || s.includes('masthead') || s.includes('topbar') || s.includes('top-bar')) return 'Header';
  if (/\bfooter\b/.test(s) || s.includes('site-footer') || s.includes('colophon')) return 'Footer';
  if (s.includes('html > head') || s.includes('<title') || s.includes('<meta') || s.includes('<link')) return 'Document Head';
  if (s.includes('<form') || s.includes('<input') || s.includes('<select') || s.includes('<textarea') || s.includes('search-form') || s.includes('login-form')) return 'Form';
  if (s.includes('modal') || s.includes('popup') || s.includes('dialog') || s.includes('lightbox') || s.includes('overlay')) return 'Modal / Popup';
  if (s.includes('social') || s.includes('share') || s.includes('facebook') || s.includes('twitter') || s.includes('instagram') || s.includes('linkedin') || s.includes('whatsapp')) return 'Social Links';
  if (s.includes('<img') || s.includes('<video') || s.includes('<audio') || s.includes('carousel') || s.includes('slider') || s.includes('gallery') || s.includes('swiper')) return 'Media / Carousel';
  if (/\bcard\b/.test(s) || s.includes('listing') || s.includes('grid-item') || s.includes('post-item') || s.includes('product-card')) return 'Card / Listing';
  if (s.includes('breadcrumb')) return 'Breadcrumb';
  if (s.includes('widget') || /\baside\b/.test(s) || s.includes('sidebar')) return 'Widget / Sidebar';
  if (s.includes('cta') || s.includes('call-to-action') || s.includes('banner') || s.includes('hero')) return 'CTA / Banner';

  return 'Shared Layout';
}
