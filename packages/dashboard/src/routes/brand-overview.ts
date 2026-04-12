import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import { requirePermission } from '../auth/middleware.js';
import { getOrgId } from './admin/helpers.js';
import { computeSparklinePoints } from '../services/sparkline.js';

export interface SiteEntry {
  siteUrl: string;
  siteUrlEncoded: string;
  score: number | null;
  scoreClass: string;
  sparklinePoints: string;
  delta: number | null;
  isFirstScore: boolean;
  guidelineName: string | null;
  history: Array<{ computedAt: string; overall: number }>;
  color: { kind: string; value?: number };
  typography: { kind: string; value?: number };
  components: { kind: string; value?: number };
  brandRelatedCount: number;
  totalIssues: number;
}

export interface OrgSummary {
  avgScore: number | null;
  avgScoreClass: string;
  totalScored: number;
  improving: number;
  regressing: number;
  stable: number;
}

/**
 * Pure function: computes org-level summary from an array of SiteEntry objects.
 * Extracted for testability (Plan 23-02, Task 1).
 */
export function computeOrgSummary(sites: readonly SiteEntry[]): OrgSummary {
  const scoredSites = sites.filter(s => s.score !== null);
  const avgScore = scoredSites.length > 0
    ? Math.round(scoredSites.reduce((sum, s) => sum + (s.score ?? 0), 0) / scoredSites.length)
    : null;

  let improvingCount = 0;
  let regressingCount = 0;
  for (const s of scoredSites) {
    if (s.delta !== null && s.delta > 0) improvingCount++;
    else if (s.delta !== null && s.delta < 0) regressingCount++;
  }

  return {
    avgScore,
    avgScoreClass: avgScore !== null
      ? (avgScore >= 85 ? 'text--success' : avgScore >= 70 ? 'text--warning' : 'text--error')
      : '',
    totalScored: scoredSites.length,
    improving: improvingCount,
    regressing: regressingCount,
    stable: scoredSites.length - improvingCount - regressingCount,
  };
}

export async function brandOverviewRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  server.get('/brand-overview', {
    preHandler: requirePermission('branding.view'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Org resolution: org-scoped users see their own org. Global admins
    // (admin.system) can pick any org via ?org= query param, defaulting
    // to the first org in the system.
    let orgId = getOrgId(request);
    const query = request.query as Record<string, string>;
    const isGlobalAdmin = !orgId;
    let allOrgs: Array<{ id: string; name: string }> = [];

    if (isGlobalAdmin) {
      allOrgs = (await storage.organizations.listOrgs()).map(o => ({ id: o.id, name: o.name }));
      if (allOrgs.length === 0) {
        return reply.view('brand-overview.hbs', {
          pageTitle: 'Brand Overview',
          currentPath: '/brand-overview',
          user: request.user,
          sites: [],
          activeSite: null,
          selectedSite: null,
          summary: { avgScore: null, avgScoreClass: '', totalScored: 0, improving: 0, regressing: 0, stable: 0 },
          hasSites: false,
          isGlobalAdmin: true,
          allOrgs: [],
          selectedOrgId: null,
        });
      }
      orgId = query.org && allOrgs.some(o => o.id === query.org) ? query.org : allOrgs[0].id;
    }

    // After resolution, orgId is guaranteed non-null (org-scoped user
    // has currentOrgId, global admin resolved above with early return).
    const effectiveOrgId: string = orgId!;

    // 1. Get all sites with latest completed scan for this org
    const latestScans = await storage.scans.getLatestPerSite(effectiveOrgId);

    // 2. For each site, load brand score history
    const selectedSite = (request.query as Record<string, string>).site || null;

    const sites: SiteEntry[] = [];

    for (const scan of latestScans) {
      const history = await storage.brandScores.getHistoryForSite(effectiveOrgId, scan.siteUrl, 20);
      const scoredEntries = history.filter(h => h.result.kind === 'scored');

      if (scoredEntries.length === 0) continue; // skip sites with no brand scores

      const latest = scoredEntries[0].result;
      const latestOverall = latest.kind === 'scored' ? latest.overall : 0;

      const chronological = [...scoredEntries].reverse();
      const values = chronological.map(h => h.result.kind === 'scored' ? h.result.overall : 0);
      const sparklinePoints = computeSparklinePoints(values);

      const previousOverall = scoredEntries.length >= 2 && scoredEntries[1].result.kind === 'scored'
        ? scoredEntries[1].result.overall
        : null;
      const delta = previousOverall !== null ? latestOverall - previousOverall : null;

      // Sub-scores from latest scored result
      const scored = latest.kind === 'scored' ? latest : null;

      // Guideline name via site assignment lookup (more reliable than scan FK)
      let guidelineName: string | null = null;
      try {
        const gl = await storage.branding.getGuidelineForSite(scan.siteUrl, effectiveOrgId);
        guidelineName = gl?.name ?? null;
      } catch { /* non-fatal */ }

      sites.push({
        siteUrl: scan.siteUrl,
        siteUrlEncoded: encodeURIComponent(scan.siteUrl),
        score: latestOverall,
        scoreClass: latestOverall >= 85 ? 'text--success' : latestOverall >= 70 ? 'text--warning' : 'text--error',
        sparklinePoints,
        delta,
        isFirstScore: scoredEntries.length === 1,
        guidelineName,
        history: scoredEntries.map(h => ({
          computedAt: h.computedAt,
          overall: h.result.kind === 'scored' ? h.result.overall : 0,
        })),
        color: scored
          ? { kind: scored.color.kind, value: scored.color.kind === 'scored' ? scored.color.value : undefined }
          : { kind: 'unscorable' },
        typography: scored
          ? { kind: scored.typography.kind, value: scored.typography.kind === 'scored' ? scored.typography.value : undefined }
          : { kind: 'unscorable' },
        components: scored
          ? { kind: scored.components.kind, value: scored.components.kind === 'scored' ? scored.components.value : undefined }
          : { kind: 'unscorable' },
        brandRelatedCount: scan.brandRelatedCount ?? 0,
        totalIssues: scan.totalIssues ?? 0,
      });
    }

    // 3. Org-level summary
    const summary = computeOrgSummary(sites);

    // 4. Selected site detail (for HTMX partial swap)
    const activeSite = selectedSite
      ? sites.find(s => s.siteUrl === selectedSite) ?? sites[0] ?? null
      : sites[0] ?? null;

    const viewData = {
      pageTitle: 'Brand Overview',
      currentPath: '/brand-overview',
      user: request.user,
      sites,
      activeSite,
      selectedSite: activeSite?.siteUrl ?? null,
      summary,
      hasSites: sites.length > 0,
      isGlobalAdmin,
      allOrgs,
      selectedOrgId: effectiveOrgId,
    };

    return reply.view('brand-overview.hbs', viewData);
  });
}
