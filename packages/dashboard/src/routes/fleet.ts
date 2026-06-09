import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import type { WpSite } from '../db/interfaces/wp-network-repository.js';
import type { ScanRecord } from '../db/types.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import { deriveExposure, type ExposureBand, type ExposureResult } from '../services/legal-exposure.js';

// ---------------------------------------------------------------------------
// View-ready badge modifier + icon for each exposure band (D-01 / WCAG 1.4.1)
// ---------------------------------------------------------------------------

const BAND_VIEW_PROPS: Record<ExposureBand, { badgeModifier: string; bandIcon: string }> = {
  lower:    { badgeModifier: 'notice-light',  bandIcon: '●' },
  moderate: { badgeModifier: 'warning-light', bandIcon: '▲' },
  elevated: { badgeModifier: 'error-light',   bandIcon: '▲▲' },
  high:     { badgeModifier: 'error-light',   bandIcon: '⬛' },
};

/** Ordinal rank for sorting (higher = more at risk). Sites with null exposure sort last. */
const EXPOSURE_RANK: Record<ExposureBand, number> = {
  high:     4,
  elevated: 3,
  moderate: 2,
  lower:    1,
};

/** View-ready exposure object attached to a site. */
export interface SiteExposureView extends ExposureResult {
  readonly badgeModifier: string;
  readonly bandIcon: string;
}

/**
 * Decorate each site with exposure derived from its latestScan.
 * Sites with no scan get exposure = null (org-scoped: uses the site's own scan data only).
 * Exported for direct assertion in fleet-exposure.test.ts.
 */
export async function decorateWithExposure<
  T extends WpSite & { latestScan: ScanRecord | null },
>(decorated: readonly T[]): Promise<Array<T & { exposure: SiteExposureView | null }>> {
  return Promise.all(
    decorated.map(async (s) => {
      if (s.latestScan === null) {
        return { ...s, exposure: null };
      }
      try {
        const result = deriveExposure({
          jurisdictions: s.latestScan.jurisdictions ?? [],
          regulations: s.latestScan.regulations ?? [],
          findings: {
            errors: s.latestScan.errors ?? 0,
            warnings: s.latestScan.warnings ?? 0,
            notices: s.latestScan.notices ?? 0,
            confirmedViolations: s.latestScan.confirmedViolations ?? 0,
          },
        });
        const viewProps = BAND_VIEW_PROPS[result.band];
        return {
          ...s,
          exposure: { ...result, ...viewProps } as SiteExposureView,
        };
      } catch {
        return { ...s, exposure: null };
      }
    }),
  );
}

/**
 * Compute portfolio-level exposure summary.
 * Exported for direct assertion in fleet-exposure.test.ts.
 */
export function computeFleetExposureSummary(
  sites: ReadonlyArray<{ exposure: SiteExposureView | null }>,
): { highBandCount: number } {
  const highBandCount = sites.filter((s) => s.exposure?.band === 'high').length;
  return { highBandCount };
}

/**
 * Sort sites by exposure band, most-at-risk first (High > Elevated > Moderate > Lower).
 * Sites with null exposure sort last (rank 0).
 * Exported for direct assertion in fleet-exposure.test.ts.
 */
export function sortByExposure<T extends { exposure: SiteExposureView | null }>(
  sites: readonly T[],
): T[] {
  return [...sites].sort((a, b) => {
    const rankA = a.exposure ? (EXPOSURE_RANK[a.exposure.band] ?? 0) : 0;
    const rankB = b.exposure ? (EXPOSURE_RANK[b.exposure.band] ?? 0) : 0;
    return rankB - rankA;
  });
}

/**
 * Fleet pages — UI surface for /api/v1/fleet.
 *
 *   GET /fleet         — per-org view (caller's currentOrgId)
 *   GET /admin/fleet   — admin global view (all orgs)
 *   GET /fleet/:id     — per-site detail (org-scoped)
 *   GET /admin/fleet/:id — per-site detail (admin)
 *
 * The list view also joins each site's latest completed scan so the
 * fleet table has a "Last scan" column with verdict + score.
 */
export async function fleetRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── helpers ──────────────────────────────────────────────────────────────
  async function decorateWithLatestScan(
    sites: readonly WpSite[],
  ): Promise<Array<WpSite & { latestScan: ScanRecord | null }>> {
    return Promise.all(
      sites.map(async (s) => ({
        ...s,
        latestScan: await storage.scans.getLatestCompletedForSite(s.orgId, s.url),
      })),
    );
  }

  function summary(sites: readonly WpSite[]) {
    return {
      siteCount: sites.length,
      activeCount: sites.filter((s) => s.status === 'active').length,
      staleCount: sites.filter((s) => s.status === 'stale').length,
    };
  }

  // ── list views ───────────────────────────────────────────────────────────
  server.get(
    '/fleet',
    { schema: { ...HtmlPageSchema, tags: ['fleet'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const sites = await storage.wpSites.list({ orgId, status: 'all' });
      const withScans = await decorateWithLatestScan(sites);
      const withExposure = await decorateWithExposure(withScans);
      const sorted = sortByExposure(withExposure);
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet',
        currentPath: '/fleet',
        user: request.user,
        scope: 'org',
        scopeLabel: orgId,
        sites: sorted,
        ...summary(sites),
        fleetExposureSummary: computeFleetExposureSummary(withExposure),
      });
    },
  );

  server.get(
    '/admin/fleet',
    { schema: { ...HtmlPageSchema, tags: ['fleet', 'admin'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user?.role !== 'admin') {
        return reply.code(403).view('errors/403.hbs', {
          pageTitle: 'Forbidden',
          user: request.user,
        });
      }
      const sites = await storage.wpSites.listAll({ status: 'all' });
      const withScans = await decorateWithLatestScan(sites);
      const withExposure = await decorateWithExposure(withScans);
      const sorted = sortByExposure(withExposure);
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet (all orgs)',
        currentPath: '/admin/fleet',
        user: request.user,
        scope: 'admin',
        scopeLabel: 'all organizations',
        sites: sorted,
        ...summary(sites),
        fleetExposureSummary: computeFleetExposureSummary(withExposure),
      });
    },
  );

  // ── detail views ─────────────────────────────────────────────────────────
  async function renderDetail(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: 'org' | 'admin',
  ) {
    const { id } = request.params as { id: string };
    const site = await storage.wpSites.get(id);
    if (site === null) {
      return reply.code(404).view('errors/404.hbs', {
        pageTitle: 'Site not found',
        user: request.user,
      });
    }
    if (scope === 'org' && site.orgId !== (request.user?.currentOrgId ?? 'system')) {
      return reply.code(403).view('errors/403.hbs', {
        pageTitle: 'Forbidden',
        user: request.user,
      });
    }
    if (scope === 'admin' && request.user?.role !== 'admin') {
      return reply.code(403).view('errors/403.hbs', {
        pageTitle: 'Forbidden',
        user: request.user,
      });
    }

    // Most recent scans for this site (URL match within the same org).
    const allScans = await storage.scans.listScans({ orgId: site.orgId, siteUrl: site.url });
    const recentScans = allScans.slice(0, 10);
    const latestScan = await storage.scans.getLatestCompletedForSite(site.orgId, site.url);

    return reply.view('fleet-detail.hbs', {
      pageTitle: `Fleet · ${site.url}`,
      currentPath: scope === 'admin' ? '/admin/fleet' : '/fleet',
      user: request.user,
      scope,
      backHref: scope === 'admin' ? '/admin/fleet' : '/fleet',
      site,
      latestScan,
      recentScans,
      bulkFixHref: '/admin/bulk-fix?siteUrl=' + encodeURIComponent(site.url),
    });
  }

  server.get(
    '/fleet/:id',
    { schema: { ...HtmlPageSchema, tags: ['fleet'] } },
    async (request, reply) => renderDetail(request, reply, 'org'),
  );

  server.get(
    '/admin/fleet/:id',
    { schema: { ...HtmlPageSchema, tags: ['fleet', 'admin'] } },
    async (request, reply) => renderDetail(request, reply, 'admin'),
  );
}
