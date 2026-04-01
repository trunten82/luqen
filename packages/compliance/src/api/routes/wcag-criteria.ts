import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerWcagCriteriaRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/wcag-criteria
  app.get('/api/v1/wcag-criteria', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    const query = request.query as { version?: string; level?: string };
    const criteria = await db.listWcagCriteria({
      version: query.version,
      level: query.level,
    });
    await reply.send({ data: criteria, total: criteria.length });
  });
}
