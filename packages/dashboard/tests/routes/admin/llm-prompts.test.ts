/**
 * Integration tests for the LLM admin prompt editor routes.
 *
 * Tests the split-region editor render, save (normal + migrate), 422 error toast,
 * stale detection, and segment count mismatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { registerSession } from '../../../src/auth/session.js';
import { llmAdminRoutes } from '../../../src/routes/admin/llm.js';
import { LLMValidationError } from '../../../src/llm-client.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';
import type { LLMClient, LLMPrompt } from '../../../src/llm-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// ── Minimal fixture templates ────────────────────────────────────────────────

const SIMPLE_DEFAULT =
  'intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->tail';

const MULTI_EDITABLE_DEFAULT =
  'A<!-- LOCKED:output-format -->L<!-- /LOCKED -->B<!-- LOCKED:variable-injection -->V<!-- /LOCKED -->C';

const makeLLMPrompt = (overrides: Partial<LLMPrompt> = {}): LLMPrompt => ({
  capability: 'generate-fix',
  template: SIMPLE_DEFAULT,
  isOverride: false,
  updatedAt: undefined,
  ...overrides,
});

// ── Mock LLMClient factory ───────────────────────────────────────────────────

function makeMockClient(overrides: {
  getPromptFn?: () => Promise<LLMPrompt>;
  getDefaultPromptFn?: () => Promise<LLMPrompt>;
  setPromptFn?: (cap: string, template: string) => Promise<LLMPrompt>;
  healthFn?: () => Promise<{ status: string }>;
  listProvidersFn?: () => Promise<[]>;
  listModelsFn?: () => Promise<[]>;
  listCapabilitiesFn?: () => Promise<[]>;
} = {}): LLMClient {
  const mock = {
    health: overrides.healthFn ?? vi.fn().mockResolvedValue({ status: 'ok' }),
    listProviders: overrides.listProvidersFn ?? vi.fn().mockResolvedValue([]),
    listModels: overrides.listModelsFn ?? vi.fn().mockResolvedValue([]),
    listCapabilities: overrides.listCapabilitiesFn ?? vi.fn().mockResolvedValue([]),
    getPrompt: overrides.getPromptFn ?? vi.fn().mockResolvedValue(makeLLMPrompt()),
    getDefaultPrompt: overrides.getDefaultPromptFn ?? vi.fn().mockResolvedValue(makeLLMPrompt()),
    setPrompt: overrides.setPromptFn ?? vi.fn().mockResolvedValue(makeLLMPrompt({ isOverride: true })),
    deletePrompt: vi.fn().mockResolvedValue(undefined),
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
  return mock;
}

// ── Test server factory ──────────────────────────────────────────────────────

async function createTestServer(client: LLMClient | null = null): Promise<{
  server: FastifyInstance;
  cleanup: () => void;
}> {
  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub view — returns template + data as JSON for assertions on GET
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

  const getLLMClient = (): LLMClient | null => client;
  await llmAdminRoutes(server, getLLMClient);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/llm?tab=prompts — split-region editor render', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt()),
      getDefaultPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt()),
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('renders 6 capability prompt cards in the view data (includes Phase 32 agent-conversation + agent-system)', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { prompts: Array<{ capability: string; segments: unknown[] }> } };
    // Phase 32-05: extended from 4 → 6 (agent-conversation + agent-system prompt-id)
    expect(body.data.prompts).toHaveLength(6);
    const caps = body.data.prompts.map((p) => p.capability);
    expect(caps).toContain('generate-fix');
    expect(caps).toContain('analyse-report');
    expect(caps).toContain('discover-branding');
    expect(caps).toContain('extract-requirements');
    expect(caps).toContain('agent-conversation');
    expect(caps).toContain('agent-system');
  });

  it('includes segment data with at least one editable segment per capability', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: { prompts: Array<{ segments: Array<{ type: string; index?: number }> }> } };
    for (const prompt of body.data.prompts) {
      const editables = prompt.segments.filter((s) => s.type === 'editable');
      expect(editables.length).toBeGreaterThan(0);
    }
  });

  it('sets isStale=false for non-custom prompts', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: { prompts: Array<{ isStale: boolean; isOverride: boolean }> } };
    for (const prompt of body.data.prompts) {
      expect(prompt.isStale).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/llm?tab=prompts — stale override detection', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;
  const capturedTemplates: string[] = [];

  beforeEach(async () => {
    capturedTemplates.length = 0;
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ isOverride: true, template: 'plain old override no fences' }),
      ),
      getDefaultPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: SIMPLE_DEFAULT }),
      ),
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('sets isStale=true when override is missing locked blocks', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: { prompts: Array<{ capability: string; isStale: boolean; segments: Array<{ type: string; value?: string }> }> } };
    const gf = body.data.prompts.find((p) => p.capability === 'generate-fix')!;
    expect(gf.isStale).toBe(true);
  });

  it('pre-fills first editable textarea with old override text when stale', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm?tab=prompts' });
    const body = res.json() as { data: { prompts: Array<{ capability: string; segments: Array<{ type: string; value?: string; index?: number }> }> } };
    const gf = body.data.prompts.find((p) => p.capability === 'generate-fix')!;
    const firstEditable = gf.segments.find((s) => s.type === 'editable' && s.index === 0);
    expect(firstEditable?.value).toBe('plain old override no fences');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/llm/prompts/:capability — save valid reassembled template', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;
  let capturedTemplate = '';
  let mockSetPrompt: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    capturedTemplate = '';
    mockSetPrompt = vi.fn().mockImplementation((_cap: string, tpl: string) => {
      capturedTemplate = tpl;
      return Promise.resolve(makeLLMPrompt({ isOverride: true, template: tpl }));
    });
    const client = makeMockClient({
      getDefaultPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt({ template: SIMPLE_DEFAULT })),
      setPromptFn: mockSetPrompt,
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('assembles template with locked block from default and editable values from form', async () => {
    // SIMPLE_DEFAULT = 'intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->tail'
    // 2 editable slots: segment[0]=intro portion, segment[1]=tail portion
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=newIntro&segment%5B1%5D=newTail',
    });

    expect(mockSetPrompt).toHaveBeenCalledOnce();
    expect(capturedTemplate).toBe(
      'newIntro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->newTail',
    );
    expect(res.headers['hx-redirect']).toBe('/admin/llm?tab=prompts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/llm/prompts/:capability — 422 from LLM service', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    const err = new LLMValidationError('Validation failed', [
      {
        name: 'output-format',
        reason: 'missing',
        explanation: 'This section defines the required JSON response schema.',
      },
    ]);
    const client = makeMockClient({
      getDefaultPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt({ template: SIMPLE_DEFAULT })),
      setPromptFn: vi.fn().mockRejectedValue(err),
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('returns 422 status', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=a&segment%5B1%5D=b',
    });
    expect(res.statusCode).toBe(422);
  });

  it('toast names the violated section', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=a&segment%5B1%5D=b',
    });
    expect(res.body).toContain("'output-format'");
  });

  it('toast contains the explanation text', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=a&segment%5B1%5D=b',
    });
    const html = res.body;
    const hasExplanation =
      html.includes('JSON response schema') || html.includes('capability engine');
    expect(hasExplanation).toBe(true);
  });

  it('toast contains reset-to-default control (reset-confirm href or Reset text)', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=a&segment%5B1%5D=b',
    });
    const html = res.body;
    const hasResetControl =
      html.includes('/reset-confirm') ||
      html.toLowerCase().includes('reset to default');
    expect(hasResetControl).toBe(true);
  });

  it('toast does NOT contain a migrate button', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=a&segment%5B1%5D=b',
    });
    expect(res.body.includes('name="_migrate"')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/llm/prompts/:capability — segment count mismatch', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  beforeEach(async () => {
    // Default has 2 editable slots (3 editables: A, B, C and 2 locked: output-format, variable-injection)
    const client = makeMockClient({
      getDefaultPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: MULTI_EDITABLE_DEFAULT }),
      ),
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('returns 400 when only 1 segment submitted for 3-editable template', async () => {
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=only-one',
    });
    expect(res.statusCode).toBe(400);
    // The response body has HTML-encoded apostrophe (&#39;) — check for the surrounding word
    expect(res.body.toLowerCase()).toContain('match the template');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /admin/llm/prompts/:capability — migrate stale override', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;
  let capturedTemplate = '';
  let mockSetPrompt: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    capturedTemplate = '';
    mockSetPrompt = vi.fn().mockImplementation((_cap: string, tpl: string) => {
      capturedTemplate = tpl;
      return Promise.resolve(makeLLMPrompt({ isOverride: true, template: tpl }));
    });
    const client = makeMockClient({
      getDefaultPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: SIMPLE_DEFAULT }),
      ),
      setPromptFn: mockSetPrompt,
    });
    ctx = await createTestServer(client);
  });

  afterEach(() => ctx.cleanup());

  it('assembles template with old override text + default locked block when _migrate=1', async () => {
    // SIMPLE_DEFAULT has 2 editables: 'intro' and 'tail'
    // With _migrate=1, segment[0]='my old text' and the second editable gets default 'tail'
    const res = await ctx.server.inject({
      method: 'PUT',
      url: '/admin/llm/prompts/generate-fix',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'segment%5B0%5D=my+old+text&_migrate=1',
    });

    expect(mockSetPrompt).toHaveBeenCalledOnce();
    // Template must contain BOTH the old override text AND the default locked block
    expect(capturedTemplate).toContain('my old text');
    expect(capturedTemplate).toContain('<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->');
    expect(res.headers['hx-redirect']).toBe('/admin/llm?tab=prompts');
  });
});
