/**
 * Inline-styled HTML email body generator for scheduled executive digests.
 *
 * Follows the existing buildEmailBody() pattern (email/report-generator.ts):
 *   - Inline styles only — no external stylesheets (Outlook-safe)
 *   - Table-based layout
 *   - No external stylesheet link or style tags
 *
 * Conservative framing (D-06/D-12):
 *   - Band is always expressed as icon + label string (never a number)
 *   - No forbidden words: compliant, 100%, lawsuit-proof, will be sued, fault, guarantee
 *   - Vocabulary: `baseline` not `default`; `expired` not `passed`
 *   - DISCLAIMER_TEXT imported verbatim from legal-exposure.ts
 *
 * Slack/Teams messages are built inline in the scheduler (text-only summaries).
 */

import type { DigestData, SiteDelta } from '../services/digest-service.js';
import type { ExposureBand } from '../services/legal-exposure.js';
import { DISCLAIMER_TEXT } from '../services/legal-exposure.js';

// ---------------------------------------------------------------------------
// Email identity tokens (R1 — Phase 56; mirrors report-generator.ts)
// Inline-safe sRGB hex. All foreground/background pairs AAA (>= 7:1).
// ---------------------------------------------------------------------------

const EMAIL_FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ID_ACCENT = '#5a1a18';       // oxblood CTA button background
const TEXT_PRIMARY = '#1a1a1a';
const TEXT_SECONDARY = '#6b6b6b';
const BG_PAGE = '#fdfcfc';
const BG_MUTED = '#f5f3f3';
const BORDER_SUBTLE = '#e5e0e0';
const DELTA_NEW = '#9a3412';       // new findings (red)
const DELTA_FIXED = '#15803d';     // fixed findings (green)

// Band badge inline styles (Surface 3 tokens — UI-SPEC)
const BAND_BADGE_STYLE: Record<ExposureBand, string> = {
  lower:    'background-color:#dbeafe; color:#1e40af; border:1px solid #93c5fd; border-radius:4px; padding:2px 8px; font-size:14px; font-weight:600; white-space:nowrap;',
  moderate: 'background-color:#fef9c3; color:#92400e; border:1px solid #fcd34d; border-radius:4px; padding:2px 8px; font-size:14px; font-weight:600; white-space:nowrap;',
  elevated: 'background-color:#fee2e2; color:#991b1b; border:1px solid #fca5a5; border-radius:4px; padding:2px 8px; font-size:14px; font-weight:600; white-space:nowrap;',
  high:     'background-color:#fecaca; color:#7f1d1d; border:1px solid #f87171; border-radius:4px; padding:2px 8px; font-size:14px; font-weight:600; white-space:nowrap;',
};

// Band icon characters (always paired with label — colour never sole differentiator)
const BAND_ICON: Record<ExposureBand, string> = {
  lower:    '● ',
  moderate: '▲ ',
  elevated: '▲▲ ',
  high:     '⬛ ',
};

const BAND_LABEL: Record<ExposureBand, string> = {
  lower:    'Lower',
  moderate: 'Moderate',
  elevated: 'Elevated',
  high:     'High',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const e = new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

function bandBadgeHtml(band: ExposureBand): string {
  const icon = escapeHtml(BAND_ICON[band]);
  const label = escapeHtml(BAND_LABEL[band]);
  return `<span style="${BAND_BADGE_STYLE[band]}">${icon}${label}</span>`;
}

function deltaHtml(value: number): string {
  if (value > 0) {
    return `<span style="color:${DELTA_NEW}; font-weight:600;">+${value}</span>`;
  }
  if (value < 0) {
    return `<span style="color:${DELTA_FIXED}; font-weight:600;">${value}</span>`;
  }
  return `<span style="color:${TEXT_SECONDARY};">0</span>`;
}

function directionHtml(direction: SiteDelta['direction']): string {
  switch (direction) {
    case 'worsened':
      return `<span style="color:${DELTA_NEW};">▲ Worsened</span>`;
    case 'improved':
      return `<span style="color:${DELTA_FIXED};">▼ Improved</span>`;
    default:
      return `<span style="color:${TEXT_SECONDARY};">— Unchanged</span>`;
  }
}

// ---------------------------------------------------------------------------
// Section header cell (inline uppercase label)
// ---------------------------------------------------------------------------

function sectionHeader(label: string): string {
  return `
    <tr>
      <td colspan="4" style="font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:${TEXT_SECONDARY}; padding:16px 24px 8px; border-top:1px solid ${BORDER_SUBTLE};">
        ${escapeHtml(label)}
      </td>
    </tr>`;
}

// ---------------------------------------------------------------------------
// buildDigestEmailBody — main export
// ---------------------------------------------------------------------------

export function buildDigestEmailBody(data: DigestData): string {
  const dashboardUrl = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';
  const periodStr = formatPeriodRange(data.period.start, data.period.end);

  // Aggregate totals
  const totalErrors = data.sites.reduce((s, site) => s + site.errors, 0);
  const totalWarnings = data.sites.reduce((s, site) => s + site.warnings, 0);
  const totalNotices = data.sites.reduce((s, site) => s + site.notices, 0);
  const totalErrorsDelta = data.sites.reduce((s, site) => s + site.errorsDelta, 0);
  const totalWarningsDelta = data.sites.reduce((s, site) => s + site.warningsDelta, 0);
  const totalNoticesDelta = data.sites.reduce((s, site) => s + site.noticesDelta, 0);

  // Criteria changes — aggregate across sites, top 10
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

  const topCriteria = [...criteriaMap.entries()]
    .filter(([, v]) => v.newFindings > 0 || v.fixedFindings > 0)
    .sort(([, a], [, b]) => (b.newFindings + b.fixedFindings) - (a.newFindings + a.fixedFindings))
    .slice(0, 10);

  // Build criteria rows HTML
  let criteriaRowsHtml = '';
  if (topCriteria.length > 0) {
    criteriaRowsHtml = `
    <tr>
      <td colspan="4" style="padding: 4px 24px 8px;">
        <p style="margin: 0 0 6px; font-size: 14px; font-weight: 600; color: ${TEXT_SECONDARY};">Criteria with changes:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;" role="presentation">
          <thead>
            <tr>
              <th style="text-align:left; padding:2px 8px 2px 0; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600;">Criterion</th>
              <th style="text-align:center; padding:2px 8px; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600;">New</th>
              <th style="text-align:center; padding:2px 8px; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600;">Fixed</th>
            </tr>
          </thead>
          <tbody>
            ${topCriteria.map(([criterion, counts]) => `
            <tr>
              <td style="padding:2px 8px 2px 0; color:${TEXT_PRIMARY};">${escapeHtml(criterion)}</td>
              <td style="text-align:center; padding:2px 8px;">${counts.newFindings > 0 ? `<span style="color:${DELTA_NEW}; font-weight:600;">+${counts.newFindings}</span>` : `<span style="color:${TEXT_SECONDARY};">0</span>`}</td>
              <td style="text-align:center; padding:2px 8px;">${counts.fixedFindings > 0 ? `<span style="color:${DELTA_FIXED}; font-weight:600;">–${counts.fixedFindings}</span>` : `<span style="color:${TEXT_SECONDARY};">0</span>`}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </td>
    </tr>`;
  }

  // Build risk rows HTML (up to 5 sites — matching Slack/Teams contract)
  const riskSites = data.sites.slice(0, 5);
  const riskRowsHtml = riskSites.map((site) => {
    const badge = site.currentExposure !== null
      ? bandBadgeHtml(site.currentExposure.band)
      : `<span style="color:${TEXT_SECONDARY}; font-size:14px;">No data</span>`;
    return `
          <tr>
            <td style="padding:4px 0; font-size:14px; color:${TEXT_PRIMARY};">${escapeHtml(site.siteUrl)}</td>
            <td style="padding:4px 8px;">${badge}</td>
            <td style="padding:4px 0; font-size:14px;">${directionHtml(site.direction)}</td>
          </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: ${BG_MUTED}; font-family: ${EMAIL_FONT_STACK}; color: ${TEXT_PRIMARY};">
<div style="max-width: 600px; margin: 0 auto; background: ${BG_PAGE};">

  <!-- Header -->
  <div style="padding: 24px 24px 16px; border-bottom: 1px solid ${BORDER_SUBTLE};">
    <div style="font-size: 12px; font-weight: 600; color: ${ID_ACCENT}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 6px;">Luqen</div>
    <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: ${TEXT_PRIMARY}; letter-spacing: -0.012em; line-height: 1.3;">Accessibility Executive Digest</h1>
    <p style="margin: 6px 0 0; font-size: 14px; color: ${TEXT_SECONDARY}; line-height: 1.5;">
      ${escapeHtml(periodStr)}${data.siteUrl !== null ? ` · Site: ${escapeHtml(data.siteUrl)}` : ''}
    </p>
  </div>

  <!-- Main content table -->
  <table style="width: 100%; border-collapse: collapse;" role="presentation">

    <!-- WHAT CHANGED section header -->
    ${sectionHeader('What Changed')}

    <!-- Totals delta row -->
    <tr>
      <td colspan="4" style="padding: 8px 24px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;" role="presentation">
          <tr>
            <td style="padding: 4px 16px 4px 0; color: ${TEXT_PRIMARY};">Errors: <strong>${totalErrors}</strong> ${deltaHtml(totalErrorsDelta)}</td>
            <td style="padding: 4px 16px 4px 0; color: ${TEXT_PRIMARY};">Warnings: <strong>${totalWarnings}</strong> ${deltaHtml(totalWarningsDelta)}</td>
            <td style="padding: 4px 0; color: ${TEXT_PRIMARY};">Notices: <strong>${totalNotices}</strong> ${deltaHtml(totalNoticesDelta)}</td>
          </tr>
        </table>
      </td>
    </tr>

    ${criteriaRowsHtml}

    <!-- WHAT'S AT RISK section header -->
    ${sectionHeader("What's at Risk")}

    <!-- Risk table -->
    <tr>
      <td colspan="4" style="padding: 8px 24px 16px;">
        <table style="width: 100%; border-collapse: collapse;" role="presentation">
          <thead>
            <tr>
              <th style="text-align:left; padding:4px 8px 4px 0; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600; border-bottom:1px solid ${BORDER_SUBTLE};">Site</th>
              <th style="text-align:left; padding:4px 8px; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600; border-bottom:1px solid ${BORDER_SUBTLE};">Exposure</th>
              <th style="text-align:left; padding:4px 0; font-size:12px; color:${TEXT_SECONDARY}; font-weight:600; border-bottom:1px solid ${BORDER_SUBTLE};">Direction</th>
            </tr>
          </thead>
          <tbody>${riskRowsHtml}
          </tbody>
        </table>
      </td>
    </tr>

    <!-- CTA row -->
    <tr>
      <td colspan="4" style="padding: 16px 24px; border-top: 1px solid ${BORDER_SUBTLE}; text-align: center;">
        <a href="${escapeHtml(dashboardUrl)}/admin/digest-schedules"
           style="background-color:${ID_ACCENT}; color:#ffffff; border-radius:4px; padding:10px 20px; text-decoration:none; font-size:14px; font-weight:600; display:inline-block;">
          View full digest on dashboard
        </a>
        <p style="margin: 12px 0 0; font-size: 14px; color: ${TEXT_SECONDARY};">Board-ready PDF attached.</p>
      </td>
    </tr>

    <!-- Disclaimer row -->
    <tr>
      <td colspan="4" style="padding: 0 24px 16px;">
        <div style="background-color:#eff6ff; border:1px solid #93c5fd; border-radius:4px; padding:12px 16px; font-size:14px; color:#1e40af;">
          ${escapeHtml(DISCLAIMER_TEXT)}
          <br><br>
          <a href="${escapeHtml(dashboardUrl)}/methodology/legal-exposure"
             style="color:#1e40af; text-decoration:underline;">
            Exposure model methodology
          </a>
        </div>
      </td>
    </tr>

  </table>

  <!-- Footer -->
  <div style="font-size:12px; color:${TEXT_SECONDARY}; padding:16px 24px; border-top:1px solid ${BORDER_SUBTLE};">
    Generated by Luqen · ${escapeHtml(new Date(data.generatedAt).toISOString().slice(0, 10))}
  </div>

</div>
</body>
</html>`;
}
