import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PluginManager } from '../../plugins/manager.js';
import type { LLMPlugin } from '../../plugins/types.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface ExtractBody {
  readonly pageContent: string;
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

/**
 * LLM extraction API — used by the compliance service to call the active
 * LLM plugin for government regulation parsing.
 *
 * Authentication: API key (Bearer) or service token.
 * The caller must provide the page content and regulation context.
 */
export async function llmApiRoutes(
  server: FastifyInstance,
  pluginManager: PluginManager,
): Promise<void> {
  // POST /api/v1/llm/extract — extract WCAG requirements from page content
  server.post<{ Body: ExtractBody }>(
    '/api/v1/llm/extract',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Require authentication (API key or session)
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const body = request.body as ExtractBody | undefined;
      if (!body?.pageContent || !body?.context?.regulationId) {
        return reply.code(400).send({
          error: 'pageContent and context.regulationId are required',
        });
      }

      // Find the first active LLM plugin
      const llmPlugins = pluginManager.getActivePluginsByType('llm');
      if (llmPlugins.length === 0) {
        return reply.code(503).send({
          error: 'No active LLM plugin. Install and activate an LLM plugin first.',
        });
      }

      const llm = llmPlugins[0] as LLMPlugin;

      try {
        const result = await llm.extractRequirements(body.pageContent, body.context);
        return reply.send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({
          error: `LLM extraction failed: ${message}`,
        });
      }
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
