import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import type { LLMClient } from '../../llm-client.js';
import { escapeHtml, toastHtml } from './helpers.js';

export async function llmAdminRoutes(
  server: FastifyInstance,
  llmClient: LLMClient | null,
): Promise<void> {
  // ── GET /admin/llm — main page ────────────────────────────────────────────

  server.get(
    '/admin/llm',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!llmClient) {
        return reply.view('admin/llm.hbs', {
          pageTitle: 'LLM Configuration',
          currentPath: '/admin/llm',
          user: request.user,
          llmConnected: false,
        });
      }

      let providers: Awaited<ReturnType<typeof llmClient.listProviders>> = [];
      let models: Awaited<ReturnType<typeof llmClient.listModels>> = [];
      let capabilities: Awaited<ReturnType<typeof llmClient.listCapabilities>> = [];
      let prompts: Awaited<ReturnType<typeof llmClient.listPrompts>> = [];
      let llmConnected = false;
      let error: string | undefined;

      try {
        await llmClient.health();
        llmConnected = true;
        [providers, models, capabilities, prompts] = await Promise.all([
          llmClient.listProviders(),
          llmClient.listModels(),
          llmClient.listCapabilities(),
          llmClient.listPrompts(),
        ]);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to connect to LLM service';
        llmConnected = false;
      }

      // Group models by provider for display
      const modelsByProvider = providers.map((p) => ({
        ...p,
        models: models.filter((m) => m.providerId === p.id),
      }));

      return reply.view('admin/llm.hbs', {
        pageTitle: 'LLM Configuration',
        currentPath: '/admin/llm',
        user: request.user,
        llmConnected,
        error,
        providers,
        models,
        modelsByProvider,
        capabilities,
        prompts,
      });
    },
  );

  // ── POST /admin/llm/providers — create provider ───────────────────────────

  server.post(
    '/admin/llm/providers',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as {
        name?: string;
        type?: string;
        apiKey?: string;
        baseUrl?: string;
        enabled?: string;
      };

      if (!body.name?.trim() || !body.type?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Name and type are required', 'error'),
        );
      }

      try {
        await llmClient.createProvider({
          name: body.name.trim(),
          type: body.type.trim(),
          apiKey: body.apiKey?.trim() || undefined,
          baseUrl: body.baseUrl?.trim() || undefined,
          enabled: body.enabled === 'on' || body.enabled === 'true',
        });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Provider created successfully', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Create failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── POST /admin/llm/providers/:id/test — test provider ───────────────────

  server.post<{ Params: { id: string } }>(
    '/admin/llm/providers/:id/test',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        const result = await llmClient.testProvider(request.params.id);
        const msg = result.message ?? (result.ok ? 'Connection successful' : 'Connection failed');
        const type = result.ok ? 'success' : 'error';
        return reply.header('content-type', 'text/html').send(toastHtml(msg, type));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Test failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── PATCH /admin/llm/providers/:id — update provider ─────────────────────

  server.patch<{ Params: { id: string } }>(
    '/admin/llm/providers/:id',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as {
        name?: string;
        apiKey?: string;
        baseUrl?: string;
        enabled?: string;
      };

      try {
        const data: Record<string, unknown> = {};
        if (body.name?.trim()) data['name'] = body.name.trim();
        if (body.apiKey?.trim()) data['apiKey'] = body.apiKey.trim();
        if (body.baseUrl !== undefined) data['baseUrl'] = body.baseUrl.trim() || undefined;
        if (body.enabled !== undefined) data['enabled'] = body.enabled === 'on' || body.enabled === 'true';

        await llmClient.updateProvider(request.params.id, data);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Provider updated', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Update failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── DELETE /admin/llm/providers/:id — delete provider ────────────────────

  server.delete<{ Params: { id: string } }>(
    '/admin/llm/providers/:id',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        await llmClient.deleteProvider(request.params.id);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Provider deleted', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Delete failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── POST /admin/llm/models — register model ───────────────────────────────

  server.post(
    '/admin/llm/models',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as {
        providerId?: string;
        externalId?: string;
        name?: string;
        contextWindow?: string;
        enabled?: string;
      };

      if (!body.providerId?.trim() || !body.externalId?.trim() || !body.name?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Provider, external ID, and name are required', 'error'),
        );
      }

      try {
        await llmClient.createModel({
          providerId: body.providerId.trim(),
          externalId: body.externalId.trim(),
          name: body.name.trim(),
          contextWindow: body.contextWindow ? parseInt(body.contextWindow, 10) : undefined,
          enabled: body.enabled === 'on' || body.enabled === 'true',
        });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Model registered', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Register failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── DELETE /admin/llm/models/:id — delete model ───────────────────────────

  server.delete<{ Params: { id: string } }>(
    '/admin/llm/models/:id',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        await llmClient.deleteModel(request.params.id);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Model deleted', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Delete failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── PUT /admin/llm/capabilities/:name/assign — assign model ───────────────

  server.put<{ Params: { name: string } }>(
    '/admin/llm/capabilities/:name/assign',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as { modelId?: string; priority?: string };

      if (!body.modelId?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Model ID is required', 'error'),
        );
      }

      try {
        await llmClient.assignCapability(request.params.name, {
          modelId: body.modelId.trim(),
          priority: body.priority ? parseInt(body.priority, 10) : undefined,
        });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Model assigned to capability', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Assign failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── DELETE /admin/llm/capabilities/:name/unassign/:modelId ───────────────

  server.delete<{ Params: { name: string; modelId: string } }>(
    '/admin/llm/capabilities/:name/unassign/:modelId',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        await llmClient.unassignCapability(request.params.name, request.params.modelId);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Model unassigned from capability', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Unassign failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── PUT /admin/llm/prompts/:capability — save prompt override ─────────────

  server.put<{ Params: { capability: string } }>(
    '/admin/llm/prompts/:capability',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as { template?: string };

      if (!body.template?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Template is required', 'error'),
        );
      }

      try {
        await llmClient.setPrompt(request.params.capability, body.template.trim());
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Prompt saved', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Save failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── DELETE /admin/llm/prompts/:capability — reset to default ──────────────

  server.delete<{ Params: { capability: string } }>(
    '/admin/llm/prompts/:capability',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        await llmClient.deletePrompt(request.params.capability);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'llmChanged')
          .send(toastHtml('Prompt reset to default', 'success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Reset failed: ${message}`, 'error'),
        );
      }
    },
  );
}
