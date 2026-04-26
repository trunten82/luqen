import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import type { CapabilityName } from '../../types.js';

const Model = Type.Object(
  {
    id: Type.String(),
    providerId: Type.String(),
    modelId: Type.String(),
    displayName: Type.String(),
    status: Type.Union([Type.Literal('active'), Type.Literal('inactive')]),
    capabilities: Type.Array(Type.String()),
    createdAt: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const CreateModelBody = Type.Object(
  {
    providerId: Type.Optional(Type.String()),
    modelId: Type.Optional(Type.String()),
    displayName: Type.Optional(Type.String()),
    capabilities: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

const ListModelsQuery = Type.Object(
  { providerId: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const IdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });

export async function registerModelRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/models
  app.get('/api/v1/models', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['models'],
      summary: 'List registered models, optionally filtered by providerId',
      querystring: ListModelsQuery,
      response: {
        200: LuqenResponse(Type.Array(Model)),
        500: ErrorEnvelope,
      },
    },
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
    schema: {
      tags: ['models'],
      summary: 'Get a model by id',
      params: IdParams,
      response: {
        200: LuqenResponse(Model),
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
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
    schema: {
      tags: ['models'],
      summary: 'Register a new model under a provider',
      body: CreateModelBody,
      response: {
        201: LuqenResponse(Model),
        400: ErrorEnvelope,
      },
    },
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
    schema: {
      tags: ['models'],
      summary: 'Delete a model',
      params: IdParams,
      response: {
        204: Type.Null(),
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
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
