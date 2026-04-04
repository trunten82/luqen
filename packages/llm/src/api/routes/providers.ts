import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createAdapter } from '../../providers/registry.js';
import type { ProviderType, UpdateProviderInput } from '../../types.js';

function stripApiKey<T extends { apiKey?: string }>(provider: T): Omit<T, 'apiKey'> {
  const { apiKey: _key, ...rest } = provider;
  return rest;
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/providers
  app.get('/api/v1/providers', {
    preHandler: [requireScope('read')],
  }, async (_request, reply) => {
    try {
      const providers = await db.listProviders();
      await reply.send(providers.map(stripApiKey));
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/providers/:id
  app.get('/api/v1/providers/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const provider = await db.getProvider(id);
      if (provider == null) {
        await reply.status(404).send({ error: 'Provider not found', statusCode: 404 });
        return;
      }
      await reply.send(stripApiKey(provider));
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/providers
  app.post('/api/v1/providers', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      if (!body.name || !body.type || !body.baseUrl) {
        await reply.status(400).send({
          error: 'name, type, and baseUrl are required',
          statusCode: 400,
        });
        return;
      }

      const provider = await db.createProvider({
        name: String(body.name),
        type: String(body.type) as ProviderType,
        baseUrl: String(body.baseUrl),
        ...(body.apiKey != null ? { apiKey: String(body.apiKey) } : {}),
      });

      await reply.status(201).send(stripApiKey(provider));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/providers/:id
  app.patch('/api/v1/providers/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const update: UpdateProviderInput = {
        ...(body.name != null ? { name: String(body.name) } : {}),
        ...(body.baseUrl != null ? { baseUrl: String(body.baseUrl) } : {}),
        ...(body.apiKey != null ? { apiKey: String(body.apiKey) } : {}),
        ...(body.status != null ? { status: body.status as 'active' | 'inactive' | 'error' } : {}),
      };

      const updated = await db.updateProvider(id, update);
      if (updated == null) {
        await reply.status(404).send({ error: 'Provider not found', statusCode: 404 });
        return;
      }
      await reply.send(stripApiKey(updated));
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // DELETE /api/v1/providers/:id
  app.delete('/api/v1/providers/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await db.deleteProvider(id);
      if (!deleted) {
        await reply.status(404).send({ error: 'Provider not found', statusCode: 404 });
        return;
      }
      await reply.status(204).send();
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/providers/:id/test
  app.post('/api/v1/providers/:id/test', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const provider = await db.getProvider(id);
      if (provider == null) {
        await reply.status(404).send({ error: 'Provider not found', statusCode: 404 });
        return;
      }

      const adapter = createAdapter(provider.type);
      await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      let healthy = false;
      try {
        healthy = await adapter.healthCheck();
      } finally {
        await adapter.disconnect();
      }

      const newStatus = healthy ? 'active' : 'error';
      await db.updateProvider(id, { status: newStatus });

      await reply.send({ ok: healthy, status: newStatus });
    } catch (_err) {
      // Update provider status to error on failure
      const { id } = request.params as { id: string };
      await db.updateProvider(id, { status: 'error' }).catch(() => undefined);
      await reply.status(502).send({ error: 'Provider connectivity test failed', statusCode: 502 });
    }
  });

  // GET /api/v1/providers/:id/models
  app.get('/api/v1/providers/:id/models', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const provider = await db.getProvider(id);
      if (provider == null) {
        await reply.status(404).send({ error: 'Provider not found', statusCode: 404 });
        return;
      }

      const adapter = createAdapter(provider.type);
      await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      let models;
      try {
        models = await adapter.listModels();
      } finally {
        await adapter.disconnect();
      }

      await reply.send(models);
    } catch (_err) {
      await reply.status(502).send({ error: 'Failed to fetch models from provider', statusCode: 502 });
    }
  });
}
