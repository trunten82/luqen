import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { checkCompliance } from '../../engine/checker.js';
import type { ComplianceCheckRequest } from '../../types.js';

export async function registerComplianceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/compliance/check
  app.post('/api/v1/compliance/check', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const body = request.body as ComplianceCheckRequest;

      if (!Array.isArray(body.jurisdictions) || body.jurisdictions.length === 0) {
        await reply.status(400).send({ error: 'jurisdictions array is required', statusCode: 400 });
        return;
      }
      if (!Array.isArray(body.issues)) {
        await reply.status(400).send({ error: 'issues array is required', statusCode: 400 });
        return;
      }

      const result = await checkCompliance(body, db);
      await reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}
