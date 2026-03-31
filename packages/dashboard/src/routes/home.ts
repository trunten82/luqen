import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import type { DashboardConfig } from '../config.js';
import { listJurisdictions, listRegulations } from '../compliance-client.js';
import { getToken, getOrgId } from './admin/helpers.js';

export async function homeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  config?: DashboardConfig,
): Promise<void> {
  server.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    await reply.redirect('/home');
  });

  server.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    const isAdmin = request.user?.role === 'admin';
    const orgId = isAdmin ? undefined : request.user?.currentOrgId;
    const orgFilter = orgId !== undefined ? { orgId } : {};
    const recentScans = await storage.scans.listScans({ limit: 10, ...orgFilter });

    const allScans = await storage.scans.listScans(orgFilter);
    const totalScans = allScans.length;

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const scansThisWeek = allScans.filter(
      (s) => s.createdAt >= oneWeekAgo,
    ).length;

    const pagesScanned = allScans.reduce(
      (sum, s) => sum + (s.pagesScanned ?? 0),
      0,
    );
    const issuesFound = allScans.reduce(
      (sum, s) => sum + (s.totalIssues ?? 0),
      0,
    );

    // Executive summary data
    const completedScans = allScans.filter((s) => s.status === 'completed');
    const uniqueSiteUrls = new Set(completedScans.map((s) => s.siteUrl));
    const sitesMonitored = uniqueSiteUrls.size;

    // Overall trend: compare errors-per-page (normalized) across sites
    let latestErrorRate = 0;
    let previousErrorRate = 0;
    let sitesWithHistory = 0;
    for (const url of uniqueSiteUrls) {
      const siteScans = completedScans
        .filter((s) => s.siteUrl === url)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (siteScans.length >= 2) {
        const latest = siteScans[siteScans.length - 1];
        const previous = siteScans[siteScans.length - 2];
        latestErrorRate += (latest.errors ?? 0) / Math.max(latest.pagesScanned ?? 1, 1);
        previousErrorRate += (previous.errors ?? 0) / Math.max(previous.pagesScanned ?? 1, 1);
        sitesWithHistory++;
      }
    }

    let trendDirection: string;
    if (sitesWithHistory === 0) {
      trendDirection = completedScans.length === 0 ? 'No data' : 'Stable';
    } else if (latestErrorRate < previousErrorRate) {
      trendDirection = 'Improving';
    } else if (latestErrorRate > previousErrorRate) {
      trendDirection = 'Regressing';
    } else {
      trendDirection = 'Stable';
    }

    // Compliance: % of SITES whose latest scan is compliant
    // With jurisdictions → confirmedViolations === 0; without → errors === 0
    const latestPerSite = new Map<string, typeof completedScans[0]>();
    for (const scan of completedScans) {
      const existing = latestPerSite.get(scan.siteUrl);
      if (existing === undefined || scan.createdAt > existing.createdAt) {
        latestPerSite.set(scan.siteUrl, scan);
      }
    }
    let compliantSites = 0;
    for (const scan of latestPerSite.values()) {
      const hasJurisdictions = scan.jurisdictions.length > 0;
      const isCompliant = hasJurisdictions
        ? (scan.confirmedViolations ?? 0) === 0
        : (scan.errors ?? 0) === 0;
      if (isCompliant) compliantSites++;
    }
    const complianceRate = latestPerSite.size > 0
      ? Math.round((compliantSites / latestPerSite.size) * 100)
      : 0;

    // Load jurisdictions + regulations for quick scan form
    let jurisdictions: Array<{ id: string; name: string }> = [];
    let regulations: Array<{ id: string; name: string; shortName: string; jurisdictionId: string }> = [];
    if (config?.complianceUrl) {
      try {
        const token = getToken(request);
        const rawJ = await listJurisdictions(config.complianceUrl, token, getOrgId(request));
        jurisdictions = rawJ.map((j) => ({ id: j.id, name: j.name }));
        const rawR = await listRegulations(config.complianceUrl, token, undefined, getOrgId(request));
        regulations = rawR.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, jurisdictionId: r.jurisdictionId }));
      } catch {
        // Non-fatal
      }
    }

    return reply.view('home.hbs', {
      pageTitle: 'Home',
      currentPath: '/home',
      user: request.user,
      stats: {
        totalScans,
        scansThisWeek,
        pagesScanned,
        issuesFound,
        sitesMonitored,
        trendDirection,
        trendClass: trendDirection === 'Improving'
          ? 'text--success'
          : trendDirection === 'Regressing'
            ? 'text--error'
            : 'text--muted',
        complianceRate,
      },
      jurisdictions,
      regulations,
      recentScans: recentScans.map((s) => ({
        ...s,
        jurisdictions: s.jurisdictions.join(', '),
        createdAtDisplay: new Date(s.createdAt).toLocaleString(),
        completedAtDisplay: s.completedAt
          ? new Date(s.completedAt).toLocaleString()
          : '',
      })),
    });
  });
}
