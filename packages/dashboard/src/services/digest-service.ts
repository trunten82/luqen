/**
 * Digest computation core for scheduled executive digests.
 *
 * Builds a DigestData payload for a given org/site scope and time period:
 *   - "What changed": new vs fixed findings, per-WCAG-criterion and totals
 *   - "What's at risk": exposure trend (current vs baseline band + direction)
 *
 * Conservative framing (D-12):
 *   - Band is always the ordinal label, never a number or percentage
 *   - No forbidden words: compliant, 100%, lawsuit-proof, will be sued,
 *     fault, guarantee
 *   - Vocabulary: use `baseline` not `default`; `expired` not `passed`
 *   - A site with no scan in the period reports hasNewScan=false explicitly
 *     — silence NEVER reads as "fine" (D-03)
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { StorageAdapter } from '../db/adapter.js';
import type { ScanRecord } from '../db/types.js';
import { normalizeReportData, type JsonReportFile } from './report-service.js';
import { deriveExposure, BAND_ORDINAL, type ExposureResult } from './legal-exposure.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Inclusive time window for the digest. ISO date strings. */
export interface DigestPeriod {
  readonly start: string;
  readonly end: string;
}

/** Per-WCAG-criterion change between baseline and current scan. */
export interface CriterionDelta {
  /** Dotted WCAG criterion key, e.g. "1.1.1". */
  readonly criterion: string;
  /** Net new findings in the current scan vs baseline (0 if not increased). */
  readonly newFindings: number;
  /** Net fixed findings in the current scan vs baseline (0 if not decreased). */
  readonly fixedFindings: number;
}

/** Computed change summary for a single site over the digest period. */
export interface SiteDelta {
  readonly siteUrl: string;
  /** True when a completed scan exists within [period.start, period.end]. */
  readonly hasNewScan: boolean;
  /** Findings totals from the current (or most recent) scan. */
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
  /** Totals deltas vs baseline (0 when hasNewScan=false or no baseline). */
  readonly errorsDelta: number;
  readonly warningsDelta: number;
  readonly noticesDelta: number;
  /** Per-criterion changes (empty when hasNewScan=false). */
  readonly criteriaChanges: readonly CriterionDelta[];
  /** Exposure from the current (or most recent available) scan. null if no scan at all. */
  readonly currentExposure: ExposureResult | null;
  /** Exposure from the scan immediately before period.start. null if no baseline. */
  readonly baselineExposure: ExposureResult | null;
  /** Direction of exposure change relative to baseline. */
  readonly direction: 'worsened' | 'improved' | 'unchanged';
}

/** The complete digest payload consumed by renderers (PDF/email/API/HBS). */
export interface DigestData {
  readonly orgId: string;
  /** null for org-wide scope; the site URL for single-site scope. */
  readonly siteUrl: string | null;
  readonly period: DigestPeriod;
  /** Ordered: most at-risk site first (by current exposure band, DESC). */
  readonly sites: readonly SiteDelta[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute direction of exposure change from baseline to current.
 * null on either side → 'unchanged'.
 */
function computeDirection(
  current: ExposureResult | null,
  baseline: ExposureResult | null,
): 'worsened' | 'improved' | 'unchanged' {
  if (current === null || baseline === null) return 'unchanged';
  const curr = BAND_ORDINAL[current.band];
  const base = BAND_ORDINAL[baseline.band];
  if (curr > base) return 'worsened';
  if (curr < base) return 'improved';
  return 'unchanged';
}

/**
 * Load a scan's JSON report from the DB or from disk (jsonReportPath fallback).
 * Returns null if not available — never throws.
 */
async function loadReport(storage: StorageAdapter, scan: ScanRecord): Promise<JsonReportFile | null> {
  try {
    const dbReport = await storage.scans.getReport(scan.id);
    if (dbReport !== null) {
      return dbReport as unknown as JsonReportFile;
    }
    if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
      return JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
    }
  } catch {
    // Malformed report — conservative: treat as unavailable
  }
  return null;
}

/** Build an ExposureInput from a ScanRecord (mirrors fleet.ts derivation). */
function buildExposureInput(scan: ScanRecord) {
  return {
    jurisdictions: scan.jurisdictions ?? [],
    regulations: scan.regulations ?? [],
    findings: {
      errors: scan.errors ?? 0,
      warnings: scan.warnings ?? 0,
      notices: scan.notices ?? 0,
      confirmedViolations: scan.confirmedViolations ?? 0,
    },
  };
}

/**
 * For a site's completed scan list (DESC by completedAt / createdAt),
 * find:
 *   - current: the latest scan with completedAt within [periodStart, periodEnd]
 *   - baseline: the latest scan with completedAt strictly before periodStart
 * Scans must have status = 'completed' (the repository already filters this
 * for getScansForSite when needed; we filter ourselves since listScans may
 * return any status).
 */
function partitionScans(
  scans: readonly ScanRecord[],
  periodStart: string,
  periodEnd: string,
): { current: ScanRecord | null; baseline: ScanRecord | null } {
  const completed = scans.filter((s) => s.status === 'completed');
  // Stable comparison key: completedAt > createdAt (completedAt is optional)
  const ts = (s: ScanRecord) => s.completedAt ?? s.createdAt;

  let current: ScanRecord | null = null;
  let baseline: ScanRecord | null = null;

  for (const scan of completed) {
    const t = ts(scan);
    if (t >= periodStart && t <= periodEnd) {
      if (current === null || ts(current) < t) current = scan;
    } else if (t < periodStart) {
      if (baseline === null || ts(baseline) < t) baseline = scan;
    }
  }

  return { current, baseline };
}

/** Derive per-criterion count map from normalizeReportData output. */
function criterionCountMap(
  report: JsonReportFile,
  scan: ScanRecord,
): Map<string, number> {
  const data = normalizeReportData(report, {
    siteUrl: scan.siteUrl,
    pagesScanned: scan.pagesScanned,
    errors: scan.errors,
    warnings: scan.warnings,
    notices: scan.notices,
  });
  const map = new Map<string, number>();
  for (const group of data.allIssueGroups) {
    map.set(group.criterion, group.totalCount);
  }
  return map;
}

/** Compute CriterionDelta[] by comparing two criterion count maps. */
function computeCriteriaChanges(
  currentMap: Map<string, number>,
  baselineMap: Map<string, number>,
): CriterionDelta[] {
  const allCriteria = new Set([...currentMap.keys(), ...baselineMap.keys()]);
  const deltas: CriterionDelta[] = [];

  for (const criterion of allCriteria) {
    const curr = currentMap.get(criterion) ?? 0;
    const base = baselineMap.get(criterion) ?? 0;
    if (curr !== base) {
      deltas.push({
        criterion,
        newFindings: curr > base ? curr - base : 0,
        fixedFindings: base > curr ? base - curr : 0,
      });
    }
  }

  deltas.sort((a, b) => a.criterion.localeCompare(b.criterion));
  return deltas;
}

/**
 * Build the SiteDelta for one site. Uses per-site try/catch so one bad
 * site never fails the whole digest build (T-82-07).
 */
async function buildSiteDelta(
  storage: StorageAdapter,
  orgId: string,
  siteUrl: string,
  period: DigestPeriod,
): Promise<SiteDelta> {
  try {
    const allScans = await storage.scans.getScansForSite(orgId, siteUrl, 200);
    const { current, baseline } = partitionScans(allScans, period.start, period.end);

    // Exposure for current (or fallback to most recent completed if no current in period)
    const forExposure = current ?? allScans.find((s) => s.status === 'completed') ?? null;
    const currentExposure = forExposure !== null
      ? (() => {
          try { return deriveExposure(buildExposureInput(forExposure)); } catch { return null; }
        })()
      : null;

    const baselineExposure = baseline !== null
      ? (() => {
          try { return deriveExposure(buildExposureInput(baseline)); } catch { return null; }
        })()
      : null;

    const direction = computeDirection(currentExposure, baselineExposure);

    if (current === null) {
      // No scan within the period — explicit no-scan state (D-03)
      return {
        siteUrl,
        hasNewScan: false,
        errors: forExposure?.errors ?? 0,
        warnings: forExposure?.warnings ?? 0,
        notices: forExposure?.notices ?? 0,
        errorsDelta: 0,
        warningsDelta: 0,
        noticesDelta: 0,
        criteriaChanges: [],
        currentExposure,
        baselineExposure,
        direction,
      };
    }

    // Has a current scan in the period — compute deltas
    const errors = current.errors ?? 0;
    const warnings = current.warnings ?? 0;
    const notices = current.notices ?? 0;

    const baseErrors = baseline?.errors ?? 0;
    const baseWarnings = baseline?.warnings ?? 0;
    const baseNotices = baseline?.notices ?? 0;

    // Per-criterion deltas (only when both reports are available)
    let criteriaChanges: CriterionDelta[] = [];
    if (baseline !== null) {
      const [currentReport, baselineReport] = await Promise.all([
        loadReport(storage, current),
        loadReport(storage, baseline),
      ]);

      if (currentReport !== null && baselineReport !== null) {
        const currentMap = criterionCountMap(currentReport, current);
        const baseMap = criterionCountMap(baselineReport, baseline);
        criteriaChanges = computeCriteriaChanges(currentMap, baseMap);
      } else if (currentReport !== null) {
        // No baseline report — all current findings are "new"
        const currentMap = criterionCountMap(currentReport, current);
        for (const [criterion, count] of currentMap) {
          if (count > 0) {
            criteriaChanges.push({ criterion, newFindings: count, fixedFindings: 0 });
          }
        }
        criteriaChanges.sort((a, b) => a.criterion.localeCompare(b.criterion));
      }
    }

    return {
      siteUrl,
      hasNewScan: true,
      errors,
      warnings,
      notices,
      errorsDelta: errors - baseErrors,
      warningsDelta: warnings - baseWarnings,
      noticesDelta: notices - baseNotices,
      criteriaChanges,
      currentExposure,
      baselineExposure,
      direction,
    };
  } catch {
    // Defensive: return a safe zero-state for this site so others still render
    return {
      siteUrl,
      hasNewScan: false,
      errors: 0,
      warnings: 0,
      notices: 0,
      errorsDelta: 0,
      warningsDelta: 0,
      noticesDelta: 0,
      criteriaChanges: [],
      currentExposure: null,
      baselineExposure: null,
      direction: 'unchanged',
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the digest payload for a given org/site scope and time period.
 *
 * - For single-site scope (scope.siteUrl !== null), returns one SiteDelta.
 * - For org-wide scope (scope.siteUrl === null), enumerates all sites with
 *   at least one completed scan for the org, ranked by current exposure band
 *   DESC (most at risk first).
 *
 * Conservative: a site with no completed scan in the period gets
 * hasNewScan=false with deltas of 0 — never implies "unchanged/fine".
 */
export async function buildDigest(
  storage: StorageAdapter,
  scope: { orgId: string; siteUrl: string | null },
  period: DigestPeriod,
): Promise<DigestData> {
  const { orgId, siteUrl } = scope;

  let siteUrls: string[];

  if (siteUrl !== null) {
    siteUrls = [siteUrl];
  } else {
    // Enumerate all distinct completed-scan sites for this org
    const allCompleted = await storage.scans.listScans({ orgId, status: 'completed' });
    const distinctSites = new Set(allCompleted.map((s) => s.siteUrl));
    siteUrls = [...distinctSites];
  }

  const siteDeltas = await Promise.all(
    siteUrls.map((url) => buildSiteDelta(storage, orgId, url, period)),
  );

  // Sort by current exposure band DESC (most at risk first) for org scope
  if (siteUrl === null) {
    siteDeltas.sort((a, b) => {
      const bandA = a.currentExposure !== null ? BAND_ORDINAL[a.currentExposure.band] : -1;
      const bandB = b.currentExposure !== null ? BAND_ORDINAL[b.currentExposure.band] : -1;
      return bandB - bandA;
    });
  }

  return {
    orgId,
    siteUrl,
    period,
    sites: siteDeltas,
    generatedAt: new Date().toISOString(),
  };
}
