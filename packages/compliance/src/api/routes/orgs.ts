import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerOrgRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  app.delete('/api/v1/orgs/:id/data', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id: orgId } = request.params as { id: string };
      if (orgId === 'system') {
        await reply.status(400).send({ error: 'Cannot delete system org data', statusCode: 400 });
        return;
      }
      await db.deleteOrgData(orgId);
      await reply.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}
