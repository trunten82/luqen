import { describe, it, expect } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { brandingGuidelineRoutes } from '../../../src/routes/admin/branding-guidelines.js';
import { loadTranslations } from '../../../src/i18n/index.js';
import type { LLMClient } from '../../../src/llm-client.js';

loadTranslations();

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(getLLMClient: () => LLMClient | null): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-branding-discover-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'test-org' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['branding.manage', 'branding.view']);
  });

  await brandingGuidelineRoutes(server, storage, getLLMClient);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

function makeMockLlmClient(
  discoverBranding: LLMClient['discoverBranding'],
): LLMClient {
  return {
    baseUrl: 'https://llm.example.com',
    discoverBranding,
    destroy: () => {},
  } as unknown as LLMClient;
}

describe('POST /admin/branding-guidelines/:id/discover-branding — diagnostics-aware toasts', () => {
  it('shows the bot-protection message (not "try a different URL") when diagnostics.kind is bot-protected', async () => {
    const mockLlm = makeMockLlmClient(async () => ({
      colors: [],
      fonts: [],
      logoUrl: '',
      brandName: '',
      description: '',
      diagnostics: { kind: 'bot-protected' },
    }));
    const ctx = await createTestServer(() => mockLlm);

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({ id: guidelineId, orgId: 'test-org', name: 'Test Guideline' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/discover-branding`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `url=${encodeURIComponent('https://www.camparigroup.com')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('try a different URL');
    expect(response.body.toLowerCase()).toContain('bot');
  });

  it('shows a "could not reach" message with the detail when diagnostics.kind is fetch-failed', async () => {
    const mockLlm = makeMockLlmClient(async () => ({
      colors: [],
      fonts: [],
      logoUrl: '',
      brandName: '',
      description: '',
      diagnostics: { kind: 'fetch-failed', detail: 'ECONNREFUSED' },
    }));
    const ctx = await createTestServer(() => mockLlm);

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({ id: guidelineId, orgId: 'test-org', name: 'Test Guideline' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/discover-branding`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `url=${encodeURIComponent('https://example.com')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('ECONNREFUSED');
  });

  it('keeps the "No brand signals detected" message when diagnostics is absent or no-signals', async () => {
    const mockLlm = makeMockLlmClient(async () => ({
      colors: [],
      fonts: [],
      logoUrl: '',
      brandName: '',
      description: '',
    }));
    const ctx = await createTestServer(() => mockLlm);

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({ id: guidelineId, orgId: 'test-org', name: 'Test Guideline' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/discover-branding`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `url=${encodeURIComponent('https://example.com')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('No brand signals detected');
  });
});
