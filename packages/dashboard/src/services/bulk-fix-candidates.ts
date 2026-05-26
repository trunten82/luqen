/**
 * Phase 62.3 / 62.4 — Shared candidate-resolution for bulk fixes.
 *
 * Extracted from routes/api/bulk-fixes.ts so the 62.4 MCP fleet tool
 * `dashboard_queue_bulk_fix` can reuse the same matching logic without
 * duplicating the criterion-match / team-scope code.
 *
 * A "site" is the latest completed scan per site_url across the bulk_fix's
 * effective org scope (home org + every linked org via team_org_links when
 * teamId is set; just the home org otherwise). The site is a CANDIDATE if any
 * issue in that scan's jsonReport matches the criterion via either:
 *   - issue.wcagCriterion === criterion, OR
 *   - issue.code.startsWith(criterion) — fallback for rules whose code
 *     embeds the criterion (e.g. "WCAG2AA.Principle1.Guideline1_1...").
 */

import type { StorageAdapter } from '../db/index.js';

interface ScanIssueShape {
  readonly code?: string;
  readonly wcagCriterion?: string;
}

interface ScanReportShape {
  readonly pages?: ReadonlyArray<{
    readonly issues?: ReadonlyArray<ScanIssueShape>;
  }>;
}

export interface BulkFixCandidate {
  readonly site_id: string;
  readonly site_url: string;
  readonly last_seen_at: string;
  readonly suggested_patch_summary: string;
}

/** Apply the criterion-match rule across a parsed scan report. */
export function reportMatchesCriterion(
  report: ScanReportShape | null,
  criterion: string,
): boolean {
  if (report === null || !Array.isArray(report.pages)) return false;
  for (const page of report.pages) {
    if (!Array.isArray(page.issues)) continue;
    for (const issue of page.issues) {
      if (issue.wcagCriterion === criterion) return true;
      if (typeof issue.code === 'string' && issue.code.startsWith(criterion)) {
        return true;
      }
    }
  }
  return false;
}

/** Effective org-id list for a team: home org + every active linked org. */
export async function teamScopeOrgIds(
  storage: StorageAdapter,
  teamId: string,
): Promise<readonly string[]> {
  const team = await storage.teams.getTeam(teamId);
  if (team === null) return [];
  const links = await storage.teamOrgLinks.listLinksForTeam(teamId);
  const ids = new Set<string>([team.orgId, ...links.map((l) => l.orgId)]);
  return [...ids];
}

export interface BulkFixCandidatesInput {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string | null;
  readonly criterion: string;
}

export async function computeBulkFixCandidates(
  storage: StorageAdapter,
  bulkFix: BulkFixCandidatesInput,
): Promise<BulkFixCandidate[]> {
  const orgIds: readonly string[] =
    bulkFix.teamId !== null
      ? await teamScopeOrgIds(storage, bulkFix.teamId)
      : [bulkFix.orgId];

  const found: BulkFixCandidate[] = [];
  const seenSiteUrls = new Set<string>();
  for (const orgId of orgIds) {
    const latest = await storage.scans.getLatestPerSite(orgId);
    for (const scan of latest) {
      if (seenSiteUrls.has(scan.siteUrl)) continue;
      const report = (await storage.scans.getReport(
        scan.id,
      )) as ScanReportShape | null;
      if (!reportMatchesCriterion(report, bulkFix.criterion)) continue;
      seenSiteUrls.add(scan.siteUrl);
      // site_id semantics: we don't carry a stable wp_sites id here, so we
      // use scan.id as the per-site handle. Dispatch passes this through to
      // the coordinated_pr leg.site_id; the plugin reconciles by site_url.
      found.push({
        site_id: scan.id,
        site_url: scan.siteUrl,
        last_seen_at: scan.completedAt ?? scan.createdAt,
        suggested_patch_summary: `Apply ${bulkFix.criterion} fix to ${scan.siteUrl}`,
      });
    }
  }
  return found;
}
