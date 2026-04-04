import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import type { CapabilityName } from '../../types.js';

export async function registerModelRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/models
  app.get('/api/v1/models', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const providerId = query.providerId != null ? String(query.providerId) : undefined;
      const models = await db.listModels(providerId);
      await reply.send(models);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/models/:id
  app.get('/api/v1/models/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const model = await db.getModel(id);
      if (model == null) {
        await reply.status(404).send({ error: 'Model not found', statusCode: 404 });
        return;
      }
      await reply.send(model);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/models
  app.post('/api/v1/models', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      if (!body.providerId || !body.modelId || !body.displayName) {
        await reply.status(400).send({
          error: 'providerId, modelId, and displayName are required',
          statusCode: 400,
        });
        return;
      }

      // Verify provider exists
      const provider = await db.getProvider(String(body.providerId));
      if (provider == null) {
        await reply.status(400).send({ error: 'Provider not found', statusCode: 400 });
        return;
      }

      const model = await db.createModel({
        providerId: String(body.providerId),
        modelId: String(body.modelId),
        displayName: String(body.displayName),
        ...(Array.isArray(body.capabilities)
          ? { capabilities: body.capabilities as CapabilityName[] }
          : {}),
      });

      await reply.status(201).send(model);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // DELETE /api/v1/models/:id
  app.delete('/api/v1/models/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await db.deleteModel(id);
      if (!deleted) {
        await reply.status(404).send({ error: 'Model not found', statusCode: 404 });
        return;
      }
      await reply.status(204).send();
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
