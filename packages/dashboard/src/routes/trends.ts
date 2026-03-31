import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter, ScanRecord } from '../db/index.js';

interface TrendPoint {
  readonly date: string;
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
  readonly totalIssues: number;
  readonly pagesScanned: number;
  readonly confirmedViolations: number;
}

interface SiteTrend {
  readonly siteUrl: string;
  readonly points: readonly TrendPoint[];
}

interface SiteSummaryRow {
  readonly siteUrl: string;
  readonly latestDate: string;
  readonly latestErrors: number;
  readonly latestWarnings: number;
  readonly latestNotices: number;
  readonly latestTotal: number;
  readonly previousErrors: number | null;
  readonly previousWarnings: number | null;
  readonly previousNotices: number | null;
  readonly previousTotal: number | null;
  readonly deltaErrors: number | null;
  readonly deltaWarnings: number | null;
  readonly deltaNotices: number | null;
  readonly deltaTotal: number | null;
  readonly trend: 'improving' | 'regressing' | 'stable' | 'new';
}

interface OrgTotalPoint {
  readonly date: string;
  readonly totalIssues: number;
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
}

interface SiteScoreEntry {
  readonly siteUrl: string;
  readonly score: number;
  readonly trend: 'improving' | 'stable' | 'regressing' | 'new';
  readonly lastScanned: string;
  readonly scoreClass: string;
}

interface TrendKpi {
  readonly totalSites: number;
  readonly totalScans: number;
  readonly overallChangePct: number | null;
  readonly overallChangeDirection: 'improving' | 'regressing' | 'stable' | 'insufficient';
  readonly bestSite: string | null;
  readonly bestSiteChangePct: number | null;
  readonly worstSite: string | null;
  readonly worstSiteChangePct: number | null;
}

function groupBySite(scans: readonly ScanRecord[]): readonly SiteTrend[] {
  const siteMap = new Map<string, TrendPoint[]>();

  for (const scan of scans) {
    const points = siteMap.get(scan.siteUrl) ?? [];
    points.push({
      date: scan.createdAt,
      errors: scan.errors ?? 0,
      warnings: scan.warnings ?? 0,
      notices: scan.notices ?? 0,
      totalIssues: scan.totalIssues ?? 0,
      pagesScanned: scan.pagesScanned ?? 0,
      confirmedViolations: scan.confirmedViolations ?? 0,
    });
    siteMap.set(scan.siteUrl, points);
  }

  const trends: SiteTrend[] = [];
  for (const [siteUrl, points] of siteMap) {
    trends.push({ siteUrl, points });
  }
  return trends;
}

function buildOrgTotals(scans: readonly ScanRecord[]): readonly OrgTotalPoint[] {
  // Group scans by date (day granularity) and sum across all sites
  const dateMap = new Map<string, { totalIssues: number; errors: number; warnings: number; notices: number }>();

  for (const scan of scans) {
    const dateKey = scan.createdAt.slice(0, 10); // YYYY-MM-DD
    const existing = dateMap.get(dateKey) ?? { totalIssues: 0, errors: 0, warnings: 0, notices: 0 };
    dateMap.set(dateKey, {
      totalIssues: existing.totalIssues + (scan.totalIssues ?? 0),
      errors: existing.errors + (scan.errors ?? 0),
      warnings: existing.warnings + (scan.warnings ?? 0),
      notices: existing.notices + (scan.notices ?? 0),
    });
  }

  const sorted = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([date, totals]) => ({
    date,
    totalIssues: totals.totalIssues,
    errors: totals.errors,
    warnings: totals.warnings,
    notices: totals.notices,
  }));
}

function computeOrgScore(scans: readonly ScanRecord[]): number {
  // Average of per-site scores (prevents one bad site from tanking org score)
  const latestBySite = new Map<string, ScanRecord>();
  for (const scan of scans) {
    const existing = latestBySite.get(scan.siteUrl);
    if (existing === undefined || scan.createdAt > existing.createdAt) {
      latestBySite.set(scan.siteUrl, scan);
    }
  }

  if (latestBySite.size === 0) return 100;

  let scoreSum = 0;
  for (const scan of latestBySite.values()) {
    const pages = Math.max(scan.pagesScanned ?? 1, 1);
    const raw = 100 - ((scan.errors ?? 0) * 10 + (scan.warnings ?? 0) * 3 + (scan.notices ?? 0) * 0.5) / pages;
    scoreSum += Math.max(0, Math.min(100, raw));
  }

  return Math.round(scoreSum / latestBySite.size);
}

function buildSiteScores(trends: readonly SiteTrend[]): readonly SiteScoreEntry[] {
  const entries: SiteScoreEntry[] = [];

  for (const site of trends) {
    const points = site.points;
    if (points.length === 0) continue;

    const latest = points[points.length - 1];
    const pagesScanned = Math.max(latest.pagesScanned, 1);
    const rawScore = 100 - (latest.errors * 10 + latest.warnings * 3 + latest.notices * 0.5) / pagesScanned;
    const score = Math.round(Math.max(0, Math.min(100, rawScore)));

    let trend: SiteScoreEntry['trend'];
    if (points.length < 2) {
      trend = 'new';
    } else {
      const previous = points[points.length - 2];
      const prevPages = Math.max(previous.pagesScanned, 1);
      const prevRaw = 100 - (previous.errors * 10 + previous.warnings * 3 + previous.notices * 0.5) / prevPages;
      const prevScore = Math.round(Math.max(0, Math.min(100, prevRaw)));

      if (score > prevScore) {
        trend = 'improving';
      } else if (score < prevScore) {
        trend = 'regressing';
      } else {
        trend = 'stable';
      }
    }

    const scoreClass = score > 80 ? 'text--success' : score >= 50 ? 'text--warning' : 'text--error';

    entries.push({
      siteUrl: site.siteUrl,
      score,
      trend,
      lastScanned: latest.date,
      scoreClass,
    });
  }

  return entries;
}

function buildKpi(
  scans: readonly ScanRecord[],
  trends: readonly SiteTrend[],
): TrendKpi {
  const totalSites = trends.length;
  const totalScans = scans.length;

  // Compute per-site percentage change in total issues (latest vs previous)
  const siteChanges: Array<{ siteUrl: string; changePct: number }> = [];
  let latestIssueSum = 0;
  let previousIssueSum = 0;

  for (const site of trends) {
    const pts = site.points;
    if (pts.length < 2) continue;

    const latest = pts[pts.length - 1];
    const previous = pts[pts.length - 2];
    const prevTotal = previous.totalIssues;

    latestIssueSum += latest.totalIssues;
    previousIssueSum += prevTotal;

    if (prevTotal === 0) {
      if (latest.totalIssues > 0) {
        siteChanges.push({ siteUrl: site.siteUrl, changePct: 100 });
      } else {
        siteChanges.push({ siteUrl: site.siteUrl, changePct: 0 });
      }
    } else {
      const pct = Math.round(((latest.totalIssues - prevTotal) / prevTotal) * 100);
      siteChanges.push({ siteUrl: site.siteUrl, changePct: pct });
    }
  }

  if (siteChanges.length === 0) {
    return {
      totalSites,
      totalScans,
      overallChangePct: null,
      overallChangeDirection: 'insufficient',
      bestSite: null,
      bestSiteChangePct: null,
      worstSite: null,
      worstSiteChangePct: null,
    };
  }

  // Weighted overall change based on total issue counts (not site-count average)
  const avgChange = previousIssueSum === 0
    ? (latestIssueSum > 0 ? 100 : 0)
    : Math.round(((latestIssueSum - previousIssueSum) / previousIssueSum) * 100);

  const sorted = [...siteChanges].sort((a, b) => a.changePct - b.changePct);
  const best = sorted[0]; // Most negative = most improved
  const worst = sorted[sorted.length - 1]; // Most positive = most regressed

  const direction: TrendKpi['overallChangeDirection'] =
    avgChange < 0 ? 'improving' : avgChange > 0 ? 'regressing' : 'stable';

  return {
    totalSites,
    totalScans,
    overallChangePct: avgChange,
    overallChangeDirection: direction,
    bestSite: best.siteUrl,
    bestSiteChangePct: best.changePct,
    worstSite: worst.siteUrl,
    worstSiteChangePct: worst.changePct,
  };
}

function buildSummaryTable(trends: readonly SiteTrend[]): readonly SiteSummaryRow[] {
  const rows: SiteSummaryRow[] = [];

  for (const site of trends) {
    const points = site.points;
    if (points.length === 0) continue;

    const latest = points[points.length - 1];
    const previous = points.length >= 2 ? points[points.length - 2] : null;

    const deltaErrors = previous !== null ? latest.errors - previous.errors : null;
    const deltaWarnings = previous !== null ? latest.warnings - previous.warnings : null;
    const deltaNotices = previous !== null ? latest.notices - previous.notices : null;
    const deltaTotal = previous !== null ? latest.totalIssues - previous.totalIssues : null;

    let trend: SiteSummaryRow['trend'];
    if (previous === null) {
      trend = 'new';
    } else if (deltaTotal !== null && deltaTotal < 0) {
      trend = 'improving';
    } else if (deltaTotal !== null && deltaTotal > 0) {
      trend = 'regressing';
    } else {
      trend = 'stable';
    }

    rows.push({
      siteUrl: site.siteUrl,
      latestDate: latest.date,
      latestErrors: latest.errors,
      latestWarnings: latest.warnings,
      latestNotices: latest.notices,
      latestTotal: latest.totalIssues,
      previousErrors: previous?.errors ?? null,
      previousWarnings: previous?.warnings ?? null,
      previousNotices: previous?.notices ?? null,
      previousTotal: previous?.totalIssues ?? null,
      deltaErrors,
      deltaWarnings,
      deltaNotices,
      deltaTotal,
      trend,
    });
  }

  return rows;
}

export async function trendRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/reports/trends',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = request.user?.role === 'admin';
      const orgId = isAdmin ? undefined : request.user?.currentOrgId;
      const scans = await storage.scans.getTrendData(orgId);
      const trends = groupBySite(scans);
      const summaryTable = buildSummaryTable(trends);
      const siteUrls = trends.map((t) => t.siteUrl);

      const orgTotals = buildOrgTotals(scans);
      const orgScore = computeOrgScore(scans);
      const siteScores = buildSiteScores(trends);
      const kpi = buildKpi(scans, trends);

      const orgScoreClass = orgScore > 80 ? 'text--success' : orgScore >= 50 ? 'text--warning' : 'text--error';

      return reply.view('trends.hbs', {
        pageTitle: 'Trends',
        currentPath: '/reports/trends',
        user: request.user,
        trendData: trends,
        orgTotals,
        orgScore,
        orgScoreClass,
        siteScores: siteScores.map((s) => ({
          ...s,
          lastScannedDisplay: new Date(s.lastScanned).toLocaleDateString(),
          trendLabel: s.trend === 'improving'
            ? 'Improving'
            : s.trend === 'regressing'
              ? 'Regressing'
              : s.trend === 'new'
                ? 'New'
                : 'Stable',
          trendArrow: s.trend === 'improving'
            ? '&#9650;'
            : s.trend === 'regressing'
              ? '&#9660;'
              : '&#9644;',
          trendClass: s.trend === 'improving'
            ? 'text--success'
            : s.trend === 'regressing'
              ? 'text--error'
              : 'text--muted',
        })),
        summaryTable: summaryTable.map((row) => ({
          ...row,
          latestDateDisplay: new Date(row.latestDate).toLocaleDateString(),
          trendClass: row.trend === 'improving'
            ? 'text--success'
            : row.trend === 'regressing'
              ? 'text--error'
              : 'text--muted',
          trendLabel: row.trend === 'improving'
            ? 'Improving'
            : row.trend === 'regressing'
              ? 'Regressing'
              : row.trend === 'new'
                ? 'New'
                : 'Stable',
        })),
        siteUrls,
        hasTrends: trends.length > 0,
        kpi,
        kpiDirectionClass: kpi.overallChangeDirection === 'improving'
          ? 'text--success'
          : kpi.overallChangeDirection === 'regressing'
            ? 'text--error'
            : 'text--muted',
        kpiDirectionLabel: kpi.overallChangeDirection === 'improving'
          ? 'Improving'
          : kpi.overallChangeDirection === 'regressing'
            ? 'Regressing'
            : kpi.overallChangeDirection === 'stable'
              ? 'Stable'
              : 'N/A',
      });
    },
  );
}
