import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ScanDb } from '../../db/scans.js';
import { extractCriterion, getWcagDescription } from '../wcag-enrichment.js';

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------

function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => escape(String(v ?? ''))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// JSON report shape (minimal subset needed for issue export)
// ---------------------------------------------------------------------------

interface JsonReportIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
  readonly regulations?: ReadonlyArray<{
    readonly shortName: string;
    readonly url?: string;
    readonly obligation?: string;
  }>;
}

interface JsonReportPage {
  readonly url: string;
  readonly issues: readonly JsonReportIssue[];
}

interface JsonReportFile {
  readonly pages?: readonly JsonReportPage[];
  readonly siteUrl?: string;
  readonly issues?: readonly JsonReportIssue[];
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
  db: ScanDb,
): Promise<void> {

  // ── GET /api/v1/export/scans.csv ──────────────────────────────────────────
  server.get(
    '/api/v1/export/scans.csv',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const scans = db.listScans({
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

  // ── GET /api/v1/export/scans/:id/issues.csv ──────────────────────────────
  server.get(
    '/api/v1/export/scans/:id/issues.csv',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (
        scan.status !== 'completed' ||
        scan.jsonReportPath === undefined ||
        !existsSync(scan.jsonReportPath)
      ) {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      let raw: JsonReportFile;
      try {
        raw = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
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
      const pages: readonly JsonReportPage[] = raw.pages ?? (
        raw.issues && raw.issues.length > 0
          ? [{ url: raw.siteUrl ?? scan.siteUrl, issues: raw.issues }]
          : []
      );

      const headers = [
        'Severity',
        'WCAG Criterion',
        'WCAG Title',
        'Message',
        'Selector',
        'Page URL',
        'Regulations',
        'Component',
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

          rows.push([
            issue.type,
            criterion ?? '',
            title,
            issue.message,
            issue.selector,
            page.url,
            regNames,
            component,
          ]);
        }
      }

      const csv = toCsv(headers, rows);
      const filename = `luqen-issues-${id}-${todayStamp()}.csv`;

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );

  // ── GET /api/v1/export/trends.csv ─────────────────────────────────────────
  server.get(
    '/api/v1/export/trends.csv',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { siteUrl?: string };
      const orgId = request.user?.currentOrgId;
      const scans = db.getTrendData(orgId);

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
