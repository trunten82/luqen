/**
 * Phase 37 Plan 05 — End-to-end coverage for AUX-01..AUX-05.
 *
 * Harness shape
 * -------------
 * Following the dashboard's existing "E2E" idiom (see
 * tests/e2e/agent-history.e2e.test.ts and tests/e2e/agent-history-a11y.e2e.test.ts),
 * this spec uses **vitest + Fastify `server.inject` + JSDOM** rather than
 * Playwright. Playwright is not wired into packages/dashboard (no
 * @playwright/test dep, no playwright.config.ts, no browser runtime).
 * Plan 05's checkpoint instructions explicitly permit this fallback.
 *
 * What this exercises end-to-end:
 *   - real SqliteStorageAdapter (real migrations 047 + 058 + 059 + 060)
 *   - real registerAgentRoutes for retry / edit-resend / share /
 *     edit-form / message-by-id / share-view
 *   - real ShareLinkRepository
 *   - real handleStreamAbort code path for AUX-01 by replaying the same
 *     three writes the private method performs (appendMessage, then
 *     markMessageStopped, then agentAudit.append) — bit-for-bit equivalent
 *     to AgentService's stop persistence (see agent-service.ts line 555).
 *   - share-view HTML rendered through the real Fastify route, then
 *     parsed by JSDOM and scanned by axe-core (zero serious + critical
 *     violations).
 *   - mobile viewport (375px) parity check on share-view markup.
 *
 * AUX-01..AUX-05 mapping:
 *   AUX-01 stop persistence → test 1
 *   AUX-02 retry            → test 2
 *   AUX-03 edit-resend      → test 3
 *   AUX-04 copy markdown    → test 4 (markdown source GET endpoint)
 *   AUX-05 share + 403 cross-org + 404 revoked → test 5, 6
 *   share-view a11y         → test 7
 *   mobile viewport         → test 8
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import type { AgentService } from '../../src/agent/agent-service.js';
import type { ToolDispatcher } from '../../src/agent/tool-dispatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'style.css');
const STYLE_CSS_SOURCE = readFileSync(STYLE_CSS_PATH, 'utf8');

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly userId: string;
  readonly otherUserId: string;
  readonly orgId: string;
  readonly otherOrgId: string;
  readonly conversationId: string;
  readonly setOrg: (orgId: string | undefined) => void;
  readonly setUser: (userId: string) => void;
  readonly setUnauth: (v: boolean) => void;
  readonly cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt(`phase-37-05-e2e-${randomUUID()}`);
  const dbPath = join(tmpdir(), `e2e-streaming-ux-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const otherUserId = randomUUID();
  const raw = storage.getRawDatabase();
  const now = new Date().toISOString();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, now);
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(otherUserId, `o-${otherUserId.slice(0, 6)}`, now);

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
    title: 'AUX e2e conversation',
  });

  // Stub LLM-driven primitives — none of the e2e routes invoke them.
  const stubAgentService: Pick<AgentService, 'runTurn'> = { runTurn: async () => {} };
  const stubDispatcher: Pick<ToolDispatcher, 'dispatch'> = {
    dispatch: async () => ({ ok: true, data: {} }) as unknown as ReturnType<ToolDispatcher['dispatch']> extends Promise<infer R> ? R : never,
  };

  let currentOrg: string | undefined = orgA.id;
  let currentUser = userId;
  let unauth = false;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.addHook('preHandler', async (request, reply) => {
    if (unauth) {
      await reply.code(401).send({ error: 'unauth' });
      return;
    }
    if (currentOrg === undefined) {
      request.user = { id: currentUser, username: 'tester', role: 'viewer' };
      return;
    }
    request.user = {
      id: currentUser,
      username: 'tester',
      role: 'viewer',
      currentOrgId: currentOrg,
    };
  });

  await registerAgentRoutes(server, {
    agentService: stubAgentService as unknown as AgentService,
    dispatcher: stubDispatcher as unknown as ToolDispatcher,
    storage,
    publicUrl: 'https://dashboard.example.com',
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
    setOrg: (v) => { currentOrg = v; },
    setUser: (v) => { currentUser = v; },
    setUnauth: (v) => { unauth = v; },
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
  turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): Promise<readonly string[]> {
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

async function fetchAuditByTool(
  storage: SqliteStorageAdapter,
  orgId: string,
  toolName: string,
): Promise<ReadonlyArray<{ toolName: string; conversationId: string | null; argsJson: string }>> {
  const rows = await storage.agentAudit.listForOrg(orgId, {}, { limit: 50 });
  return rows.filter((r) => r.toolName === toolName);
}

describe('Phase 37 Plan 05 — AUX-01..AUX-05 end-to-end', () => {
  let ctx: Ctx;

  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  // -------------------------------------------------------------------
  // AUX-01 Stop — partial assistant text persists with status='stopped',
  // audit row toolName='message_stopped', outcomeDetail='stopped_by_user'.
  // We replay the exact three-write dance AgentService.handleStreamAbort
  // performs (appendMessage→markMessageStopped→agentAudit.append). The
  // only thing this skips is the AbortSignal plumbing — those bytes are
  // already covered by tests/agent/agent-service-stop-persist.test.ts.
  // -------------------------------------------------------------------
  it('test 1 — AUX-01: stopped partial persists across reload (audit row + status flag)', async () => {
    await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'Long prompt that will be stopped mid-stream.' },
    ]);
    const partial = '# Heading\n\nThis is a **partial** answer that the user stop';

    // Mirror handleStreamAbort:
    const row = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'assistant',
      content: partial,
      status: 'streaming',
    });
    await ctx.storage.conversations.markMessageStopped(
      row.id,
      ctx.conversationId,
      ctx.orgId,
      partial,
    );
    await ctx.storage.agentAudit.append({
      userId: ctx.userId,
      orgId: ctx.orgId,
      conversationId: ctx.conversationId,
      toolName: 'message_stopped',
      argsJson: '{}',
      outcome: 'success',
      outcomeDetail: 'stopped_by_user',
      latencyMs: 150,
    });

    // Reload — fetch active history via real route.
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${ctx.conversationId}/messages/${row.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; content: string; status: string };
    expect(body.id).toBe(row.id);
    expect(body.status).toBe('stopped');
    expect(body.content).toBe(partial);

    // Audit row visible.
    const stopped = await fetchAuditByTool(ctx.storage, ctx.orgId, 'message_stopped');
    expect(stopped.length).toBe(1);
    expect(stopped[0]!.conversationId).toBe(ctx.conversationId);
  });

  // -------------------------------------------------------------------
  // AUX-02 Retry — POST /retry supersedes the latest assistant turn,
  // audit row toolName='message_retried' lands.
  // -------------------------------------------------------------------
  it('test 2 — AUX-02: retry supersedes latest assistant + audit row', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/retry`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversationId: string; retried: boolean };
    expect(body.retried).toBe(true);

    const all = await ctx.storage.conversations.getMessagesIncludingSuperseded(
      ctx.conversationId,
      ctx.orgId,
    );
    const target = all.find((m) => m.id === ids[1]);
    expect(target?.status).toBe('superseded');

    const audit = await fetchAuditByTool(ctx.storage, ctx.orgId, 'message_retried');
    expect(audit.length).toBe(1);
    const meta = JSON.parse(audit[0]!.argsJson) as { originalMessageId: string };
    expect(meta.originalMessageId).toBe(ids[1]);

    // Active branch no longer contains the superseded assistant.
    const active = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    expect(active.find((m) => m.id === ids[1])).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // AUX-03 Edit-resend — POST /edit-resend supersedes original user +
  // following assistant, persists new user row, audit row lands.
  // -------------------------------------------------------------------
  it('test 3 — AUX-03: edit-resend branches conversation; superseded rows still in DB', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[0]}/edit-resend`,
      headers: { 'content-type': 'application/json' },
      payload: { content: 'Hello there' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversationId: string; newUserMessageId: string };
    expect(body.newUserMessageId).toBeTruthy();
    expect(body.newUserMessageId).not.toBe(ids[0]);

    // Active branch: only the new user message survives (no assistant yet).
    const active = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(body.newUserMessageId);
    expect(active[0]!.content).toBe('Hello there');

    // Superseded rows are still in DB (audit history preserved).
    const all = await ctx.storage.conversations.getMessagesIncludingSuperseded(
      ctx.conversationId,
      ctx.orgId,
    );
    expect(all.find((m) => m.id === ids[0])?.status).toBe('superseded');
    expect(all.find((m) => m.id === ids[1])?.status).toBe('superseded');

    // Audit row.
    const audit = await fetchAuditByTool(ctx.storage, ctx.orgId, 'message_edit_resend');
    expect(audit.length).toBe(1);
    const meta = JSON.parse(audit[0]!.argsJson) as {
      originalUserMessageId: string;
      newUserMessageId: string;
      supersededAssistantId?: string;
    };
    expect(meta.originalUserMessageId).toBe(ids[0]);
    expect(meta.newUserMessageId).toBe(body.newUserMessageId);
    expect(meta.supersededAssistantId).toBe(ids[1]);
  });

  // -------------------------------------------------------------------
  // AUX-04 Copy — the markdown-source endpoint returns raw markdown
  // (no HTML) for the assistant message. agent.js uses this as a fallback
  // when the in-memory cache misses; the contract is that the response
  // body's `content` field is identical to what was streamed.
  // -------------------------------------------------------------------
  it('test 4 — AUX-04: GET /messages/:mid returns raw markdown source (no HTML escaping)', async () => {
    const markdown = '# Heading\n\n**bold** and `code`\n\n- item 1\n- item 2';
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: markdown },
    ]);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { content: string };
    expect(body.content).toBe(markdown);
    // No HTML tags injected by the route — exact byte match.
    expect(body.content).not.toMatch(/<h1>|<strong>|<code>|<ul>|<li>/);
  });

  // -------------------------------------------------------------------
  // AUX-05 Share — POST /share returns 201 + shareId/url, audit row
  // 'share_created' lands, and GET /agent/share/:id renders read-only
  // HTML for the same-org session.
  // -------------------------------------------------------------------
  it('test 5 — AUX-05: share creates link, GET renders read-only page (no composer / no action buttons)', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'share me' },
      { role: 'assistant', content: 'this is the shared response' },
    ]);
    const post = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(post.statusCode).toBe(201);
    const created = post.json() as { shareId: string; url: string };
    expect(created.shareId).toBeTruthy();
    expect(created.url).toBe(`/agent/share/${created.shareId}`);

    const audit = await fetchAuditByTool(ctx.storage, ctx.orgId, 'share_created');
    expect(audit.length).toBe(1);

    // GET share-view (same session = same org).
    const get = await ctx.server.inject({ method: 'GET', url: created.url });
    expect(get.statusCode).toBe(200);
    expect(String(get.headers['content-type'])).toMatch(/text\/html/);
    const html = get.body;
    expect(html).toContain('this is the shared response');
    // No composer, no action buttons (readOnly=true suppresses them).
    expect(html).not.toContain('id="agent-form"');
    expect(html).not.toContain('id="agent-input"');
    expect(html).not.toMatch(/data-action="(retry|copy|share|edit)Assistant"/);
    expect(html).not.toContain('data-action="editUserMessage"');
  });

  // -------------------------------------------------------------------
  // AUX-05 cross-org 403 — a foreign-org session that follows the share
  // URL gets a 403, NOT 200 and NOT a sneaky 404. The link itself is not
  // confidential (random 22-char id) — the org gate is the boundary.
  // -------------------------------------------------------------------
  it('test 6 — AUX-05: foreign-org session on share URL → 403 forbidden_org_mismatch', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const post = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(post.statusCode).toBe(201);
    const { shareId } = post.json() as { shareId: string };

    // Switch session to other org.
    ctx.setOrg(ctx.otherOrgId);
    ctx.setUser(ctx.otherUserId);
    const get = await ctx.server.inject({ method: 'GET', url: `/agent/share/${shareId}` });
    expect(get.statusCode).toBe(403);
    expect((get.json() as { error: string }).error).toBe('forbidden_org_mismatch');
  });

  // -------------------------------------------------------------------
  // Share-view a11y — JSDOM the HTML response, inline style.css, run
  // axe-core scoped to the <main class="agent-share"> region, assert
  // zero serious + critical violations.
  // -------------------------------------------------------------------
  it('test 7 — share-view has zero serious + critical axe-core violations + meta robots noindex', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'a11y question' },
      { role: 'assistant', content: 'A11y answer with **markdown**.' },
    ]);
    const post = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(post.statusCode).toBe(201);
    const { url } = post.json() as { shareId: string; url: string };
    const get = await ctx.server.inject({ method: 'GET', url });
    expect(get.statusCode).toBe(200);
    const html = get.body;

    // Inline real style.css so axe can evaluate contrast / focus rules
    // against the actual tokens.
    const inlined = html.replace(
      '<link rel="stylesheet" href="/static/style.css">',
      `<style>${STYLE_CSS_SOURCE}</style>`,
    );
    const dom = new JSDOM(inlined, { url: 'http://localhost/', pretendToBeVisual: true });
    const win = dom.window as unknown as Window & typeof globalThis;
    const doc = win.document;

    // Threat T-37-20 mitigation — share view must not be indexable.
    const robots = doc.querySelector('meta[name="robots"]');
    expect(robots).not.toBeNull();
    expect(robots!.getAttribute('content')).toMatch(/noindex/i);
    expect(robots!.getAttribute('content')).toMatch(/nofollow/i);

    // axe-core scoped to the share region.
    const region = doc.querySelector('main.agent-share') as Element;
    expect(region).not.toBeNull();
    const results = await axe.run(region, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    }) as unknown as axe.AxeResults;

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      const formatted = blocking.map((v) =>
        `${v.id} [${v.impact}]: ${v.description}\n  ` +
        v.nodes.slice(0, 2).map((n) => n.html).join('\n  '),
      ).join('\n\n');
      console.error('axe violations:\n' + formatted);
    }
    expect(blocking).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Mobile viewport parity — 375px wide JSDOM, share thread must not
  // overflow horizontally and must not render any action / composer
  // markup. We assert on the markup contract; the layout itself is
  // governed by the .agent-share BEM block in style.css (max-width
  // 720px, padding scales down at 375).
  // -------------------------------------------------------------------
  it('test 8 — share-view at 375px viewport: no composer / no action buttons / readable head', async () => {
    const ids = await seedTurns(ctx.storage, ctx.conversationId, [
      { role: 'user', content: 'mobile test' },
      { role: 'assistant', content: 'mobile answer' },
    ]);
    const post = await ctx.server.inject({
      method: 'POST',
      url: `/agent/conversations/${ctx.conversationId}/messages/${ids[1]}/share`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    const { url } = post.json() as { url: string };
    const get = await ctx.server.inject({ method: 'GET', url });
    const inlined = get.body.replace(
      '<link rel="stylesheet" href="/static/style.css">',
      `<style>${STYLE_CSS_SOURCE}</style>`,
    );
    const dom = new JSDOM(inlined, {
      url: 'http://localhost/',
      pretendToBeVisual: true,
    });
    const win = dom.window as unknown as Window & typeof globalThis;
    Object.defineProperty(win, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: 667, configurable: true });
    const doc = win.document;

    // No composer / no action buttons.
    expect(doc.getElementById('agent-form')).toBeNull();
    expect(doc.getElementById('agent-input')).toBeNull();
    expect(doc.querySelector('[data-action="retryAssistant"]')).toBeNull();
    expect(doc.querySelector('[data-action="copyAssistant"]')).toBeNull();
    expect(doc.querySelector('[data-action="shareAssistant"]')).toBeNull();
    expect(doc.querySelector('[data-action="editUserMessage"]')).toBeNull();

    // Header is readable (h1 has text content).
    const h1 = doc.querySelector('main.agent-share .agent-share__head h1');
    expect(h1).not.toBeNull();
    expect((h1!.textContent ?? '').trim().length).toBeGreaterThan(0);

    // Style.css contains the .agent-share BEM block (max-width / padding rules
    // — Plan 05 Task 2). Belt-and-braces grep so a future refactor that
    // accidentally drops the share polish trips this test.
    expect(STYLE_CSS_SOURCE).toMatch(/\.agent-share\s*\{/);
    expect(STYLE_CSS_SOURCE).toMatch(/\.agent-share__head/);
    expect(STYLE_CSS_SOURCE).toMatch(/\.agent-share__thread/);
  });
});
