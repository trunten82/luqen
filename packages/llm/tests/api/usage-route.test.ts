/**
 * Phase 72-03 — GET /api/v1/usage route.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { registerUsageRoutes } from '../../src/api/routes/usage.js';

let adapter: SqliteAdapter;
let dbPath: string;
let app: FastifyInstance;

// Bypass auth in tests by stubbing requireScope. The route registers
// `preHandler: requireScope('read')` but we monkey-patch the auth
// import at the Fastify level by injecting `request.auth` shape if
// needed — simplest path: wrap the app and skip the preHandler by
// registering our own handler. For now we test the underlying logic
// through the in-process Fastify instance with the real handler — the
// scope check fails (401) without a token, so we add a request decorator
// that pre-populates the auth context.

beforeEach(async () => {
  dbPath = join(tmpdir(), `llm-usage-route-${randomUUID()}.db`);
  adapter = new SqliteAdapter(dbPath);
  await adapter.initialize();
  app = Fastify();
  // Stub auth: inject a token-shape onto every request before route
  // handlers run. Without this the requireScope('read') preHandler
  // returns 401 because there's no bearer header.
  // Stub the requireScope preHandler input: requireScope() reads
  // request.tokenPayload (set by the auth middleware in production).
  // We inject a synthetic payload pre-handler so the scope check passes.
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tokenPayload: { scopes: string[]; orgId: string; sub: string } }).tokenPayload = {
      scopes: ['read', 'write', 'admin'],
      orgId: 'system',
      sub: 'test',
    };
  });
  await registerUsageRoutes(app, adapter);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await adapter.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

async function seed(): Promise<void> {
  await adapter.recordUsage({
    capability: 'generate-fix', orgId: 'org-a',
    providerId: 'p1', providerType: 'openai',
    modelId: 'm1', modelName: 'gpt-4o-mini',
    promptTokens: 100, completionTokens: 50, latencyMs: 500, status: 'ok',
  });
  await new Promise((r) => setTimeout(r, 3));
  await adapter.recordUsage({
    capability: 'analyse-report', orgId: 'org-a',
    providerId: 'p2', providerType: 'anthropic',
    modelId: 'm2', modelName: 'claude-3.5-sonnet',
    promptTokens: 200, completionTokens: 60, latencyMs: 800, status: 'ok',
  });
  await new Promise((r) => setTimeout(r, 3));
  await adapter.recordUsage({
    capability: 'generate-fix', orgId: 'org-b',
    providerId: 'p1', providerType: 'openai',
    modelId: 'm1', modelName: 'gpt-4o-mini',
    promptTokens: 80, completionTokens: 40, latencyMs: 400, status: 'error',
    errorClass: 'RateLimitError',
  });
}

describe('GET /api/v1/usage', () => {
  it('returns rows and totals envelope', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      rows: unknown[];
      totals: {
        callCount: number; okCount: number; errorCount: number;
        promptTokens: number; completionTokens: number; totalTokens: number;
        avgLatencyMs: number;
      };
    };
    expect(body.rows).toHaveLength(3);
    expect(body.totals.callCount).toBe(3);
    expect(body.totals.okCount).toBe(2);
    expect(body.totals.errorCount).toBe(1);
    expect(body.totals.promptTokens).toBe(380);
    expect(body.totals.completionTokens).toBe(150);
    expect(body.totals.totalTokens).toBe(530);
    expect(body.totals.avgLatencyMs).toBeGreaterThan(0);
  });

  it('filters by orgId', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage?orgId=org-a' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      rows: Array<{ orgId: string | null }>;
      totals: { callCount: number };
    };
    expect(body.totals.callCount).toBe(2);
    expect(body.rows.every((r) => r.orgId === 'org-a')).toBe(true);
  });

  it('filters by capability', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage?capability=generate-fix' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      rows: Array<{ capability: string }>;
      totals: { callCount: number };
    };
    expect(body.totals.callCount).toBe(2);
    expect(body.rows.every((r) => r.capability === 'generate-fix')).toBe(true);
  });

  it('rejects unknown capability with 400', async () => {
    await seed();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/usage?capability=not-a-real-capability',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('invalid_capability');
  });

  it('returns empty rows + zero totals when no data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      rows: unknown[];
      totals: { callCount: number; totalTokens: number; avgLatencyMs: number };
    };
    expect(body.rows).toHaveLength(0);
    expect(body.totals.callCount).toBe(0);
    expect(body.totals.totalTokens).toBe(0);
    expect(body.totals.avgLatencyMs).toBe(0);
  });
});
