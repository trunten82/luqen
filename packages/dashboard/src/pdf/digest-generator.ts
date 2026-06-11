/**
 * Board-ready PDF generator for scheduled executive digests.
 *
 * Generates a PDFKit document from DigestData — no Chromium dependency (D-07).
 *
 * Conservative framing (D-06/D-12):
 *   - Exposure is ALWAYS the ordinal band label (High/Elevated/Moderate/Lower)
 *   - Band icon + label always present (colour never the sole differentiator)
 *   - No forbidden words: compliant, 100%, lawsuit-proof, will be sued, fault, guarantee
 *   - Vocabulary: `baseline` not `default`; `expired` not `passed`
 *   - DISCLAIMER_TEXT imported verbatim — single source of truth
 */

import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DigestData, SiteDelta } from '../services/digest-service.js';
import type { DigestSchedule } from '../db/types.js';
import type { ExposureBand } from '../services/legal-exposure.js';
import { DISCLAIMER_TEXT } from '../services/legal-exposure.js';
import type { EmailAttachment } from '../email/sender.js';

// ---------------------------------------------------------------------------
// Color constants — R1 identity tokens (mirrored from pdf/generator.ts)
// sRGB hex equivalents of the dashboard OKLCH tokens.
// ---------------------------------------------------------------------------

const ID_ACCENT = '#5a2a26';       // oxblood
const TEXT_PRIMARY = '#1a1a1a';    // body / display (matches PDF convention)
const TEXT_SECONDARY = '#6b6b6b';  // meta / labels
const BG_SURFACE = '#faf7f6';
const BORDER_SUBTLE = '#e5e0e0';

// Band-specific colour pairs (Surface 4 — UI-SPEC)
const BAND_HIGH_TEXT = '#7f1d1d';     const BAND_HIGH_BG = '#fecaca';
const BAND_ELEVATED_TEXT = '#991b1b'; const BAND_ELEVATED_BG = '#fee2e2';
const BAND_MODERATE_TEXT = '#92400e'; const BAND_MODERATE_BG = '#fef9c3';
const BAND_LOWER_TEXT = '#1e40af';    const BAND_LOWER_BG = '#dbeafe';

// Delta colours (UI-SPEC Surface 4)
const DELTA_NEW = '#9a3412';
const DELTA_FIXED = '#15803d';

// ---------------------------------------------------------------------------
// Band-specific display data (icon + label — always both present)
// ---------------------------------------------------------------------------

const BAND_DISPLAY: Record<ExposureBand, { icon: string; label: string; textColor: string; bgColor: string }> = {
  high:     { icon: '⬛ ', label: 'High',     textColor: BAND_HIGH_TEXT,     bgColor: BAND_HIGH_BG },
  elevated: { icon: '▲▲ ', label: 'Elevated', textColor: BAND_ELEVATED_TEXT, bgColor: BAND_ELEVATED_BG },
  moderate: { icon: '▲ ',  label: 'Moderate', textColor: BAND_MODERATE_TEXT, bgColor: BAND_MODERATE_BG },
  lower:    { icon: '● ',  label: 'Lower',    textColor: BAND_LOWER_TEXT,    bgColor: BAND_LOWER_BG },
};

// ---------------------------------------------------------------------------
// Fonts — embedded Inter + IBM Plex Mono (mirrors generator.ts)
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

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const e = new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

function escapeOrgSlug(orgId: string): string {
  return orgId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

function formatPeriodSlug(start: string): string {
  return start.slice(0, 10); // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Band badge renderer (filled rect + icon char + label)
// ---------------------------------------------------------------------------

function renderBandBadge(
  doc: PDFKit.PDFDocument,
  band: ExposureBand,
  x: number,
  y: number,
  badgeWidth = 90,
  badgeHeight = 18,
): void {
  const { icon, label, textColor, bgColor } = BAND_DISPLAY[band];

  // Filled background rectangle
  doc.save()
    .rect(x, y, badgeWidth, badgeHeight)
    .fill(bgColor)
    .restore();

  // Icon + label text (icon and label ALWAYS present — colour never sole differentiator)
  doc.fontSize(9).fillColor(textColor).font('Body-Bold')
    .text(icon + label, x + 4, y + 4, { width: badgeWidth - 8, lineBreak: false });
}

// ---------------------------------------------------------------------------
// Direction label helper
// ---------------------------------------------------------------------------

function directionLabel(direction: SiteDelta['direction']): string {
  switch (direction) {
    case 'worsened': return '▲ Worsened';
    case 'improved': return '▼ Improved';
    default: return '— Unchanged';
  }
}

function directionColor(direction: SiteDelta['direction']): string {
  switch (direction) {
    case 'worsened': return DELTA_NEW;
    case 'improved': return DELTA_FIXED;
    default: return TEXT_SECONDARY;
  }
}

// ---------------------------------------------------------------------------
// Section rule helper
// ---------------------------------------------------------------------------

function drawSectionRule(doc: PDFKit.PDFDocument, pageWidth: number): void {
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.margins.left + pageWidth, doc.y)
    .lineWidth(0.5).strokeColor(BORDER_SUBTLE).stroke();
  doc.moveDown(0.5);
}

// ---------------------------------------------------------------------------
// generateDigestPdf — main export
// ---------------------------------------------------------------------------

export async function generateDigestPdf(
  data: DigestData,
  org: { name?: string; address?: string; website?: string },
): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: mm(15), bottom: mm(15), left: mm(10), right: mm(10) },
        info: {
          Title: `Accessibility Exposure Digest — ${data.period.start}`,
          Creator: 'Luqen',
        },
      });

      registerFonts(doc);

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // ── Page 1: Cover / Identity ────────────────────────────────────────

      // Identity block — omit entirely when org.name is not set
      if (org.name) {
        doc.fontSize(11).fillColor(TEXT_PRIMARY).font('Body-Bold').text(org.name, left, doc.y);
        if (org.address) {
          doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body').text(org.address, left, doc.y + 2);
        }
        if (org.website) {
          doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body').text(org.website, left, doc.y + 2);
        }
        doc.moveDown(0.8);
        drawSectionRule(doc, pageWidth);
      }

      // Document eyebrow
      doc.fontSize(8).fillColor(ID_ACCENT).font('Body-Bold')
        .text('ACCESSIBILITY EXPOSURE DIGEST', left, doc.y, { characterSpacing: 1.2, lineGap: 4 });

      // Period + generated date
      const periodStr = formatPeriodRange(data.period.start, data.period.end);
      const generatedStr = new Date(data.generatedAt).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });

      doc.fontSize(14).fillColor(TEXT_PRIMARY).font('Display-Bold')
        .text(periodStr, left, doc.y, { lineGap: 4 });

      doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Mono')
        .text(`Generated ${generatedStr}`, left, doc.y, { lineGap: 4 });

      doc.moveDown(0.4);

      // Scope
      const scopeLabel = data.siteUrl !== null ? `Site: ${data.siteUrl}` : 'Scope: Org-wide';
      doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
        .text(scopeLabel, left, doc.y);

      doc.moveDown(1.5);

      // ── Page 2: What Changed ─────────────────────────────────────────────
      doc.addPage();

      doc.fontSize(13).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text('WHAT CHANGED', left, doc.y, { characterSpacing: 0.8 });

      doc.moveDown(0.3);
      drawSectionRule(doc, pageWidth);

      doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
        .text(`Period: ${periodStr}`, left, doc.y);
      doc.moveDown(0.6);

      // Aggregate totals across all sites
      const totalErrors = data.sites.reduce((s, site) => s + site.errors, 0);
      const totalWarnings = data.sites.reduce((s, site) => s + site.warnings, 0);
      const totalNotices = data.sites.reduce((s, site) => s + site.notices, 0);
      const totalErrorsDelta = data.sites.reduce((s, site) => s + site.errorsDelta, 0);
      const totalWarningsDelta = data.sites.reduce((s, site) => s + site.warningsDelta, 0);
      const totalNoticesDelta = data.sites.reduce((s, site) => s + site.noticesDelta, 0);

      // Totals section
      doc.fontSize(11).fillColor(TEXT_PRIMARY).font('Body-Bold').text('Totals', left, doc.y);
      doc.moveDown(0.3);

      const totalsRows: Array<{ label: string; value: number; delta: number }> = [
        { label: 'Errors', value: totalErrors, delta: totalErrorsDelta },
        { label: 'Warnings', value: totalWarnings, delta: totalWarningsDelta },
        { label: 'Notices', value: totalNotices, delta: totalNoticesDelta },
      ];

      for (const row of totalsRows) {
        const deltaText = row.delta > 0 ? `(+${row.delta})` : row.delta < 0 ? `(${row.delta})` : '(unchanged)';
        const deltaColor = row.delta > 0 ? DELTA_NEW : row.delta < 0 ? DELTA_FIXED : TEXT_SECONDARY;

        const rowY = doc.y;
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Body')
          .text(row.label, left, rowY, { continued: false });
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text(String(row.value), left + 80, rowY, { continued: false });
        doc.fontSize(10).fillColor(deltaColor).font('Body')
          .text(deltaText, left + 130, rowY, { continued: false });

        doc.y = rowY + 16;
      }

      doc.moveDown(0.8);

      // Criteria changes table — aggregate top-10 across sites
      const criteriaMap = new Map<string, { newFindings: number; fixedFindings: number }>();
      for (const site of data.sites) {
        for (const cc of site.criteriaChanges) {
          const existing = criteriaMap.get(cc.criterion) ?? { newFindings: 0, fixedFindings: 0 };
          criteriaMap.set(cc.criterion, {
            newFindings: existing.newFindings + cc.newFindings,
            fixedFindings: existing.fixedFindings + cc.fixedFindings,
          });
        }
      }

      const criteriaRows = [...criteriaMap.entries()]
        .filter(([, v]) => v.newFindings > 0 || v.fixedFindings > 0)
        .sort(([, a], [, b]) => (b.newFindings + b.fixedFindings) - (a.newFindings + a.fixedFindings))
        .slice(0, 10);

      if (criteriaRows.length > 0) {
        doc.fontSize(11).fillColor(TEXT_PRIMARY).font('Body-Bold')
          .text('Criteria changes (top 10)', left, doc.y);
        doc.moveDown(0.3);

        // Table header
        const headerY = doc.y;
        doc.save()
          .rect(left, headerY, pageWidth, 16)
          .fill(BG_SURFACE)
          .restore();

        doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
        doc.text('CRITERION', left + 4, headerY + 5, { characterSpacing: 0.6 });
        doc.text('NEW', left + 200, headerY + 5, { characterSpacing: 0.6 });
        doc.text('FIXED', left + 260, headerY + 5, { characterSpacing: 0.6 });
        doc.y = headerY + 18;

        for (const [criterion, counts] of criteriaRows) {
          const rowY = doc.y;
          if (rowY > doc.page.height - doc.page.margins.bottom - 20) {
            doc.addPage();
          }

          doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body')
            .text(criterion, left + 4, doc.y, { continued: false });

          if (counts.newFindings > 0) {
            doc.fontSize(9).fillColor(DELTA_NEW).font('Body-Bold')
              .text(`+${counts.newFindings}`, left + 200, rowY, { continued: false });
          } else {
            doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
              .text('0', left + 200, rowY, { continued: false });
          }

          if (counts.fixedFindings > 0) {
            doc.fontSize(9).fillColor(DELTA_FIXED).font('Body-Bold')
              .text(`–${counts.fixedFindings}`, left + 260, rowY, { continued: false });
          } else {
            doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
              .text('0', left + 260, rowY, { continued: false });
          }

          doc.y = rowY + 14;
        }
      }

      // ── Page 3: What's at Risk ────────────────────────────────────────────
      doc.addPage();

      doc.fontSize(13).fillColor(TEXT_PRIMARY).font('Body-Bold')
        .text("WHAT'S AT RISK", left, doc.y, { characterSpacing: 0.8 });

      doc.moveDown(0.3);
      drawSectionRule(doc, pageWidth);

      // Risk table header
      const riskHeaderY = doc.y;
      doc.save()
        .rect(left, riskHeaderY, pageWidth, 16)
        .fill(BG_SURFACE)
        .restore();

      doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Body-Bold');
      doc.text('SITE', left + 4, riskHeaderY + 5, { characterSpacing: 0.6 });
      doc.text('EXPOSURE', left + 200, riskHeaderY + 5, { characterSpacing: 0.6 });
      doc.text('DIRECTION', left + 300, riskHeaderY + 5, { characterSpacing: 0.6 });
      doc.y = riskHeaderY + 20;

      for (const site of data.sites) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
        }

        const rowY = doc.y;

        // Site URL
        doc.fontSize(9).fillColor(TEXT_PRIMARY).font('Body')
          .text(site.siteUrl, left + 4, rowY, { width: 180, lineBreak: false });

        // Exposure band badge
        if (site.currentExposure !== null) {
          renderBandBadge(doc, site.currentExposure.band, left + 200, rowY - 2);
        } else {
          doc.fontSize(9).fillColor(TEXT_SECONDARY).font('Body')
            .text('No data', left + 200, rowY);
        }

        // Direction
        const dirLabel = directionLabel(site.direction);
        const dirColor = directionColor(site.direction);
        doc.fontSize(9).fillColor(dirColor).font('Body')
          .text(dirLabel, left + 300, rowY, { lineBreak: false });

        doc.y = rowY + 24;
      }

      doc.moveDown(1);

      // ── Disclaimer section (final page area) ──────────────────────────────

      // Check if we need a new page for disclaimer
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
      }

      doc.moveDown(0.5);
      drawSectionRule(doc, pageWidth);

      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text('DISCLAIMER', left, doc.y, { characterSpacing: 0.8 });
      doc.moveDown(0.3);

      // Disclaimer block — light blue background (matching UI-SPEC)
      const disclaimerY = doc.y;
      const disclaimerText = DISCLAIMER_TEXT;
      const disclaimerLines = Math.ceil(disclaimerText.length / 80);
      const disclaimerHeight = disclaimerLines * 12 + 16;

      doc.save()
        .rect(left, disclaimerY, pageWidth, disclaimerHeight)
        .fill('#eff6ff')
        .restore();

      doc.fontSize(9).fillColor('#1e40af').font('Body')
        .text(disclaimerText, left + 8, disclaimerY + 8, { width: pageWidth - 16, lineGap: 3 });

      doc.y = disclaimerY + disclaimerHeight + 8;

      // Methodology link
      const dashboardUrl = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Body')
        .text(`Exposure model methodology: ${dashboardUrl}/methodology/legal-exposure`, left, doc.y);

      doc.moveDown(0.4);

      // Generated by footer
      doc.fontSize(8).fillColor(TEXT_SECONDARY).font('Mono')
        .text(`Generated by Luqen · ${new Date(data.generatedAt).toISOString()}`, left, doc.y);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// buildDigestPdfAttachment — wraps generateDigestPdf for email delivery
// ---------------------------------------------------------------------------

export async function buildDigestPdfAttachment(
  data: DigestData,
  schedule: Pick<DigestSchedule, 'orgId' | 'id'>,
): Promise<EmailAttachment | null> {
  try {
    const buffer = await generateDigestPdf(data, {});
    const orgSlug = escapeOrgSlug(schedule.orgId);
    const periodSlug = formatPeriodSlug(data.period.start);
    const filename = `accessibility-digest-${orgSlug}-${periodSlug}.pdf`;
    return {
      filename,
      content: buffer,
      contentType: 'application/pdf',
    };
  } catch (err) {
    console.error(
      `[digest-generator] Failed to generate PDF attachment for schedule ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
