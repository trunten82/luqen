/**
 * Phase 43 Plan 04 — multi-step plan integration tests.
 *
 * These bind the four pieces shipped across Plans 43-01..43-03 into
 * end-to-end scenarios:
 *
 *   1. Round-trip: LLM emits `<plan>` block + 2 tool calls → SSE `plan`
 *      frame is emitted BEFORE any `tool_started` frame, both tools run,
 *      and the persisted assistant(tool_calls) row has the `<plan>`
 *      block stripped from its content.
 *
 *   2. Mid-step cancel via `activeTurnRegistry.cancel(conversationId)`:
 *      first tool resolves → registry cancel fires → terminal `done
 *      {aborted:true}` frame; second tool's iteration never runs;
 *      assistant(tool_calls) and tool-result rows for step 1 are
 *      persisted, no row for step 2.
 *
 *   3. Cross-user route rejection: user B issues `POST /agent/cancel/:id`
 *      against user A's conversation → 404, the user-A controller is NOT
 *      aborted (regression guard for the Phase 32.1 cross-user fix).
 *
 *   4. Single-step turn (no `<plan>` block) emits no `plan` frame —
 *      backwards compatibility for the most common path.
 *
 * Surface choices
 * ---------------
 *  - SQLite + migrations real (StorageAdapter, conversation + audit repos).
 *  - LlmClient.streamAgentConversation is scripted via a small stub.
 *  - Tool dispatcher is a vi.fn that respects an injected `signal` for
 *    the cancel scenario; no real network/JWT mint.
 *  - The cross-user case spins a Fastify instance with the cancel route
 *    mounted (mirrors tests/routes/agent.test.ts).
 *
 * The stand-alone unit / route tests in agent-service.test.ts and
 * tests/routes/agent.test.ts cover the same invariants in finer-grain
 * isolation; this file pins the "everything stitched together" contract
 * for Phase 43 verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { AgentService } from '../../src/agent/agent-service.js';
import type {
  AgentStreamTurn,
  AgentStreamInput,
  AgentStreamOptions,
} from '../../src/agent/agent-service.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { ToolCallInput, ToolDispatchResult } from '../../src/agent/tool-dispatch.js';
import type { SseFrame } from '../../src/agent/sse-frames.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const TEST_TOOLS: readonly ToolMetadata[] = [
  { name: 'tool_one', requiredPermission: 'reports.view' },
  { name: 'tool_two', requiredPermission: 'reports.view' },
];

interface Ctx {
  storage: SqliteStorageAdapter;
  dbPath: string;
  userId: string;
  otherUserId: string;
  orgId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-43-04-integration-salt');
  const dbPath = join(tmpdir(), `test-43-04-int-${randomUUID()}.db`);
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
  ).run(otherUserId, `u-${otherUserId.slice(0, 6)}`, new Date().toISOString());

  const org = await storage.organizations.createOrg({
    name: 'Phase 43 Integration Org',
    slug: `org-${userId.slice(0, 6)}`,
  });
  const conv = await storage.conversations.createConversation({
    userId,
    orgId: org.id,
  });

  return {
    storage,
    dbPath,
    userId,
    otherUserId,
    orgId: org.id,
    conversationId: conv.id,
    cleanup: async () => {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

function makeLlmStub(script: AgentStreamTurn[]) {
  const queue = [...script];
  return {
    streamAgentConversation: vi.fn(
      async (_input: AgentStreamInput, opts: AgentStreamOptions): Promise<AgentStreamTurn> => {
        if (queue.length === 0) throw new Error('LLM stub exhausted');
        const next = queue.shift()!;
        for (const t of next.text.split(' ')) {
          if (t.length > 0) opts.onFrame({ type: 'token', text: t });
        }
        return next;
      },
    ),
  };
}

function makeStaticDispatcher(handlers: Map<string, (call: ToolCallInput) => Promise<ToolDispatchResult>>) {
  return {
    dispatch: vi.fn(async (call: ToolCallInput): Promise<ToolDispatchResult> => {
      const h = handlers.get(call.name);
      if (h === undefined) return { error: 'unknown_tool' } as ToolDispatchResult;
      return h(call);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 43 Plan 04 — multi-step plan integration', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('round-trip: <plan> block parsed, plan SSE frame emitted before tool_started, persisted text strips block', async () => {
    const planText = [
      '<plan>',
      '1. Step one — first tool fetch',
      '2. Step two — second tool fetch',
      '</plan>',
      'Working on it.',
    ].join('\n');
    const llm = makeLlmStub([
      {
        text: planText,
        toolCalls: [
          { id: 't1', name: 'tool_one', args: {} },
          { id: 't2', name: 'tool_two', args: {} },
        ],
      },
      { text: 'All steps complete.', toolCalls: [] },
    ]);
    const dispatcher = makeStaticDispatcher(new Map([
      ['tool_one', async () => ({ ok: true, step: 1 })],
      ['tool_two', async () => ({ ok: true, step: 2 })],
    ]));
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'Run both tools',
      emit: (f) => { emits.push(f); },
      signal: new AbortController().signal,
    });

    // Frame ordering: plan must come before any tool_started.
    const planIdx = emits.findIndex((f) => f.type === 'plan');
    const firstToolStartedIdx = emits.findIndex((f) => f.type === 'tool_started');
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(firstToolStartedIdx).toBeGreaterThan(planIdx);

    // Plan body
    const planFrame = emits[planIdx] as Extract<SseFrame, { type: 'plan' }>;
    expect(planFrame.steps).toHaveLength(2);
    expect(planFrame.steps[0]).toMatchObject({ n: 1, label: 'Step one' });
    expect(planFrame.steps[1]).toMatchObject({ n: 2, label: 'Step two' });

    // Both tools dispatched.
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);

    // Persistence: assistant(tool_calls) row holds the post-strip text only.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolCallRow = window.find((m) => m.role === 'assistant' && m.toolCallJson != null);
    expect(toolCallRow).toBeDefined();
    const persistedText = toolCallRow!.content ?? '';
    expect(persistedText).not.toContain('<plan>');
    expect(persistedText).not.toContain('</plan>');
    expect(persistedText).toContain('Working on it.');
  });

  it('mid-step cancel via registry: step 1 result persisted, step 2 never runs, terminal done {aborted:true}', async () => {
    // First LLM turn requests tool_one only (step 1). The cancel fires
    // BEFORE the second LLM turn would run, so step 2 never gets a chance.
    const llm = makeLlmStub([
      {
        text: '<plan>\n1. Step one — quick fetch\n2. Step two — slow fetch\n</plan>\nWorking…',
        toolCalls: [{ id: 't1', name: 'tool_one', args: {} }],
      },
      { text: 'should never run', toolCalls: [] },
    ]);

    // Step 1 resolves immediately. After it lands, we cancel via the
    // registry; runTurn's between-iteration abort check short-circuits
    // before the second LLM call fires.
    const dispatcher = {
      dispatch: vi.fn(async (
        _call: ToolCallInput,
        _dispatchCtx: { signal?: AbortSignal },
      ): Promise<ToolDispatchResult> => {
        return { ok: true, step: 1 };
      }),
    };

    const registry = new ActiveTurnRegistry();
    const conversationId = ctx.conversationId;
    const emits: SseFrame[] = [];

    // Cancel as soon as the first tool_completed frame is seen.
    let cancelled = false;
    const emit = (f: SseFrame): void => {
      emits.push(f);
      if (!cancelled && f.type === 'tool_completed') {
        cancelled = true;
        registry.cancel(conversationId);
      }
    };

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
      turnRegistry: registry,
    });

    await svc.runTurn({
      conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'Run both then cancel',
      emit,
      signal: new AbortController().signal,
    });

    // Terminal frame: done {aborted:true}.
    const doneFrames = emits.filter((f) => f.type === 'done');
    expect(doneFrames.length).toBe(1);
    expect((doneFrames[0] as { aborted?: boolean }).aborted).toBe(true);

    // Only step 1 LLM iteration ran — second LLM call never fired.
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    // DB persistence: user msg + assistant(tool_calls) for step 1 + tool
    // result for step 1. NO assistant(final) follow-up because the abort
    // landed before iteration 2.
    const window = await ctx.storage.conversations.getWindow(conversationId);
    const roles = window.map((m) => m.role);
    expect(roles[0]).toBe('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');
    // No second tool-result row.
    expect(roles.filter((r) => r === 'tool').length).toBe(1);

    // Registry cleaned up.
    expect(registry.isActive(conversationId)).toBe(false);
  });

  it('single-step turn (no <plan> block) emits no plan frame and dispatches normally', async () => {
    const llm = makeLlmStub([
      { text: 'Just one tool.', toolCalls: [{ id: 't1', name: 'tool_one', args: {} }] },
      { text: 'Done.', toolCalls: [] },
    ]);
    const dispatcher = makeStaticDispatcher(new Map([
      ['tool_one', async () => ({ ok: true })],
    ]));
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'one shot',
      emit: (f) => { emits.push(f); },
      signal: new AbortController().signal,
    });
    expect(emits.find((f) => f.type === 'plan')).toBeUndefined();
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const doneFrames = emits.filter((f) => f.type === 'done');
    expect(doneFrames.length).toBe(1);
    expect((doneFrames[0] as { aborted?: boolean }).aborted).not.toBe(true);
  });

  it('cross-user cancel via POST /agent/cancel/:id → 404, original turn controller is NOT aborted', async () => {
    // User A's turn is "active" — we register a controller against the
    // conversation id. User B then POSTs /agent/cancel/:id and must get
    // a 404 with the controller untouched.
    const registry = new ActiveTurnRegistry();
    const aController = registry.register(ctx.conversationId);

    // Build a Fastify instance mounting the cancel route. Stub the
    // service + dispatcher; only /agent/cancel matters for this test.
    const server: FastifyInstance = Fastify({ logger: false });
    await server.register(import('@fastify/formbody'));

    // Inject user B (the attacker) on every request.
    server.addHook('preHandler', async (request) => {
      (request as unknown as {
        user: { id: string; username: string; role: string; currentOrgId: string };
      }).user = {
        id: ctx.otherUserId,
        username: 'attacker',
        role: 'user',
        currentOrgId: ctx.orgId,
      };
    });

    await registerAgentRoutes(server, {
      agentService: { runTurn: async () => {} } as never,
      dispatcher: { dispatch: async () => ({ ok: true } as ToolDispatchResult) } as never,
      storage: ctx.storage,
      publicUrl: 'http://localhost',
      turnRegistry: registry,
    });
    await server.ready();

    try {
      const res = await server.inject({
        method: 'POST',
        url: `/agent/cancel/${ctx.conversationId}`,
        headers: { 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      // Critical: user A's controller was NOT aborted by user B's call.
      expect(aController.signal.aborted).toBe(false);
      // Registry still holds the entry (cross-user route never touched it).
      expect(registry.isActive(ctx.conversationId)).toBe(true);
    } finally {
      await server.close();
    }
  });
});
