import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import * as crud from '../../engine/crud.js';

export async function registerRegulationRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/regulations
  app.get('/api/v1/regulations', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const filters: Record<string, string> = {};
      if (query.jurisdictionId) filters.jurisdictionId = String(query.jurisdictionId);
      if (query.status) filters.status = String(query.status);
      if (query.scope) filters.scope = String(query.scope);
      const orgId = (request as unknown as { orgId?: string }).orgId;
      if (orgId != null) filters.orgId = orgId;

      const items = await db.listRegulations(
        Object.keys(filters).length > 0 ? filters as Parameters<typeof db.listRegulations>[0] : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/regulations/:id
  app.get('/api/v1/regulations/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const regulation = await db.getRegulation(id);
      if (regulation == null) {
        await reply.status(404).send({ error: `Regulation '${id}' not found`, statusCode: 404 });
        return;
      }
      const requirements = await db.listRequirements({ regulationId: id });
      await reply.send({ ...regulation, requirements });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/regulations
  app.post('/api/v1/regulations', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof crud.createRegulation>[1];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const regulation = await crud.createRegulation(db, { ...body, orgId });
      await reply.status(201).send(regulation);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/regulations/:id
  app.patch('/api/v1/regulations/:id', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<Parameters<typeof crud.createRegulation>[1]>;
      const regulation = await crud.updateRegulation(db, id, body);
      await reply.send(regulation);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // DELETE /api/v1/regulations/:id
  app.delete('/api/v1/regulations/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await db.getRegulation(id);
      if (existing == null) {
        await reply.status(404).send({ error: `Regulation '${id}' not found`, statusCode: 404 });
        return;
      }
      await db.deleteRegulation(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
