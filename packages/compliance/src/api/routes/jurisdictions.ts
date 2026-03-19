import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import * as crud from '../../engine/crud.js';

export async function registerJurisdictionRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/jurisdictions
  app.get('/api/v1/jurisdictions', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const filters: Record<string, string> = {};
      if (query.type) filters.type = String(query.type);
      if (query.parentId) filters.parentId = String(query.parentId);

      const items = await db.listJurisdictions(
        Object.keys(filters).length > 0 ? filters as Parameters<typeof db.listJurisdictions>[0] : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/jurisdictions/:id
  app.get('/api/v1/jurisdictions/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const jurisdiction = await db.getJurisdiction(id);
      if (jurisdiction == null) {
        await reply.status(404).send({ error: `Jurisdiction '${id}' not found`, statusCode: 404 });
        return;
      }
      // Count regulations
      const regulations = await db.listRegulations({ jurisdictionId: id });
      await reply.send({ ...jurisdiction, regulationsCount: regulations.length });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/jurisdictions
  app.post('/api/v1/jurisdictions', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof crud.createJurisdiction>[1];
      const jurisdiction = await crud.createJurisdiction(db, body);
      await reply.status(201).send(jurisdiction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/jurisdictions/:id
  app.patch('/api/v1/jurisdictions/:id', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<Parameters<typeof crud.createJurisdiction>[1]>;
      const jurisdiction = await crud.updateJurisdiction(db, id, body);
      await reply.send(jurisdiction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // DELETE /api/v1/jurisdictions/:id
  app.delete('/api/v1/jurisdictions/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await db.getJurisdiction(id);
      if (existing == null) {
        await reply.status(404).send({ error: `Jurisdiction '${id}' not found`, statusCode: 404 });
        return;
      }
      await db.deleteJurisdiction(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
