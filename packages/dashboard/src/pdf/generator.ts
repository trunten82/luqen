/**
 * Server-side PDF generation using PDFKit (direct PDF creation, no browser).
 *
 * Generates a styled report PDF directly from normalizeReportData output,
 * matching the report-print.hbs layout.
 */

import PDFDocument from 'pdfkit';

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
  readonly createdAtDisplay: string;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const BLUE = '#0056b3';
const DARK = '#1a1a1a';
const MUTED = '#6b6b6b';
const BG_LIGHT = '#f5f6fa';
const BORDER = '#d0d4de';
const RED = '#8b1a1a';
const RED_BG = '#f8d7da';
const ORANGE = '#7a4f00';
const ORANGE_BG = '#fff3cd';
const GREEN = '#0d6832';
const GREEN_BG = '#d4edda';
const NAVY = '#00416a';

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

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const summary = reportData.summary;
      const errors = summary.byLevel?.error ?? 0;
      const warnings = summary.byLevel?.warning ?? 0;
      const notices = summary.byLevel?.notice ?? 0;

      // ── Title ──
      doc.fontSize(18).fillColor(BLUE).font('Helvetica-Bold')
        .text('Accessibility Report', { lineGap: 2 });

      // ── Subtitle ──
      doc.fontSize(9).fillColor(MUTED).font('Helvetica')
        .text(
          `${scan.siteUrl}    ${formatStandard(scan.standard)}` +
          (scan.jurisdictions ? `    ${scan.jurisdictions}` : '') +
          `    ${scan.createdAtDisplay}`,
          { lineGap: 6 },
        );

      doc.moveDown(0.5);

      // ── Executive Box ──
      const execY = doc.y;
      const execBoxHeight = reportData.complianceMatrix ? 65 : 50;
      doc.save()
        .roundedRect(doc.page.margins.left, execY, pageWidth, execBoxHeight, 4)
        .fill(BG_LIGHT)
        .restore();

      doc.y = execY + 8;
      doc.x = doc.page.margins.left + 10;

      if (reportData.complianceMatrix && reportData.complianceMatrix.length > 0) {
        const hasErrors = errors > 0;
        doc.fontSize(10).fillColor(hasErrors ? RED : GREEN).font('Helvetica-Bold')
          .text(
            hasErrors
              ? 'Action Required — accessibility violations detected that may breach legal requirements.'
              : 'No confirmed violations detected. Review notices for potential improvements.',
            doc.page.margins.left + 10, doc.y,
            { width: pageWidth - 20 },
          );
      }

      doc.fontSize(9).fillColor(DARK).font('Helvetica')
        .text(
          `An accessibility scan of ${scan.siteUrl} found `,
          doc.page.margins.left + 10, doc.y + 2,
          { continued: true, width: pageWidth - 20 },
        )
        .fillColor(RED).font('Helvetica-Bold').text(`${errors} Errors`, { continued: true })
        .fillColor(DARK).font('Helvetica').text(', ', { continued: true })
        .fillColor(ORANGE).font('Helvetica-Bold').text(`${warnings} Warnings`, { continued: true })
        .fillColor(DARK).font('Helvetica').text(', and ', { continued: true })
        .font('Helvetica-Bold').text(`${notices} Notices`, { continued: true })
        .font('Helvetica').text(` across ${summary.pagesScanned ?? 0} pages.`);

      if (reportData.complianceMatrix && reportData.complianceMatrix.length > 0) {
        doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold')
          .text(
            'Compliance Risk: ' +
            reportData.complianceMatrix.map((c) => {
              const icon = c.reviewStatus === 'fail' ? '!' : c.reviewStatus === 'review' ? '?' : 'OK';
              const label = c.reviewStatus === 'fail' ? 'Failing' : c.reviewStatus === 'review' ? 'Needs Review' : 'Passing';
              return `${c.jurisdictionName}: ${icon} ${label}`;
            }).join(', '),
            doc.page.margins.left + 10, doc.y + 2,
            { width: pageWidth - 20 },
          );
      }

      doc.y = execY + execBoxHeight + 10;
      doc.x = doc.page.margins.left;

      // ── KPI Cards ──
      const kpiData = [
        { value: String(summary.pagesScanned ?? 0), label: 'PAGES SCANNED', color: DARK },
        { value: String(summary.totalIssues ?? 0), label: 'TOTAL ISSUES', color: DARK },
        { value: String(errors), label: 'ERRORS', color: RED },
        { value: String(warnings), label: 'WARNINGS', color: ORANGE },
        { value: String(notices), label: 'NOTICES', color: NAVY },
      ];

      const kpiWidth = (pageWidth - 4 * 6) / 5;
      const kpiY = doc.y;
      const kpiHeight = 45;

      for (let i = 0; i < kpiData.length; i++) {
        const x = doc.page.margins.left + i * (kpiWidth + 6);
        doc.save()
          .roundedRect(x, kpiY, kpiWidth, kpiHeight, 4)
          .lineWidth(0.5).strokeColor(BORDER).stroke()
          .restore();

        doc.fontSize(20).fillColor(kpiData[i].color).font('Helvetica-Bold')
          .text(kpiData[i].value, x, kpiY + 5, { width: kpiWidth, align: 'center' });

        doc.fontSize(6).fillColor(MUTED).font('Helvetica')
          .text(kpiData[i].label, x, kpiY + 30, { width: kpiWidth, align: 'center' });
      }

      doc.y = kpiY + kpiHeight + 15;

      // ── Compliance Matrix ──
      if (reportData.complianceMatrix && reportData.complianceMatrix.length > 0) {
        doc.fontSize(12).fillColor(BLUE).font('Helvetica-Bold')
          .text('Legal Compliance');
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
          .lineWidth(1.5).strokeColor(BLUE).stroke();
        doc.moveDown(0.4);

        for (const entry of reportData.complianceMatrix) {
          const cardY = doc.y;
          const bgColor = entry.reviewStatus === 'fail' ? RED_BG : entry.reviewStatus === 'review' ? ORANGE_BG : GREEN_BG;

          doc.save()
            .roundedRect(doc.page.margins.left, cardY, 200, 36, 4)
            .lineWidth(0.5).strokeColor(BORDER).stroke()
            .restore();

          doc.save()
            .rect(doc.page.margins.left, cardY, 200, 18)
            .fill(bgColor)
            .restore();

          doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold')
            .text(entry.jurisdictionName, doc.page.margins.left + 6, cardY + 4);

          const statusLabel = entry.reviewStatus === 'fail' ? 'FAIL' : entry.reviewStatus === 'review' ? 'REVIEW' : 'PASS';
          doc.text(statusLabel, doc.page.margins.left + 140, cardY + 4, { width: 54, align: 'right' });

          doc.fontSize(7).fillColor(DARK).font('Helvetica')
            .text(
              `WCAG criteria violated: ${entry.confirmedViolations}` +
              (entry.needsReview ? ` · Needs review: ${entry.needsReview}` : ''),
              doc.page.margins.left + 6, cardY + 22,
            );

          doc.y = cardY + 42;
        }

        doc.moveDown(0.3);
      }

      // ── Top Critical Actions ──
      doc.fontSize(12).fillColor(BLUE).font('Helvetica-Bold')
        .text('Top Critical Actions');
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(1.5).strokeColor(BLUE).stroke();
      doc.moveDown(0.2);

      doc.fontSize(8).fillColor(MUTED).font('Helvetica')
        .text('The most impactful issues to address first — errors and regulatory warnings, sorted by severity and reach.');
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
        .fill(BG_LIGHT)
        .restore();

      doc.fontSize(7).fillColor(DARK).font('Helvetica-Bold');
      doc.text('SEVERITY', colX.severity + 4, headerY + 4);
      doc.text('WCAG', colX.wcag, headerY + 4);
      doc.text('ISSUE', colX.issue, headerY + 4);
      doc.text('PAGES', colX.pages, headerY + 4, { width: 36, align: 'right' });

      doc.y = headerY + 18;

      // Table rows
      for (const item of reportData.topActionItems) {
        const rowY = doc.y;

        // Check if we need a new page
        if (rowY > doc.page.height - doc.page.margins.bottom - 25) {
          doc.addPage();
        }

        const currentY = doc.y;

        // Severity badge
        const badgeColor = item.severity === 'error' ? RED_BG : ORANGE_BG;
        const textColor = item.severity === 'error' ? RED : ORANGE;
        const badgeText = `${item.count} ${item.severity.toUpperCase()}`;
        const badgeWidth = 65;

        doc.save()
          .roundedRect(colX.severity + 4, currentY + 1, badgeWidth, 13, 2)
          .fill(badgeColor)
          .restore();

        doc.fontSize(7).fillColor(textColor).font('Helvetica-Bold')
          .text(badgeText, colX.severity + 4, currentY + 3, { width: badgeWidth, align: 'center' });

        // WCAG criterion
        doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold')
          .text(item.criterion, colX.wcag, currentY + 3);

        // Issue title + regulation tags
        doc.fontSize(8).fillColor(DARK).font('Helvetica')
          .text(item.title, colX.issue, currentY + 3, { width: colX.pages - colX.issue - 5 });

        if (item.regulations.length > 0) {
          const regText = item.regulations.map((r) => r.shortName).join('  ');
          doc.fontSize(6).fillColor(RED).font('Helvetica-Bold')
            .text(regText, colX.issue, doc.y);
        }

        // Pages
        doc.fontSize(8).fillColor(DARK).font('Helvetica')
          .text(String(item.pageCount), colX.pages, currentY + 3, { width: 36, align: 'right' });

        // Row separator
        const nextY = Math.max(doc.y + 2, currentY + 18);
        doc.moveTo(doc.page.margins.left, nextY)
          .lineTo(doc.page.margins.left + pageWidth, nextY)
          .lineWidth(0.3).strokeColor(BORDER).stroke();

        doc.y = nextY + 3;
      }

      doc.moveDown(0.5);

      // ── Quick Wins ──
      if (reportData.templateComponents.length > 0) {
        doc.fontSize(12).fillColor(BLUE).font('Helvetica-Bold')
          .text('Quick Wins — Template Fixes');
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
          .lineWidth(1.5).strokeColor(BLUE).stroke();
        doc.moveDown(0.2);

        doc.fontSize(8).fillColor(MUTED).font('Helvetica')
          .text('These issues appear in shared components used across multiple pages. Fixing the component once resolves the issue everywhere.');
        doc.moveDown(0.4);

        for (const comp of reportData.templateComponents) {
          doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold')
            .text(`${comp.componentName}`, { continued: true })
            .font('Helvetica')
            .text(`  —  ${comp.issueCount} issues  ·  ${comp.maxAffectedPages} pages  ·  Fix once → resolves on all pages`);
        }

        doc.moveDown(0.5);
      }

      // ── Scan Errors ──
      if (reportData.errors && reportData.errors.length > 0) {
        doc.fontSize(12).fillColor(BLUE).font('Helvetica-Bold')
          .text('Scan Errors');
        doc.moveDown(0.3);

        for (const err of reportData.errors) {
          doc.fontSize(8).fillColor(RED).font('Helvetica-Bold')
            .text(`${err.url}`, { continued: true })
            .font('Helvetica').fillColor(DARK)
            .text(` — ${err.code}: ${err.message}`);
        }

        doc.moveDown(0.5);
      }

      // ── Note ──
      doc.fontSize(8).fillColor(MUTED).font('Helvetica')
        .text(
          'For the complete issue list with selectors and code context, use the Excel export from the dashboard.',
          doc.page.margins.left, doc.y,
          { width: pageWidth },
        );

      // ── Footer ──
      doc.moveDown(1);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(0.3).strokeColor(BORDER).stroke();
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor(MUTED).font('Helvetica')
        .text(`Generated by Luqen  ·  ${scan.createdAtDisplay}`, doc.page.margins.left, doc.y, { width: pageWidth, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
