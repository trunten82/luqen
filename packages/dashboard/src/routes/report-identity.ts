/**
 * Report Identity admin routes.
 *
 *  - GET  /admin/report-identity   admin config form (auth)
 *  - POST /admin/report-identity   save config (auth, CSRF)
 *
 * Sets the per-org legal/company identity rendered on the VPAT/ACR (entity
 * name, contact email, optional postal address, optional evaluator/preparer
 * org). The report LOGO is reused from the org's branding guideline image —
 * there is no logo upload here. Attribution only: nothing here is a conformance
 * or certification claim (US-lawsuit-protection direction — never over-claim).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/adapter.js';
import { requirePermission } from '../auth/middleware.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import type {
  ReportIdentityRecord,
  ReportIdentityInput,
} from '../db/interfaces/report-identity-repository.js';

export async function reportIdentityRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── Admin: view + edit the per-org report identity ──────────────────────
  server.get(
    '/admin/report-identity',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? 'system';
      const saved = (request.query as { saved?: string } | undefined)?.saved === '1';
      const supported = storage.reportIdentities !== undefined;

      const existing = supported ? await storage.reportIdentities!.get(orgId) : null;
      const org = await storage.organizations.getOrg(orgId);

      const config: ReportIdentityRecord = existing ?? {
        orgId,
        updatedAt: '',
        ...(org?.name !== undefined ? { entityName: org.name } : {}),
      };

      return reply.view('admin/report-identity.hbs', {
        user: request.user,
        currentPath: '/admin/report-identity',
        config,
        supported,
        saved,
        csrfToken: (request as unknown as { csrfToken?: () => string }).csrfToken?.() ?? '',
      });
    },
  );

  // ── Admin: save the report identity ─────────────────────────────────────
  server.post(
    '/admin/report-identity',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (storage.reportIdentities === undefined) {
        return reply.redirect('/admin/report-identity');
      }
      const orgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? 'system';
      const userId = (request.user as { id?: string } | undefined)?.id;
      const body = (request.body ?? {}) as Record<string, string | undefined>;

      const input: ReportIdentityInput = {
        ...(body.entityName?.trim() ? { entityName: body.entityName.trim() } : {}),
        ...(body.contactEmail?.trim() ? { contactEmail: body.contactEmail.trim() } : {}),
        ...(body.postalAddress?.trim() ? { postalAddress: body.postalAddress.trim() } : {}),
        ...(body.preparedBy?.trim() ? { preparedBy: body.preparedBy.trim() } : {}),
      };

      await storage.reportIdentities.upsert(orgId, input, userId);
      return reply.redirect('/admin/report-identity?saved=1');
    },
  );
}
