/**
 * Server-side PDF generation using PDFKit (direct PDF creation, no browser).
 *
 * Generates a styled report PDF directly from normalizeReportData output,
 * matching the report-print.hbs layout.
 */

import PDFDocument from 'pdfkit';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VpatReport, VpatConformance } from '../services/vpat-service.js';
import type { VpatEvidenceGroup } from '../services/vpat-evidence.js';

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

/**
 * Draw a section heading anchored at the LEFT MARGIN.
 *
 * PDFKit's doc.text() without an explicit x inherits doc.x from the previous
 * draw — after a KPI card or a right-aligned table column, doc.x lingers near
 * the right edge and the next section renders as an unreadable sliver
 * (live report PDF, "Quick Wins" section, 2026-07-14). Every section heading
 * MUST go through this helper so the x/width reset can't be forgotten.
 */
export function sectionHeading(
  doc: PDFKit.PDFDocument,
  title: string,
): void {
  doc.x = doc.page.margins.left;
  doc.fontSize(12).text(title, doc.page.margins.left, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
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
        doc.fillColor(TEXT_PRIMARY).font('Body-Bold');
        sectionHeading(doc, 'Legal Compliance');
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
      doc.fillColor(TEXT_PRIMARY).font('Body-Bold');
      sectionHeading(doc, 'Top Critical Actions');
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
        doc.fillColor(TEXT_PRIMARY).font('Body-Bold');
        sectionHeading(doc, 'Quick Wins: Template Fixes');
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
        doc.fillColor(TEXT_PRIMARY).font('Body-Bold');
        sectionHeading(doc, 'Scan Errors');
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
 *
 * When `evidence` is supplied, an appendix embeds image evidence (screenshots,
 * PNG/JPEG only — PDFKit cannot rasterise gif/webp) and lists every other
 * evidence document by filename, per criterion. `uploadsRoot` is the on-disk
 * uploads directory used to resolve each public `/uploads/...` path.
 */
export interface VpatEvidence {
  readonly groups: readonly VpatEvidenceGroup[];
  readonly uploadsRoot: string;
}

export async function generateVpatPdf(
  scan: PdfScanMeta,
  vpat: VpatReport,
  evidence?: VpatEvidence,
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

      // ── Per-org legal/company identity (attribution only, no new claim) ──
      if (vpat.identity) {
        const id = vpat.identity;
        doc.moveDown(0.4);
        // Logo: PNG/JPEG only (PDFKit cannot rasterise gif/webp), resolved on
        // disk from the org's branding image — never a user-supplied path.
        if (id.logoPath && evidence?.uploadsRoot) {
          const logoAbs = join(evidence.uploadsRoot, id.logoPath.replace(/^\/uploads\//, ''));
          if (/\.(png|jpe?g)$/i.test(logoAbs) && existsSync(logoAbs)) {
            try {
              const yTop = doc.y;
              doc.image(logoAbs, left, yTop, { fit: [140, 48] });
              doc.y = yTop + 52;
            } catch {
              /* unreadable logo — skip, render text only */
            }
          }
        }
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text(id.entityName, left, doc.y);
        if (id.postalAddress) {
          doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
            .text(id.postalAddress, left, doc.y);
        }
        if (id.contactEmail) {
          doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
            .text(`Contact: ${id.contactEmail}`, left, doc.y);
        }
      }

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

      // ── Evaluation methodology & attestation (documentary weight) ──
      const att = vpat.attestation;
      doc.fontSize(9).fillColor(ID_ACCENT).font('Body-Bold')
        .text('Evaluation methodology & attestation', left, doc.y, { lineGap: 2 });
      const attLine = (label: string, value: string): void => {
        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body-Bold')
          .text(`${label}  `, left, doc.y, { continued: true })
          .fillColor(TEXT_PRIMARY).font('Body').text(value);
      };
      attLine('Evaluation date:', att.evaluationDate);
      attLine('Scope:', `${att.pagesEvaluated} page(s) of ${scan.siteUrl}`);
      attLine('Standards assessed:', att.standardsLabel);
      attLine('Methods:', att.methods.join('; '));
      if (att.evaluator) attLine('Evaluator:', att.evaluator);
      if (att.reasonedChangeCount && att.reasonedChangeCount > 0) {
        attLine('Documented verdict changes (with reasons):', String(att.reasonedChangeCount));
      }
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor(STATUS_WARNING).font('Body')
        .text(
          `This Accessibility Conformance Report reflects a good-faith evaluation of ${scan.siteUrl} as of `
          + `${att.evaluationDate}, performed using the methods listed above. It records the state of conformance at `
          + 'that time and the ongoing remediation effort; it is not a certification and does not guarantee conformance.',
          left, doc.y, { lineGap: 2, width: pageWidth },
        );
      doc.moveDown(0.7);
      doc.x = left;

      // ── Standards & laws evaluated against (programmatic per-regulation notes) ──
      if (vpat.evaluatedStandards.length > 0) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
          doc.addPage();
        }
        doc.fontSize(9).fillColor(ID_ACCENT).font('Body-Bold')
          .text('Standards & laws evaluated against', left, doc.y, { lineGap: 2 });
        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
          .text(
            'This report was evaluated explicitly against each of the following standards and laws, '
            + 'as selected for this scan. Each is named in full so the scope of coverage is unambiguous.',
            left, doc.y, { lineGap: 2, width: pageWidth },
          );
        doc.moveDown(0.3);
        for (const std of vpat.evaluatedStandards) {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 48) {
            doc.addPage();
          }
          // Regulation name + token.
          doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body-Bold')
            .text(`${std.name}  `, left, doc.y, { continued: true })
            .fillColor(TEXT_SECONDARY).font('Body').text(`(${std.token})`);
          // Citation + enforcement date (programmatic).
          const cite = [
            std.reference ? `Reference: ${std.reference}` : null,
            std.enforcementDate ? `in force since ${std.enforcementDate}` : null,
          ].filter((s): s is string => s !== null).join(' · ');
          if (cite) {
            doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body')
              .text(cite, left, doc.y, { width: pageWidth });
          }
          // One-line factual description (the programmatic context note).
          if (std.description) {
            doc.fontSize(8).fillColor(TEXT_PRIMARY).font('Body')
              .text(std.description, left, doc.y, { lineGap: 1.5, width: pageWidth });
          }
          doc.moveDown(0.35);
        }
        doc.fontSize(8).fillColor(STATUS_WARNING).font('Body')
          .text(
            'These descriptions summarise the cited standards and laws for context only; they do not '
            + 'constitute legal advice, and this report records a good-faith evaluation rather than a '
            + 'certification of compliance.',
            left, doc.y, { lineGap: 2, width: pageWidth },
          );
        doc.moveDown(0.7);
        doc.x = left;
      }

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

      // ── Functional Performance table — only when Section 508 §302 or
      //    EN 301 549 clause 4 applies (driven by selected jurisdictions). ──
      if (vpat.includeFunctionalPerformance) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
        doc.addPage();
      }
      doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text(vpat.functionalPerformanceHeading, left, doc.y);
      doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
        .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(
          'The WCAG tables above constitute the success-criteria evidence. The functional needs below '
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
      doc.moveDown(0.7);
      doc.x = left;
      } // end if (vpat.includeFunctionalPerformance)

      // Per-regulation legal context now renders programmatically in the
      // "Standards & laws evaluated against" section above (one note per selected
      // regulation, from the compliance records). The curated per-law paragraph
      // catalog was retired in favour of that data-driven coverage.

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
            + `${rem.summary.aiProposed} AI-proposed draft fix(es), `
            + `${rem.summary.developerVerified} developer-verified, across `
            + `${rem.scanTrend.length} completed scan(s)`
            + `${rem.summary.firstActivity ? ` since ${rem.summary.firstActivity}` : ''}. `
            + `Luqen's AI only drafts candidate fixes; a human developer reviews each one, and a change takes `
            + `effect only when a person accepts and merges it. The AI assists drafting under human supervision — `
            + `it never applies changes on its own, and it is not the basis of the conformance verdicts in this `
            + `report. This section evidences an ongoing remediation effort; it does not assert conformance.`,
            left, doc.y, { lineGap: 2, width: pageWidth },
          );
        doc.moveDown(0.3);
        doc.fontSize(7.5).fillColor(TEXT_SECONDARY).font('Body')
          .text(
            '"AI-proposed (draft)" counts fixes the AI drafted as candidate code changes for a developer to review '
            + '— drafts, not applied or accepted changes. "Developer-verified" counts the changes a human developer '
            + 'actually reviewed and merged.',
            left, doc.y, { lineGap: 1.5, width: pageWidth },
          );
        doc.moveDown(0.4);
        doc.x = left;

        const remLabel = (t: string): string =>
          t === 'ai-proposed' ? 'AI-proposed (draft)'
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

      // ── Manual test evidence (screenshots embedded, documents listed) ──
      if (evidence && evidence.groups.length > 0) {
        const THUMB_W = 130;
        const THUMB_H = 98;
        const GAP = 8;

        if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
          doc.addPage();
        }
        doc.fontSize(12).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Manual test evidence', left, doc.y);
        doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
          .lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
        doc.moveDown(0.2);
        doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
          .text(
            'Supporting evidence files recorded during manual testing, grouped by success criterion. '
            + 'Screenshots are embedded below; other documents are listed by filename. These artifacts '
            + 'substantiate the manual verdicts and form part of the dated, good-faith testing record.',
            left, doc.y, { lineGap: 2, width: pageWidth },
          );
        doc.moveDown(0.4);
        doc.x = left;

        for (const group of evidence.groups) {
          // Criterion heading.
          if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
            doc.addPage();
          }
          doc.fontSize(9).fillColor(ID_ACCENT).font('Body-Bold')
            .text(group.title ? `${group.criterion}: ${group.title}` : group.criterion, left, doc.y);
          doc.moveDown(0.15);
          doc.x = left;

          // Embed image evidence (PNG/JPEG) in a wrapping row; collect every
          // non-embeddable or missing file to list by name afterwards.
          const docFiles: string[] = [];
          let cursorX = left;
          let rowTop = doc.y;
          let rowHasImage = false;

          for (const item of group.items) {
            const embeddable = item.mimeType === 'image/png' || item.mimeType === 'image/jpeg';
            const absPath = embeddable
              ? join(evidence.uploadsRoot, item.filePath.replace(/^\/uploads\//, ''))
              : '';
            if (!embeddable || absPath === '' || !existsSync(absPath)) {
              docFiles.push(item.fileName);
              continue;
            }
            // Wrap to a new row when the next thumbnail would overflow the width.
            if (cursorX + THUMB_W > left + pageWidth) {
              cursorX = left;
              rowTop = rowTop + THUMB_H + GAP;
            }
            // Page-break when the row would overflow the page bottom.
            if (rowTop + THUMB_H > doc.page.height - doc.page.margins.bottom) {
              doc.addPage();
              rowTop = doc.page.margins.top;
              cursorX = left;
            }
            try {
              doc.image(absPath, cursorX, rowTop, { fit: [THUMB_W, THUMB_H] });
              cursorX += THUMB_W + GAP;
              rowHasImage = true;
            } catch {
              // Corrupt / unreadable image → fall back to listing the filename.
              docFiles.push(item.fileName);
            }
          }
          if (rowHasImage) {
            doc.y = rowTop + THUMB_H + 6;
            doc.x = left;
          }

          // List documents (and any non-embeddable images) by filename.
          for (const name of docFiles) {
            if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
              doc.addPage();
            }
            doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
              .text(`- ${name}`, left, doc.y, { width: pageWidth });
          }
          doc.moveDown(0.4);
          doc.x = left;
        }
        doc.moveDown(0.3);
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
