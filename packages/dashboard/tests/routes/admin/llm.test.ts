/**
 * Phase 32-05 — /admin/llm template-data assertions for the new agent surfaces.
 *
 * Following the existing llm-prompts.test.ts pattern, `reply.view` is stubbed to
 * return JSON of `{ template, data }` so assertions run against the view data
 * bag (equivalent proof that the Handlebars template will render the expected
 * surfaces, without pulling in the Handlebars engine itself).
 *
 * Surfaces covered (UI-SPEC Surface 3, 4, 5 Part C):
 *   - Capabilities tab exposes agent-conversation capability + agentConvMetadata
 *   - Prompts tab exposes agent-system entry + agentSystemLockedFences
 *   - Models tab iterates providers (regression check — Anthropic row appears
 *     automatically once Plan 01 seeds the provider; skipped by default since
 *     this plan does not alter the registry seed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { registerSession } from '../../../src/auth/session.js';
import { llmAdminRoutes } from '../../../src/routes/admin/llm.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';
import type { LLMClient, LLMPrompt } from '../../../src/llm-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// Minimal default template — one editable + one locked fence.
const DEFAULT_TEMPLATE =
  'intro<!-- LOCKED:output-format -->FMT<!-- /LOCKED -->tail';

const makeLLMPrompt = (overrides: Partial<LLMPrompt> = {}): LLMPrompt => ({
  capability: 'generate-fix',
  template: DEFAULT_TEMPLATE,
  isOverride: false,
  updatedAt: undefined,
  ...overrides,
});

function makeMockClient(overrides: {
  providers?: unknown[];
  capabilities?: unknown[];
} = {}): LLMClient {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
    listProviders: vi.fn().mockResolvedValue(overrides.providers ?? []),
    listModels: vi.fn().mockResolvedValue([]),
    listCapabilities: vi.fn().mockResolvedValue(overrides.capabilities ?? []),
    getPrompt: vi.fn().mockResolvedValue(makeLLMPrompt()),
    getDefaultPrompt: vi.fn().mockResolvedValue(makeLLMPrompt()),
    setPrompt: vi.fn(),
    deletePrompt: vi.fn(),
    listPrompts: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    testProvider: vi.fn(),
    listRemoteModels: vi.fn(),
    createModel: vi.fn(),
    deleteModel: vi.fn(),
    assignCapability: vi.fn(),
    unassignCapability: vi.fn(),
    updateCapabilityPriority: vi.fn(),
    generateFix: vi.fn(),
    analyseReport: vi.fn(),
    discoverBranding: vi.fn(),
    listOAuthClients: vi.fn(),
    createOAuthClient: vi.fn(),
    deleteOAuthClient: vi.fn(),
    status: vi.fn(),
    destroy: vi.fn(),
    get baseUrl() { return 'http://localhost:7100'; },
    getToken: vi.fn().mockResolvedValue(null),
  } as unknown as LLMClient;
}

async function createTestServer(client: LLMClient | null): Promise<{
  server: FastifyInstance;
  cleanup: () => void;
}> {
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role: 'admin' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(ALL_PERMISSION_IDS);
  });

  await llmAdminRoutes(server, () => client);
  await server.ready();

  return { server, cleanup: () => { void server.close(); } };
}

type LlmViewData = {
  activeTab: string;
  capabilities?: Array<{ name: string }>;
  prompts?: Array<{ capability: string; segments: Array<{ type: string; name?: string }> }>;
  agentConvMetadata?: {
    supportsToolsRequired: boolean;
    iterationCap: number;
    manifestSize: number;
    destructiveCount: number;
    destructiveTools: readonly string[];
  };
  agentSystemLockedFences?: Array<{ name: string; tooltipKey: string }>;
  modelsByProvider?: Array<{ name: string; type: string }>;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/llm?tab=capabilities — agent-conversation surface (Surface 3)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    const client = makeMockClient({
      capabilities: [
        { name: 'generate-fix', assignments: [] },
        { name: 'agent-conversation', assignments: [] },
      ],
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('Test A: capabilities list includes agent-conversation and tool-use metadata is present', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=capabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: LlmViewData };
    expect(body.data.activeTab).toBe('capabilities');
    const capNames = (body.data.capabilities ?? []).map((c) => c.name);
    expect(capNames).toContain('agent-conversation');
    expect(body.data.agentConvMetadata).toBeDefined();
    expect(body.data.agentConvMetadata?.supportsToolsRequired).toBe(true);
  });

  it('Test B: agent-conversation metadata includes iteration cap 5 + manifest/destructive counters', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=capabilities' });
    const body = res.json() as { data: LlmViewData };
    expect(body.data.agentConvMetadata?.iterationCap).toBe(5);
    expect(typeof body.data.agentConvMetadata?.manifestSize).toBe('number');
    expect(typeof body.data.agentConvMetadata?.destructiveCount).toBe('number');
    expect(Array.isArray(body.data.agentConvMetadata?.destructiveTools)).toBe(true);
  });
});

describe('GET /admin/llm?tab=prompts — agent-system surface (Surface 4)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    ctx = await createTestServer(makeMockClient());
  });

  afterEach(() => ctx.cleanup());

  it('Test C: prompts list contains agent-system alongside the 5 capability prompts', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: LlmViewData };
    const capabilities = (body.data.prompts ?? []).map((p) => p.capability);
    expect(capabilities).toContain('agent-system');
    expect(capabilities).toContain('agent-conversation');
    expect(capabilities).toContain('generate-fix');
  });

  it('Test D: agentSystemLockedFences is passed with rbac/confirmation/honesty entries + tooltip keys', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: LlmViewData };
    const fences = body.data.agentSystemLockedFences ?? [];
    const names = fences.map((f) => f.name);
    expect(names).toEqual(['rbac', 'confirmation', 'honesty']);
    for (const fence of fences) {
      expect(fence.tooltipKey).toMatch(/^admin\.llm\.prompts\.locked(Rbac|Confirm|Honesty)Tooltip$/);
    }
  });

  it('Test F (defence-in-depth): agent-system prompts row carries no per-org-override marker in view data', async () => {
    // The UI absence check is enforced at template level (prompts tab gates the
    // override pill on capability !== 'agent-system'). The route data itself
    // exposes no orgOverride flag for agent-system, so assertion here is
    // indirectly on the absence of such a field in the prompt entry.
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: LlmViewData & { prompts?: Array<Record<string, unknown>> } };
    const agentSystem = (body.data.prompts ?? []).find((p) => p['capability'] === 'agent-system');
    expect(agentSystem).toBeDefined();
    expect(agentSystem?.['orgOverride']).toBeUndefined();
    expect(agentSystem?.['perOrgOverride']).toBeUndefined();
  });
});

describe('GET /admin/llm?tab=models — Anthropic provider surface (Surface 5 Part C)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    // Simulate Plan 01 registry seed: providers list includes an anthropic row.
    const client = makeMockClient({
      providers: [
        {
          id: 'prov-anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          status: 'active',
        },
      ],
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('Test E: modelsByProvider surfaces the Anthropic provider row when present in registry', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=models' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: LlmViewData };
    const providerTypes = (body.data.modelsByProvider ?? []).map((p) => p.type);
    const providerNames = (body.data.modelsByProvider ?? []).map((p) => p.name);
    expect(providerTypes).toContain('anthropic');
    expect(providerNames).toContain('Anthropic');
  });
});
