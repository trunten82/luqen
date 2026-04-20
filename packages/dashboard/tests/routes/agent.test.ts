/**
 * Phase 32 Plan 04 Task 4 (RED) — /agent/* route tests.
 *
 * Covers the five routes exposed by registerAgentRoutes:
 *   POST /agent/message           — HTMX form POST, persists user message + 202
 *   GET  /agent/stream/:id        — SSE, runs AgentService.runTurn
 *   POST /agent/confirm/:msgId    — pending_confirmation → sent
 *   POST /agent/deny/:msgId       — pending_confirmation → denied + synth tool result
 *   GET  /agent/panel             — HTMX drawer partial
 *
 * Plus cross-cutting:
 *   - Rate-limit onSend hook rewrites 429 to JSON (feedback_rate_limiter.md)
 *   - /agent/stream rejects mismatched Origin (T-32-04-14)
 *   - CSRF preserves project convention
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import type { AgentService } from '../../src/agent/agent-service.js';
import type { ToolDispatcher } from '../../src/agent/tool-dispatch.js';

const PUBLIC_URL = 'https://dashboard.example.com';

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  userId: string;
  orgId: string;
  conversationId: string;
  runTurn: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  cleanup: () => Promise<void>;
}

async function buildCtx(
  overrides: { rateLimitMax?: number } = {},
): Promise<Ctx> {
  setEncryptionSalt('phase-32-04-agent-routes-salt');
  const dbPath = join(tmpdir(), `test-agent-routes-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());
  const org = await storage.organizations.createOrg({
    name: 'Org',
    slug: `o-${userId.slice(0, 6)}`,
  });
  const conv = await storage.conversations.createConversation({
    userId,
    orgId: org.id,
  });

  const runTurn = vi.fn(async (input: Parameters<AgentService['runTurn']>[0]) => {
    // Minimal happy-path simulation: emit a token + done, persist assistant msg.
    input.emit({ type: 'token', text: 'hello' });
    input.emit({ type: 'done' });
    await storage.conversations.appendMessage({
      conversationId: input.conversationId,
      role: 'assistant',
      content: 'hello',
      status: 'sent',
    });
  });
  const dispatch = vi.fn(async () => ({ ok: true }));

  const agentService = { runTurn } as unknown as AgentService;
  const dispatcher = { dispatch } as unknown as ToolDispatcher;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  // Inject authenticated user for every request (test substitute for the
  // production authGuard + session preHandler).
  let authed = true;
  server.addHook('preHandler', async (request, reply) => {
    if (!authed) {
      await reply.code(401).send({ error: 'unauth' });
      return;
    }
    request.user = {
      id: userId,
      username: 'tester',
      role: 'viewer',
      currentOrgId: org.id,
    };
  });

  // Toggle auth on the fly by reading a header — individual tests can send
  // `x-test-unauth: 1` to trigger the 401 path.
  server.addHook('preHandler', async (request) => {
    if (request.headers['x-test-unauth'] === '1') authed = false;
    else authed = true;
  });

  await registerAgentRoutes(server, {
    agentService,
    dispatcher,
    storage,
    publicUrl: PUBLIC_URL,
    rateLimit: { max: overrides.rateLimitMax ?? 60, timeWindow: '1 minute' },
  });
  await server.ready();

  return {
    server,
    storage,
    userId,
    orgId: org.id,
    conversationId: conv.id,
    runTurn,
    dispatch,
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

describe('/agent/* routes', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildCtx();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('Test 1: POST /agent/message without auth returns 401', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: { conversationId: ctx.conversationId, content: 'hi' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Test 2: POST /agent/message with auth persists a user row + returns 202', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: { conversationId: ctx.conversationId, content: 'hello there' },
    });
    expect(res.statusCode).toBe(202);
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const userRow = window.find((m) => m.role === 'user' && m.content === 'hello there');
    expect(userRow).toBeDefined();
  });

  it('Test 3: GET /agent/stream/:id sets SSE headers and invokes AgentService.runTurn', async () => {
    // Seed a user message to drive the turn.
    await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'user',
      content: 'what are my reports?',
      status: 'sent',
    });

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/stream/${ctx.conversationId}`,
      headers: { accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/event-stream/);
    expect(ctx.runTurn).toHaveBeenCalledTimes(1);
    // The body should contain the 'token' + 'done' SSE events emitted by the stub.
    expect(res.body).toContain('event: token');
    expect(res.body).toContain('event: done');
  });

  it('Test 4: rate-limit returns JSON 429 {error:rate_limited, retry_after_ms}', async () => {
    await ctx.cleanup();
    ctx = await buildCtx({ rateLimitMax: 2 });
    // Fire 3 requests — the third should trip the rate limit.
    await ctx.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: { conversationId: ctx.conversationId, content: 'a' },
    });
    await ctx.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: { conversationId: ctx.conversationId, content: 'b' },
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: { conversationId: ctx.conversationId, content: 'c' },
    });
    expect(res.statusCode).toBe(429);
    expect(String(res.headers['content-type'])).toMatch(/application\/json/);
    const body = res.json() as { error: string; retry_after_ms: number };
    expect(body.error).toBe('rate_limited');
    expect(typeof body.retry_after_ms).toBe('number');
    expect(body.retry_after_ms).toBeGreaterThan(0);
  });

  it('Test 5: /agent/stream rejects mismatched Origin with 403 origin_mismatch', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/stream/${ctx.conversationId}`,
      headers: {
        accept: 'text/event-stream',
        origin: 'https://evil.example.com',
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string };
    expect(body.error).toBe('origin_mismatch');

    // Same-origin request passes.
    const ok = await ctx.server.inject({
      method: 'GET',
      url: `/agent/stream/${ctx.conversationId}`,
      headers: {
        accept: 'text/event-stream',
        origin: PUBLIC_URL,
      },
    });
    expect(ok.statusCode).toBe(200);

    // No-Origin EventSource passes.
    const noOrigin = await ctx.server.inject({
      method: 'GET',
      url: `/agent/stream/${ctx.conversationId}`,
      headers: { accept: 'text/event-stream' },
    });
    expect(noOrigin.statusCode).toBe(200);
  });

  it('Test 6: POST /agent/confirm/:messageId transitions pending_confirmation → sent + calls dispatcher', async () => {
    // Seed a pending tool row.
    const pending = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 't1',
        name: 'dashboard_scan_site',
        args: { siteUrl: 'https://ex.com' },
      }),
    });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/confirm/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([200, 202, 204]).toContain(res.statusCode);
    expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    const history = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    const pendingAfter = history.find((m) => m.id === pending.id);
    expect(pendingAfter?.status).toBe('sent');
  });

  it('Test 7: POST /agent/deny/:messageId transitions status=denied and writes user_denied tool result', async () => {
    const pending = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 't1',
        name: 'dashboard_scan_site',
        args: { siteUrl: 'https://ex.com' },
      }),
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/deny/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([200, 202, 204]).toContain(res.statusCode);
    const history = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    const pendingAfter = history.find((m) => m.id === pending.id);
    expect(pendingAfter?.status).toBe('denied');
    // A synthetic tool result row representing the denial should exist.
    const denialRow = history.find(
      (m) =>
        m.role === 'tool' &&
        m.id !== pending.id &&
        typeof m.toolResultJson === 'string' &&
        m.toolResultJson.includes('user_denied'),
    );
    expect(denialRow).toBeDefined();
  });

  it('Test 8: GET /agent/panel with auth returns HTML', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/panel',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/text\/html/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
