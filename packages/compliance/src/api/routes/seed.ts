import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { seedBaseline, getSeedStatus } from '../../seed/loader.js';

interface SeedBody {
  force?: boolean;
}

export async function registerSeedRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/seed
  app.post<{ Body: SeedBody }>('/api/v1/seed', {
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
