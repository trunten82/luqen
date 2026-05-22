import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanRecord } from '../db/types.js';
import { extractCriterion, getWcagDescription } from '../routes/wcag-enrichment.js';
import { normalizeReportData, inferComponent } from '../services/report-service.js';
import type { JsonReportFile } from '../services/report-service.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// JsonReportFile type imported from services/report-service.ts

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

  const handlebars = (await import('handlebars')).default;
  const viewsDir = resolve(join(__dirname, '..', 'views'));
  const templatePath = join(viewsDir, 'report-print.hbs');

  if (!existsSync(templatePath)) return null;

  const templateSource = await readFile(templatePath, 'utf-8');
  const template = handlebars.compile(templateSource);

  const reportData = normalizeReportData(raw, scan);

  const scanMeta = {
    ...scan,
    jurisdictions: scan.jurisdictions.join(', '),
    createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
    completedAtDisplay: scan.completedAt
      ? new Date(scan.completedAt).toLocaleString()
      : '',
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

  const pages = raw.pages ?? (
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

// ---------------------------------------------------------------------------
// Identity tokens (R1 — Phase 56)
// Email clients do not support OKLCH or external CSS, so we mirror the
// dashboard's --id-* and status tokens as inline-safe sRGB hex values.
// Every text/background pair below is verified AAA (>= 7:1) on small text.
// ---------------------------------------------------------------------------

const EMAIL_FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const EMAIL_MONO_STACK =
  "'IBM Plex Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const ID_ACCENT = '#5a2a26';       // oxblood
const TEXT_PRIMARY = '#231e1d';    // ~14.9:1 on #fefcfb (AAA)
const TEXT_SECONDARY = '#5e5550';  // ~7.6:1 on #fefcfb (AAA small text)
const TEXT_MUTED = '#807672';      // ~4.7:1 on #fefcfb — large/bold only
const BG_PAGE = '#fefcfb';
const BG_SURFACE = '#faf7f6';
const BG_MUTED = '#efeae8';
const BORDER_SUBTLE = '#e3dcd9';
const STATUS_ERROR = '#a52822';    // ~7.0:1 on #fefcfb (AAA)
const STATUS_WARNING = '#7c5612';  // ~7.4:1 on #fefcfb (AAA)
const STATUS_INFO = '#1f4f99';     // ~7.4:1 on #fefcfb (AAA)
const CITRON = '#d6c43c';          // evidence accent — never carries text contrast

export function buildEmailBody(
  scan: ScanRecord,
  options?: { includeWarnings?: boolean; includeNotices?: boolean },
): string {
  const errors = scan.errors ?? 0;
  const warnings = (options?.includeWarnings !== false) ? (scan.warnings ?? 0) : 0;
  const notices = (options?.includeNotices !== false) ? (scan.notices ?? 0) : 0;
  const pagesScanned = scan.pagesScanned ?? 0;
  const scanDate = scan.completedAt
    ? new Date(scan.completedAt).toLocaleString()
    : new Date(scan.createdAt).toLocaleString();
  const scanIsoDate = (scan.completedAt ?? scan.createdAt).slice(0, 10);

  // Verdict line: one sentence in body-strong type, followed by a meta line.
  const verdict = errors > 0
    ? `${scan.siteUrl} has ${errors} blocking ${errors === 1 ? 'issue' : 'issues'} across ${pagesScanned} ${pagesScanned === 1 ? 'page' : 'pages'}.`
    : `${scan.siteUrl} has no blocking issues across ${pagesScanned} ${pagesScanned === 1 ? 'page' : 'pages'}.`;

  // Whether to flag a block with the 4px citron top-border (evidence rule).
  const flagErrors = errors > 0;
  const flagWarnings = warnings > 0;

  // Cell helper: AAA-verified text colours on AAA-verified tinted surfaces.
  // We retain a tinted background but lift the foreground to the AAA status
  // tokens above (a52822 / 7c5612 / 206a44 all hit >= 7:1 on faf7f6).
  const kpiCell = (
    value: number,
    label: string,
    fg: string,
    flag: boolean,
  ): string => `
        <td style="padding: 0; width: 25%; vertical-align: top;">
          <div style="border-top: 4px solid ${flag ? CITRON : 'transparent'}; background: ${BG_SURFACE}; border-bottom: 1px solid ${BORDER_SUBTLE}; border-left: 1px solid ${BORDER_SUBTLE}; border-right: 1px solid ${BORDER_SUBTLE}; padding: 14px 8px; text-align: center;">
            <div style="font-family: ${EMAIL_FONT_STACK}; font-size: 28px; font-weight: 700; color: ${fg}; line-height: 1.1; letter-spacing: -0.012em;">${value}</div>
            <div style="font-family: ${EMAIL_FONT_STACK}; font-size: 11px; font-weight: 600; text-transform: uppercase; color: ${TEXT_SECONDARY}; letter-spacing: 0.06em; margin-top: 4px;">${label}</div>
          </div>
        </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: ${BG_MUTED}; font-family: ${EMAIL_FONT_STACK}; color: ${TEXT_PRIMARY};">
<div style="max-width: 600px; margin: 0 auto; background: ${BG_PAGE};">
  <div style="padding: 24px 24px 16px; border-bottom: 1px solid ${BORDER_SUBTLE};">
    <div style="font-family: ${EMAIL_FONT_STACK}; font-size: 12px; font-weight: 600; color: ${ID_ACCENT}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 6px;">Luqen Accessibility Report</div>
    <h1 style="margin: 0; font-family: ${EMAIL_FONT_STACK}; font-size: 20px; font-weight: 700; color: ${TEXT_PRIMARY}; letter-spacing: -0.012em; line-height: 1.3;">${escapeHtml(verdict)}</h1>
    <p style="margin: 8px 0 0; font-family: ${EMAIL_MONO_STACK}; font-size: 12px; color: ${TEXT_SECONDARY}; line-height: 1.5;">
      Scanned: ${escapeHtml(scanDate)} &middot; Standard: ${escapeHtml(scan.standard)}
    </p>
  </div>
  <div style="padding: 24px;">
    <p style="margin: 0 0 16px; font-family: ${EMAIL_FONT_STACK}; font-size: 14px; color: ${TEXT_PRIMARY}; line-height: 1.5;">
      Site: <strong style="color: ${TEXT_PRIMARY};">${escapeHtml(scan.siteUrl)}</strong>
    </p>

    <table style="width: 100%; border-collapse: separate; border-spacing: 6px 0;" role="presentation">
      <tr>
        ${kpiCell(pagesScanned, 'Pages', TEXT_PRIMARY, false)}
        ${kpiCell(errors, 'Errors', STATUS_ERROR, flagErrors)}
        ${kpiCell(warnings, 'Warnings', STATUS_WARNING, flagWarnings)}
        ${kpiCell(notices, 'Notices', STATUS_INFO, false)}
      </tr>
    </table>

    <p style="margin: 24px 0 0; font-family: ${EMAIL_FONT_STACK}; font-size: 14px; color: ${TEXT_SECONDARY}; line-height: 1.5;">
      See the attached report for the complete issue list, selectors, and code context.
    </p>
  </div>
  <div style="background: ${BG_SURFACE}; padding: 16px 24px; border-top: 1px solid ${BORDER_SUBTLE};">
    <div style="font-family: ${EMAIL_MONO_STACK}; font-size: 11px; color: ${TEXT_SECONDARY}; line-height: 1.5;">
      <span style="color: ${ID_ACCENT}; font-weight: 600;">Verified by Luqen</span> &middot; ${escapeHtml(scanIsoDate)}
    </div>
    <div style="font-family: ${EMAIL_FONT_STACK}; font-size: 11px; color: ${TEXT_MUTED}; margin-top: 4px;">
      Generated by Luqen
    </div>
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
