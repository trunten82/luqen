/**
 * Fleet / site report bundling.
 *
 * Builds a downloadable bundle (.tar.gz) of VPAT/ACR PDFs — one per site's
 * latest completed scan — for a whole organisation, plus a MANIFEST.txt that
 * states what the bundle is and the same conservative good-faith disclaimer the
 * reports carry. Reuses the exact single-report pipeline (normalizeReportData →
 * buildVpat → generateVpatPdf) so a fleet PDF is byte-for-byte the same report
 * a user would download per site.
 *
 * No new dependencies: bundling uses the already-installed `tar` package (there
 * is no zip lib in the tree). No DB migration — reads existing scans + manual
 * tests + remediation events.
 */

import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import type { StorageAdapter } from '../db/adapter.js';
import type { ScanRecord } from '../db/types.js';
import { normalizeReportData, type JsonReportFile } from './report-service.js';
import { buildVpat } from './vpat-service.js';
import { buildRemediationRecord } from './remediation-service.js';
import { generateVpatPdf } from '../pdf/generator.js';

/** Hard cap so a huge org can't exhaust memory/disk in one request. */
export const FLEET_REPORT_MAX_SITES = 50;

export interface FleetReportResult {
  /** The .tar.gz bundle. */
  readonly buffer: Buffer;
  /** Number of site reports actually included. */
  readonly included: number;
  /** Sites omitted because the cap was hit (0 when none). */
  readonly truncated: number;
  /** Total candidate sites with a completed scan before the cap. */
  readonly candidates: number;
}

function hostnameOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
  }
}

/** Builds the VPAT PDF for one completed scan, mirroring the export.ts route. */
async function buildVpatPdfForScan(
  storage: StorageAdapter,
  scan: ScanRecord,
): Promise<Buffer | null> {
  let reportJson: JsonReportFile | null = null;
  const dbReport = await storage.scans.getReport(scan.id);
  if (dbReport !== null) {
    reportJson = dbReport as JsonReportFile;
  } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
    reportJson = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
  }
  if (reportJson === null) return null;

  const reportData = normalizeReportData(reportJson, scan);
  const manualResults = storage.manualTests
    ? await storage.manualTests.getManualTests(scan.id)
    : [];
  const orgId = scan.orgId ?? 'system';
  const [remediationEvents, siteScans] = await Promise.all([
    storage.remediationEvents.listForSite(orgId, scan.siteUrl),
    storage.scans.getScansForSite(orgId, scan.siteUrl),
  ]);
  const remediation = buildRemediationRecord(remediationEvents, siteScans);
  // Phase 84 C#2: forward the vision-evaluated criteria so cleanly-evaluated
  // criteria are elevated to "Supports" in the VPAT.
  const vpat = buildVpat(
    reportData,
    scan,
    manualResults,
    { behaviorallyEvaluatedCriteria: new Set(reportData.behaviorallyEvaluatedCriteria ?? []) },
    remediation,
  );

  return generateVpatPdf(
    {
      siteUrl: scan.siteUrl,
      standard: scan.standard,
      jurisdictions: scan.jurisdictions.join(', '),
      regulations: (scan.regulations ?? []).join(', '),
      createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
    },
    vpat,
  );
}

function manifest(
  orgLabel: string,
  generatedAt: string,
  entries: readonly { siteUrl: string; file: string }[],
  truncated: number,
): string {
  const lines = [
    'Luqen — Accessibility Conformance Report bundle',
    '================================================',
    `Organisation: ${orgLabel}`,
    `Generated:    ${generatedAt}`,
    `Reports:      ${entries.length}`,
    ...(truncated > 0 ? [`Omitted:      ${truncated} site(s) beyond the ${FLEET_REPORT_MAX_SITES}-report limit`] : []),
    '',
    'Contents:',
    ...entries.map((e) => `  - ${e.file}  (${e.siteUrl})`),
    '',
    'About this bundle',
    '-----------------',
    'Each file is a Voluntary Product Accessibility Template (VPAT) / Accessibility',
    'Conformance Report for one site, derived from its most recent completed scan',
    'plus any recorded manual test results. These reports are transparency and',
    'good-faith remediation documents. They are not certificates of compliance and',
    'do not constitute legal advice or a guarantee against accessibility claims.',
    'Criteria that automated testing cannot conclusively verify are reported as',
    '"Not Evaluated" until a manual test is recorded — they are not assumed to pass.',
  ];
  return lines.join('\n') + '\n';
}

/**
 * Builds a .tar.gz bundle of VPAT PDFs for every site in an org that has a
 * completed scan (latest per site). Returns an empty-but-valid bundle (just the
 * MANIFEST) when the org has no completed scans, so the endpoint always returns
 * a well-formed archive.
 */
export async function buildFleetReportBundle(
  storage: StorageAdapter,
  orgId: string,
  opts: { orgLabel?: string; generatedAt?: string } = {},
): Promise<FleetReportResult> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const orgLabel = opts.orgLabel ?? orgId;

  const latest = await storage.scans.getLatestPerSite(orgId);
  const completed = latest.filter((s) => s.status === 'completed');
  const candidates = completed.length;
  const selected = completed.slice(0, FLEET_REPORT_MAX_SITES);
  const truncated = candidates - selected.length;

  const dir = await mkdtemp(join(tmpdir(), 'luqen-fleet-'));
  try {
    const entries: { siteUrl: string; file: string }[] = [];
    const usedNames = new Set<string>();
    for (const scan of selected) {
      const pdf = await buildVpatPdfForScan(storage, scan);
      if (pdf === null) continue;
      let base = `vpat_${hostnameOf(scan.siteUrl)}`;
      let name = `${base}.pdf`;
      let n = 2;
      while (usedNames.has(name)) name = `${base}_${n++}.pdf`;
      usedNames.add(name);
      await writeFile(join(dir, name), pdf);
      entries.push({ siteUrl: scan.siteUrl, file: name });
    }

    await writeFile(join(dir, 'MANIFEST.txt'), manifest(orgLabel, generatedAt, entries, truncated), 'utf-8');

    const fileList = ['MANIFEST.txt', ...entries.map((e) => e.file)];
    const tgzPath = join(dir, '_bundle.tar.gz');
    await tar.create({ gzip: true, cwd: dir, file: tgzPath }, fileList);
    const buffer = await readFile(tgzPath);

    return { buffer, included: entries.length, truncated, candidates };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
