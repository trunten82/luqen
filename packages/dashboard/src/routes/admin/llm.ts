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
    { preHandler: requirePermission('admin.system', 'llm.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tab } = request.query as { tab?: string };
      const activeTab = ['providers', 'models', 'capabilities', 'prompts'].includes(tab ?? '')
        ? tab!
        : 'providers';

      if (!llmClient) {
        return reply.view('admin/llm.hbs', {
          pageTitle: 'LLM Configuration',
          currentPath: '/admin/llm',
          user: request.user,
          llmConnected: false,
          activeTab,
        });
      }

      let providers: Awaited<ReturnType<typeof llmClient.listProviders>> = [];
      let models: Awaited<ReturnType<typeof llmClient.listModels>> = [];
      let capabilities: Awaited<ReturnType<typeof llmClient.listCapabilities>> = [];
      let llmConnected = false;
      let error: string | undefined;

      try {
        await llmClient.health();
        llmConnected = true;
        [providers, models, capabilities] = await Promise.all([
          llmClient.listProviders(),
          llmClient.listModels(),
          llmClient.listCapabilities(),
        ]);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to connect to LLM service';
        llmConnected = false;
      }

      // Add status badge fields to providers
      const providersWithBadge = providers.map((p) => ({
        ...p,
        statusClass: p.status === 'active' ? 'badge--success' : p.status === 'error' ? 'badge--error' : 'badge--neutral',
        statusLabel: p.status === 'active' ? 'Active' : p.status === 'error' ? 'Error' : 'Inactive',
      }));

      // Add status badge fields to models
      const modelsWithBadge = models.map((m) => ({
        ...m,
        statusClass: m.status === 'active' ? 'badge--success' : 'badge--neutral',
        statusLabel: m.status === 'active' ? 'Active' : 'Inactive',
      }));

      // Group models by provider for display
      const modelsByProvider = providersWithBadge.map((p) => ({
        ...p,
        models: modelsWithBadge.filter((m) => m.providerId === p.id),
      }));

      // Resolve capability assignments to include model display names
      const capabilitiesWithModels = capabilities.map((cap) => ({
        ...cap,
        assignedModels: cap.assignments.map((a) => {
          const model = models.find((m) => m.id === a.modelId);
          return {
            id: a.modelId,
            name: model ? `${model.displayName} (${model.modelId})` : a.modelId,
            priority: a.priority,
          };
        }),
      }));

      // Build prompts for all 4 capabilities (getPrompt returns default when no override)
      const CAPABILITY_NAMES = ['extract-requirements', 'generate-fix', 'analyse-report', 'discover-branding'];
      const promptData = llmConnected
        ? await Promise.all(
            CAPABILITY_NAMES.map(async (cap) => {
              try {
                const p = await llmClient.getPrompt(cap);
                return {
                  capability: cap,
                  template: p.template,
                  isCustom: p.isCustom ?? false,
                  updatedAt: p.updatedAt ?? null,
                };
              } catch {
                return { capability: cap, template: '', isCustom: false, updatedAt: null };
              }
            }),
          )
        : [];

      return reply.view('admin/llm.hbs', {
        pageTitle: 'LLM Configuration',
        currentPath: '/admin/llm',
        user: request.user,
        llmConnected,
        activeTab,
        error,
        providers: providersWithBadge,
        models: modelsWithBadge,
        modelsByProvider,
        capabilities: capabilitiesWithModels,
        prompts: promptData,
      });
    },
  );

  // ── POST /admin/llm/providers — create provider ───────────────────────────

  server.post(
    '/admin/llm/providers',
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
        });
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/llm?tab=providers')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
    async (request, reply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        const result = await llmClient.testProvider(request.params.id);
        const msg = result.ok ? 'Connection successful' : 'Connection failed';
        const type = result.ok ? 'success' : 'error';
        return reply
          .header('content-type', 'text/html')
          .send(toastHtml(msg, type));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Test failed: ${message}`, 'error'),
        );
      }
    },
  );

  // ── GET /admin/llm/remote-models — fetch models from provider API ────────

  server.get(
    '/admin/llm/remote-models',
    { preHandler: requirePermission('admin.system', 'llm.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId } = request.query as { providerId?: string };
      if (!providerId || !llmClient) {
        return reply.header('content-type', 'text/html').send(
          '<option value="">Select a provider first</option>',
        );
      }
      try {
        const models = await llmClient.listRemoteModels(providerId);
        const options = models.map((m) =>
          `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`,
        ).join('');
        return reply.header('content-type', 'text/html').send(
          `<option value="">Select model...</option>${options}`,
        );
      } catch {
        return reply.header('content-type', 'text/html').send(
          '<option value="">Failed to fetch models</option>',
        );
      }
    },
  );

  // ── PATCH /admin/llm/providers/:id — update provider ─────────────────────

  server.patch<{ Params: { id: string } }>(
    '/admin/llm/providers/:id',
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
        status?: string;
      };

      try {
        const data: Record<string, unknown> = {};
        if (body.name?.trim()) data['name'] = body.name.trim();
        if (body.apiKey?.trim()) data['apiKey'] = body.apiKey.trim();
        if (body.baseUrl !== undefined) data['baseUrl'] = body.baseUrl.trim() || undefined;
        if (body.status === 'active' || body.status === 'inactive') data['status'] = body.status;

        await llmClient.updateProvider(request.params.id, data);
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/llm?tab=providers')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=providers')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      const body = request.body as {
        providerId?: string;
        externalId?: string;
        modelId?: string;
        name?: string;
        displayName?: string;
      };

      const modelId = (body.modelId ?? body.externalId)?.trim() ?? '';
      const displayName = (body.displayName ?? body.name)?.trim() ?? '';

      if (!body.providerId?.trim() || !modelId || !displayName) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Provider, model ID, and display name are required', 'error'),
        );
      }

      try {
        await llmClient.createModel({
          providerId: body.providerId.trim(),
          modelId,
          displayName,
        });
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/llm?tab=models')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=models')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=capabilities')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=capabilities')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=prompts')
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
    { preHandler: requirePermission('admin.system', 'llm.manage') },
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
          .header('HX-Redirect', '/admin/llm?tab=prompts')
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
