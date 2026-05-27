import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import type { WpSite } from '../db/interfaces/wp-network-repository.js';
import type { ScanRecord } from '../db/types.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

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
      const decorated = await decorateWithLatestScan(sites);
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet',
        currentPath: '/fleet',
        user: request.user,
        scope: 'org',
        scopeLabel: orgId,
        sites: decorated,
        ...summary(sites),
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
      const decorated = await decorateWithLatestScan(sites);
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet (all orgs)',
        currentPath: '/admin/fleet',
        user: request.user,
        scope: 'admin',
        scopeLabel: 'all organizations',
        sites: decorated,
        ...summary(sites),
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
