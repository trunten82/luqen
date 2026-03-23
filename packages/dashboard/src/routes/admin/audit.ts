import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import type { StorageAdapter } from '../../db/index.js';

interface AuditQueryParams {
  actor?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

export async function auditRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/audit-log',
    { preHandler: requirePermission('audit.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as AuditQueryParams;

      const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);

      const result = await storage.audit.query({
        actor: q.actor || undefined,
        action: q.action || undefined,
        resourceType: q.resourceType || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        limit,
        offset,
      });

      const hasMore = offset + limit < result.total;

      return reply.view('admin/audit-log.hbs', {
        pageTitle: 'Audit Log',
        currentPath: '/admin/audit-log',
        user: request.user,
        entries: result.entries,
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
