import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { seedBaseline, getSeedStatus } from '../../seed/loader.js';

const SeedBodySchema = Type.Object(
  { force: Type.Optional(Type.Boolean()) },
  { additionalProperties: true },
);
const SeedResponse = Type.Object({}, { additionalProperties: true });
const SeedStatusResponse = Type.Object({}, { additionalProperties: true });

interface SeedBody {
  force?: boolean;
}

export async function registerSeedRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/seed
  app.post<{ Body: SeedBody }>('/api/v1/seed', {
    schema: {
      tags: ['seed'],
      summary: 'Seed baseline regulations and requirements',
      // Body is optional — callers may POST without a body to use defaults.
      response: { 200: SeedResponse, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const force = request.body?.force === true;
      const result = await seedBaseline(db, { force });
      const seeded = result.jurisdictions > 0 && result.regulations > 0 && result.requirements > 0;
      await reply.status(200).send({ success: true, seeded, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Seed failed';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // POST /api/v1/admin/reseed — always force reseed
  app.post('/api/v1/admin/reseed', {
    schema: {
      tags: ['seed'],
      summary: 'Force reseed baseline data',
      response: { 200: SeedResponse, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (_request, reply) => {
    try {
      const result = await seedBaseline(db, { force: true });
      const seeded = result.jurisdictions > 0 && result.regulations > 0 && result.requirements > 0;
      await reply.status(200).send({ success: true, seeded, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reseed failed';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // GET /api/v1/seed/status
  app.get('/api/v1/seed/status', {
    schema: {
      tags: ['seed'],
      summary: 'Get seed status',
      response: { 200: SeedStatusResponse, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('read')],
  }, async (_request, reply) => {
    try {
      const status = await getSeedStatus(db);
      await reply.send(status);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
