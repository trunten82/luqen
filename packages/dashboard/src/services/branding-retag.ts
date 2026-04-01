import type { StorageAdapter } from '../db/adapter.js';

/**
 * Re-run branding matching on all completed scans for a given site+org.
 *
 * Called when a guideline is assigned to a site, activated, or modified
 * (colors/fonts/selectors added or removed) so that historical scans
 * reflect the latest branding configuration.
 */
export async function retagScansForSite(
  storage: StorageAdapter,
  siteUrl: string,
  orgId: string,
): Promise<{ retagged: number }> {
  // 1. Resolve the active guideline for this site
  const guideline = await storage.branding.getGuidelineForSite(siteUrl, orgId);
  if (!guideline?.active || !guideline.colors || !guideline.fonts || !guideline.selectors) {
    return { retagged: 0 };
  }

  // 2. Find all completed scans for this site+org
  const scans = await storage.scans.listScans({
    siteUrl,
    orgId,
    status: 'completed',
  });

  // 3. Re-run branding matcher on each scan
  const { BrandingMatcher } = await import('@luqen/branding');
  const matcher = new BrandingMatcher();
  let retagged = 0;

  const guidelineInput = {
    id: guideline.id,
    orgId: guideline.orgId,
    name: guideline.name,
    version: guideline.version,
    active: guideline.active,
    colors: guideline.colors.map((c) => ({
      id: c.id,
      name: c.name,
      hexValue: c.hexValue,
      ...(c.usage ? { usage: c.usage as any } : {}),
      ...(c.context ? { context: c.context } : {}),
    })),
    fonts: guideline.fonts.map((f) => ({
      id: f.id,
      family: f.family,
      ...(f.weights ? { weights: f.weights } : {}),
      ...(f.usage ? { usage: f.usage as any } : {}),
      ...(f.context ? { context: f.context } : {}),
    })),
    selectors: guideline.selectors.map((s) => ({
      id: s.id,
      pattern: s.pattern,
      ...(s.description ? { description: s.description } : {}),
    })),
  };

  for (const scan of scans) {
    if (!scan.jsonReport) continue;

    try {
      const reportData = JSON.parse(scan.jsonReport);
      if (!reportData.pages) continue;

      // Collect all issues across pages for matching
      const allIssues: Array<Record<string, unknown>> = [];
      for (const page of reportData.pages as Array<{ issues: Array<Record<string, unknown>> }>) {
        for (const issue of page.issues ?? []) {
          allIssues.push(issue);
        }
      }

      // Run matcher
      const branded = matcher.match(
        allIssues as unknown as ReadonlyArray<{
          readonly code: string;
          readonly type: 'error' | 'warning' | 'notice';
          readonly message: string;
          readonly selector: string;
          readonly context: string;
        }>,
        guidelineInput as unknown as Parameters<typeof matcher.match>[1],
      );

      // Enrich page issues with branding tags
      let brandRelatedCount = 0;
      for (const page of reportData.pages as Array<{ issues: Array<Record<string, unknown>> }>) {
        for (let i = 0; i < page.issues.length; i++) {
          // Remove stale brandMatch if present
          delete page.issues[i].brandMatch;

          const match = branded.find(
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

      // Add/update branding summary in report
      reportData.branding = {
        guidelineId: guideline.id,
        guidelineName: guideline.name,
        guidelineVersion: guideline.version,
        brandRelatedCount,
      };

      // Persist enriched report
      await storage.scans.updateScan(scan.id, {
        jsonReport: JSON.stringify(reportData, null, 2),
        brandingGuidelineId: guideline.id,
        brandingGuidelineVersion: guideline.version,
        brandRelatedCount,
      });

      retagged++;
    } catch {
      // Non-fatal — skip scans that fail to parse
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
): Promise<{ totalRetagged: number }> {
  const sites = await storage.branding.getSiteAssignments(guidelineId);
  let totalRetagged = 0;

  for (const siteUrl of sites) {
    try {
      const { retagged } = await retagScansForSite(storage, siteUrl, orgId);
      totalRetagged += retagged;
    } catch {
      // Non-fatal — continue with remaining sites
      continue;
    }
  }

  return { totalRetagged };
}
