import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import * as crud from '../../engine/crud.js';

export async function registerRequirementRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/requirements
  app.get('/api/v1/requirements', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const filters: Record<string, string> = {};
      if (query.regulationId) filters.regulationId = String(query.regulationId);
      if (query.wcagCriterion) filters.wcagCriterion = String(query.wcagCriterion);
      if (query.obligation) filters.obligation = String(query.obligation);

      const items = await db.listRequirements(
        Object.keys(filters).length > 0 ? filters as Parameters<typeof db.listRequirements>[0] : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/requirements/:id
  app.get('/api/v1/requirements/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requirement = await db.getRequirement(id);
      if (requirement == null) {
        await reply.status(404).send({ error: `Requirement '${id}' not found`, statusCode: 404 });
        return;
      }
      const regulation = await db.getRegulation(requirement.regulationId);
      await reply.send({ ...requirement, regulation });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/requirements
  app.post('/api/v1/requirements', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof crud.createRequirement>[1];
      const requirement = await crud.createRequirement(db, body);
      await reply.status(201).send(requirement);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // POST /api/v1/requirements/bulk
  app.post('/api/v1/requirements/bulk', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as { requirements: Parameters<typeof crud.createRequirement>[1][] };
      const items = Array.isArray(body) ? body : body.requirements;
      if (!Array.isArray(items)) {
        await reply.status(400).send({ error: 'Body must be an array or { requirements: [] }', statusCode: 400 });
        return;
      }
      const results = await db.bulkCreateRequirements(items);
      await reply.status(201).send(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/requirements/:id
  app.patch('/api/v1/requirements/:id', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<Parameters<typeof crud.createRequirement>[1]>;
      const requirement = await crud.updateRequirement(db, id, body);
      await reply.send(requirement);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // DELETE /api/v1/requirements/:id
  app.delete('/api/v1/requirements/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await db.getRequirement(id);
      if (existing == null) {
        await reply.status(404).send({ error: `Requirement '${id}' not found`, statusCode: 404 });
        return;
      }
      await db.deleteRequirement(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
