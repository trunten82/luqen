/**
 * Phase 64.1 — admin oversight for public badges.
 *
 *   GET  /admin/badges                       — HTML page (static + dynamic lists)
 *   POST /admin/badges/static/:scanId/revoke — flip a static badge off (admin)
 *   POST /admin/badges/live/:badgeId/revoke  — flip a live badge off  (admin)
 *
 * admin.system sees every org's badges. admin.org sees only their own org's.
 *
 * Revocation uses POST (with the existing cookie-based CSRF chain) rather
 * than DELETE so the admin page can submit via plain HTMX <button hx-post>
 * without javascript URL trickery.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { requirePermission } from '../../auth/middleware.js';
import { hasPermission } from '../../permissions.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

const HtmlPartial = {
  tags: ['html-page'],
  produces: ['text/html'],
  response: {
    200: Type.String(),
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
  },
} as const;

export async function adminBadgeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  selfScanId?: string,
): Promise<void> {
  server.get(
    '/admin/badges',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdminSystem = hasPermission(request, 'admin.system');
      const orgFilter = isAdminSystem ? undefined : (request.user?.currentOrgId ?? 'system');

      const [staticScans, liveBadges] = await Promise.all([
        storage.scans.listPubliclyShared(orgFilter),
        storage.siteBadges.list(orgFilter),
      ]);

      const host = request.headers.host ?? '';

      // Surface the config-driven dogfood badge (login page) as a
      // read-only "system" entry so admins can see what's actually
      // exposed publicly. admin.system only — it's a system surface.
      let systemBadge: {
        scanId: string;
        siteUrl: string;
        badgeUrl: string;
        reportUrl: string;
        publicUrl: string;
        completedAt: string | null;
        standard: string;
      } | null = null;
      if (isAdminSystem && selfScanId !== undefined && selfScanId !== '') {
        const self = await storage.scans.getScan(selfScanId);
        if (self !== null) {
          systemBadge = {
            scanId: self.id,
            siteUrl: self.siteUrl,
            badgeUrl: `https://${host}/api/v1/badge/${self.id}.svg`,
            reportUrl: `/reports/${self.id}`,
            publicUrl: `https://${host}/reports/${self.id}/public`,
            completedAt: self.completedAt ?? self.createdAt,
            standard: self.standard,
          };
        }
      }

      return reply.view('admin/badges.hbs', {
        pageTitle: 'Public badges',
        currentPath: '/admin/badges',
        user: request.user,
        isAdminSystem,
        systemBadge,
        staticBadges: staticScans.map((s) => ({
          scanId: s.id,
          siteUrl: s.siteUrl,
          orgId: s.orgId,
          enabledAt: s.publicShareEnabledAt ?? null,
          enabledBy: s.publicShareEnabledBy ?? null,
          standard: s.standard,
          completedAt: s.completedAt ?? s.createdAt,
          badgeUrl: `https://${host}/api/v1/badge/${s.id}.svg`,
          reportUrl: `/reports/${s.id}`,
          publicUrl: `https://${host}/reports/${s.id}/public`,
        })),
        liveBadges: liveBadges.map((b) => ({
          id: b.id,
          siteUrl: b.siteUrl,
          orgId: b.orgId,
          enabled: b.enabled,
          createdAt: b.createdAt,
          createdBy: b.createdBy ?? null,
          badgeUrl: `https://${host}/api/v1/badge/live/${b.id}.svg`,
        })),
      });
    },
  );

  server.post(
    '/admin/badges/static/:scanId/revoke',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: { ...HtmlPartial, params: Type.Object({ scanId: Type.String() }) },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scanId } = request.params as { scanId: string };
      const scan = await storage.scans.getScan(scanId);
      if (scan === null) return reply.code(404).send({ error: 'Report not found' });
      const isAdminSystem = hasPermission(request, 'admin.system');
      const orgId = request.user?.currentOrgId ?? 'system';
      if (!isAdminSystem && scan.orgId !== orgId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      await storage.scans.setPublicShare(
        scanId,
        scan.orgId,
        false,
        request.user?.id ?? 'admin',
      );
      return reply.redirect('/admin/badges?revoked=static');
    },
  );

  server.post(
    '/admin/badges/live/:badgeId/revoke',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: { ...HtmlPartial, params: Type.Object({ badgeId: Type.String() }) },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId } = request.params as { badgeId: string };
      const badge = await storage.siteBadges.get(badgeId);
      if (badge === null) return reply.code(404).send({ error: 'Badge not found' });
      const isAdminSystem = hasPermission(request, 'admin.system');
      const orgId = request.user?.currentOrgId ?? 'system';
      if (!isAdminSystem && badge.orgId !== orgId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      await storage.siteBadges.setEnabled(badgeId, badge.orgId, false);
      return reply.redirect('/admin/badges?revoked=live');
    },
  );

  // Re-enable a previously-revoked live badge. Same URL, same id —
  // consumers don't need to update their embed code.
  server.post(
    '/admin/badges/live/:badgeId/enable',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: { ...HtmlPartial, params: Type.Object({ badgeId: Type.String() }) },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId } = request.params as { badgeId: string };
      const badge = await storage.siteBadges.get(badgeId);
      if (badge === null) return reply.code(404).send({ error: 'Badge not found' });
      const isAdminSystem = hasPermission(request, 'admin.system');
      const orgId = request.user?.currentOrgId ?? 'system';
      if (!isAdminSystem && badge.orgId !== orgId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      await storage.siteBadges.setEnabled(badgeId, badge.orgId, true);
      return reply.redirect('/admin/badges?enabled=live');
    },
  );
}
