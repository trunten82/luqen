/**
 * Phase 37 Plan 03 Task 2 — /agent/conversations/:cid/messages/:mid/{retry,edit-resend,share}.
 *
 * Coverage (≥18 cases — 6 per endpoint):
 *
 * Retry:
 *   - 401 unauthenticated
 *   - 400 no_org_context
 *   - 404 wrong_org
 *   - 400 not_most_recent_assistant
 *   - success: marks target superseded + audit row landed
 *   - idempotent: second call → 404 (target already superseded)
 *
 * Edit-resend:
 *   - 401 unauthenticated
 *   - 400 invalid body (empty content)
 *   - 404 wrong_org
 *   - 400 not_most_recent_user
 *   - success: prior user + assistant superseded, new user persisted, audit written
 *   - edge: edit-resend when no assistant reply exists yet → only user superseded
 *
 * Share:
 *   - 401 unauthenticated
 *   - 404 wrong_org
 *   - 400 mid is user role (not assistant)
 *   - 400 superseded message → 400 not assistant or 404
 *   - success: 201 + valid shareId + url
 *   - audit row appended on success
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
  conversationId: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(opts: { noOrg?: boolean } = {}): Promise<Ctx> {
  setEncryptionSalt('phase-37-03-actions-salt');
  const dbPath = join(tmpdir(), `test-agent-actions-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());

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
      request.user = { id: userId, username: 'tester', role: 'viewer' };
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

async function seedTurns(
  storage: SqliteStorageAdapter,
  conversationId: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const t of turns) {
    const m = await storage.conversations.appendMessage({
      conversationId,
      role: t.role,
      content: t.content,
      status: 'sent',
    });
    ids.push(m.id);
  }
  return ids;
}

describe('/agent/conversations/:cid/messages/:mid/* — Phase 37 Plan 03 Task 2', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  // ── RETRY (6) ──────────────────────────────────────────────────────

  it('retry: 401 unauthenticated', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('retry: 400 no_org_context when user has no org', async () => {
    await ctx.cleanup();
    ctx = await buildCtx({ noOrg: true });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/abc/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('no_org_context');
  });

  it('retry: 404 when conversation belongs to a different org', async () => {
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const fIds = await seedTurns(ctx.storage, foreign.id, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${foreign.id}/messages/${fIds[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('retry: 400 not_most_recent_assistant when target is not the latest assistant', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]);
    // Target the OLD assistant (ids[1]) — should fail.
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('not_most_recent_assistant');
  });

  it('retry: success → marks target superseded + audit row', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversationId: string; retried: boolean };
    expect(body.conversationId).toBe(ctx.conversationId);
    expect(body.retried).toBe(true);

    // Target message is superseded.
    const all = await ctx.storage.conversations.getMessagesIncludingSuperseded(
      ctx.conversationId, ctx.orgId,
    );
    const target = all.find((m) => m.id === ids[1]);
    expect(target?.status).toBe('superseded');

    // Audit row landed.
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const row = audit.find((a) => a.toolName === 'message_retried');
    expect(row).toBeDefined();
    expect(row?.conversationId).toBe(ctx.conversationId);
    const meta = JSON.parse(row!.argsJson) as { originalMessageId: string };
    expect(meta.originalMessageId).toBe(ids[1]);
  });

  it('retry: idempotent — second call returns 404 (target already superseded)', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const first = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(second.statusCode).toBe(404);
  });

  // ── EDIT-RESEND (6) ────────────────────────────────────────────────

  it('edit-resend: 401 unauthenticated', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/edit-resend`,
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: { content: 'edited' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('edit-resend: 400 invalid body (empty content)', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('edit-resend: 404 wrong_org', async () => {
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const fIds = await seedTurns(ctx.storage, foreign.id, [
      { role: 'user', content: 'q' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${foreign.id}/messages/${fIds[0]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: 'edited' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('edit-resend: 400 not_most_recent_user when target is not the latest user msg', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    // Try to edit the FIRST user message — fails.
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: 'edited' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('not_most_recent_user');
  });

  it('edit-resend: success → prior user+assistant superseded, new user persisted, audit landed', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'original' },
      { role: 'assistant', content: 'old reply' },
    ]);
    // Most recent user is ids[2]; assistant reply ids[3].
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[2]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: 'edited content' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversationId: string; newUserMessageId: string };
    expect(body.conversationId).toBe(ctx.conversationId);
    expect(typeof body.newUserMessageId).toBe('string');
    expect(body.newUserMessageId.length).toBeGreaterThan(0);

    const all = await ctx.storage.conversations.getMessagesIncludingSuperseded(
      ctx.conversationId, ctx.orgId,
    );
    const oldUser = all.find((m) => m.id === ids[2]);
    const oldAssistant = all.find((m) => m.id === ids[3]);
    expect(oldUser?.status).toBe('superseded');
    expect(oldAssistant?.status).toBe('superseded');

    const newUser = all.find((m) => m.id === body.newUserMessageId);
    expect(newUser?.role).toBe('user');
    expect(newUser?.content).toBe('edited content');

    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const row = audit.find((a) => a.toolName === 'message_edit_resend');
    expect(row).toBeDefined();
    const meta = JSON.parse(row!.argsJson) as {
      originalUserMessageId: string;
      newUserMessageId: string;
      supersededAssistantId?: string;
    };
    expect(meta.originalUserMessageId).toBe(ids[2]);
    expect(meta.newUserMessageId).toBe(body.newUserMessageId);
    expect(meta.supersededAssistantId).toBe(ids[3]);
  });

  it('edit-resend: edge — most recent user has no assistant reply yet → only user superseded', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'lonely' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: 'updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { newUserMessageId: string };

    const all = await ctx.storage.conversations.getMessagesIncludingSuperseded(
      ctx.conversationId, ctx.orgId,
    );
    const old = all.find((m) => m.id === ids[0]);
    expect(old?.status).toBe('superseded');

    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const row = audit.find((a) => a.toolName === 'message_edit_resend');
    expect(row).toBeDefined();
    const meta = JSON.parse(row!.argsJson) as {
      originalUserMessageId: string;
      newUserMessageId: string;
      supersededAssistantId?: string;
    };
    expect(meta.supersededAssistantId).toBeUndefined();
    expect(meta.newUserMessageId).toBe(body.newUserMessageId);
  });

  // ── SHARE (6) ──────────────────────────────────────────────────────

  it('share: 401 unauthenticated', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'x-test-unauth': '1', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('share: 404 wrong_org', async () => {
    const foreign = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const fIds = await seedTurns(ctx.storage, foreign.id, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${foreign.id}/messages/${fIds[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('share: 400 when target is a user message (must be assistant)', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('not_assistant_message');
  });

  it('share: 404 when target is superseded', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    await ctx.storage.conversations.markMessagesSuperseded(
      [ids[1]], ctx.conversationId, ctx.orgId,
    );
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('share: success → 201 + valid shareId + url', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { shareId: string; url: string };
    expect(body.shareId.length).toBeGreaterThan(0);
    expect(body.url).toBe(`/agent/share/${body.shareId}`);

    // Share link persisted with correct linkage.
    const link = await ctx.storage.shareLinks.getShareLink(body.shareId);
    expect(link).not.toBeNull();
    expect(link?.conversationId).toBe(ctx.conversationId);
    expect(link?.orgId).toBe(ctx.orgId);
    expect(link?.anchorMessageId).toBe(ids[1]);
    expect(link?.createdByUserId).toBe(ctx.userId);
  });

  it('share: success path appends share_created audit row', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { shareId: string };

    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const row = audit.find((a) => a.toolName === 'share_created');
    expect(row).toBeDefined();
    expect(row?.conversationId).toBe(ctx.conversationId);
    const meta = JSON.parse(row!.argsJson) as { shareId: string; anchorMessageId: string };
    expect(meta.shareId).toBe(body.shareId);
    expect(meta.anchorMessageId).toBe(ids[1]);
  });
});
