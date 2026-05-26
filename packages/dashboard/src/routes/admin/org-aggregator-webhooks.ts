/**
 * Phase 63.1 — Admin pages for org-wide aggregator webhook subscriptions.
 *
 * Dashboard-internal webhook list (separate from compliance-side webhooks).
 * Admin.org / admin.system can create + soft-delete subscriptions for their
 * org. POSTs return small HTMX-friendly partials per project convention.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';
import { toastHtml } from './helpers.js';

const AggregatorCreateBody = Type.Object(
  {
    url: Type.Optional(Type.String()),
    secret: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const AggregatorIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const HtmlPartialResponse = {
  tags: ['html-page'],
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: Type.String(),
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    500: Type.String(),
  },
} as const;

function callerOrgId(request: FastifyRequest): string | undefined {
  return request.user?.currentOrgId;
}

export async function orgAggregatorWebhookRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/org-webhooks/aggregator — admin.org page.
  server.get(
    '/admin/org-webhooks/aggregator',
    {
      preHandler: requirePermission('admin.org', 'admin.system'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = callerOrgId(request);
      const webhooks =
        orgId === undefined ? [] : await storage.orgAggregatorWebhooks.listAll(orgId);

      const formatted = webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        active: w.active,
        createdAtDisplay: new Date(w.createdAt).toLocaleString(),
        hasSecret: w.secret !== null && w.secret !== '',
      }));

      return reply.view('admin/org-aggregator-webhooks.hbs', {
        pageTitle: 'Org Aggregator Webhooks',
        currentPath: '/admin/org-webhooks/aggregator',
        user: request.user,
        webhooks: formatted,
      });
    },
  );

  // POST /admin/org-webhooks/aggregator — create subscription.
  server.post(
    '/admin/org-webhooks/aggregator',
    {
      preHandler: requirePermission('admin.org', 'admin.system'),
      schema: { body: AggregatorCreateBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { url?: string; secret?: string };
      const orgId = callerOrgId(request);
      if (orgId === undefined || orgId === '') {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('No current org context.', 'error'));
      }
      if (!body.url?.trim()) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('URL is required.', 'error'));
      }

      try {
        const created = await storage.orgAggregatorWebhooks.create({
          orgId,
          url: body.url.trim(),
          secret: body.secret?.trim() || null,
          createdBy: request.user?.id ?? null,
        });
        await storage.audit.log({
          actor: request.user?.username ?? request.user?.id ?? 'unknown',
          actorId: request.user?.id,
          action: 'org_aggregator_webhook.created',
          resourceType: 'org_aggregator_webhook',
          resourceId: created.id,
          details: { org_id: orgId, url: created.url },
          orgId,
          ipAddress: request.ip,
        });
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Aggregator webhook added.'));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to add aggregator webhook';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/org-webhooks/aggregator/:id/delete — soft delete.
  server.post(
    '/admin/org-webhooks/aggregator/:id/delete',
    {
      preHandler: requirePermission('admin.org', 'admin.system'),
      schema: { params: AggregatorIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const ok = await storage.orgAggregatorWebhooks.delete(id);
        if (!ok) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('Aggregator webhook not found.', 'error'));
        }
        await storage.audit.log({
          actor: request.user?.username ?? request.user?.id ?? 'unknown',
          actorId: request.user?.id,
          action: 'org_aggregator_webhook.deleted',
          resourceType: 'org_aggregator_webhook',
          resourceId: id,
          details: { org_id: callerOrgId(request) ?? null },
          orgId: callerOrgId(request),
          ipAddress: request.ip,
        });
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Aggregator webhook deleted.'));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete aggregator webhook';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );
}
