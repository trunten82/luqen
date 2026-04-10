/**
 * Integration tests for the diff modal and reset-confirm modal routes.
 *
 * GET /admin/llm/prompts/:capability/diff — Compare with default modal
 * GET /admin/llm/prompts/:capability/reset-confirm — Reset confirmation modal
 * DELETE /admin/llm/prompts/:capability — regression smoke
 * Permission boundary: /diff requires llm.view, /reset-confirm requires llm.manage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { registerSession } from '../../../src/auth/session.js';
import { llmAdminRoutes } from '../../../src/routes/admin/llm.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';
import type { LLMClient, LLMPrompt } from '../../../src/llm-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// ── Fixture templates ─────────────────────────────────────────────────────────

// Default has two lines, override changed one
const DEFAULT_TEMPLATE =
  'intro\n<!-- LOCKED:output-format -->locked<!-- /LOCKED -->\ntail\n';

const OVERRIDE_TEMPLATE =
  'intro\n<!-- LOCKED:output-format -->locked<!-- /LOCKED -->\nchanged\n';

const makeLLMPrompt = (overrides: Partial<LLMPrompt> = {}): LLMPrompt => ({
  capability: 'generate-fix',
  template: DEFAULT_TEMPLATE,
  isOverride: false,
  updatedAt: undefined,
  ...overrides,
});

// ── Mock client factory ───────────────────────────────────────────────────────

function makeMockClient(overrides: {
  getPromptFn?: () => Promise<LLMPrompt>;
  getDefaultPromptFn?: () => Promise<LLMPrompt>;
  deletePromptFn?: () => Promise<void>;
} = {}): LLMClient {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
    listProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue([]),
    listCapabilities: vi.fn().mockResolvedValue([]),
    getPrompt: overrides.getPromptFn ?? vi.fn().mockResolvedValue(makeLLMPrompt()),
    getDefaultPrompt: overrides.getDefaultPromptFn ?? vi.fn().mockResolvedValue(makeLLMPrompt()),
    setPrompt: vi.fn().mockResolvedValue(makeLLMPrompt({ isOverride: true })),
    deletePrompt: overrides.deletePromptFn ?? vi.fn().mockResolvedValue(undefined),
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

// ── Server factory ────────────────────────────────────────────────────────────

async function createTestServer(
  client: LLMClient | null,
  permissionIds: readonly string[] = ALL_PERMISSION_IDS,
): Promise<{ server: FastifyInstance; cleanup: () => void }> {
  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub view — echoes template + data as JSON for assertions
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
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissionIds);
  });

  await llmAdminRoutes(server, () => client);
  await server.ready();

  return { server, cleanup: () => { void server.close(); } };
}

// ── GET /diff tests ───────────────────────────────────────────────────────────

describe('GET /admin/llm/prompts/:capability/diff', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  afterEach(() => ctx.cleanup());

  it('renders diff modal with add/remove/context lines when override differs from default', async () => {
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: OVERRIDE_TEMPLATE, isOverride: true }),
      ),
      getDefaultPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: DEFAULT_TEMPLATE }),
      ),
    });
    ctx = await createTestServer(client);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/diff',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { template: string; data: { capability: string; diffLines: Array<{ type: string; text: string }>; isOverride: boolean } };
    expect(body.template).toBe('admin/partials/prompt-diff-modal.hbs');
    expect(body.data.capability).toBe('generate-fix');
    // Should have lines with type 'add', 'remove', 'context'
    const types = body.data.diffLines.map((l) => l.type);
    expect(types).toContain('context');
    // 'tail' in default was replaced by 'changed' in override
    const addTexts = body.data.diffLines.filter((l) => l.type === 'add').map((l) => l.text);
    const removeTexts = body.data.diffLines.filter((l) => l.type === 'remove').map((l) => l.text);
    expect(addTexts).toContain('changed');
    expect(removeTexts).toContain('tail');
  });

  it('shows no-differences state when prompt matches the default', async () => {
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt({ isOverride: false })),
      getDefaultPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt()),
    });
    ctx = await createTestServer(client);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/diff',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { diffLines: Array<{ type: string }> } };
    // All lines should be context (no diffs)
    for (const line of body.data.diffLines) {
      expect(line.type).toBe('context');
    }
  });

  it('returns 400 when capability is not one of the four valid names', async () => {
    ctx = await createTestServer(makeMockClient());

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/invalid-name/diff',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid capability');
  });

  it('returns 503 when LLM client is not configured', async () => {
    ctx = await createTestServer(null);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/diff',
    });

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('not configured');
  });
});

// ── GET /reset-confirm tests ──────────────────────────────────────────────────

describe('GET /admin/llm/prompts/:capability/reset-confirm', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  afterEach(() => ctx.cleanup());

  it('renders reset modal with destructive button when prompt has override', async () => {
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: OVERRIDE_TEMPLATE, isOverride: true }),
      ),
      getDefaultPromptFn: vi.fn().mockResolvedValue(
        makeLLMPrompt({ template: DEFAULT_TEMPLATE }),
      ),
    });
    ctx = await createTestServer(client);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/reset-confirm',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      template: string;
      data: {
        capability: string;
        diffLines: Array<{ type: string; text: string }>;
        isOverride: boolean;
      };
    };
    expect(body.template).toBe('admin/partials/prompt-reset-modal.hbs');
    expect(body.data.capability).toBe('generate-fix');
    expect(body.data.isOverride).toBe(true);
    // Diff lines should reflect the difference
    const addTexts = body.data.diffLines.filter((l) => l.type === 'add').map((l) => l.text);
    expect(addTexts).toContain('changed');
  });

  it('renders nothing-to-reset state when prompt is using the default', async () => {
    const client = makeMockClient({
      getPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt({ isOverride: false })),
      getDefaultPromptFn: vi.fn().mockResolvedValue(makeLLMPrompt()),
    });
    ctx = await createTestServer(client);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/reset-confirm',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { isOverride: boolean } };
    expect(body.data.isOverride).toBe(false);
  });

  it('returns 400 for an invalid capability name', async () => {
    ctx = await createTestServer(makeMockClient());

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/unknown-cap/reset-confirm',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid capability');
  });

  it('returns 503 when LLM client is not configured', async () => {
    ctx = await createTestServer(null);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/reset-confirm',
    });

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('not configured');
  });
});

// ── Permission boundary tests ─────────────────────────────────────────────────

describe('Permission checks for diff and reset-confirm', () => {
  it('/diff (llm.view) is accessible with view-only permissions', async () => {
    // Build a permission set that has llm.view but not llm.manage
    const viewOnlyPerms = ALL_PERMISSION_IDS.filter((p) => p !== 'llm.manage');
    const client = makeMockClient();
    const ctx = await createTestServer(client, viewOnlyPerms);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/diff',
    });

    ctx.cleanup();
    expect(res.statusCode).toBe(200);
  });

  it('/reset-confirm requires llm.manage — returns 403 with only llm.view permission', async () => {
    // Only llm.view (not admin.system, not llm.manage) — requirePermission checks ANY of its args
    const viewOnlyPerms = ['llm.view'];
    const client = makeMockClient();
    const ctx = await createTestServer(client, viewOnlyPerms);

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/llm/prompts/generate-fix/reset-confirm',
    });

    ctx.cleanup();
    expect(res.statusCode).toBe(403);
  });
});

// ── Regression smoke: existing DELETE route ───────────────────────────────────

describe('DELETE /admin/llm/prompts/:capability — regression smoke', () => {
  it('returns HX-Redirect to prompts tab on success', async () => {
    const client = makeMockClient({
      deletePromptFn: vi.fn().mockResolvedValue(undefined),
    });
    const ctx = await createTestServer(client);

    const res = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/llm/prompts/generate-fix',
    });

    ctx.cleanup();
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/admin/llm?tab=prompts');
    expect(res.body).toContain('reset to default');
  });
});
