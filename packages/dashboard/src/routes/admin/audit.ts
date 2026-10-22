import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import type { StorageAdapter } from '../../db/index.js';
import { HtmlPageSchema } from '../../api/schemas/envelope.js';
import type { AuditEntry } from '../../db/types.js';
import type { Locale } from '../../i18n/index.js';
import { resolveLocale } from '../../services/vpat-share-service.js';
import { actorFilterValues, withActorLabels } from '../../services/issue-dismissals/audit-actor-labels.js';
import { actionOptions, resourceTypeOptions } from './audit-filter-options.js';
import { auditLogScope } from '../../services/audit-log-scope.js';

// Phase 41.1-03 — TypeBox query shape for OpenAPI fidelity. Single HTML route
// returns the audit-log page; only schema/querystring required.
const AuditQuerySchema = Type.Object(
  {
    actor: Type.Optional(Type.String()),
    action: Type.Optional(Type.String()),
    resourceType: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

interface AuditQueryParams {
  actor?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/** The viewer's UI language from the secure session, else 'en' (the rule routes/reports.ts sessionLocale uses). */
function sessionLocale(request: FastifyRequest): Locale {
  const session = request.session as { get?(key: string): unknown } | undefined;
  return resolveLocale(
    typeof session?.get === 'function' ? (session.get('locale') as string | undefined) : undefined,
  ) as Locale;
}

export async function auditRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/audit-log',
    {
      preHandler: requirePermission('audit.view'),
      schema: {
        ...HtmlPageSchema,
        querystring: AuditQuerySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as AuditQueryParams;

      const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);

      // A caller in no organization reads no rows; everyone else reads their organization's rows, and a
      // global administrator reads them all (services/audit-log-scope.ts).
      const scope = auditLogScope(request.user);
      const locale = sessionLocale(request);
      const result = scope.kind === 'none'
        ? { entries: [] as AuditEntry[], total: 0 }
        : await storage.audit.query({
          actors: await actorFilterValues(storage, scope, q.actor, locale, request.log),
          action: q.action || undefined,
          resourceType: q.resourceType || undefined,
          from: q.from || undefined,
          to: q.to || undefined,
          orgId: scope.kind === 'org' ? scope.orgId : undefined,
          limit,
          offset,
        });

      const hasMore = offset + limit < result.total;
      const entries = await withActorLabels(storage, request.user, result.entries, locale, request.log);

      return reply.view('admin/audit-log.hbs', {
        pageTitle: 'Audit Log',
        currentPath: '/admin/audit-log',
        user: request.user,
        entries,
        actionOptions: actionOptions(q.action ?? ''),
        resourceTypeOptions: resourceTypeOptions(q.resourceType ?? ''),
        total: result.total,
        limit,
        offset,
        nextOffset: offset + limit,
        hasMore,
        filters: {
          actor: q.actor ?? '',
          action: q.action ?? '',
          resourceType: q.resourceType ?? '',
          from: q.from ?? '',
          to: q.to ?? '',
        },
      });
    },
  );
}
