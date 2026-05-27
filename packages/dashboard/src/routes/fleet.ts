import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

/**
 * Fleet pages — Phase 64 (UI surface for /api/v1/fleet).
 *
 *   GET /fleet         — per-org view (caller's currentOrgId)
 *   GET /admin/fleet   — admin global view (all orgs)
 *
 * Both render the same partial; the admin variant adds the orgId column
 * and lifts the org filter.
 */
export async function fleetRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/fleet',
    { schema: { ...HtmlPageSchema, tags: ['fleet'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const sites = await storage.wpSites.list({ orgId, status: 'all' });
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet',
        currentPath: '/fleet',
        user: request.user,
        scope: 'org',
        scopeLabel: orgId,
        sites,
        siteCount: sites.length,
        activeCount: sites.filter((s) => s.status === 'active').length,
        staleCount: sites.filter((s) => s.status === 'stale').length,
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
      return reply.view('fleet.hbs', {
        pageTitle: 'Fleet (all orgs)',
        currentPath: '/admin/fleet',
        user: request.user,
        scope: 'admin',
        scopeLabel: 'all organizations',
        sites,
        siteCount: sites.length,
        activeCount: sites.filter((s) => s.status === 'active').length,
        staleCount: sites.filter((s) => s.status === 'stale').length,
      });
    },
  );
}
