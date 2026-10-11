/**
 * The one dismissal read path (Phase 88).
 *
 *  - D-05  two layers: applyActiveDismissals() applies the CURRENT active set to an
 *          already-loaded raw report; every surface keeps its own raw load (SC5) and
 *          inserts exactly one call. The lookup is keyed on the SCAN's own org and
 *          toSiteKey(scan.siteUrl) — never the requester's org.
 *  - D-10  dismissedCountsByCriterion(): dismissed OCCURRENCES per WCAG criterion.
 *  - D-14 / IN-03  loadReportForScan(): DB report, then the on-disk file; a failure is
 *          reported by error NAME only (V8 parse messages quote the input).
 *  - D-16  persistedCountsFor(): the count columns' value for a scan about to be saved.
 *
 * Nothing here writes: a filtered report is never persisted (D-01, P1). Repository
 * failures propagate to the calling surface; the loader never degrades to the raw
 * report silently.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { StorageAdapter } from '../../db/index.js';
import type { ScanRecord } from '../../db/types.js';
import type { IssueDismissal } from '../../db/interfaces/issue-dismissal-repository.js';
import { extractCriterion } from '../../routes/wcag-enrichment.js';
import { countIssues, type IssueCounts } from '../count-issues.js';
import { applyDismissals, type DismissedOccurrence } from './apply-dismissals.js';
import { filterComplianceForDismissals } from './filter-compliance.js';
import { toSiteKey } from './site-key.js';

export interface AppliedActiveDismissals<R> {
  readonly report: R;
  readonly dismissed: readonly DismissedOccurrence[];
  /** The active rows for the scan's org + site; empty only when there is no repository or no active row. */
  readonly active: readonly IssueDismissal[];
}

export type LoadedReport =
  | { readonly kind: 'ok'; readonly report: unknown }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly errorName: string };

export async function applyActiveDismissals<R>(
  storage: StorageAdapter,
  scan: Pick<ScanRecord, 'orgId' | 'siteUrl'>,
  raw: R,
): Promise<AppliedActiveDismissals<R>> {
  const repo = storage.issueDismissals;
  if (repo === undefined) return { report: raw, dismissed: [], active: [] };
  const siteKey = toSiteKey(scan.siteUrl);
  const active = await repo.listActiveForSite(scan.orgId, siteKey);
  if (active.length === 0) return { report: raw, dismissed: [], active: [] };
  const applied = applyDismissals(raw, active, siteKey);
  if (applied.dismissed.length === 0) return { report: raw, dismissed: [], active };
  // D-08: the matrices follow the dismissals; only when something was actually dismissed.
  return { report: filterComplianceForDismissals(raw, applied.report), dismissed: applied.dismissed, active };
}

/**
 * A scan ROW carries the whole raw report as `jsonReport`, and several surfaces spread or
 * serialise the row next to the (filtered) report. When, and only when, at least one
 * dismissal applied, the row's raw blob is replaced by the filtered report's JSON so the
 * dismissed occurrence is absent from the WHOLE output. Otherwise the caller's own row
 * object is returned (identity: zero dismissals stay byte-identical, SC5). Never persists.
 */
export function withDismissalsInRawBlob<S extends { readonly jsonReport?: string }>(
  row: S,
  applied: Pick<AppliedActiveDismissals<unknown>, 'report' | 'dismissed'>,
): S {
  if (applied.dismissed.length === 0 || row.jsonReport === undefined) return row;
  return { ...row, jsonReport: JSON.stringify(applied.report) };
}

/** DB report first, then the jsonReportPath file. Never carries err.message. */
export async function loadReportForScan(
  storage: StorageAdapter,
  scan: Pick<ScanRecord, 'id' | 'jsonReportPath'>,
): Promise<LoadedReport> {
  try {
    const dbReport = await storage.scans.getReport(scan.id);
    if (dbReport !== null) return { kind: 'ok', report: dbReport };
    if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
      return { kind: 'ok', report: JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as unknown };
    }
    return { kind: 'missing' };
  } catch (err) {
    return { kind: 'error', errorName: err instanceof Error ? err.name : 'Error' };
  }
}

function criterionOfIssue(issue: unknown): string | null {
  if (typeof issue !== 'object' || issue === null) return null;
  const { wcagCriterion, code } = issue as { wcagCriterion?: unknown; code?: unknown };
  if (typeof wcagCriterion === 'string' && wcagCriterion !== '') return wcagCriterion;
  return typeof code === 'string' ? extractCriterion(code) : null;
}

/** Dismissed OCCURRENCES per WCAG criterion; occurrences with no criterion are not attributed. */
export function dismissedCountsByCriterion(
  dismissed: readonly DismissedOccurrence[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const occurrence of dismissed) {
    const criterion = criterionOfIssue(occurrence.issue);
    if (criterion === null) continue;
    counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
  }
  return counts;
}

/**
 * Counts to persist for a scan: the caller's own counts object, unchanged, when nothing
 * is dismissed (the scanner's counts stay authoritative, D-16 / SC5), else countIssues
 * of the dismissal-filtered pages.
 */
export async function persistedCountsFor(
  storage: StorageAdapter,
  scope: Pick<ScanRecord, 'orgId' | 'siteUrl'>,
  pages: readonly unknown[],
  rawCounts: IssueCounts,
): Promise<IssueCounts> {
  const applied = await applyActiveDismissals(storage, scope, { pages });
  if (applied.dismissed.length === 0) return rawCounts;
  return countIssues(applied.report);
}
