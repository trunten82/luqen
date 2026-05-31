/**
 * Server-side PDF generation using PDFKit (direct PDF creation, no browser).
 *
 * Generates a styled report PDF directly from normalizeReportData output,
 * matching the report-print.hbs layout.
 */

import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VpatReport, VpatConformance } from '../services/vpat-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReportSummary {
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly byLevel?: { readonly error: number; readonly warning: number; readonly notice: number };
}

interface ActionItem {
  readonly severity: string;
  readonly count: number;
  readonly criterion: string;
  readonly title: string;
  readonly pageCount: number;
  readonly regulations: ReadonlyArray<{ readonly shortName: string }>;
}

interface ComplianceEntry {
  readonly jurisdictionName: string;
  readonly reviewStatus: string;
  readonly confirmedViolations: number;
  readonly needsReview?: number;
}

interface TemplateComponent {
  readonly componentName: string;
  readonly issueCount: number;
  readonly maxAffectedPages: number;
}

export interface PdfReportData {
  readonly summary: ReportSummary;
  readonly topActionItems: readonly ActionItem[];
  readonly complianceMatrix?: readonly ComplianceEntry[] | null;
  readonly templateComponents: readonly TemplateComponent[];
  readonly errors?: readonly { readonly url: string; readonly code: string; readonly message: string }[];
}

export interface PdfScanMeta {
  readonly siteUrl: string;
  readonly standard: string;
  readonly jurisdictions: string;
  readonly regulations?: string;
  readonly createdAtDisplay: string;
}

// ---------------------------------------------------------------------------
// Subtitle formatter (exported for testing — pure, no PDF context)
// ---------------------------------------------------------------------------

/**
 * Builds the subtitle string for the PDF header. Jurisdictions and regulations
 * segments are omitted when empty, mirroring the existing pattern used for the
 * Jurisdictions segment (D-28 freeze — the Jurisdictions portion is byte-identical
 * to its pre-Phase-07 form).
 */
export function formatSubtitle(scan: PdfScanMeta): string {
  return (
    `${scan.siteUrl}    ${formatStandard(scan.standard)}` +
    (scan.jurisdictions ? `    ${scan.jurisdictions}` : '') +
    (scan.regulations ? `    Regulations: ${scan.regulations}` : '') +
    `    ${scan.createdAtDisplay}`
  );
}

// ---------------------------------------------------------------------------
// Colors — R1 identity tokens (Phase 56)
// sRGB hex equivalents of the dashboard OKLCH tokens. All foreground/background
// pairs used below are AAA (>= 7:1 on small text) against the page surfaces.
// ---------------------------------------------------------------------------

const ID_ACCENT = '#5a2a26';       // oxblood
const TEXT_PRIMARY = '#231e1d';    // body / display
const TEXT_SECONDARY = '#5e5550';  // meta / labels
const TEXT_MUTED = '#807672';      // captions (large/bold only)
const BG_SURFACE = '#faf7f6';
const BORDER_SUBTLE = '#e3dcd9';
const BORDER_STRONG = '#cdc3bf';
const STATUS_ERROR = '#a52822';
const STATUS_WARNING = '#7c5612';
const STATUS_SUCCESS = '#206a44';
const STATUS_INFO = '#1f4f99';
const CITRON = '#d6c43c';          // evidence flag — top-border only, never text

// ---------------------------------------------------------------------------
// Fonts — embedded Inter + IBM Plex Mono (Phase 56 closeout)
// ---------------------------------------------------------------------------

const FONTS_DIR = resolve(fileURLToPath(import.meta.url), '..', 'fonts');
const FONT_FILES = {
  body: 'Inter-Regular.ttf',
  bodyBold: 'Inter-SemiBold.ttf',
  display: 'InterDisplay-SemiBold.ttf',
  mono: 'IBMPlexMono-Regular.ttf',
} as const;

function registerFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont('Body', resolve(FONTS_DIR, FONT_FILES.body));
  doc.registerFont('Body-Bold', resolve(FONTS_DIR, FONT_FILES.bodyBold));
  doc.registerFont('Display-Bold', resolve(FONTS_DIR, FONT_FILES.display));
  doc.registerFont('Mono', resolve(FONTS_DIR, FONT_FILES.mono));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mm(val: number): number {
  return val * 2.835; // mm to points
}

function formatStandard(code: string): string {
  const map: Record<string, string> = {
    'WCAG2A': 'WCAG 2.1 Level A',
    'WCAG2AA': 'WCAG 2.1 Level AA',
    'WCAG2AAA': 'WCAG 2.1 Level AAA',
  };
  return map[code] ?? code;
}

// ---------------------------------------------------------------------------
// Direct PDF generation from report data
// ---------------------------------------------------------------------------

export async function generatePdfFromData(
  scan: PdfScanMeta,
  reportData: PdfReportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: mm(15), bottom: mm(15), left: mm(10), right: mm(10) },
        info: {
          Title: `Accessibility Report — ${scan.siteUrl}`,
          Creator: 'Luqen',
        },
      });

      registerFonts(doc);

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const summary = reportData.summary;
      const errors = summary.byLevel?.error ?? 0;
      const warnings = summary.byLevel?.warning ?? 0;
      const notices = summary.byLevel?.notice ?? 0;

      // ── Cover: eyebrow + verdict line + meta ──
      // Pattern: PRODUCT/DESIGN "verdict line" — one display-weight sentence,
      // a meta line in monospace-ish secondary text. No gradient, no chrome.
      doc.fontSize(8).fillColor(ID_ACCENT).font('Body-Bold')
        .text('LUQEN ACCESSIBILITY REPORT', { characterSpacing: 1.2, lineGap: 4 });

      const verdictText = errors > 0
        ? `${scan.siteUrl} has ${errors} blocking ${errors === 1 ? 'issue' : 'issues'} across ${summary.pagesScanned ?? 0} ${(summary.pagesScanned ?? 0) === 1 ? 'page' : 'pages'}.`
        : `${scan.siteUrl} has no blocking issues across ${summary.pagesScanned ?? 0} ${(summary.pagesScanned ?? 0) === 1 ? 'page' : 'pages'}.`;

      doc.fontSize(18).fillColor(TEXT_PRIMARY).font('Display-Bold')
        .text(verdictText, { lineGap: 2 });

      doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
        .text(formatSubtitle(scan), { lineGap: 6 });

      doc.moveDown(0.3);

      // Quiet 0.5pt rule under the cover header. No filled banner.
      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
      doc.moveDown(0.6);

      // Optional compliance-risk meta sentence, plain body weight.
      if (reportData.complianceMatrix && reportData.complianceMatrix.length > 0) {
        doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body')
          .text(
            'Compliance: ' +
            reportData.complianceMatrix.map((c) => {
              const label = c.reviewStatus === 'fail' ? 'failing' : c.reviewStatus === 'review' ? 'needs review' : 'passing';
              return `${c.jurisdictionName} ${label}`;
            }).join(', '),
            doc.page.margins.left, doc.y,
            { width: pageWidth },
          );
        doc.moveDown(0.6);
      }

      doc.x = doc.page.margins.left;

      // ── KPI Cards ──
      // Quiet 0.5pt border on all cards; a 4px citron top-border on cards that
      // flag breach (errors > 0, warnings > 0). No coloured backgrounds —
      // typography carries the weight.
      const kpiData = [
        { value: String(summary.pagesScanned ?? 0), label: 'PAGES SCANNED', color: TEXT_PRIMARY, flag: false },
        { value: String(summary.totalIssues ?? 0), label: 'TOTAL ISSUES', color: TEXT_PRIMARY, flag: false },
        { value: String(errors), label: 'ERRORS', color: STATUS_ERROR, flag: errors > 0 },
        { value: String(warnings), label: 'WARNINGS', color: STATUS_WARNING, flag: warnings > 0 },
        { value: String(notices), label: 'NOTICES', color: STATUS_INFO, flag: false },
      ];

      const kpiWidth = (pageWidth - 4 * 6) / 5;
      const kpiY = doc.y;
      const kpiHeight = 48;

      for (let i = 0; i < kpiData.length; i++) {
        const x = doc.page.margins.left + i * (kpiWidth + 6);

        // Card border (quiet)
        doc.save()
          .rect(x, kpiY, kpiWidth, kpiHeight)
          .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke()
          .restore();

        // 4px citron flag on the top of breach-flagged cards
        if (kpiData[i].flag) {
          doc.save()
            .rect(x, kpiY, kpiWidth, 4)
            .fill(CITRON)
            .restore();
        }

        doc.fontSize(20).fillColor(kpiData[i].color).font('Body-Bold')
          .text(kpiData[i].value, x, kpiY + 8, { width: kpiWidth, align: 'center' });

        doc.fontSize(6).fillColor(TEXT_SECONDARY).font('Body-Bold')
          .text(kpiData[i].label, x, kpiY + 33, { width: kpiWidth, align: 'center', characterSpacing: 0.6 });
      }

      doc.y = kpiY + kpiHeight + 15;

      // ── Compliance Matrix ──
      if (reportData.complianceMatrix && reportData.complianceMatrix.length > 0) {
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Legal Compliance');
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
          .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
        doc.moveDown(0.4);

        for (const entry of reportData.complianceMatrix) {
          const cardY = doc.y;
          const cardWidth = 220;
          const flag = entry.reviewStatus === 'fail';
          const statusColor =
            entry.reviewStatus === 'fail' ? STATUS_ERROR :
            entry.reviewStatus === 'review' ? STATUS_WARNING : STATUS_SUCCESS;

          // Quiet 0.5pt border (no fill)
          doc.save()
            .rect(doc.page.margins.left, cardY, cardWidth, 36)
            .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke()
            .restore();

          // 4px citron top-border for AAA-breach (fail) rows
          if (flag) {
            doc.save()
              .rect(doc.page.margins.left, cardY, cardWidth, 4)
              .fill(CITRON)
              .restore();
          }

          doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body-Bold')
            .text(entry.jurisdictionName, doc.page.margins.left + 8, cardY + 7);

          const statusLabel = entry.reviewStatus === 'fail' ? 'FAIL' : entry.reviewStatus === 'review' ? 'REVIEW' : 'PASS';
          doc.fontSize(9).fillColor(statusColor).font('Body-Bold')
            .text(statusLabel, doc.page.margins.left + cardWidth - 64, cardY + 7, { width: 56, align: 'right' });

          doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
            .text(
              `WCAG criteria violated: ${entry.confirmedViolations}` +
              (entry.needsReview ? `  ·  Needs review: ${entry.needsReview}` : ''),
              doc.page.margins.left + 8, cardY + 22,
            );

          doc.y = cardY + 42;
        }

        doc.moveDown(0.3);
      }

      // ── Top Critical Actions ──
      doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text('Top Critical Actions');
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      doc.moveDown(0.2);

      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text('The most impactful issues to address first: errors and regulatory warnings, sorted by severity and reach.');
      doc.moveDown(0.4);

      // Table header
      const colX = {
        severity: doc.page.margins.left,
        wcag: doc.page.margins.left + 80,
        issue: doc.page.margins.left + 140,
        pages: doc.page.margins.left + pageWidth - 40,
      };

      const headerY = doc.y;
      doc.save()
        .rect(doc.page.margins.left, headerY, pageWidth, 16)
        .fill(BG_SURFACE)
        .restore();

      doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
      doc.text('SEVERITY', colX.severity + 4, headerY + 5, { characterSpacing: 0.6 });
      doc.text('WCAG', colX.wcag, headerY + 5, { characterSpacing: 0.6 });
      doc.text('ISSUE', colX.issue, headerY + 5, { characterSpacing: 0.6 });
      doc.text('PAGES', colX.pages, headerY + 5, { width: 36, align: 'right', characterSpacing: 0.6 });

      doc.y = headerY + 18;

      // Table rows
      for (const item of reportData.topActionItems) {
        const rowY = doc.y;

        // Check if we need a new page
        if (rowY > doc.page.height - doc.page.margins.bottom - 25) {
          doc.addPage();
        }

        const currentY = doc.y;
        const isError = item.severity === 'error';
        const sevColor = isError ? STATUS_ERROR : STATUS_WARNING;

        // 4px citron top-border on rows that flag a blocker (error severity).
        if (isError) {
          doc.save()
            .rect(doc.page.margins.left, currentY, pageWidth, 4)
            .fill(CITRON)
            .restore();
        }

        const textY = currentY + (isError ? 7 : 3);

        // Severity as plain typographic label (no filled badge).
        doc.fontSize(8).fillColor(sevColor).font('Body-Bold')
          .text(`${item.count} ${item.severity.toUpperCase()}`, colX.severity + 4, textY, { width: 70 });

        // WCAG criterion
        doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text(item.criterion, colX.wcag, textY);

        // Issue title + regulation tags
        doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body')
          .text(item.title, colX.issue, textY, { width: colX.pages - colX.issue - 5 });

        if (item.regulations.length > 0) {
          const regText = item.regulations.map((r) => r.shortName).join('  ');
          doc.fontSize(6).fillColor(TEXT_SECONDARY).font('Body-Bold')
            .text(regText, colX.issue, doc.y, { characterSpacing: 0.5 });
        }

        // Pages
        doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body')
          .text(String(item.pageCount), colX.pages, textY, { width: 36, align: 'right' });

        // Row separator (quiet 0.5pt)
        const nextY = Math.max(doc.y + 2, currentY + (isError ? 22 : 18));
        doc.moveTo(doc.page.margins.left, nextY)
          .lineTo(doc.page.margins.left + pageWidth, nextY)
          .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();

        doc.y = nextY + 3;
      }

      doc.moveDown(0.5);

      // ── Quick Wins ──
      if (reportData.templateComponents.length > 0) {
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Quick Wins: Template Fixes');
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
          .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
        doc.moveDown(0.2);

        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
          .text('These issues appear in shared components used across multiple pages. Fixing the component once resolves the issue everywhere.');
        doc.moveDown(0.4);

        for (const comp of reportData.templateComponents) {
          doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body-Bold')
            .text(`${comp.componentName}`, { continued: true })
            .font('Body').fillColor(TEXT_SECONDARY)
            .text(`  ·  ${comp.issueCount} issues  ·  ${comp.maxAffectedPages} pages  ·  fix once, resolves on all pages`);
        }

        doc.moveDown(0.5);
      }

      // ── Scan Errors ──
      if (reportData.errors && reportData.errors.length > 0) {
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Scan Errors');
        doc.moveDown(0.3);

        for (const err of reportData.errors) {
          doc.fontSize(8).fillColor(STATUS_ERROR).font('Body-Bold')
            .text(`${err.url}`, { continued: true })
            .font('Body').fillColor(TEXT_PRIMARY)
            .text(`  ·  ${err.code}: ${err.message}`);
        }

        doc.moveDown(0.5);
      }

      // ── Note ──
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          'For the complete issue list with selectors and code context, use the Excel export from the dashboard.',
          doc.page.margins.left, doc.y,
          { width: pageWidth },
        );

      // ── Footer ──
      // ISO scan date in monospace (Courier as bundled-font fallback for Plex Mono).
      doc.moveDown(1);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
      doc.moveDown(0.3);

      const isoDate = new Date().toISOString().slice(0, 10);
      const footerY = doc.y;
      doc.fontSize(7).fillColor(ID_ACCENT).font('Body-Bold')
        .text('Verified by Luqen', doc.page.margins.left, footerY, { continued: true })
        .fillColor(TEXT_SECONDARY).font('Mono')
        .text(`  ·  ${isoDate}  ·  ${scan.createdAtDisplay}`);

      doc.fontSize(6).fillColor(TEXT_MUTED).font('Body')
        .text('Generated by Luqen', doc.page.margins.left, doc.y + 2, { width: pageWidth, align: 'left' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// VPAT / ACR PDF
// ---------------------------------------------------------------------------

/** Maps a VPAT conformance verdict to a text colour. */
function conformanceColor(conformance: VpatConformance): string {
  switch (conformance) {
    case 'Supports':
      return STATUS_SUCCESS;
    case 'Partially Supports':
      return STATUS_WARNING;
    case 'Does Not Support':
      return STATUS_ERROR;
    default:
      return TEXT_SECONDARY;
  }
}

/**
 * Generates a clean Accessibility Conformance Report (VPAT) PDF: a cover,
 * a conformance summary line, then one table per WCAG level with columns
 * Criteria | Conformance Level | Remarks. Reuses the same fonts, colours and
 * helpers as the standard report PDF.
 */
export async function generateVpatPdf(
  scan: PdfScanMeta,
  vpat: VpatReport,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: mm(15), bottom: mm(15), left: mm(10), right: mm(10) },
        info: {
          Title: `Accessibility Conformance Report — ${scan.siteUrl}`,
          Creator: 'Luqen',
        },
      });

      registerFonts(doc);

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      // ── Cover ──
      doc.fontSize(8).fillColor(ID_ACCENT).font('Body-Bold')
        .text('LUQEN', { characterSpacing: 1.2, lineGap: 4 });

      doc.fontSize(18).fillColor(TEXT_PRIMARY).font('Display-Bold')
        .text('Accessibility Conformance Report (VPAT®)', { lineGap: 2 });

      doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          `${scan.siteUrl}    ${formatStandard(vpat.standard)}    Generated ${vpat.generatedAt}`,
          { lineGap: 6 },
        );

      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
      doc.moveDown(0.6);

      // ── Summary line ──
      const s = vpat.summary;
      doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body')
        .text(
          `Conformance summary (${s.total} criteria): ` +
          `${s.supports} Supports · ${s.partial} Partially Supports · ` +
          `${s.doesNotSupport} Does Not Support · ${s.notApplicable} Not Applicable · ` +
          `${s.notEvaluated} Not Evaluated`,
          left, doc.y,
          { width: pageWidth },
        );
      doc.moveDown(0.6);
      doc.x = left;

      // ── Methodology & scope (transparency, not a certification) ──
      // Legal-defensibility framing: the report states its own limits so it
      // reads as a good-faith remediation record, never an over-claim. Mirrors
      // the conservative derivation in vpat-service.ts.
      doc.save().rect(left, doc.y, pageWidth, 4).fill(CITRON).restore();
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor(ID_ACCENT).font('Body-Bold')
        .text('Methodology & scope', left, doc.y, { lineGap: 2 });
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          'Conformance is derived from automated testing (Pa11y / axe-core) combined with any recorded manual test '
          + 'results. Automated testing reliably detects only a portion of WCAG success criteria (industry estimates '
          + '~30-40%); it can confirm machine-verifiable failures but cannot, on its own, prove that a criterion '
          + 'requiring human judgement (such as meaningful alternative text, logical reading order, or keyboard '
          + 'operability) is fully met. Criteria that automated testing cannot conclusively verify are reported as '
          + '"Not Evaluated" until a manual test is recorded - they are not assumed to pass. Where AI-assisted fixes '
          + 'were applied, they were reviewed and merged under human developer supervision.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.4);
      doc.fontSize(8).fillColor(STATUS_WARNING).font('Body-Bold')
        .text(
          'This report is a transparency and remediation-planning document. It is not a certificate of compliance and '
          + 'does not constitute legal advice or a guarantee against accessibility claims. No automated tool or report '
          + 'can make a site "lawsuit-proof"; ongoing manual testing and remediation are required.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.7);
      doc.x = left;

      // Column geometry.
      const colCriteria = left;
      const colConformance = left + 150;
      const colRemarks = left + 280;
      const remarksWidth = left + pageWidth - colRemarks;

      for (const table of vpat.tablesByLevel) {
        // Level heading.
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
          doc.addPage();
        }
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text(`WCAG Level ${table.level}`, left, doc.y);
        doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
          .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
        doc.moveDown(0.2);

        // Column header.
        const headerY = doc.y;
        doc.save().rect(left, headerY, pageWidth, 16).fill(BG_SURFACE).restore();
        doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
        doc.text('CRITERIA', colCriteria + 4, headerY + 5, { characterSpacing: 0.6 });
        doc.text('CONFORMANCE LEVEL', colConformance, headerY + 5, { characterSpacing: 0.6 });
        doc.text('REMARKS', colRemarks, headerY + 5, { characterSpacing: 0.6 });
        doc.y = headerY + 18;

        // Rows.
        for (const row of table.rows) {
          // Page break check (mirrors the report-table loop pattern).
          if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
            doc.addPage();
          }
          const rowY = doc.y;

          doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body-Bold')
            .text(row.criterion, colCriteria + 4, rowY, { width: colConformance - colCriteria - 8 });
          doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body')
            .text(row.title, colCriteria + 4, doc.y, { width: colConformance - colCriteria - 8 });
          const criteriaBottom = doc.y;

          doc.fontSize(8).fillColor(conformanceColor(row.conformance)).font('Body-Bold')
            .text(row.conformance, colConformance, rowY, { width: colRemarks - colConformance - 6 });
          const conformanceBottom = doc.y;

          doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
            .text(row.remarks, colRemarks, rowY, { width: remarksWidth });
          const remarksBottom = doc.y;

          const nextY = Math.max(criteriaBottom, conformanceBottom, remarksBottom) + 4;
          doc.moveTo(left, nextY).lineTo(left + pageWidth, nextY)
            .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
          doc.y = nextY + 3;
        }

        doc.moveDown(0.6);
      }

      // ── Section 508 — Functional Performance Criteria (§302) ──
      // US framing: Revised Section 508 incorporates WCAG 2.0 A & AA by
      // reference (E205.4), so the WCAG tables above are the success-criteria
      // evidence; §302 adds holistic functional outcomes, derived conservatively
      // (a mapped WCAG failure escalates a need to "Does Not Support"; a clean
      // scan leaves it "Not Evaluated", never auto-"Supports").
      if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
        doc.addPage();
      }
      doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text('Section 508 — Functional Performance Criteria (§302)', left, doc.y);
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          'Revised Section 508 (36 CFR 1194, Appendix A) incorporates WCAG 2.0 Level A and AA by reference for '
          + 'electronic content (E205.4); the WCAG tables above constitute that evidence. The functional needs below '
          + 'describe end-to-end outcomes and are reported conservatively — a related WCAG failure marks a need "Does '
          + 'Not Support", while a clean scan leaves it "Not Evaluated" pending manual testing with assistive technology.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.4);
      doc.x = left;

      // Column header (Functional need | Conformance | Remarks).
      const fpcHeaderY = doc.y;
      doc.save().rect(left, fpcHeaderY, pageWidth, 16).fill(BG_SURFACE).restore();
      doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
      doc.text('FUNCTIONAL NEED', colCriteria + 4, fpcHeaderY + 5, { characterSpacing: 0.6 });
      doc.text('CONFORMANCE LEVEL', colConformance, fpcHeaderY + 5, { characterSpacing: 0.6 });
      doc.text('REMARKS', colRemarks, fpcHeaderY + 5, { characterSpacing: 0.6 });
      doc.y = fpcHeaderY + 18;

      for (const fpc of vpat.section508.functionalPerformance) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
        }
        const fpcRowY = doc.y;

        doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text(fpc.id, colCriteria + 4, fpcRowY, { width: colConformance - colCriteria - 8 });
        doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body')
          .text(fpc.need, colCriteria + 4, doc.y, { width: colConformance - colCriteria - 8 });
        const needBottom = doc.y;

        doc.fontSize(8).fillColor(conformanceColor(fpc.conformance)).font('Body-Bold')
          .text(fpc.conformance, colConformance, fpcRowY, { width: colRemarks - colConformance - 6 });
        const fpcConformanceBottom = doc.y;

        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
          .text(fpc.remarks, colRemarks, fpcRowY, { width: remarksWidth });
        const fpcRemarksBottom = doc.y;

        const fpcNextY = Math.max(needBottom, fpcConformanceBottom, fpcRemarksBottom) + 4;
        doc.moveTo(left, fpcNextY).lineTo(left + pageWidth, fpcNextY)
          .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
        doc.y = fpcNextY + 3;
      }
      doc.moveDown(0.4);
      doc.x = left;
      doc.fontSize(7).fillColor(TEXT_MUTED).font('Body')
        .text(
          'Section 508 Chapter 6 (support documentation and services) is outside the scope of automated web '
          + 'scanning and is not evaluated here.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.7);
      doc.x = left;

      // ── ADA Title II & Title III context ──
      if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
        doc.addPage();
      }
      doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text('ADA Title II & Title III context', left, doc.y);
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          'U.S. courts and the Department of Justice have repeatedly treated WCAG 2.x Level AA as the practical '
          + 'benchmark for the Americans with Disabilities Act, although the ADA itself names no single technical '
          + 'standard. Title III applies to private "places of public accommodation"; Title II applies to state and '
          + 'local government, for which the DOJ 2024 rule formally adopts WCAG 2.1 Level AA. This report is intended '
          + 'to support a good-faith, documented remediation effort under both titles. It is not legal advice and does '
          + 'not certify compliance.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.7);
      doc.x = left;

      // ── Remediation record (dated, good-faith) ──
      const rem = vpat.remediation;
      if (rem && !rem.isEmpty) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
          doc.addPage();
        }
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Remediation record', left, doc.y);
        doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
          .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
        doc.moveDown(0.2);
        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
          .text(
            `A dated, good-faith record of remediation activity for this site: `
            + `${rem.summary.aiProposed} AI-proposed fix action(s), `
            + `${rem.summary.developerVerified} developer-verified, across `
            + `${rem.scanTrend.length} completed scan(s)`
            + `${rem.summary.firstActivity ? ` since ${rem.summary.firstActivity}` : ''}. `
            + `It documents an active, ongoing remediation effort; it does not assert conformance.`,
            left, doc.y, { lineGap: 2, width: pageWidth },
          );
        doc.moveDown(0.4);
        doc.x = left;

        const remLabel = (t: string): string =>
          t === 'ai-proposed' ? 'AI-proposed'
          : t === 'developer-verified' ? 'Developer-verified'
          : 'Manual-verified';

        const colDate = left;
        const colAction = left + 70;
        const colCrit = left + 180;
        const colDetail = left + 250;
        const detailWidth = left + pageWidth - colDetail;

        if (rem.events.length > 0) {
          const remHeaderY = doc.y;
          doc.save().rect(left, remHeaderY, pageWidth, 16).fill(BG_SURFACE).restore();
          doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
          doc.text('DATE', colDate + 4, remHeaderY + 5, { characterSpacing: 0.6 });
          doc.text('ACTION', colAction, remHeaderY + 5, { characterSpacing: 0.6 });
          doc.text('CRITERION', colCrit, remHeaderY + 5, { characterSpacing: 0.6 });
          doc.text('DETAIL', colDetail, remHeaderY + 5, { characterSpacing: 0.6 });
          doc.y = remHeaderY + 18;

          for (const ev of rem.events) {
            if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
              doc.addPage();
            }
            const evY = doc.y;
            doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
              .text(ev.date, colDate + 4, evY, { width: colAction - colDate - 6 });
            const dateBottom = doc.y;
            doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body-Bold')
              .text(remLabel(ev.type), colAction, evY, { width: colCrit - colAction - 6 });
            const actionBottom = doc.y;
            doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
              .text(ev.criterion ?? '—', colCrit, evY, { width: colDetail - colCrit - 6 });
            const critBottom = doc.y;
            const detailText = ev.actor ? `${ev.detail ?? ''} (${ev.actor})` : (ev.detail ?? '');
            doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
              .text(detailText, colDetail, evY, { width: detailWidth });
            const detailBottom = doc.y;

            const evNext = Math.max(dateBottom, actionBottom, critBottom, detailBottom) + 4;
            doc.moveTo(left, evNext).lineTo(left + pageWidth, evNext)
              .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
            doc.y = evNext + 3;
          }
        }
        doc.moveDown(0.7);
        doc.x = left;
      }

      // ── Footer ──
      if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
      }
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor(ID_ACCENT).font('Body-Bold')
        .text('Generated by Luqen', left, doc.y, { continued: true })
        .fillColor(TEXT_SECONDARY).font('Mono')
        .text(`  ·  ${vpat.generatedAt}`);
      doc.fontSize(6).fillColor(TEXT_MUTED).font('Body')
        .text(
          'VPAT is a registered trademark of the Information Technology Industry Council (ITI).',
          left, doc.y + 2, { width: pageWidth },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
