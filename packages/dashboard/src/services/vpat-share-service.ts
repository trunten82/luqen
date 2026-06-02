import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord } from '../db/types.js';
import { normalizeReportData } from './report-service.js';
import type { JsonReportFile } from './report-service.js';
import { buildVpat, type VpatReport } from './vpat-service.js';
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
  const vpat = buildVpat(
    reportData,
    scan,
    manualResults,
    {
      evidenceCounts,
      reasonedChangeCount,
      behaviorallyEvaluatedCriteria: new Set(reportData.behaviorallyEvaluatedCriteria ?? []),
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
 * Render a loaded VPAT/ACR to standalone public HTML using the shared vpat.hbs
 * template. Used by BOTH the token-share view (`/share/:token`) and the public
 * dynamic ACR view (`/reports/:id/acr`) so the two surfaces render identically.
 * Download links are supplied by the caller (each surface routes downloads
 * through its own public path).
 */
export async function renderVpatHtml(
  scan: ScanRecord,
  loaded: LoadedVpat,
  opts: { pdfUrl: string; packUrl: string | null; isShared: boolean },
): Promise<string> {
  const handlebars = (await import('handlebars')).default;
  const viewsDir = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'views'));
  handlebars.registerHelper('conformanceBadge', (conformance: string) => {
    const cls =
      conformance === 'Supports' ? 'badge--success' :
      conformance === 'Partially Supports' ? 'badge--warning' :
      conformance === 'Does Not Support' ? 'badge--error' : 'badge--neutral';
    const escaped = handlebars.escapeExpression(conformance);
    return new handlebars.SafeString(`<span class="badge ${cls}">${escaped}</span>`);
  });
  const template = handlebars.compile(await readFile(join(viewsDir, 'vpat.hbs'), 'utf-8'));
  return template(
    {
      scan,
      vpat: loaded.vpat,
      evidenceGroups: loaded.evidenceGroups,
      pdfUrl: opts.pdfUrl,
      packUrl: opts.packUrl,
      isShared: opts.isShared,
    },
    { data: { root: { locale: 'en' } } },
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
): Promise<Buffer | null> {
  const loaded = await loadVpatForScan(storage, scan);
  if (loaded === null) return null;
  const { vpat, evidenceGroups, scanMeta } = loaded;

  const pdfBuffer = await generateVpatPdf(scanMeta, vpat, { groups: evidenceGroups, uploadsRoot });

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
