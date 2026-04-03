import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PluginManager } from '../../plugins/manager.js';
import type { LLMPlugin } from '../../plugins/types.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface ExtractBody {
  readonly pageContent: string;
  readonly pluginId?: string;
  readonly context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function llmApiRoutes(
  server: FastifyInstance,
  pluginManager: PluginManager,
): Promise<void> {
  // POST /api/v1/llm/extract — extract WCAG requirements from page content
  // Optional pluginId selects which LLM plugin to use (defaults to first active)
  server.post<{ Body: ExtractBody }>(
    '/api/v1/llm/extract',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const body = request.body as ExtractBody | undefined;
      if (!body?.pageContent || !body?.context?.regulationId) {
        return reply.code(400).send({
          error: 'pageContent and context.regulationId are required',
        });
      }

      // Resolve LLM plugin — by ID or first active
      let llm: LLMPlugin | null = null;
      if (body.pluginId) {
        const instance = pluginManager.getActiveInstance(body.pluginId);
        if (!instance) {
          return reply.code(400).send({ error: `LLM plugin "${body.pluginId}" is not active` });
        }
        llm = instance as LLMPlugin;
      } else {
        const llmPlugins = pluginManager.getActivePluginsByType('llm');
        if (llmPlugins.length === 0) {
          return reply.code(503).send({ error: 'No active LLM plugin' });
        }
        llm = llmPlugins[0] as LLMPlugin;
      }

      try {
        const result = await llm.extractRequirements(body.pageContent, body.context);
        return reply.send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `LLM extraction failed: ${message}` });
      }
    },
  );

  // GET /api/v1/llm/plugins — list active LLM plugins for selection
  server.get(
    '/api/v1/llm/plugins',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const all = pluginManager.list();
      const llmPlugins = all
        .filter((p) => p.type === 'llm' && p.status === 'active')
        .map((p) => ({ id: p.id, packageName: p.packageName, version: p.version }));
      return reply.send(llmPlugins);
    },
  );

  // GET /api/v1/llm/status — check if an LLM plugin is available
  server.get(
    '/api/v1/llm/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const llmPlugins = pluginManager.getActivePluginsByType('llm');
      return reply.send({
        available: llmPlugins.length > 0,
        pluginCount: llmPlugins.length,
      });
    },
  );
}
