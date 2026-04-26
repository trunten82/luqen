import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import type { PluginManager } from '../../plugins/manager.js';
import { ErrorEnvelope, NoContent } from '../../api/schemas/envelope.js';

// Plugins API responds with bare JSON (not wrapped envelope) — schemas mirror that.
const PluginShape = Type.Object({}, { additionalProperties: true });
const PluginListSchema = Type.Array(PluginShape);
const PluginRegistryEntrySchema = Type.Object({}, { additionalProperties: true });
const PluginRegistryListSchema = Type.Array(PluginRegistryEntrySchema);
const PluginHealthSchema = Type.Object({}, { additionalProperties: true });

// InstallBody / ConfigBody intentionally NOT declared as `body:` schemas:
// the access-control test calls these endpoints without a body, and Fastify
// runs body validation before preHandler — a body schema would short-circuit
// the requirePermission 403 path. Handlers validate inputs themselves.

const PluginIdParamsSchema = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

// ---------------------------------------------------------------------------
// Request body / param types
// ---------------------------------------------------------------------------

interface InstallBody {
  readonly name: string;
}

interface ConfigBody {
  readonly config: Record<string, unknown>;
}

interface PluginParams {
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function pluginApiRoutes(
  server: FastifyInstance,
  pluginManager: PluginManager,
): Promise<void> {
  // GET /api/v1/plugins — list installed plugins
  server.get(
    '/api/v1/plugins',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        response: { 200: PluginListSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const plugins = pluginManager.list();
      return reply.send(plugins);
    },
  );

  // GET /api/v1/plugins/registry — list available from registry (mark installed ones)
  server.get(
    '/api/v1/plugins/registry',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        response: { 200: PluginRegistryListSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const installed = pluginManager.list();
      const installedPackages = new Set(installed.map((p) => p.packageName));
      const registry = pluginManager.getRegistryEntries();

      const entries = registry.map((entry) => ({
        ...entry,
        installed: installedPackages.has(entry.packageName),
      }));

      return reply.send(entries);
    },
  );

  // POST /api/v1/plugins/install — { name: string }
  server.post<{ Body: InstallBody }>(
    '/api/v1/plugins/install',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        response: {
          201: PluginShape,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { name } = (request.body ?? {}) as InstallBody;

      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name is required' });
      }

      try {
        const plugin = await pluginManager.install(name);
        return reply.code(201).send(plugin);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found in catalogue') || message.includes('not found in registry')) {
          return reply.code(400).send({ error: message });
        }

        return reply.code(500).send({ error: `Install failed: ${message}` });
      }
    },
  );

  // PATCH /api/v1/plugins/:id/config — { config: Record<string, unknown> }
  server.patch<{ Params: PluginParams; Body: ConfigBody }>(
    '/api/v1/plugins/:id/config',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        params: PluginIdParamsSchema,
        response: {
          200: PluginShape,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { config } = (request.body ?? {}) as ConfigBody;

      if (config === undefined || config === null || typeof config !== 'object') {
        return reply.code(400).send({ error: 'config object is required' });
      }

      try {
        const plugin = await pluginManager.configure(id, config);
        return reply.send(plugin);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }

        return reply.code(500).send({ error: message });
      }
    },
  );

  // POST /api/v1/plugins/:id/activate
  server.post<{ Params: PluginParams }>(
    '/api/v1/plugins/:id/activate',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        params: PluginIdParamsSchema,
        response: {
          200: PluginShape,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const plugin = await pluginManager.activate(id);
        return reply.send(plugin);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }

        return reply.code(500).send({ error: message });
      }
    },
  );

  // POST /api/v1/plugins/:id/deactivate
  server.post<{ Params: PluginParams }>(
    '/api/v1/plugins/:id/deactivate',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        params: PluginIdParamsSchema,
        response: {
          200: PluginShape,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const plugin = await pluginManager.deactivate(id);
        return reply.send(plugin);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }

        return reply.code(500).send({ error: message });
      }
    },
  );

  // DELETE /api/v1/plugins/:id
  server.delete<{ Params: PluginParams }>(
    '/api/v1/plugins/:id',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        params: PluginIdParamsSchema,
        response: {
          204: NoContent,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        await pluginManager.remove(id);
        return reply.code(204).send();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }

        return reply.code(500).send({ error: message });
      }
    },
  );

  // GET /api/v1/plugins/:id/health
  server.get<{ Params: PluginParams }>(
    '/api/v1/plugins/:id/health',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        tags: ['plugins'],
        params: PluginIdParamsSchema,
        response: {
          200: PluginHealthSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const plugin = pluginManager.getPlugin(id);
      if (!plugin) {
        return reply.code(404).send({ error: `Plugin "${id}" not found` });
      }

      const health = await pluginManager.checkHealth(id);
      return reply.send(health);
    },
  );
}
