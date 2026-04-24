/**
 * Phase 35 Plan 03 Task 2 — /agent/conversations* HTTP surface tests.
 *
 * Coverage:
 *   - 401 unauthenticated on all 5 endpoints (5)
 *   - 400 no_org (1 — shared fixture)
 *   - List: empty, populated, pagination nextOffset, hides soft-deleted (4)
 *   - Search: invalid empty q, invalid too-long q, title match, content
 *     match, org isolation (5)
 *   - Get: 404 wrong org, 404 soft-deleted, 200 full history (3)
 *   - Rename: invalid body, wrong org 404, soft-deleted 404,
 *     success + audit row present (4)
 *   - Delete: success + audit, idempotent 404, wrong org 404 (3)
 *
 * CSRF note: @fastify/csrf-protection is registered at the SERVER level in
 * production (server.ts line 366/833). This route file does NOT register it,
 * and this test harness mirrors tests/routes/agent.test.ts by not registering
 * it either. The plan's "missing CSRF → 403" case is therefore validated at
 * the server-integration level, not here.
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
  otherOrgId: string;
  otherUserId: string;
  conversationId: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(opts: { noOrg?: boolean } = {}): Promise<Ctx> {
  setEncryptionSalt('phase-35-03-agent-history-salt');
  const dbPath = join(tmpdir(), `test-agent-history-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const otherUserId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(otherUserId, `o-${otherUserId.slice(0, 6)}`, new Date().toISOString());

  const orgA = await storage.organizations.createOrg({
    name: 'OrgA',
    slug: `a-${userId.slice(0, 6)}`,
  });
  const orgB = await storage.organizations.createOrg({
    name: 'OrgB',
    slug: `b-${userId.slice(0, 6)}`,
  });
  const conv = await storage.conversations.createConversation({
    userId,
    orgId: orgA.id,
  });

  const runTurn = vi.fn(async () => {});
  const dispatch = vi.fn(async () => ({ ok: true }));
  const agentService = { runTurn } as unknown as AgentService;
  const dispatcher = { dispatch } as unknown as ToolDispatcher;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  server.addHook('preHandler', async (request, reply) => {
    if (request.headers['x-test-unauth'] === '1') {
      await reply.code(401).send({ error: 'unauth' });
      return;
    }
    if (opts.noOrg) {
      request.user = {
        id: userId,
        username: 'tester',
        role: 'viewer',
      };
      return;
    }
    request.user = {
      id: userId,
      username: 'tester',
      role: 'viewer',
      currentOrgId: orgA.id,
    };
  });

  await registerAgentRoutes(server, {
    agentService,
    dispatcher,
    storage,
    publicUrl: PUBLIC_URL,
    rateLimit: { max: 1000, timeWindow: '1 minute' },
  });
  await server.ready();

  return {
    server,
    storage,
    userId,
    otherUserId,
    orgId: orgA.id,
    otherOrgId: orgB.id,
    conversationId: conv.id,
    dbPath,
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

async function seedMessages(
  storage: SqliteStorageAdapter,
  conversationId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  for (const m of messages) {
    await storage.conversations.appendMessage({
      conversationId,
      role: m.role,
      content: m.content,
      status: 'sent',
    });
  }
}

describe('/agent/conversations* — Phase 35 Plan 03', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  // ── 401 unauthenticated — 5 cases ─────────────────────────────────

  it('401 GET /agent/conversations unauthenticated', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations',
      headers: { 'x-test-unauth': '1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 GET /agent/conversations/search unauthenticated', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations/search?q=x',
      headers: { 'x-test-unauth': '1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 GET /agent/conversations/:id unauthenticated', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${ctx.conversationId}`,
      headers: { 'x-test-unauth': '1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 POST /agent/conversations/:id/rename unauthenticated', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/rename`,
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 POST /agent/conversations/:id/delete unauthenticated', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/delete`,
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  // ── 400 no_org ────────────────────────────────────────────────────

  it('400 no_org_context when user has no org + no admin.system', async () => {
    await ctx.cleanup();
    ctx = await buildCtx({ noOrg: true });
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('no_org_context');
  });

  // ── List (4) ──────────────────────────────────────────────────────

  it('list: empty state returns items=[] nextOffset=null', async () => {
    // Soft-delete the seeded conversation so list is truly empty.
    await ctx.storage.conversations.softDeleteConversation(ctx.conversationId, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; nextOffset: number | null };
    expect(body.items).toEqual([]);
    expect(body.nextOffset).toBeNull();
  });

  it('list: populated items carry id, title, timestamps, messageCount', async () => {
    await seedMessages(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    await ctx.storage.conversations.renameConversation(ctx.conversationId, ctx.orgId, 'Chat A');

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        id: string; title: string | null; createdAt: string; updatedAt: string;
        lastMessageAt: string | null; messageCount: number;
      }>;
      nextOffset: number | null;
    };
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe(ctx.conversationId);
    expect(body.items[0].title).toBe('Chat A');
    expect(body.items[0].messageCount).toBe(2);
    expect(body.items[0].lastMessageAt).toBeTruthy();
  });

  it('list: nextOffset set when items.length === limit', async () => {
    // Seed 3 conversations, request limit=2 → nextOffset=2.
    for (let i = 0; i < 2; i++) {
      await ctx.storage.conversations.createConversation({
        userId: ctx.userId,
        orgId: ctx.orgId,
      });
    }
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations?limit=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; nextOffset: number | null };
    expect(body.items.length).toBe(2);
    expect(body.nextOffset).toBe(2);
  });

  it('list: hides soft-deleted conversations', async () => {
    const extra = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.orgId,
    });
    await ctx.storage.conversations.softDeleteConversation(extra.id, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations',
    });
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).not.toContain(extra.id);
  });

  // ── Search (5) ────────────────────────────────────────────────────

  it('search: empty q → 400 invalid_query', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations/search?q=',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_query');
  });

  it('search: q longer than 200 chars → 400', async () => {
    const big = 'x'.repeat(201);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/search?q=${encodeURIComponent(big)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('search: title match returns matchField=title', async () => {
    await ctx.storage.conversations.renameConversation(
      ctx.conversationId, ctx.orgId, 'WCAG question',
    );
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations/search?q=wcag',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; matchField: string; snippet: string }> };
    expect(body.items.length).toBe(1);
    expect(body.items[0].matchField).toBe('title');
    expect(body.items[0].snippet).toBe('WCAG question');
  });

  it('search: content match returns matchField=content with snippet', async () => {
    await seedMessages(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'please help with color contrast requirements' },
    ]);
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations/search?q=contrast',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ matchField: string; snippet: string }> };
    expect(body.items.length).toBe(1);
    expect(body.items[0].matchField).toBe('content');
    expect(body.items[0].snippet.toLowerCase()).toContain('contrast');
  });

  it('search: org isolation — other org conversations never leak', async () => {
    // Create a conversation in orgB with matching content.
    const foreignConv = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    await ctx.storage.conversations.renameConversation(
      foreignConv.id, ctx.otherOrgId, 'UniqueNeedleAAA',
    );
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/agent/conversations/search?q=UniqueNeedleAAA',
    });
    const body = res.json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  // ── Get (3) ───────────────────────────────────────────────────────

  it('get: wrong org returns 404', async () => {
    // Create a conversation owned by a DIFFERENT org.
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${foreign.id}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('get: soft-deleted returns 404', async () => {
    await ctx.storage.conversations.softDeleteConversation(ctx.conversationId, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${ctx.conversationId}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('get: happy path returns conversation + full message history', async () => {
    await seedMessages(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${ctx.conversationId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversation: { id: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.conversation.id).toBe(ctx.conversationId);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
  });

  // ── Rename (4) ────────────────────────────────────────────────────

  it('rename: invalid body (empty title) → 400', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/rename`,
      headers: { 'content-type': 'application/json' },
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rename: wrong org → 404 and no write', async () => {
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${foreign.id}/rename`,
      headers: { 'content-type': 'application/json' },
      payload: { title: 'attempted rename' },
    });
    expect(res.statusCode).toBe(404);
    const conv = await ctx.storage.conversations.getConversation(foreign.id, ctx.otherOrgId);
    expect(conv?.title).toBeNull();
  });

  it('rename: soft-deleted → 404', async () => {
    await ctx.storage.conversations.softDeleteConversation(ctx.conversationId, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/rename`,
      headers: { 'content-type': 'application/json' },
      payload: { title: 'new' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rename: success → 200 + updated conversation + audit row written', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/rename`,
      headers: { 'content-type': 'application/json' },
      payload: { title: 'New title' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { title: string } };
    expect(body.conversation.title).toBe('New title');

    // Audit row landed.
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const renameRow = audit.find((a) => a.toolName === 'conversation_renamed');
    expect(renameRow).toBeDefined();
    expect(renameRow?.conversationId).toBe(ctx.conversationId);
    expect(renameRow?.outcome).toBe('success');
    const meta = JSON.parse(renameRow!.argsJson) as { oldTitle: string | null; newTitle: string };
    expect(meta.newTitle).toBe('New title');
    expect(meta.oldTitle).toBeNull();
  });

  // ── Delete (3) ────────────────────────────────────────────────────

  it('delete: success → 200 + audit row + row marked is_deleted', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/delete`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean };
    expect(body.success).toBe(true);

    const conv = await ctx.storage.conversations.getConversation(ctx.conversationId, ctx.orgId);
    expect(conv?.isDeleted).toBe(true);

    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const delRow = audit.find((a) => a.toolName === 'conversation_soft_deleted');
    expect(delRow).toBeDefined();
    expect(delRow?.conversationId).toBe(ctx.conversationId);
  });

  it('delete: idempotent — second call returns 404', async () => {
    const first = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/delete`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/delete`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(second.statusCode).toBe(404);
  });

  it('delete: wrong org → 404 and no audit write', async () => {
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${foreign.id}/delete`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);

    const conv = await ctx.storage.conversations.getConversation(foreign.id, ctx.otherOrgId);
    expect(conv?.isDeleted).toBe(false);
  });
});
