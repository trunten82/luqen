import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanRecord } from '../db/types.js';
import { extractCriterion, getWcagDescription } from '../routes/wcag-enrichment.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// Minimal JSON report shape (subset needed for email report generation)
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
  readonly summary?: {
    readonly url?: string;
    readonly pagesScanned?: number;
    readonly totalIssues?: number;
    readonly byLevel?: { readonly error: number; readonly warning: number; readonly notice: number };
  };
  readonly pages?: readonly JsonReportPage[];
  readonly siteUrl?: string;
  readonly pagesScanned?: number;
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
// Generate printable HTML report (reuse report-print.hbs template)
// ---------------------------------------------------------------------------

export async function generateReportHtml(
  scan: ScanRecord,
  reportJsonPath: string,
): Promise<string | null> {
  if (!existsSync(reportJsonPath)) return null;

  let raw: JsonReportFile;
  try {
    raw = JSON.parse(await readFile(reportJsonPath, 'utf-8')) as JsonReportFile;
  } catch {
    return null;
  }

  // We compile the print template directly with Handlebars (same approach as
  // the /reports/:id/print route).
  const handlebars = (await import('handlebars')).default;
  const viewsDir = resolve(join(__dirname, '..', 'views'));
  const templatePath = join(viewsDir, 'report-print.hbs');

  if (!existsSync(templatePath)) return null;

  const templateSource = await readFile(templatePath, 'utf-8');
  const template = handlebars.compile(templateSource);

  // Import normalizeReportData dynamically to avoid circular deps — we
  // reconstruct a lightweight version inline instead.
  const summary = raw.summary ?? {
    url: raw.siteUrl ?? scan.siteUrl,
    pagesScanned: raw.pagesScanned ?? scan.pagesScanned ?? 0,
    pagesFailed: 0,
    totalIssues: (scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0),
    byLevel: {
      error: scan.errors ?? 0,
      warning: scan.warnings ?? 0,
      notice: scan.notices ?? 0,
    },
  };

  const pages = raw.pages ?? (
    raw.issues && raw.issues.length > 0
      ? [{ url: raw.siteUrl ?? scan.siteUrl, issueCount: raw.issues.length, issues: raw.issues }]
      : []
  );

  const scanMeta = {
    ...scan,
    jurisdictions: scan.jurisdictions.join(', '),
    createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
    completedAtDisplay: scan.completedAt
      ? new Date(scan.completedAt).toLocaleString()
      : '',
  };

  const reportData = {
    summary,
    pages,
    errors: [],
    compliance: null,
    complianceMatrix: null,
    templateIssues: null,
    templateIssueCount: 0,
    templateOccurrenceCount: 0,
    templateComponents: [],
    allIssueGroups: [],
    regulatoryIssueCount: 0,
    templateIssueTotal: 0,
  };

  const html = template({
    scan: scanMeta,
    reportData,
    userRole: 'admin',
    isExecutiveView: false,
  });

  return html;
}

// ---------------------------------------------------------------------------
// Generate CSV content (mirrors export route logic)
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

function inferComponent(selector: string, context: string): string {
  const s = (selector + ' ' + context).toLowerCase();

  if (s.includes('cookie') || s.includes('consent') || s.includes('iubenda') || s.includes('gdpr') || s.includes('onetrust')) return 'Cookie Banner';
  if (/\bnav(igation|bar)?\b/.test(s) || s.includes('offcanvas') || s.includes('menu') || s.includes('hamburger') || s.includes('sidebar')) return 'Navigation';
  if (/\bheader\b/.test(s) || s.includes('site-header') || s.includes('masthead') || s.includes('topbar') || s.includes('top-bar')) return 'Header';
  if (/\bfooter\b/.test(s) || s.includes('site-footer') || s.includes('colophon')) return 'Footer';
  if (s.includes('html > head') || s.includes('<title') || s.includes('<meta') || s.includes('<link')) return 'Document Head';
  if (s.includes('<form') || s.includes('<input') || s.includes('<select') || s.includes('<textarea') || s.includes('search-form') || s.includes('login-form')) return 'Form';
  if (s.includes('modal') || s.includes('popup') || s.includes('dialog') || s.includes('lightbox') || s.includes('overlay')) return 'Modal / Popup';
  if (s.includes('social') || s.includes('share') || s.includes('facebook') || s.includes('twitter')) return 'Social Links';
  if (s.includes('<img') || s.includes('<video') || s.includes('<audio') || s.includes('carousel') || s.includes('slider')) return 'Media / Carousel';
  if (/\bcard\b/.test(s) || s.includes('listing') || s.includes('grid-item')) return 'Card / Listing';
  if (s.includes('breadcrumb')) return 'Breadcrumb';
  if (s.includes('widget') || /\baside\b/.test(s)) return 'Widget / Sidebar';
  if (s.includes('cta') || s.includes('call-to-action') || s.includes('banner') || s.includes('hero')) return 'CTA / Banner';

  return 'Shared Layout';
}

export async function generateIssuesCsv(
  scan: ScanRecord,
  reportJsonPath: string,
): Promise<string | null> {
  if (!existsSync(reportJsonPath)) return null;

  let raw: JsonReportFile;
  try {
    raw = JSON.parse(await readFile(reportJsonPath, 'utf-8')) as JsonReportFile;
  } catch {
    return null;
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

      const regs = issue.regulations ?? issueAnnotations[issue.code] ?? [];
      const regNames = regs.map((r) => r.shortName).join('; ');

      const component = inferComponent(issue.selector, issue.context);

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

  return toCsv(headers, rows);
}

// ---------------------------------------------------------------------------
// Build inline-styled HTML email body with summary KPIs
// ---------------------------------------------------------------------------

export function buildEmailBody(scan: ScanRecord): string {
  const errors = scan.errors ?? 0;
  const warnings = scan.warnings ?? 0;
  const notices = scan.notices ?? 0;
  const pagesScanned = scan.pagesScanned ?? 0;
  const scanDate = scan.completedAt
    ? new Date(scan.completedAt).toLocaleString()
    : new Date(scan.createdAt).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f5f6fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #0056b3; color: #ffffff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Luqen Accessibility Report</h1>
  </div>
  <div style="padding: 24px;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #333;">Site: <strong>${escapeHtml(scan.siteUrl)}</strong></p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #333;">Standard: <strong>${escapeHtml(scan.standard)}</strong></p>
    <p style="margin: 0 0 20px; font-size: 14px; color: #333;">Scanned: <strong>${escapeHtml(scanDate)}</strong></p>

    <table style="width: 100%; border-collapse: separate; border-spacing: 8px 0;" role="presentation">
      <tr>
        <td style="padding: 16px 8px; text-align: center; background: #f8d7da; border-radius: 6px; width: 25%;">
          <div style="font-size: 28px; font-weight: 800; color: #8b1a1a;">${pagesScanned}</div>
          <div style="font-size: 11px; text-transform: uppercase; color: #8b1a1a; letter-spacing: 0.5px;">Pages</div>
        </td>
        <td style="padding: 16px 8px; text-align: center; background: #f8d7da; border-radius: 6px; width: 25%;">
          <div style="font-size: 28px; font-weight: 800; color: #8b1a1a;">${errors}</div>
          <div style="font-size: 11px; text-transform: uppercase; color: #8b1a1a; letter-spacing: 0.5px;">Errors</div>
        </td>
        <td style="padding: 16px 8px; text-align: center; background: #fff3cd; border-radius: 6px; width: 25%;">
          <div style="font-size: 28px; font-weight: 800; color: #856404;">${warnings}</div>
          <div style="font-size: 11px; text-transform: uppercase; color: #856404; letter-spacing: 0.5px;">Warnings</div>
        </td>
        <td style="padding: 16px 8px; text-align: center; background: #d4edda; border-radius: 6px; width: 25%;">
          <div style="font-size: 28px; font-weight: 800; color: #155724;">${notices}</div>
          <div style="font-size: 11px; text-transform: uppercase; color: #155724; letter-spacing: 0.5px;">Notices</div>
        </td>
      </tr>
    </table>

    <p style="margin: 20px 0 0; font-size: 14px; color: #555;">See the attached report for full details.</p>
  </div>
  <div style="background: #f5f6fa; padding: 16px; text-align: center; font-size: 12px; color: #6b6b6b; border-top: 1px solid #e0e0e0;">
    Generated by Luqen
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
