import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

const WcagCriterion = Type.Object({}, { additionalProperties: true });
const WcagCriteriaResponse = Type.Object(
  {
    data: Type.Array(WcagCriterion),
    total: Type.Number(),
  },
  { additionalProperties: true },
);
const WcagCriteriaQuery = Type.Object(
  {
    version: Type.Optional(Type.String()),
    level: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export async function registerWcagCriteriaRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/wcag-criteria
  app.get('/api/v1/wcag-criteria', {
    schema: {
      tags: ['wcag-criteria'],
      summary: 'List WCAG criteria',
      querystring: WcagCriteriaQuery,
      response: {
        200: WcagCriteriaResponse,
        401: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
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
