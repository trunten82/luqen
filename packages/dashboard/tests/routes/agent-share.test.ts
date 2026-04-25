/**
 * Phase 37 Plan 03 Task 3 — GET /agent/share/:shareId tests.
 *
 * Coverage (≥7 cases):
 *   1. 401 unauthenticated
 *   2. 400 no_org_context
 *   3. 404 unknown shareId
 *   4. 404 revoked shareId
 *   5. 403 foreign-org session
 *   6. 404 conversation soft-deleted after share created
 *   7. 200 success — HTML contains title + messages, NO action buttons,
 *      NO composer textarea
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
  cleanup: () => Promise<void>;
  setOrg: (orgId: string | undefined) => void;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-37-03-share-salt');
  const dbPath = join(tmpdir(), `test-agent-share-${randomUUID()}.db`);
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

  let currentOrgOverride: string | undefined = orgA.id;
  let unauth = false;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  server.addHook('preHandler', async (request, reply) => {
    if (unauth || request.headers['x-test-unauth'] === '1') {
      await reply.code(401).send({ error: 'unauth' });
      return;
    }
    if (currentOrgOverride === undefined) {
      request.user = { id: userId, username: 'tester', role: 'viewer' };
      return;
    }
    request.user = {
      id: userId,
      username: 'tester',
      role: 'viewer',
      currentOrgId: currentOrgOverride,
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
    setOrg: (org) => { currentOrgOverride = org; },
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

async function seedAndShare(ctx: Ctx): Promise<{ shareId: string; assistantId: string }> {
  await ctx.storage.conversations.appendMessage({
    conversationId: ctx.conversationId,
    role: 'user',
    content: 'how do I fix WCAG 1.4.3?',
    status: 'sent',
  });
  const a = await ctx.storage.conversations.appendMessage({
    conversationId: ctx.conversationId,
    role: 'assistant',
    content: 'Increase contrast to 4.5:1 minimum.',
    status: 'final',
  });
  await ctx.storage.conversations.renameConversation(
    ctx.conversationId, ctx.orgId, 'Contrast question',
  );
  const link = await ctx.storage.shareLinks.createShareLink({
    conversationId: ctx.conversationId,
    orgId: ctx.orgId,
    anchorMessageId: a.id,
    createdByUserId: ctx.userId,
  });
  return { shareId: link.id, assistantId: a.id };
}

describe('GET /agent/share/:shareId — Phase 37 Plan 03 Task 3', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('401 unauthenticated', async () => {
    const { shareId } = await seedAndShare(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
      headers: { 'x-test-unauth': '1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('400 no_org_context', async () => {
    const { shareId } = await seedAndShare(ctx);
    ctx.setOrg(undefined);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('no_org_context');
  });

  it('404 unknown shareId', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/does-not-exist-id-22-c`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 revoked shareId', async () => {
    const { shareId } = await seedAndShare(ctx);
    await ctx.storage.shareLinks.revokeShareLink(shareId, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 foreign-org session — link.orgId !== session.orgId', async () => {
    const { shareId } = await seedAndShare(ctx);
    ctx.setOrg(ctx.otherOrgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('forbidden_org_mismatch');
  });

  it('404 conversation soft-deleted after share created', async () => {
    const { shareId } = await seedAndShare(ctx);
    await ctx.storage.conversations.softDeleteConversation(ctx.conversationId, ctx.orgId);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 success — HTML contains title + messages, NO action buttons, NO composer', async () => {
    const { shareId } = await seedAndShare(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/share/${shareId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.body;
    // Title rendered.
    expect(html).toContain('Contrast question');
    // Both messages rendered.
    expect(html).toContain('how do I fix WCAG 1.4.3?');
    expect(html).toContain('Increase contrast to 4.5:1 minimum.');
    // NO action buttons.
    expect(html).not.toContain('data-action="retryAssistant"');
    expect(html).not.toContain('data-action="copyAssistant"');
    expect(html).not.toContain('data-action="shareAssistant"');
    expect(html).not.toContain('data-action="editUserMessage"');
    // NO composer textarea (the agent drawer's input is keyed off
    // id="agent-input" / form#agent-form).
    expect(html).not.toContain('id="agent-input"');
    expect(html).not.toContain('id="agent-form"');
  });
});
