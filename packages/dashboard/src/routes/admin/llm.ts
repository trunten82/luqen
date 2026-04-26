import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import { LLMValidationError } from '../../llm-client.js';
import type { LLMClient } from '../../llm-client.js';
import { escapeHtml, toastHtml } from './helpers.js';
import { parsePromptSegments, assembleTemplate } from '../../services/prompt-segments.js';
import type { PromptSegment } from '../../services/prompt-segments.js';
import { computePromptDiff } from '../../services/prompt-diff.js';
import { filterToolsByRbac } from '@luqen/core/mcp';
import { DASHBOARD_TOOL_METADATA } from '../../mcp/metadata.js';
import { resolveEffectivePermissions } from '../../permissions.js';
import type { RoleRepository } from '../../db/interfaces/role-repository.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 32 D-13 + AI-SPEC §4c.2.B — the three fixed locked fences surfaced
// by the `agent-system` prompt. Passed to the prompts-tab template so the
// view can render a variant card per fence with distinct border colors.
const AGENT_SYSTEM_LOCKED_FENCES: readonly {
  readonly name: 'rbac' | 'confirmation' | 'honesty';
  readonly tooltipKey: string;
}[] = [
  { name: 'rbac',         tooltipKey: 'admin.llm.prompts.lockedRbacTooltip' },
  { name: 'confirmation', tooltipKey: 'admin.llm.prompts.lockedConfirmTooltip' },
  { name: 'honesty',      tooltipKey: 'admin.llm.prompts.lockedHonestyTooltip' },
];

// Phase 41.1-02 — local TypeBox shapes for HTMX partial responses.
const HtmlPartialResponse = {
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: ErrorEnvelope,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    422: ErrorEnvelope,
    500: ErrorEnvelope,
    503: ErrorEnvelope,
  },
} as const;

const IdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });
const NameParams = Type.Object({ name: Type.String() }, { additionalProperties: true });
const NameModelParams = Type.Object(
  { name: Type.String(), modelId: Type.String() },
  { additionalProperties: true },
);
const CapabilityParams = Type.Object(
  { capability: Type.String() },
  { additionalProperties: true },
);
const TabQuery = Type.Object(
  { tab: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
const ProviderQuery = Type.Object(
  { providerId: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

export interface LlmAdminRoutesOptions {
  /** Role repository for per-request permission resolution (manifest-size + destructive-count). */
  readonly roleRepository?: RoleRepository;
}

export async function llmAdminRoutes(
  server: FastifyInstance,
  /** Getter for current LLM client (runtime reload support). */
  getLLMClient: () => LLMClient | null,
  options: LlmAdminRoutesOptions = {},
): Promise<void> {
  const { roleRepository } = options;
  // ── GET /admin/llm — main page ────────────────────────────────────────────

  server.get(
    '/admin/llm',
    {
      preHandler: requirePermission('admin.system', 'llm.view'),
      schema: { ...HtmlPageSchema, querystring: TabQuery },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tab } = request.query as { tab?: string };
      const activeTab = ['providers', 'models', 'capabilities', 'prompts'].includes(tab ?? '')
        ? tab!
        : 'providers';

      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.view('admin/llm.hbs', {
          pageTitle: 'LLM Configuration',
          currentPath: '/admin/llm',
          user: request.user,
          llmConnected: false,
          activeTab,
          agentSystemLockedFences: AGENT_SYSTEM_LOCKED_FENCES,
        });
      }

      let providers: Awaited<ReturnType<LLMClient['listProviders']>> = [];
      let models: Awaited<ReturnType<LLMClient['listModels']>> = [];
      let capabilities: Awaited<ReturnType<LLMClient['listCapabilities']>> = [];
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

      // Build prompts for all 5 capabilities (+ 'agent-system' prompt id) with split-region segment data.
      //
      // TODO(phase-33): import CAPABILITY_NAMES from '@luqen/llm/types' once the module's
      // ambient declaration is wired in dashboard package — see
      // .planning/phases/32-agent-service-chat-ui/32-PATTERNS.md "Resolved Ambiguities:
      // Capability-name list duplication".
      //
      // Phase 32-02 D-14: 'agent-system' is a PROMPT id (not a capability). It rides
      // the same prompt-editor surface as the 5 capability prompts so admins can
      // tune tone without touching RBAC/confirmation/honesty fences.
      const CAPABILITY_NAMES = [
        'extract-requirements',
        'generate-fix',
        'analyse-report',
        'discover-branding',
        'agent-conversation',
        'agent-system',
      ];
      const promptData = llmConnected
        ? await Promise.all(
            CAPABILITY_NAMES.map(async (cap) => {
              try {
                const [current, defaultPrompt] = await Promise.all([
                  llmClient.getPrompt(cap),
                  llmClient.getDefaultPrompt(cap),
                ]);
                const isCustom = current.isOverride ?? false;
                const defaultSegments = parsePromptSegments(defaultPrompt.template);

                let isStale = false;
                let segments: Array<{ type: string; name?: string; content?: string; index?: number; value?: string }>;

                if (!isCustom) {
                  // No override — use default editable segments as initial values
                  let editableIdx = 0;
                  segments = defaultSegments.map((seg) => {
                    if (seg.type === 'locked') {
                      return { type: 'locked', name: seg.name, content: seg.content };
                    }
                    return { type: 'editable', index: editableIdx++, value: seg.content };
                  });
                } else {
                  // Custom override — check for staleness
                  const overrideSegments = parsePromptSegments(current.template);
                  const expectedLockedNames = defaultSegments
                    .filter((s): s is PromptSegment & { type: 'locked'; name: string } => s.type === 'locked' && s.name != null)
                    .map((s) => s.name);
                  const overrideLockedNames = overrideSegments
                    .filter((s) => s.type === 'locked' && s.name != null)
                    .map((s) => s.name as string);
                  const missingLockNames = expectedLockedNames.filter((n) => !overrideLockedNames.includes(n));

                  if (missingLockNames.length > 0 && current.template.trim()) {
                    // Stale override: use whole override as first editable, default locked blocks shown read-only
                    isStale = true;
                    let editableIdx = 0;
                    segments = defaultSegments.map((seg) => {
                      if (seg.type === 'locked') {
                        return { type: 'locked', name: seg.name, content: seg.content };
                      }
                      // First editable slot gets the whole old override; remaining get default content
                      const val = editableIdx === 0 ? current.template : seg.content;
                      return { type: 'editable', index: editableIdx++, value: val };
                    });
                  } else {
                    // Non-stale custom override — extract editable values from override segments
                    const overrideEditables = overrideSegments
                      .filter((s) => s.type === 'editable')
                      .map((s) => s.content);
                    let editableIdx = 0;
                    segments = defaultSegments.map((seg) => {
                      if (seg.type === 'locked') {
                        return { type: 'locked', name: seg.name, content: seg.content };
                      }
                      const val = overrideEditables[editableIdx] ?? seg.content;
                      return { type: 'editable', index: editableIdx++, value: val };
                    });
                  }
                }

                return {
                  capability: cap,
                  isCustom,
                  isStale,
                  updatedAt: current.updatedAt ?? null,
                  segments,
                };
              } catch {
                return { capability: cap, isCustom: false, isStale: false, updatedAt: null, segments: [] };
              }
            }),
          )
        : [];

      // Phase 32 D-13 + AI-SPEC §4c.2.A — agent-conversation capability metadata.
      // `manifestSize` + `destructiveCount` are computed per-request against the
      // current admin's effective permissions, so the badge reflects THIS org's
      // visible tool manifest (UI-SPEC Surface 3 decision gate: per-org answer).
      const userId = (request.user as { id?: string } | undefined)?.id;
      const userRole = (request.user as { role?: string } | undefined)?.role ?? 'viewer';
      const orgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId;

      let agentConvMetadata: {
        supportsToolsRequired: boolean;
        iterationCap: number;
        manifestSize: number;
        destructiveCount: number;
        destructiveTools: readonly string[];
      } = {
        supportsToolsRequired: true,
        iterationCap: 5,
        manifestSize: 0,
        destructiveCount: 0,
        destructiveTools: [],
      };

      if (roleRepository && userId) {
        try {
          const permissions = await resolveEffectivePermissions(
            roleRepository,
            userId,
            userRole,
            orgId,
          );
          const allowedNames = new Set(filterToolsByRbac(DASHBOARD_TOOL_METADATA, permissions));
          const manifest = DASHBOARD_TOOL_METADATA.filter((t) => allowedNames.has(t.name));
          const destructiveTools = manifest.filter((t) => t.destructive === true).map((t) => t.name);
          agentConvMetadata = {
            supportsToolsRequired: true,
            iterationCap: 5,
            manifestSize: manifest.length,
            destructiveCount: destructiveTools.length,
            destructiveTools,
          };
        } catch {
          // Fall through to default (empty manifest) on permission-resolution failure —
          // admin UI must still render even if role repository is unavailable.
        }
      }

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
        agentConvMetadata,
        agentSystemLockedFences: AGENT_SYSTEM_LOCKED_FENCES,
      });
    },
  );

  // ── POST /admin/llm/providers — create provider ───────────────────────────

  server.post(
    '/admin/llm/providers',
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: HtmlPartialResponse,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: IdParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      try {
        const result = await llmClient.testProvider(request.params.id);
        const msg = result.ok ? 'Connection successful' : 'Connection failed';
        const type = result.ok ? 'success' : 'error';
        const badgeClass = result.ok ? 'badge--success' : 'badge--error';
        const badgeLabel = result.ok ? 'Active' : 'Error';
        const oob = `<template><td data-label="Status" id="provider-status-${escapeHtml(request.params.id)}" hx-swap-oob="true"><span class="badge ${badgeClass}">${badgeLabel}</span></td></template>`;
        return reply
          .header('content-type', 'text/html')
          .send(toastHtml(msg, type) + oob);
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { querystring: ProviderQuery, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: IdParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: IdParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: HtmlPartialResponse,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: IdParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: NameParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: NameModelParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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

  // ── POST /admin/llm/capabilities/:name/priority/:modelId — update priority ─

  server.post<{ Params: { name: string; modelId: string } }>(
    '/admin/llm/capabilities/:name/priority/:modelId',
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: NameModelParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(toastHtml('LLM not configured', 'error'));
      }
      const { name, modelId } = request.params;
      const body = request.body as { priority?: string };
      const priority = parseInt(body.priority ?? '0', 10);

      try {
        await llmClient.updateCapabilityPriority(name, modelId, priority);
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/llm?tab=capabilities')
          .send(toastHtml(`Priority updated to ${priority}`, 'success'));
      } catch (err) {
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(err instanceof Error ? err.message : 'Failed', 'error'),
        );
      }
    },
  );

  // ── PUT /admin/llm/prompts/:capability — save prompt override ─────────────

  server.put<{ Params: { capability: string }; Body: Record<string, string> }>(
    '/admin/llm/prompts/:capability',
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: CapabilityParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }

      // Collect ordered form values: segment[0], segment[1], ...
      const body = request.body as Record<string, string>;
      const editableValues: string[] = [];
      for (let i = 0; ; i++) {
        const key = `segment[${i}]`;
        if (body[key] == null) break;
        editableValues.push(body[key]);
      }
      const isMigrate = body['_migrate'] === '1';

      try {
        const defaultPrompt = await llmClient.getDefaultPrompt(request.params.capability);
        const defaultSegments = parsePromptSegments(defaultPrompt.template);
        const editableCount = defaultSegments.filter((s) => s.type === 'editable').length;

        let finalEditables = editableValues;

        if (isMigrate) {
          // Stale override migration: pad or trim submitted values to match editable slot count,
          // using the default's editable contents as filler for any missing slots.
          const defaultEditables = defaultSegments
            .filter((s): s is PromptSegment & { type: 'editable' } => s.type === 'editable')
            .map((s) => s.content);
          finalEditables = Array.from({ length: editableCount }, (_, i) =>
            editableValues[i] ?? defaultEditables[i] ?? '',
          );
        } else if (editableValues.length !== editableCount) {
          return reply.code(400).header('content-type', 'text/html').send(
            toastHtml("Form segments don't match the template. Reload the page and try again.", 'error'),
          );
        }

        const fullTemplate = assembleTemplate({ defaultSegments, editableValues: finalEditables });
        await llmClient.setPrompt(request.params.capability, fullTemplate);
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/llm?tab=prompts')
          .send(toastHtml('Prompt saved', 'success'));
      } catch (err) {
        if (err instanceof LLMValidationError) {
          const cap = request.params.capability;
          const names = err.violations.map((v) => `'${escapeHtml(v.name)}'`).join(', ');
          const prefix = `Cannot save: locked section ${names} was modified.`;
          // Prefer the per-violation explanation forwarded by the LLM service;
          // fall back to the generic hint.
          const firstViolation = err.violations[0];
          const hint = (firstViolation?.explanation && firstViolation.explanation.length > 0)
            ? firstViolation.explanation
            : 'This section defines the required output format — the capability engine cannot parse responses without it.';
          const resetLabel = 'Reset to default';
          // Build the toast HTML inline — toastHtml() only accepts a plain string.
          // NOTE: /reset-confirm endpoint is added by plan 13-03 (same phase, wave 3).
          // By the time this feature is deployed, the URL will be valid.
          const toast =
            `<div id="toast-container" hx-swap-oob="innerHTML" role="region" aria-label="Notifications" aria-live="polite">` +
            `<div class="toast toast--error" role="alert">` +
            `<p>${prefix}</p>` +
            `<p>${escapeHtml(hint)}</p>` +
            `<button type="button" class="btn btn--link" ` +
            `hx-get="/admin/llm/prompts/${encodeURIComponent(cap)}/reset-confirm" ` +
            `hx-target="#modal-container">${escapeHtml(resetLabel)}</button>` +
            `</div></div>`;
          return reply.code(422).header('content-type', 'text/html').send(toast);
        }
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
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: CapabilityParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
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

  // ── GET /admin/llm/prompts/:capability/diff — compare modal ──────────────

  const VALID_CAPABILITIES = ['extract-requirements', 'generate-fix', 'analyse-report', 'discover-branding'];

  server.get<{ Params: { capability: string } }>(
    '/admin/llm/prompts/:capability/diff',
    {
      preHandler: requirePermission('admin.system', 'llm.view'),
      schema: { params: CapabilityParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }
      const { capability } = request.params;
      if (!VALID_CAPABILITIES.includes(capability)) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Invalid capability', 'error'),
        );
      }
      try {
        const [current, def] = await Promise.all([
          llmClient.getPrompt(capability),
          llmClient.getDefaultPrompt(capability),
        ]);
        const diffLines = computePromptDiff(def.template, current.template);
        return reply.view('admin/partials/prompt-diff-modal.hbs', {
          capability,
          diffLines,
          isOverride: current.isOverride ?? false,
          layout: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Diff failed: ${msg}`, 'error'),
        );
      }
    },
  );

  // ── GET /admin/llm/prompts/:capability/reset-confirm — reset confirmation modal ─

  server.get<{ Params: { capability: string } }>(
    '/admin/llm/prompts/:capability/reset-confirm',
    {
      preHandler: requirePermission('admin.system', 'llm.manage'),
      schema: { params: CapabilityParams, ...HtmlPartialResponse },
    },
    async (request, reply) => {
      const llmClient = getLLMClient();
      if (!llmClient) {
        return reply.code(503).header('content-type', 'text/html').send(
          toastHtml('LLM service not configured', 'error'),
        );
      }
      const { capability } = request.params;
      if (!VALID_CAPABILITIES.includes(capability)) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Invalid capability', 'error'),
        );
      }
      try {
        const [current, def] = await Promise.all([
          llmClient.getPrompt(capability),
          llmClient.getDefaultPrompt(capability),
        ]);
        const diffLines = computePromptDiff(def.template, current.template);
        return reply.view('admin/partials/prompt-reset-modal.hbs', {
          capability,
          diffLines,
          isOverride: current.isOverride ?? false,
          layout: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).header('content-type', 'text/html').send(
          toastHtml(`Reset confirm failed: ${msg}`, 'error'),
        );
      }
    },
  );
}
