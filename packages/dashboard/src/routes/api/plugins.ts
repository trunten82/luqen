import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import type { PluginManager } from '../../plugins/manager.js';

// ---------------------------------------------------------------------------
// Request body / param types
// ---------------------------------------------------------------------------

interface InstallBody {
  readonly packageName: string;
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
    { preHandler: requirePermission('admin.system') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const plugins = pluginManager.list();
      return reply.send(plugins);
    },
  );

  // GET /api/v1/plugins/registry — list available from registry (mark installed ones)
  server.get(
    '/api/v1/plugins/registry',
    { preHandler: requirePermission('admin.system') },
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

  // POST /api/v1/plugins/install — { packageName: string }
  server.post<{ Body: InstallBody }>(
    '/api/v1/plugins/install',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      const { packageName } = request.body ?? {};

      if (typeof packageName !== 'string' || packageName.trim() === '') {
        return reply.code(400).send({ error: 'packageName is required' });
      }

      try {
        const plugin = await pluginManager.install(packageName);
        return reply.code(201).send(plugin);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes('not found in registry')) {
          return reply.code(400).send({ error: message });
        }

        return reply.code(500).send({ error: `Install failed: ${message}` });
      }
    },
  );

  // PATCH /api/v1/plugins/:id/config — { config: Record<string, unknown> }
  server.patch<{ Params: PluginParams; Body: ConfigBody }>(
    '/api/v1/plugins/:id/config',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      const { id } = request.params;
      const { config } = request.body ?? {};

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
    { preHandler: requirePermission('admin.system') },
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
    { preHandler: requirePermission('admin.system') },
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
    { preHandler: requirePermission('admin.system') },
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
    { preHandler: requirePermission('admin.system') },
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
