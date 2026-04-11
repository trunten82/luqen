import type { StorageAdapter } from '../db/adapter.js';
import type { BrandingOrchestrator } from './branding/branding-orchestrator.js';
import type { BrandScoreRepository } from '../db/interfaces/brand-score-repository.js';
import type { ScoreResult } from './scoring/types.js';

/**
 * Re-run branding matching on all completed scans for a given site+org.
 *
 * Called when a guideline is assigned to a site, activated, or modified
 * (colors/fonts/selectors added or removed) so that historical scans
 * reflect the latest branding configuration.
 *
 * Phase 18 contract (BSTORE-03 append-only):
 *   - Calls BrandingOrchestrator.matchAndScore(...) once per scan retagged.
 *   - Persists a NEW brand_scores row per retagged scan — prior rows stay.
 *   - degraded result still persists an unscorable row.
 *   - no-guideline short-circuits the whole call (top-of-function early return).
 *   - Persistence failure is non-blocking: the loop continues to the next scan.
 */
export async function retagScansForSite(
  storage: StorageAdapter,
  siteUrl: string,
  orgId: string,
  brandingOrchestrator: BrandingOrchestrator,
  brandScoreRepository: BrandScoreRepository,
): Promise<{ retagged: number }> {
  // 1. Resolve the active guideline for this site. If none/inactive/incomplete,
  //    retag is a no-op — no matching to do, no rows to append.
  const guideline = await storage.branding.getGuidelineForSite(siteUrl, orgId);
  if (!guideline?.active || !guideline.colors || !guideline.fonts || !guideline.selectors) {
    return { retagged: 0 };
  }

  // 2. Project the dashboard guideline record into the @luqen/branding
  //    BrandGuideline shape. Same projection used by the scanner rewire
  //    (Plan 18-03) — the orchestrator's EmbeddedBrandingAdapter expects it.
  const orchestratorGuideline = {
    id: guideline.id,
    orgId: guideline.orgId,
    name: guideline.name,
    version: guideline.version,
    active: guideline.active,
    colors: guideline.colors.map((c) => ({
      id: c.id,
      name: c.name,
      hexValue: c.hexValue,
      ...(c.usage ? { usage: c.usage as 'primary' | 'secondary' | 'accent' | 'neutral' } : {}),
      ...(c.context ? { context: c.context } : {}),
    })),
    fonts: guideline.fonts.map((f) => ({
      id: f.id,
      family: f.family,
      ...(f.weights ? { weights: f.weights } : {}),
      ...(f.usage ? { usage: f.usage as 'heading' | 'body' | 'mono' } : {}),
      ...(f.context ? { context: f.context } : {}),
    })),
    selectors: guideline.selectors.map((s) => ({
      id: s.id,
      pattern: s.pattern,
      ...(s.description ? { description: s.description } : {}),
    })),
  };

  // 3. Enumerate completed scans for this site+org.
  const scans = await storage.scans.listScans({
    siteUrl,
    orgId,
    status: 'completed',
  });

  let retagged = 0;

  for (const scan of scans) {
    if (!scan.jsonReport) continue;

    try {
      const reportData = JSON.parse(scan.jsonReport);
      if (!reportData.pages) continue;

      // Collect all issues across pages for matching.
      const allIssues: Array<Record<string, unknown>> = [];
      for (const page of reportData.pages as Array<{ issues: Array<Record<string, unknown>> }>) {
        for (const issue of page.issues ?? []) {
          allIssues.push(issue);
        }
      }

      // INVARIANT: one match call per retagged scan (Pitfall #10 mirror).
      type MatchInput = Parameters<BrandingOrchestrator['matchAndScore']>[0];
      const result = await brandingOrchestrator.matchAndScore({
        orgId,
        siteUrl,
        scanId: scan.id,
        issues: allIssues as unknown as MatchInput['issues'],
        guideline: orchestratorGuideline as unknown as MatchInput['guideline'],
      });

      if (result.kind === 'matched') {
        // Clear stale brandMatch + re-enrich page issues with fresh match results.
        let brandRelatedCount = 0;
        for (const page of reportData.pages as Array<{ issues: Array<Record<string, unknown>> }>) {
          for (let i = 0; i < page.issues.length; i++) {
            delete page.issues[i].brandMatch;
            const match = result.brandedIssues.find(
              (b) =>
                b.issue.code === page.issues[i].code &&
                b.issue.selector === page.issues[i].selector &&
                b.issue.context === page.issues[i].context,
            );
            if (match?.brandMatch.matched) {
              page.issues[i].brandMatch = match.brandMatch;
              brandRelatedCount++;
            }
          }
        }

        reportData.branding = {
          guidelineId: guideline.id,
          guidelineName: guideline.name,
          guidelineVersion: guideline.version,
          brandRelatedCount,
        };

        // Persist enriched report on scan_records (existing column set).
        await storage.scans.updateScan(scan.id, {
          jsonReport: JSON.stringify(reportData, null, 2),
          brandingGuidelineId: guideline.id,
          brandingGuidelineVersion: guideline.version,
          brandRelatedCount,
        });

        // Append a NEW brand_scores row. BSTORE-03: never UPDATEs, always INSERTs.
        // Non-blocking: if persistence fails, log and continue to the next scan.
        try {
          await brandScoreRepository.insert(result.scoreResult, {
            scanId: scan.id,
            orgId,
            siteUrl,
            guidelineId: guideline.id,
            guidelineVersion: guideline.version,
            mode: result.mode,
            brandRelatedCount,
            totalIssues: allIssues.length,
          });
        } catch (scoreErr) {
          console.error(`[branding-retag] brand_scores insert failed for scan ${scan.id}:`, scoreErr);
          // Non-fatal — the scan's jsonReport was updated; score history just lacks this retag row.
        }

        retagged++;
      } else if (result.kind === 'degraded') {
        // Degraded retag still persists an unscorable row so trend rendering
        // has a "we tried, service was down" marker. Phase 20 UI shows the
        // same empty-state for any unscorable row regardless of reason.
        const degradedScore: ScoreResult = { kind: 'unscorable', reason: 'no-branded-issues' };
        try {
          await brandScoreRepository.insert(degradedScore, {
            scanId: scan.id,
            orgId,
            siteUrl,
            guidelineId: guideline.id,
            guidelineVersion: guideline.version,
            mode: result.mode,
            brandRelatedCount: 0,
            totalIssues: allIssues.length,
          });
          retagged++;
        } catch (scoreErr) {
          console.error(`[branding-retag] degraded insert failed for scan ${scan.id}:`, scoreErr);
        }
      }
      // else result.kind === 'no-guideline' should NOT happen here since we
      // already checked guideline is active+complete above — if it does, skip.
    } catch {
      // Non-fatal — parse error or unexpected throw; skip this scan, continue.
      continue;
    }
  }

  return { retagged };
}

/**
 * Retag all sites currently assigned to a guideline.
 * Used after modifying guideline colors/fonts/selectors or toggling active.
 */
export async function retagAllSitesForGuideline(
  storage: StorageAdapter,
  guidelineId: string,
  orgId: string,
  brandingOrchestrator: BrandingOrchestrator,
  brandScoreRepository: BrandScoreRepository,
): Promise<{ totalRetagged: number }> {
  const sites = await storage.branding.getSiteAssignments(guidelineId);
  let totalRetagged = 0;

  for (const siteUrl of sites) {
    try {
      const { retagged } = await retagScansForSite(
        storage,
        siteUrl,
        orgId,
        brandingOrchestrator,
        brandScoreRepository,
      );
      totalRetagged += retagged;
    } catch {
      // Non-fatal — continue with remaining sites
      continue;
    }
  }

  return { totalRetagged };
}
