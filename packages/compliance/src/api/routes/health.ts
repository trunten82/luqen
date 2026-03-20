import type { FastifyInstance } from 'fastify';
import { VERSION } from '../../version.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
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
