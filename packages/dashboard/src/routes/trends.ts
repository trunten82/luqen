import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScanDb, ScanRecord } from '../db/scans.js';

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
  db: ScanDb,
): Promise<void> {
  server.get(
    '/reports/trends',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId;
      const scans = db.getTrendData(orgId);
      const trends = groupBySite(scans);
      const summaryTable = buildSummaryTable(trends);
      const siteUrls = trends.map((t) => t.siteUrl);

      return reply.view('trends.hbs', {
        pageTitle: 'Trends',
        currentPath: '/reports/trends',
        user: request.user,
        trendData: trends,
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
      });
    },
  );
}
