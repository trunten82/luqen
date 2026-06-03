import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord } from '../db/types.js';
import { normalizeReportData } from './report-service.js';
import type { JsonReportFile } from './report-service.js';
import { buildVpat, type VpatReport } from './vpat-service.js';
import { resolveRegulationDetails } from './regulation-catalog.js';
import { buildVpatEvidenceGroups, type VpatEvidenceGroup } from './vpat-evidence.js';
import { resolveReportIdentity, type VpatIdentity } from './vpat-identity.js';

/**
 * Resolve a scan's per-org report identity (legal text fields + the org's
 * branding logo). Shared by the web VPAT route, the PDF export route, and the
 * token-share assembly so all surfaces render identical attribution. Guarded:
 * a storage backend without the OPTIONAL `reportIdentities` repo yields null
 * (the report renders exactly as before).
 */
export async function resolveScanIdentity(
  storage: StorageAdapter,
  scan: ScanRecord,
): Promise<VpatIdentity | null> {
  const orgId = scan.orgId ?? 'system';
  return resolveReportIdentity(
    (await storage.reportIdentities?.get(orgId)) ?? null,
    (await storage.branding.getGuidelineForSite(scan.siteUrl, orgId))?.imagePath ?? null,
  );
}
import { buildRemediationRecord } from './remediation-service.js';
import { generateVpatPdf } from '../pdf/generator.js';
import type { PdfScanMeta } from '../pdf/generator.js';
import {
  buildAcrView,
  type AcrView,
  type AcrEvidenceGroup,
  type AcrLinks,
  type AcrStaleNotice,
} from './acr-view.js';
import { generateAcrPdf, renderAcrHtml, type AcrHtmlChrome } from './acr-render.js';
import { pdfWithFallback } from './pdf-fallback.js';
import { t, SUPPORTED_LOCALES } from '../i18n/index.js';

/**
 * Shared VPAT/ACR assembly used by the authenticated export routes AND the
 * anonymous token-share routes. Centralises the report-load → buildVpat →
 * evidence-groups pipeline and the self-contained evidence-pack ZIP builder so
 * the two surfaces stay byte-for-byte identical.
 */

export interface LoadedVpat {
  readonly vpat: VpatReport;
  readonly evidenceGroups: VpatEvidenceGroup[];
  readonly scanMeta: PdfScanMeta;
}

/**
 * Load a completed scan's VPAT model (+ evidence groups + PDF scan meta).
 * Returns null when the scan has no readable report.
 */
export async function loadVpatForScan(
  storage: StorageAdapter,
  scan: ScanRecord,
): Promise<LoadedVpat | null> {
  let reportData: ReturnType<typeof normalizeReportData> | null = null;
  const dbReport = await storage.scans.getReport(scan.id);
  if (dbReport !== null) {
    reportData = normalizeReportData(dbReport as JsonReportFile, scan);
  } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
    const raw = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
    reportData = normalizeReportData(raw, scan);
  }
  if (reportData === null) return null;

  const manualResults = storage.manualTests
    ? await storage.manualTests.getManualTests(scan.id)
    : [];
  const evidenceCounts = new Map(
    ((await storage.manualTestEvidence?.countByCriterion(scan.id)) ?? []).map((c) => [c.criterionId, c.count]),
  );
  const reasonedChangeCount = (await storage.manualTestAudit?.countReasonedChanges(scan.id)) ?? 0;
  const remOrgId = scan.orgId ?? 'system';
  const [remediationEvents, siteScans] = await Promise.all([
    storage.remediationEvents.listForSite(remOrgId, scan.siteUrl),
    storage.scans.getScansForSite(remOrgId, scan.siteUrl),
  ]);
  const remediation = buildRemediationRecord(remediationEvents, siteScans);
  // Resolve the per-org legal identity ONCE here so the web view, the PDF, the
  // token-share view, and the evidence-pack PDF (all routed through this
  // assembly) render it identically.
  const identity = await resolveScanIdentity(storage, scan);
  const regulationDetails = await resolveRegulationDetails(scan.regulations ?? [], scan.orgId);
  const vpat = buildVpat(
    reportData,
    scan,
    manualResults,
    {
      evidenceCounts,
      reasonedChangeCount,
      behaviorallyEvaluatedCriteria: new Set(reportData.behaviorallyEvaluatedCriteria ?? []),
      regulationDetails,
      ...(identity ? { identity } : {}),
    },
    remediation,
  );
  const evidenceGroups = buildVpatEvidenceGroups(
    (await storage.manualTestEvidence?.listEvidence(scan.id)) ?? [],
    vpat,
  );
  const scanMeta: PdfScanMeta = {
    siteUrl: scan.siteUrl,
    standard: scan.standard,
    jurisdictions: (scan.jurisdictions ?? []).join(', '),
    regulations: (scan.regulations ?? []).join(', '),
    createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
  };
  return { vpat, evidenceGroups, scanMeta };
}

/**
 * Validate a candidate locale against the supported set, falling back to 'en'.
 */
export function resolveLocale(candidate: string | undefined): string {
  return candidate !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(candidate)
    ? candidate
    : 'en';
}

/**
 * Resolve a stored upload path (e.g. `/uploads/x.png`) to a base64 data URI so
 * the shared ACR template renders self-contained (HTML→PDF has no base URL, and
 * public viewers must not depend on an authenticated /uploads path). Only
 * PNG/JPEG are embedded; anything else returns '' (the caller lists it by name).
 */
async function uploadToDataUri(uploadsRoot: string, publicPath: string): Promise<string> {
  if (!/\.(png|jpe?g)$/i.test(publicPath)) return '';
  const abs = join(uploadsRoot, publicPath.replace(/^\/uploads\//, ''));
  if (!existsSync(abs)) return '';
  try {
    const mime = /\.png$/i.test(abs) ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${(await readFile(abs)).toString('base64')}`;
  } catch {
    return '';
  }
}

/** Options shared by the ACR view assembly. */
export interface ScanAcrViewOptions {
  /** Already-validated locale (use {@link resolveLocale}). */
  readonly locale: string;
  /** On-disk uploads root for resolving evidence images + the org logo. */
  readonly uploadsRoot: string;
  /** Surface-specific links (pdf/pack/live-report/badge/dashboard). */
  readonly links?: AcrLinks;
  /** Stale-revision banner (only on a non-latest Snapshot revision). */
  readonly staleNotice?: AcrStaleNotice;
}

/**
 * THE single ACR view assembly for the dashboard. Maps a loaded VPAT onto the
 * shared-template view shape, fully localized and content-complete: per-org
 * wording overrides, the verdict-change audit trail, evidence images inlined as
 * data URIs, the org logo, and surface-specific links. Every render path (web,
 * public, token-share, evidence-pack PDF, authed export) builds its AcrView here
 * so all surfaces stay byte-identical for the same view JSON + locale.
 */
export async function buildScanAcrView(
  storage: StorageAdapter,
  scan: ScanRecord,
  loaded: LoadedVpat,
  opts: ScanAcrViewOptions,
): Promise<AcrView> {
  const orgId = scan.orgId ?? 'system';

  // Verdict-change audit trail — only rows carrying a recorded reason are
  // surfaced; that is the defensible evidence of a reasoned evaluation process.
  const auditRows = (await storage.manualTestAudit?.listAudit(scan.id)) ?? [];
  const auditHistory = auditRows
    .filter((a) => (a.comment ?? '').trim() !== '')
    .map((a) => ({
      criterion: a.criterionId,
      change: `${a.fromStatus ?? 'untested'} → ${a.toStatus}`,
      reason: a.comment ?? '',
      actor: a.actor ?? '—',
      date: a.createdAt.slice(0, 10),
    }));

  // Evidence images are inlined as data URIs so the document renders
  // self-contained (HTML→PDF has no base URL; public viewers need no auth). The
  // download `href` keeps the original /uploads path so authed viewers can still
  // open the full-resolution artifact (and documents, which are never inlined).
  const evidence: AcrEvidenceGroup[] = await Promise.all(
    loaded.evidenceGroups.map(async (g) => ({
      criterion: g.criterion,
      title: g.title,
      items: await Promise.all(
        g.items.map(async (it) => ({
          fileName: it.fileName,
          isImage: it.isImage,
          src: it.isImage ? await uploadToDataUri(opts.uploadsRoot, it.filePath) : '',
          href: it.filePath,
        })),
      ),
    })),
  );

  const logoUrl = loaded.vpat.identity?.logoPath
    ? await uploadToDataUri(opts.uploadsRoot, loaded.vpat.identity.logoPath)
    : '';

  const wordingOverrides = (await storage.acrWording?.listForOrg(orgId, opts.locale)) ?? [];

  return buildAcrView(loaded.vpat, loaded.scanMeta, {
    locale: opts.locale,
    t: t as unknown as Parameters<typeof buildAcrView>[2]['t'],
    wordingOverrides,
    auditHistory,
    ...(opts.links ? { links: opts.links } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    evidence,
    ...(opts.staleNotice ? { staleNotice: opts.staleNotice } : {}),
  });
}

/**
 * Render a loaded VPAT/ACR to standalone HTML using the SHARED ACR template
 * (the single source of truth, identical to the WordPress plugin and the PDF).
 * Used by the public dynamic ACR (`/reports/:id/acr`), the token-share view
 * (`/share/:token`), the per-site report page, and the authenticated web view
 * (which passes interactive `chrome`). Replaces the retired `vpat.hbs`.
 */
export async function renderScanAcrHtml(
  storage: StorageAdapter,
  scan: ScanRecord,
  loaded: LoadedVpat,
  opts: ScanAcrViewOptions,
  chrome: AcrHtmlChrome = {},
): Promise<string> {
  const view = await buildScanAcrView(storage, scan, loaded, opts);
  return renderAcrHtml(view, { locale: opts.locale, ...chrome });
}

/**
 * Render a loaded VPAT/ACR to a PDF buffer via the shared template + headless
 * Chromium (the single-source path that matches the WordPress plugin). Degrades
 * to the dependency-free PDFKit VPAT renderer when no browser can launch (CI, or
 * a host without Chromium) so a valid PDF is always served — logged on degrade.
 */
export async function renderScanAcrPdf(
  storage: StorageAdapter,
  scan: ScanRecord,
  loaded: LoadedVpat,
  opts: ScanAcrViewOptions,
  onFallback?: (err: unknown) => void,
): Promise<Buffer> {
  const view = await buildScanAcrView(storage, scan, loaded, opts);
  return pdfWithFallback(
    () => generateAcrPdf(view),
    () => generateVpatPdf(loaded.scanMeta, loaded.vpat, { groups: loaded.evidenceGroups, uploadsRoot: opts.uploadsRoot }),
    onFallback,
  );
}

/**
 * Sanitise a single path component before it becomes a ZIP entry name —
 * defence-in-depth against zip-slip via a criterion id or stored filename.
 */
export function sanitizeZipPart(value: string): string {
  const cleaned = value
    .replace(/[\\/]/g, '_')
    .replace(/\.\.+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : 'file';
}

/**
 * Build the self-contained evidence pack: the ACR PDF + every original
 * evidence file (foldered by criterion) + a plain-text index. Returns null when
 * the scan has no readable report.
 */
export async function buildEvidencePackZip(
  storage: StorageAdapter,
  scan: ScanRecord,
  uploadsRoot: string,
  locale: string = 'en',
): Promise<Buffer | null> {
  const loaded = await loadVpatForScan(storage, scan);
  if (loaded === null) return null;
  const { vpat, evidenceGroups } = loaded;

  // The pack's ACR PDF renders through the shared template (Chromium), with the
  // PDFKit VPAT as the no-browser fallback — same single source as every other
  // surface, so the pack PDF matches the standalone download byte-for-byte.
  const pdfBuffer = await renderScanAcrPdf(storage, scan, loaded, {
    locale: resolveLocale(locale),
    uploadsRoot,
  });

  const zip = new JSZip();
  zip.file('accessibility-conformance-report.pdf', pdfBuffer);

  const indexLines: string[] = [
    'LUQEN — VPAT / ACR EVIDENCE PACK',
    '',
    `Site:      ${scan.siteUrl}`,
    `Standard:  ${vpat.standard}`,
    `Generated: ${vpat.generatedAt}`,
    '',
    'This pack contains the Accessibility Conformance Report',
    '(accessibility-conformance-report.pdf) and the supporting manual-test',
    'evidence files, organised by WCAG success criterion below.',
    '',
  ];

  let bundled = 0;
  let missing = 0;
  for (const group of evidenceGroups) {
    indexLines.push(group.title ? `${group.criterion} — ${group.title}` : group.criterion);
    const critDir = sanitizeZipPart(group.criterion);
    for (const item of group.items) {
      const fileSafe = sanitizeZipPart(item.fileName);
      const entryPath = `evidence/${critDir}/${fileSafe}`;
      try {
        const bytes = await readFile(join(uploadsRoot, item.filePath.replace(/^\/uploads\//, '')));
        zip.file(entryPath, bytes);
        indexLines.push(`    ${entryPath}`);
        bundled += 1;
      } catch {
        indexLines.push(`    ${fileSafe}  (file unavailable — not included)`);
        missing += 1;
      }
    }
    indexLines.push('');
  }
  if (evidenceGroups.length === 0) {
    indexLines.push('(No manual-test evidence files were recorded for this scan.)');
    indexLines.push('');
  }
  indexLines.push(`Files bundled: ${bundled}${missing > 0 ? `; unavailable: ${missing}` : ''}`);
  zip.file('EVIDENCE-INDEX.txt', `${indexLines.join('\n')}\n`);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
