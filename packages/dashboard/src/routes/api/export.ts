import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../../db/index.js';
import { extractCriterion, getWcagDescription } from '../wcag-enrichment.js';
import { generateReportPdf, isPuppeteerAvailable } from '../../pdf/generator.js';
import { normalizeReportData } from '../../services/report-service.js';
import type { JsonReportFile } from '../../services/report-service.js';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------

function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  // Always quote every field to handle commas, semicolons, quotes, and newlines
  // in issue messages, selectors, and HTML context snippets.
  const escape = (val: string): string => '"' + val.replace(/"/g, '""') + '"';
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => escape(String(v ?? ''))).join(','));
  }
  // BOM + CRLF for Excel compatibility
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
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

  // ── GET /api/v1/export/scans.csv ──────────────────────────────────────────
  server.get(
    '/api/v1/export/scans.csv',
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
        s.createdAt,
        s.completedAt ?? '',
      ]);

      const csv = toCsv(headers, rows);
      const filename = `luqen-scans-${todayStamp()}.csv`;

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );

  // ── GET /api/v1/export/scans/:id/issues.xlsx — Excel export
  // ── GET /api/v1/export/scans/:id/issues.csv  — legacy URL, serves Excel
  for (const ext of ['xlsx', 'csv'] as const) {
  server.get(
    `/api/v1/export/scans/:id/issues.${ext}`,
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

      // Build issue annotation lookup
      const issueAnnotations: Record<string, Array<{ shortName: string }>> = {};
      if (raw.compliance?.issueAnnotations) {
        for (const [code, regs] of Object.entries(raw.compliance.issueAnnotations)) {
          issueAnnotations[code] = [...regs];
        }
      } else if (raw.compliance?.annotatedIssues) {
        for (const ai of raw.compliance.annotatedIssues) {
          if (ai.regulations && ai.regulations.length > 0) {
            const existing = issueAnnotations[ai.code] ?? [];
            const existingNames = new Set(existing.map((r) => r.shortName));
            const newRegs = ai.regulations
              .filter((r) => !existingNames.has(r.shortName))
              .map((r) => ({ shortName: r.shortName }));
            issueAnnotations[ai.code] = [...existing, ...newRegs];
          }
        }
      }

      // Flatten all pages into rows
      const pages: readonly ExportPage[] = raw.pages ?? (
        raw.issues && raw.issues.length > 0
          ? [{ url: raw.siteUrl ?? scan.siteUrl, issues: raw.issues }]
          : []
      );

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

          // Regulations from issue itself or from annotations
          const regs = issue.regulations ?? issueAnnotations[issue.code] ?? [];
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
          const fixSuggestion = issue.fixSuggestion
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

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Luqen';
      wb.created = new Date();
      const ws = wb.addWorksheet('Issues');

      // Header row with styling
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: [8, 8, 10, 20, 40, 40, 30, 30, 40, 10, 20, 15, 30][i] ?? 20 }));
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, size: 10 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6FA' } };

      // Data rows
      for (const row of rows) {
        const dataRow = ws.addRow(row);
        const sev = row[0];
        if (sev === 'error') dataRow.getCell(1).font = { color: { argb: 'FF8B1A1A' }, bold: true };
        else if (sev === 'warning') dataRow.getCell(1).font = { color: { argb: 'FF7A4F00' }, bold: true };
        const pri = row[1];
        if (pri === 'Critical') dataRow.getCell(2).font = { color: { argb: 'FF8B1A1A' }, bold: true };
        else if (pri === 'High') dataRow.getCell(2).font = { color: { argb: 'FF7A4F00' }, bold: true };
      }

      // Auto-filter and freeze header
      ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + headers.length)}1` };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await wb.xlsx.writeBuffer();
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
        .send(Buffer.from(buffer as ArrayBuffer));
    },
  );
  } // end for (xlsx/csv)

  // ── GET /api/v1/export/trends.csv ─────────────────────────────────────────
  server.get(
    '/api/v1/export/trends.csv',
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

      const csv = toCsv(headers, rows);
      const filename = `luqen-trends-${todayStamp()}.csv`;

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );

  // ── GET /api/v1/export/scans/:id/report.pdf ─────────────────────────────
  server.get(
    '/api/v1/export/scans/:id/report.pdf',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check puppeteer availability before doing any work
      if (!isPuppeteerAvailable()) {
        return reply.code(501).send({
          error: 'PDF generation is not available. Puppeteer is not installed on this server.',
        });
      }

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

      // Read report JSON — try DB first, then file (same as print route)
      let html: string;
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
        request.log.info({
          topActionItems: reportData.topActionItems?.length ?? 0,
          allIssueGroups: reportData.allIssueGroups?.length ?? 0,
          pages: reportData.pages?.length ?? 0,
          totalIssues: reportData.summary?.totalIssues ?? 0,
          reportSource: dbReport !== null ? 'db' : 'file',
          rawPages: (reportJson as Record<string, unknown>).pages ? (reportJson.pages?.length ?? 0) : 0,
          rawIssues: (reportJson as Record<string, unknown>).issues ? ((reportJson as Record<string, unknown>).issues as unknown[])?.length ?? 0 : 0,
        }, 'PDF export: normalizeReportData result');

        // Use the same Handlebars singleton as server.ts (helpers already registered)
        const { default: handlebars } = await import('handlebars');
        const { resolve: resolvePath, join: joinPath } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dirname = fileURLToPath(new URL('.', import.meta.url));
        const viewsDir = resolvePath(joinPath(dirname, '..', '..', 'views'));
        const templateSource = await readFile(joinPath(viewsDir, 'report-print.hbs'), 'utf-8');
        const template = handlebars.compile(templateSource);

        html = template({
          scan: {
            ...scan,
            jurisdictions: scan.jurisdictions.join(', '),
            createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
            completedAtDisplay: scan.completedAt ? new Date(scan.completedAt).toLocaleString() : '',
          },
          reportData,
          userRole: 'admin',
          isExecutiveView: false,
        });
      } catch (err) {
        request.log.error(err, 'Failed to render report HTML');
        return reply.code(500).send({ error: 'Failed to render report HTML' });
      }

      // Generate PDF from rendered HTML
      try {
        const pdfBuffer = await generateReportPdf(html, {
          format: 'A4',
          margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
        });

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

  // ── GET /api/v1/export/scans/:id/report-debug — diagnostic for PDF data ──
  server.get(
    '/api/v1/export/scans/:id/report-debug',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);
      if (scan === null || scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Scan not found or not completed' });
      }

      let reportJson: JsonReportFile | null = null;
      const dbReport = await storage.scans.getReport(scan.id);
      if (dbReport !== null) {
        reportJson = dbReport as JsonReportFile;
      } else if (scan.jsonReportPath && existsSync(scan.jsonReportPath)) {
        reportJson = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
      }

      if (reportJson === null) {
        return reply.send({ error: 'No report data', scan: { id: scan.id, jsonReportPath: scan.jsonReportPath } });
      }

      const reportData = normalizeReportData(reportJson, scan);

      return reply.send({
        source: dbReport !== null ? 'db' : 'file',
        rawKeys: Object.keys(reportJson),
        rawPagesCount: reportJson.pages?.length ?? 0,
        rawIssuesCount: (reportJson as Record<string, unknown>).issues
          ? ((reportJson as Record<string, unknown>).issues as unknown[])?.length ?? 0
          : 0,
        rawFirstPageIssues: reportJson.pages?.[0]?.issues?.length ?? 0,
        summary: reportData.summary,
        pagesCount: reportData.pages?.length ?? 0,
        allIssueGroupsCount: reportData.allIssueGroups?.length ?? 0,
        topActionItemsCount: reportData.topActionItems?.length ?? 0,
        topActionItems: reportData.topActionItems,
        templateComponentsCount: reportData.templateComponents?.length ?? 0,
      });
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
