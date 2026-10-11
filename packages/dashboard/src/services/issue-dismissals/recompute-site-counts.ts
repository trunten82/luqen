/**
 * recomputeSiteCounts — keep the stored count columns true after a dismissal changes (Phase 88).
 *
 *  - D-13  runs synchronously inside the mark/revoke request, after the dismissal committed.
 *  - D-14  per-scan failures never undo the dismissal: they are counted, logged by scan id and
 *          error NAME only, and reported to the caller (which says `recompute_complete: false`).
 *  - D-15  the ONE shared function for mark, revoke and any one-off script; idempotent, because each
 *          scan's result depends only on its own report and the active set.
 *  - D-01/D-02  the raw report is never rewritten; only errors, warnings, notices and totalIssues
 *          are written. With no active dismissal they equal countIssues(json_report) exactly, so the
 *          raw counts stay recoverable. confirmed_violations is not derivable (D-04 Case A) and is
 *          never touched here.
 *
 * OOM contract: scans are listed with the metadata-only listing (no report blob) and each report is
 * loaded by id, one at a time, then dropped before the next. There is no cap and no early exit: every
 * listed scan of the site is processed, because a limit would silently leave columns stale.
 */
import type { StorageAdapter } from '../../db/index.js';
import { countIssues } from '../count-issues.js';
import { applyDismissals } from './apply-dismissals.js';
import { loadReportForScan } from './load-dismissed-report.js';
import { toSiteKey } from './site-key.js';

export interface RecomputeLogger {
  warn(obj: { scanId: string; errorName: string }, msg: string): void;
}

export interface RecomputeResult {
  readonly recomputedScans: number;
  readonly failedScans: number;
  /** false when the scan listing itself failed: nothing was recomputed and the result is incomplete. */
  readonly listed: boolean;
  readonly durationMs: number;
}

const consoleLogger: RecomputeLogger = {
  warn(obj, msg) {
    console.warn(obj, msg);
  },
};

function nameOf(err: unknown): string {
  return err instanceof Error ? err.name : 'Error';
}

export async function recomputeSiteCounts(
  storage: StorageAdapter,
  orgId: string,
  siteKey: string,
  log: RecomputeLogger = consoleLogger,
): Promise<RecomputeResult> {
  const started = performance.now();
  const done = (recomputedScans: number, failedScans: number, listed: boolean): RecomputeResult => ({
    recomputedScans,
    failedScans,
    listed,
    durationMs: performance.now() - started,
  });

  let siteScans;
  try {
    // Metadata columns only: no includeReport opt-in, never a blob-loading listing method.
    const listing = await storage.scans.listScans({ orgId, status: 'completed' });
    siteScans = listing.filter((scan) => toSiteKey(scan.siteUrl) === siteKey);
  } catch (err) {
    log.warn({ scanId: '-', errorName: nameOf(err) }, 'Dismissal recompute: scan listing failed');
    return done(0, 0, false);
  }

  let recomputed = 0;
  let failed = 0;
  for (const scan of siteScans) {
    try {
      const loaded = await loadReportForScan(storage, scan);
      if (loaded.kind !== 'ok') {
        failed += 1;
        log.warn(
          { scanId: scan.id, errorName: loaded.kind === 'error' ? loaded.errorName : 'NoReport' },
          'Dismissal recompute: report not readable',
        );
        continue;
      }
      // Read the active set NOW, after the report is parsed: a dismissal committed meanwhile applies.
      const active = (await storage.issueDismissals?.listActiveForSite(orgId, siteKey)) ?? [];
      const counts = countIssues(applyDismissals(loaded.report, active, siteKey).report);
      await storage.scans.updateScan(scan.id, {
        errors: counts.errors,
        warnings: counts.warnings,
        notices: counts.notices,
        totalIssues: counts.total,
      });
      recomputed += 1;
    } catch (err) {
      failed += 1;
      log.warn({ scanId: scan.id, errorName: nameOf(err) }, 'Dismissal recompute: scan failed');
    }
  }
  return done(recomputed, failed, true);
}
