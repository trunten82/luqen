import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import { VERSION } from '../../version.js';

const HealthResponse = Type.Object(
  {
    status: Type.String(),
    version: Type.String(),
    timestamp: Type.String(),
  },
  { additionalProperties: true },
);

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', {
    schema: {
      tags: ['health'],
      summary: 'Service liveness probe',
      response: {
        200: HealthResponse,
        500: ErrorEnvelope,
      },
    },
  }, async (_request, reply) => {
    await reply.status(200).send({
      status: 'ok',
      version: VERSION,
      timestamp: new Date().toISOString(),
    });
  });
}
