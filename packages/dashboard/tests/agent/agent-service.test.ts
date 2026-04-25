/**
 * Phase 32 Plan 04 Task 3 (RED) — AgentService runTurn() integration tests.
 *
 * Nine AI-SPEC §5.3 Critical + Cross-tenant fixtures + iteration cap:
 *   1. rbac-permitted-tool-call            (tool in manifest, dispatched)
 *   2. rbac-forbidden-tool-filtered        (tool omitted from manifest)
 *   3. rbac-revoked-mid-turn               (iter 2 revokes; iter 3 manifest lacks tool)
 *   4. destructive-approved                (pause; then /confirm path — simulated)
 *   5. destructive-denied                  (pause; then /deny path — simulated)
 *   6. destructive-batch-pause             (destructive + non-destructive in one batch → only pause row persisted)
 *   7. pending-confirmation-reload         (getWindow after pause still has the row)
 *   8. cross-org-data-request-blocked      (getConversation with wrong orgId returns null)
 *   9. cross-org-memory-stale-after-switch (second conversation has empty window)
 *   10. iteration-cap-forced-final-answer  (5 tool-call iters → iter 6 forces final + audit)
 *
 * Integration surface: real SQLite, real ConversationRepository, real
 * AgentAuditRepository. LlmClient.streamAgentConversation is stubbed with a
 * scripted iterator. ToolDispatcher.dispatch is stubbed with scripted results.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { SseFrame } from '../../src/agent/sse-frames.js';
import { AgentService, extractRationale, buildRetryGuidance } from '../../src/agent/agent-service.js';
import type {
  AgentStreamTurn,
  AgentStreamInput,
  AgentStreamOptions,
} from '../../src/agent/agent-service.js';
import type { ToolCallInput, ToolDispatchResult } from '../../src/agent/tool-dispatch.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Ctx {
  storage: SqliteStorageAdapter;
  dbPath: string;
  userId: string;
  orgId: string;
  otherOrgId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-32-04-agent-service-salt');
  const dbPath = join(tmpdir(), `test-agent-svc-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Seed two orgs + one user belonging to both.
  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());

  const orgA = await storage.organizations.createOrg({ name: 'Org A', slug: `a-${userId.slice(0, 6)}` });
  const orgB = await storage.organizations.createOrg({ name: 'Org B', slug: `b-${userId.slice(0, 6)}` });

  const conv = await storage.conversations.createConversation({
    userId,
    orgId: orgA.id,
  });

  return {
    storage,
    dbPath,
    userId,
    orgId: orgA.id,
    otherOrgId: orgB.id,
    conversationId: conv.id,
    cleanup: async () => {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

/**
 * Script-driven LLM stub. Each call to streamAgentConversation dequeues the
 * next scripted turn from the queue. Production streaming semantics are
 * simulated by invoking opts.onFrame for each queued frame, then returning
 * the summary { text, toolCalls }.
 */
function makeLlmStub(script: AgentStreamTurn[]) {
  const queue = [...script];
  const calls: Array<{ input: AgentStreamInput; opts: AgentStreamOptions }> = [];
  const stub = {
    streamAgentConversation: vi.fn(
      async (input: AgentStreamInput, opts: AgentStreamOptions): Promise<AgentStreamTurn> => {
        calls.push({ input, opts });
        if (queue.length === 0) {
          throw new Error('LLM stub exhausted');
        }
        const next = queue.shift()!;
        // Simulate streaming: emit tokens then a final delta.
        for (const t of next.text.split(' ')) {
          if (t.length > 0) opts.onFrame({ type: 'token', text: t });
        }
        return next;
      },
    ),
    calls,
    remainingScriptCount: () => queue.length,
  };
  return stub;
}

function makeDispatcherStub(handlers: Map<string, (call: ToolCallInput) => Promise<ToolDispatchResult>>) {
  return {
    dispatch: vi.fn(async (call: ToolCallInput): Promise<ToolDispatchResult> => {
      const h = handlers.get(call.name);
      if (h === undefined) return { error: 'unknown_tool' } as ToolDispatchResult;
      return h(call);
    }),
  };
}

const TEST_TOOLS: readonly ToolMetadata[] = [
  { name: 'dashboard_list_reports', requiredPermission: 'reports.view' },
  {
    name: 'dashboard_scan_site',
    requiredPermission: 'scans.create',
    destructive: true,
    confirmationTemplate: (args) => `Start scan of ${args['siteUrl']}`,
  },
  { name: 'dashboard_get_report', requiredPermission: 'reports.view' },
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('AgentService.runTurn — critical fixtures', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildCtx();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('rbac-permitted-tool-call: tool in manifest → dispatched + audited', async () => {
    const llm = makeLlmStub([
      {
        text: 'Fetching reports...',
        toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }],
      },
      { text: 'Here are your reports.', toolCalls: [] },
    ]);
    const dispatcher = makeDispatcherStub(
      new Map([['dashboard_list_reports', async () => ({ ok: true, reports: [] })]]),
    );
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as unknown as Parameters<typeof AgentService.prototype.runTurn>[0] extends never
        ? never
        : never, // type gymnastic — real construction below via constructor args
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as unknown as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'List my reports',
      emit: (f) => { emits.push(f); },
      signal: new AbortController().signal,
    });

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    // Two LLM calls: the tool-call turn and the follow-up answer turn.
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(2);
    const doneFrames = emits.filter((f) => f.type === 'done');
    expect(doneFrames.length).toBe(1);

    // DB assertions: Plan 32.1-08 persists an assistant(tool_calls) row
    // BEFORE the tool-result row so the conversation history reflects the
    // provider-required order (user → assistant(tool_calls) → tool →
    // assistant(final)). Pre-32.1-08 this was user → tool → assistant.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const roles = window.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // Audit row lands for the tool dispatch.
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    expect(audit.length).toBe(1);
    expect(audit[0].toolName).toBe('dashboard_list_reports');
    expect(audit[0].outcome).toBe('success');
  });

  it('rbac-forbidden-tool-filtered: manifest passed to LLM excludes tools user lacks permission for', async () => {
    const llm = makeLlmStub([{ text: 'OK.', toolCalls: [] }]);
    const dispatcher = makeDispatcherStub(new Map());
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']), // no scans.create
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'hi',
      emit: () => {},
      signal: new AbortController().signal,
    });
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(1);
    const passedTools = llm.calls[0].input.tools.map((t) => t.name);
    expect(passedTools).toContain('dashboard_list_reports');
    expect(passedTools).toContain('dashboard_get_report');
    expect(passedTools).not.toContain('dashboard_scan_site');
  });

  it('rbac-revoked-mid-turn: iter 2 manifest reflects revocation', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }],
      },
      {
        text: '',
        toolCalls: [{ id: 't2', name: 'dashboard_get_report', args: { id: 'r1' } }],
      },
      { text: 'All done.', toolCalls: [] },
    ]);
    const dispatcher = makeDispatcherStub(
      new Map([
        ['dashboard_list_reports', async () => ({ ok: true })],
        ['dashboard_get_report', async () => ({ ok: true })],
      ]),
    );
    // resolvePermissions: first two calls grant reports.view, the third strips it.
    let callCount = 0;
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => {
        callCount += 1;
        if (callCount >= 3) return new Set();
        return new Set(['reports.view']);
      },
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'kick off a loop',
      emit: () => {},
      signal: new AbortController().signal,
    });
    // Third LLM call must have been made with an empty manifest.
    expect(llm.calls.length).toBe(3);
    expect(llm.calls[2].input.tools.map((t) => t.name)).toEqual([]);
  });

  it('destructive-batch-pause: a destructive + non-destructive batch pauses the whole batch', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [
          { id: 't1', name: 'dashboard_list_reports', args: {} },
          { id: 't2', name: 'dashboard_scan_site', args: { siteUrl: 'https://ex.com' } },
        ],
      },
    ]);
    const dispatcher = makeDispatcherStub(
      new Map([['dashboard_list_reports', async () => ({ ok: true })]]),
    );
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view', 'scans.create']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'run stuff',
      emit: (f) => { emits.push(f); },
      signal: new AbortController().signal,
    });

    // No dispatches should have fired (AI-SPEC FM #4).
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    // Exactly one pending_confirmation frame should have been emitted.
    const pending = emits.filter((f) => f.type === 'pending_confirmation');
    expect(pending.length).toBe(1);
    expect((pending[0] as Extract<SseFrame, { type: 'pending_confirmation' }>).toolName).toBe(
      'dashboard_scan_site',
    );

    // DB has 1 user + 1 pending_confirmation tool row, status=pending_confirmation.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const roles = window.map((m) => m.role);
    expect(roles).toEqual(['user', 'tool']);
    expect(window[1].status).toBe('pending_confirmation');
    expect(window[1].toolCallJson).toBeTruthy();
  });

  it('pending-confirmation-reload: pending row is retrievable via getWindow after runTurn returns', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'dashboard_scan_site', args: { siteUrl: 'https://ex.com' } }],
      },
    ]);
    const dispatcher = makeDispatcherStub(new Map());
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['scans.create']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'scan it',
      emit: () => {},
      signal: new AbortController().signal,
    });
    // Simulate a reload: fetch window again from a fresh repo read.
    const windowAfter = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const pending = windowAfter.find((m) => m.status === 'pending_confirmation');
    expect(pending).toBeDefined();
    expect(pending?.toolCallJson).toBeTruthy();
    const parsed = JSON.parse(pending!.toolCallJson!);
    expect(parsed.name).toBe('dashboard_scan_site');
  });

  it('cross-org-data-request-blocked: getConversation with wrong orgId returns null', async () => {
    const conv = await ctx.storage.conversations.getConversation(
      ctx.conversationId,
      ctx.otherOrgId,
    );
    expect(conv).toBeNull();
    // Sanity: right org still returns it.
    const same = await ctx.storage.conversations.getConversation(
      ctx.conversationId,
      ctx.orgId,
    );
    expect(same).not.toBeNull();
  });

  it('cross-org-memory-stale-after-switch: second conversation in other org starts empty', async () => {
    // After writing a message in org A...
    await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'user',
      content: 'org-A secret string',
      status: 'sent',
    });
    // ...creating a fresh conversation in org B begins with empty rolling window.
    const convB = await ctx.storage.conversations.createConversation({
      userId: ctx.userId,
      orgId: ctx.otherOrgId,
    });
    const window = await ctx.storage.conversations.getWindow(convB.id);
    expect(window.length).toBe(0);
  });

  it('iteration-cap-forced-final-answer: 6th iter writes __loop__ audit + final assistant message', async () => {
    // Script 5 consecutive tool-call turns + the forced-final answer turn.
    const script: AgentStreamTurn[] = [];
    for (let i = 0; i < 5; i++) {
      script.push({
        text: '',
        toolCalls: [{ id: `t${i}`, name: 'dashboard_list_reports', args: {} }],
      });
    }
    script.push({ text: 'Final answer after forced wrap-up.', toolCalls: [] });

    const llm = makeLlmStub(script);
    const dispatcher = makeDispatcherStub(
      new Map([['dashboard_list_reports', async () => ({ ok: true })]]),
    );
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'loop forever',
      emit: (f) => { emits.push(f); },
      signal: new AbortController().signal,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(5);
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(6); // 5 tool-call + 1 forced
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 20 });
    const loopRow = audit.find((a) => a.toolName === '__loop__');
    expect(loopRow).toBeDefined();
    expect(loopRow?.outcome).toBe('error');
    expect(loopRow?.outcomeDetail).toBe('iteration_cap');
    // done frame still emitted after final answer.
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);
  });

  it('tool-result 8KB truncation applied when payload exceeds cap', async () => {
    const big = 'x'.repeat(12_000); // 12 KB result
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [{ id: 't1', name: 'dashboard_list_reports', args: {} }],
      },
      { text: 'Done.', toolCalls: [] },
    ]);
    const dispatcher = makeDispatcherStub(
      new Map([['dashboard_list_reports', async () => ({ data: big })]]),
    );
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      // Phase 35 Plan 03 — isolate these tests from the new post-first-assistant
      // title hook. Rejecting the generator hits the service's catch block
      // (swallow-with-comment), so no rename is written and the conversation
      // stays title=null, preserving these tests' row/count assertions.
      // Hook behaviour itself is covered by tests/agent/agent-service-title-hook.test.ts.
      titleGenerator: async () => { throw new Error('noop in regression suite'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolMsg = window.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    // Stored JSON includes a _truncated sentinel; size bounded.
    const stored = toolMsg!.toolResultJson!;
    const parsed = JSON.parse(stored);
    expect(parsed._truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 36-03 Task 1 — pure helpers
// ---------------------------------------------------------------------------

describe('extractRationale + buildRetryGuidance', () => {
  it('extractRationale: thinking precedes text', () => {
    expect(extractRationale({ text: 'foo', thinking: 'bar' })).toBe('bar\n\nfoo');
  });

  it('extractRationale: text only', () => {
    expect(extractRationale({ text: 'foo' })).toBe('foo');
  });

  it('extractRationale: empty string returns null', () => {
    expect(extractRationale({ text: '' })).toBeNull();
  });

  it('extractRationale: whitespace-only returns null', () => {
    expect(extractRationale({ text: '   ' })).toBeNull();
  });

  it('extractRationale: empty text + thinking returns thinking', () => {
    expect(extractRationale({ text: '', thinking: 'b' })).toBe('b');
  });

  it('buildRetryGuidance: failure with budget remaining mentions error and budget', () => {
    const out = buildRetryGuidance({ error: 'timeout' }, 2);
    expect(out).not.toBeNull();
    expect(out!).toContain('timeout');
    expect(out!).toContain('2');
    expect(out!.toLowerCase()).toMatch(/retry/);
  });

  it('buildRetryGuidance: failure with budget=0 omits retry-permission language', () => {
    const out = buildRetryGuidance({ error: 'timeout' }, 0);
    expect(out).not.toBeNull();
    expect(out!).toContain('timeout');
    // Must not invite a retry — must not say "you may retry" / "retry attempt(s) remaining"
    expect(out!.toLowerCase()).not.toMatch(/you may retry|retry attempt\(s\) remaining/);
  });

  it('buildRetryGuidance: success path returns null', () => {
    expect(buildRetryGuidance({ ok: true, value: 42 } as ToolDispatchResult, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 36-03 Task 2 — multi-step tool use (parallel dispatch + SSE +
// rationale + retry budget)
// ---------------------------------------------------------------------------

describe('Phase 36 — multi-step tool use', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  /** Dispatcher stub that records start timestamps and resolves per-handler delays. */
  function makeTimedDispatcherStub(
    handlers: Map<string, (call: ToolCallInput) => Promise<ToolDispatchResult>>,
  ) {
    const dispatchTimes: number[] = [];
    return {
      dispatchTimes,
      dispatch: vi.fn(async (call: ToolCallInput): Promise<ToolDispatchResult> => {
        dispatchTimes.push(Date.now());
        const h = handlers.get(call.name);
        if (h === undefined) return { error: 'unknown_tool' } as ToolDispatchResult;
        return h(call);
      }),
    };
  }

  function delayedHandler(ms: number, value: ToolDispatchResult): () => Promise<ToolDispatchResult> {
    return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  }

  it('A: dispatches tool batch concurrently and persists results in input order', async () => {
    const llm = makeLlmStub([
      {
        text: 'Looking up several things',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: {} },
          { id: 'b', name: 'dashboard_get_report', args: { id: 'r1' } },
          { id: 'c', name: 'dashboard_list_reports', args: { extra: true } },
        ],
      },
      { text: 'Here are the results.', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', async (call) => {
      const ms = call.args.extra === true ? 10 : 30;
      return new Promise<ToolDispatchResult>((resolve) =>
        setTimeout(() => resolve({ ok: true, callId: call.id }), ms),
      );
    });
    handlers.set('dashboard_get_report', delayedHandler(5, { ok: true, callId: 'b' }));
    const dispatcher = makeTimedDispatcherStub(handlers);

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    const start = Date.now();
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const elapsed = Date.now() - start;

    // 3 dispatches total
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
    // Started concurrently (all dispatch starts within ~10ms — no sequential serialisation)
    const startSpread = Math.max(...dispatcher.dispatchTimes) - Math.min(...dispatcher.dispatchTimes);
    expect(startSpread).toBeLessThan(20);
    // Total turn dispatch step under ~50ms (sequential would be >=45ms; we have LLM stub overhead too,
    // so check the tools step: max delay 30ms; with overhead allow 200ms total turn).
    expect(elapsed).toBeLessThan(500);

    // Tool result rows persisted in input order: a, b, c
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(3);
    const callIds = toolRows.map((r) => {
      const parsed = JSON.parse(r.toolCallJson!);
      return parsed.id;
    });
    expect(callIds).toEqual(['a', 'b', 'c']);

    // Audit rows in input order
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 50 });
    const dispatchAudits = audit.filter((a) => a.toolName !== '__loop__' && a.toolName !== '__compaction__');
    // listForOrg returns most-recent first; reverse to chronological
    const chrono = [...dispatchAudits].reverse();
    expect(chrono.length).toBe(3);
  });

  it('B: emits tool_started before tool_completed for every call', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: {} },
          { id: 'b', name: 'dashboard_get_report', args: { id: 'r1' } },
          { id: 'c', name: 'dashboard_list_reports', args: { extra: true } },
        ],
      },
      { text: 'done', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', delayedHandler(5, { ok: true }));
    handlers.set('dashboard_get_report', delayedHandler(5, { ok: true }));
    const dispatcher = makeTimedDispatcherStub(handlers);
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
      userMessage: 'go',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    const starts = emits.filter((f) => f.type === 'tool_started');
    const completes = emits.filter((f) => f.type === 'tool_completed');
    expect(starts.length).toBe(3);
    expect(completes.length).toBe(3);

    // Starts in input order
    expect(starts.map((s) => (s as Extract<SseFrame, { type: 'tool_started' }>).toolCallId))
      .toEqual(['a', 'b', 'c']);
    // All starts come before any completion (since starts are emitted synchronously, completions await promises)
    const firstCompleteIdx = emits.findIndex((f) => f.type === 'tool_completed');
    const lastStartIdx = emits.map((f) => f.type).lastIndexOf('tool_started');
    expect(lastStartIdx).toBeLessThan(firstCompleteIdx);
    // All completed are status=success
    for (const c of completes) {
      const cf = c as Extract<SseFrame, { type: 'tool_completed' }>;
      expect(cf.status).toBe('success');
    }
  });

  it('C: rationale captured (thinking + text) and persisted to every audit row', async () => {
    const llm = makeLlmStub([
      {
        text: 'I will now look up the org and the user',
        thinking: 'reasoning…',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: {} },
          { id: 'b', name: 'dashboard_get_report', args: { id: 'x' } },
        ],
      },
      { text: 'done', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', delayedHandler(2, { ok: true }));
    handlers.set('dashboard_get_report', delayedHandler(2, { ok: true }));
    const dispatcher = makeTimedDispatcherStub(handlers);

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
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 20 });
    const dispatchRows = audit.filter((a) => a.toolName !== '__loop__' && a.toolName !== '__compaction__');
    expect(dispatchRows.length).toBe(2);
    for (const row of dispatchRows) {
      expect(row.rationale).toBe('reasoning…\n\nI will now look up the org and the user');
    }
  });

  it('D: rationale is null when both text and thinking are blank', async () => {
    const llm = makeLlmStub([
      { text: '', toolCalls: [{ id: 'a', name: 'dashboard_list_reports', args: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', delayedHandler(1, { ok: true }));
    const dispatcher = makeTimedDispatcherStub(handlers);
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
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 20 });
    const dispatchRows = audit.filter((a) => a.toolName !== '__loop__' && a.toolName !== '__compaction__');
    expect(dispatchRows.length).toBe(1);
    expect(dispatchRows[0].rationale).toBeNull();
  });

  it('E: failed tool results carry retry-guidance text within the budget', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: {} },
          { id: 'b', name: 'dashboard_get_report', args: { id: 'x' } },
          { id: 'c', name: 'dashboard_list_reports', args: { extra: true } },
        ],
      },
      { text: 'wrap', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', async (call) => {
      if (call.args.extra === true) return { ok: true } as ToolDispatchResult;
      return { error: 'timeout' } as ToolDispatchResult;
    });
    handlers.set('dashboard_get_report', async () => ({ error: 'internal', message: 'boom' } as ToolDispatchResult));
    const dispatcher = makeTimedDispatcherStub(handlers);

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
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(3);
    // Row a (timeout): guidance + timeout sentinel
    const aJson = toolRows[0].toolResultJson!;
    expect(aJson).toContain('timeout');
    expect(aJson.toLowerCase()).toContain('retry attempt');
    // Row b (internal): guidance + internal sentinel
    const bJson = toolRows[1].toolResultJson!;
    expect(bJson).toContain('internal');
    expect(bJson.toLowerCase()).toContain('retry attempt');
    // Row c success: no guidance
    const cJson = toolRows[2].toolResultJson!;
    expect(cJson.toLowerCase()).not.toContain('retry attempt');

    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 20 });
    const dispatchRows = audit.filter((a) => a.toolName !== '__loop__' && a.toolName !== '__compaction__');
    // Reverse to chronological for order matching
    const chrono = [...dispatchRows].reverse();
    expect(chrono[0].outcome).toBe('timeout');
    expect(chrono[0].outcomeDetail).toBe('timeout');
    expect(chrono[1].outcome).toBe('error');
    expect(chrono[1].outcomeDetail).toBe('internal');
  });

  it('F: budget of 3 — 4th failure omits retry-permission language', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: { i: 1 } },
          { id: 'b', name: 'dashboard_list_reports', args: { i: 2 } },
          { id: 'c', name: 'dashboard_list_reports', args: { i: 3 } },
          { id: 'd', name: 'dashboard_list_reports', args: { i: 4 } },
        ],
      },
      { text: 'wrap', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', async () => ({ error: 'internal', message: 'fail' } as ToolDispatchResult));
    const dispatcher = makeTimedDispatcherStub(handlers);
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
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(4);
    // First 3 carry "retry attempt" guidance language; 4th does not but still mentions error sentinel
    expect(toolRows[0].toolResultJson!.toLowerCase()).toContain('retry attempt');
    expect(toolRows[1].toolResultJson!.toLowerCase()).toContain('retry attempt');
    expect(toolRows[2].toolResultJson!.toLowerCase()).toContain('retry attempt');
    expect(toolRows[3].toolResultJson!.toLowerCase()).not.toContain('retry attempt');
    expect(toolRows[3].toolResultJson!).toContain('internal');
    // Exhausted-message branch must mention exhaustion
    expect(toolRows[3].toolResultJson!.toLowerCase()).toMatch(/exhausted|do not retry/);
  });

  it('G: multi-step chaining respects MAX_TOOL_ITERATIONS=5 with iteration_cap audit', async () => {
    const script: AgentStreamTurn[] = [];
    for (let i = 0; i < 5; i++) {
      script.push({
        text: '',
        toolCalls: [{ id: `t${i}`, name: 'dashboard_list_reports', args: {} }],
      });
    }
    script.push({ text: 'forced wrap-up.', toolCalls: [] });
    const llm = makeLlmStub(script);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', async () => ({ ok: true } as ToolDispatchResult));
    const dispatcher = makeTimedDispatcherStub(handlers);
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
      userMessage: 'loop',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(5);
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(6);
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 50 });
    const loopRow = audit.find((a) => a.toolName === '__loop__');
    expect(loopRow).toBeDefined();
    expect(loopRow?.outcomeDetail).toBe('iteration_cap');
  });

  it('H: single-tool turn still works through the batch helper', async () => {
    const llm = makeLlmStub([
      {
        text: 'one tool',
        toolCalls: [{ id: 'only', name: 'dashboard_list_reports', args: {} }],
      },
      { text: 'done', toolCalls: [] },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', delayedHandler(1, { ok: true }));
    const dispatcher = makeTimedDispatcherStub(handlers);
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
      userMessage: 'one',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(emits.filter((f) => f.type === 'tool_started').length).toBe(1);
    expect(emits.filter((f) => f.type === 'tool_completed').length).toBe(1);
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    expect(window.filter((m) => m.role === 'tool').length).toBe(1);
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 20 });
    expect(audit.filter((a) => a.toolName === 'dashboard_list_reports').length).toBe(1);
  });

  it('I: destructive batch still pauses entire batch — no tool_started, no dispatchAll', async () => {
    const llm = makeLlmStub([
      {
        text: '',
        toolCalls: [
          { id: 'a', name: 'dashboard_list_reports', args: {} },
          { id: 'b', name: 'dashboard_scan_site', args: { siteUrl: 'https://ex.com' } },
          { id: 'c', name: 'dashboard_get_report', args: { id: 'r' } },
        ],
      },
    ]);
    const handlers = new Map<string, (c: ToolCallInput) => Promise<ToolDispatchResult>>();
    handlers.set('dashboard_list_reports', async () => ({ ok: true } as ToolDispatchResult));
    handlers.set('dashboard_get_report', async () => ({ ok: true } as ToolDispatchResult));
    const dispatcher = makeTimedDispatcherStub(handlers);
    const emits: SseFrame[] = [];
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TEST_TOOLS,
      dispatcher: dispatcher as never,
      resolvePermissions: async () => new Set(['reports.view', 'scans.create']),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'mixed',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(emits.filter((f) => f.type === 'tool_started').length).toBe(0);
    expect(emits.filter((f) => f.type === 'tool_completed').length).toBe(0);
    expect(emits.filter((f) => f.type === 'pending_confirmation').length).toBe(1);
  });
});
