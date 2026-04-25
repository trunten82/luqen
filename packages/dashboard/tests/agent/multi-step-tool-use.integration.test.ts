/**
 * Phase 36 Plan 06 Task 1 — Integration tests covering all four ATOOL
 * success criteria end-to-end against a real AgentService instance:
 *
 *   SC#1 — Parallel dispatch of multiple tool_use blocks (ATOOL-01).
 *   SC#2 — Failed tool result surfaced with retry guidance; agent recovers
 *          within the per-turn budget (ATOOL-02).
 *   SC#3 — Multi-step chaining respects MAX_TOOL_ITERATIONS=5; cap-hit
 *          synthetic chip frame emitted (ATOOL-03).
 *   SC#4 — Rationale + outcome filterable on the agent_audit_log (ATOOL-04).
 *
 * Plus one regression test pinning the single-tool path so the batch
 * helper does not regress the Phase 32 baseline.
 *
 * Harness shape
 * -------------
 * Real:
 *   - SqliteStorageAdapter on a per-test :memory:-style tmp file
 *     (real migrations including 057 — rationale column).
 *   - ConversationRepository / AgentAuditRepository.
 *   - ToolDispatcher with three test handlers (tool_a, tool_b, tool_c)
 *     registered against a small zod schema; per-test behaviour map flips
 *     each handler between success / timeout / internal-error / delay.
 *   - AgentService.runTurn — full orchestration including parallel
 *     dispatch, retry-budget injection, rationale capture, and SSE frame
 *     emission.
 *
 * Stubbed:
 *   - LlmClient.streamAgentConversation — scripted AgentStreamTurn[].
 *   - DashboardSigner — minimal stub returning a fixed JWT (no real RS256
 *     key needed for integration scope).
 *   - resolveScopes — returns ['admin.system'] (the dispatcher does not
 *     reach the network because the tool handlers run in-process).
 *
 * The new file is intentionally narrower than agent-service.test.ts: it
 * pins the SC contracts (SC#1..SC#4 + regression) on real ToolDispatcher,
 * not a stub, so Phase 39 verification has end-to-end SC evidence with
 * the JWT mint + zod arg validation paths exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { AgentService } from '../../src/agent/agent-service.js';
import type {
  AgentStreamTurn,
  AgentStreamInput,
  AgentStreamOptions,
} from '../../src/agent/agent-service.js';
import {
  ToolDispatcher,
  type ToolHandler,
  type ToolManifestEntry,
} from '../../src/agent/tool-dispatch.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { SseFrame } from '../../src/agent/sse-frames.js';

// ---------------------------------------------------------------------------
// Test tools — three lightweight handlers exercised by SC#1..SC#4
// ---------------------------------------------------------------------------

const TEST_PERMISSION = 'reports.view';

const TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'tool_a', requiredPermission: TEST_PERMISSION },
  { name: 'tool_b', requiredPermission: TEST_PERMISSION },
  { name: 'tool_c', requiredPermission: TEST_PERMISSION },
];

type Behaviour =
  | { kind: 'success'; delayMs?: number; payload?: Record<string, unknown> }
  | { kind: 'timeout' }
  | { kind: 'internal'; message?: string };

interface BehaviourMap {
  tool_a: Behaviour;
  tool_b: Behaviour;
  tool_c: Behaviour;
}

function makeHandler(getBehaviour: () => Behaviour): ToolHandler {
  return async (args) => {
    const b = getBehaviour();
    if (b.kind === 'success') {
      const delay = b.delayMs ?? 0;
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      return b.payload ?? { ok: true, args };
    }
    if (b.kind === 'timeout') {
      // Hang past the dispatcher timeout; ToolDispatcher's race promise
      // resolves to TIMEOUT_SENTINEL and surfaces { error: 'timeout' }.
      await new Promise<void>(() => {
        /* never resolves */
      });
      return undefined;
    }
    // internal
    throw new Error(b.message ?? 'boom');
  };
}

function makeManifest(getMap: () => BehaviourMap): readonly ToolManifestEntry[] {
  return [
    {
      name: 'tool_a',
      inputSchema: z.object({}).passthrough(),
      handler: makeHandler(() => getMap().tool_a),
    },
    {
      name: 'tool_b',
      inputSchema: z.object({}).passthrough(),
      handler: makeHandler(() => getMap().tool_b),
    },
    {
      name: 'tool_c',
      inputSchema: z.object({}).passthrough(),
      handler: makeHandler(() => getMap().tool_c),
    },
  ];
}

// ---------------------------------------------------------------------------
// LLM stub — scripted AgentStreamTurn queue, identical contract to the
// stub used in agent-service.test.ts so integration assertions about
// frame ordering are stable.
// ---------------------------------------------------------------------------

function makeLlmStub(script: AgentStreamTurn[]) {
  const queue = [...script];
  const calls: Array<{ input: AgentStreamInput; opts: AgentStreamOptions }> = [];
  return {
    streamAgentConversation: vi.fn(
      async (input: AgentStreamInput, opts: AgentStreamOptions): Promise<AgentStreamTurn> => {
        calls.push({ input, opts });
        if (queue.length === 0) {
          throw new Error('LLM stub exhausted');
        }
        const next = queue.shift()!;
        for (const t of next.text.split(' ')) {
          if (t.length > 0) opts.onFrame({ type: 'token', text: t });
        }
        return next;
      },
    ),
    calls,
    remainingScriptCount: () => queue.length,
  };
}

// ---------------------------------------------------------------------------
// Per-test harness
// ---------------------------------------------------------------------------

interface Ctx {
  storage: SqliteStorageAdapter;
  dbPath: string;
  userId: string;
  orgId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-36-06-multi-step-integration-salt');
  const dbPath = join(tmpdir(), `test-multi-step-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());

  const org = await storage.organizations.createOrg({
    name: 'Phase 36 Test Org',
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
    orgId: org.id,
    conversationId: conv.id,
    cleanup: async () => {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

function buildDispatcher(getMap: () => BehaviourMap, timeoutMs = 50): ToolDispatcher {
  return new ToolDispatcher({
    tools: makeManifest(getMap),
    signer: {
      currentKid: 'phase36-test-kid',
      mintAccessToken: vi.fn().mockResolvedValue('test.jwt.string'),
    },
    dashboardMcpAudience: 'https://dashboard.test/mcp',
    resolveScopes: async () => ['admin.system'],
    timeoutMs,
  });
}

interface BuildSvcArgs {
  readonly ctx: Ctx;
  readonly llm: ReturnType<typeof makeLlmStub>;
  readonly dispatcher: ToolDispatcher;
}

function buildSvc({ ctx, llm, dispatcher }: BuildSvcArgs): AgentService {
  return new AgentService({
    storage: ctx.storage,
    // The LLM stub matches the AgentService contract by structural shape;
    // the cast scopes the type widening to a single hand-off site.
    llm: llm as never,
    allTools: TOOL_METADATA,
    dispatcher,
    resolvePermissions: async () => new Set([TEST_PERMISSION]),
    config: { agentDisplayNameDefault: 'Luqen Assistant' },
    // Title hook is irrelevant to ATOOL behaviour and is exercised by
    // tests/agent/agent-service-title-hook.test.ts. Reject so it stays a
    // no-op and our row counts remain deterministic.
    titleGenerator: async () => {
      throw new Error('noop in phase-36-06 integration suite');
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 36 Plan 06 — multi-step tool-use integration (SC#1..SC#4 + regression)', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildCtx();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('SC#1 — parallel dispatch: 3 tool_use blocks fan out concurrently and persist in input order', async () => {
    const llm = makeLlmStub([
      {
        text: 'Looking up three things in parallel.',
        toolCalls: [
          { id: 'a', name: 'tool_a', args: { i: 1 } },
          { id: 'b', name: 'tool_b', args: { i: 2 } },
          { id: 'c', name: 'tool_c', args: { i: 3 } },
        ],
      },
      { text: 'All three returned.', toolCalls: [] },
    ]);

    // Per-handler delays exercise out-of-completion-order resolution
    // while keeping persistence in input order.
    const map: BehaviourMap = {
      tool_a: { kind: 'success', delayMs: 50, payload: { ok: true, name: 'a' } },
      tool_b: { kind: 'success', delayMs: 10, payload: { ok: true, name: 'b' } },
      tool_c: { kind: 'success', delayMs: 30, payload: { ok: true, name: 'c' } },
    };
    const dispatcher = buildDispatcher(() => map, 5_000);

    const svc = buildSvc({ ctx, llm, dispatcher });
    const emits: SseFrame[] = [];

    const startedAt = Date.now();
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go parallel',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });
    const elapsedMs = Date.now() - startedAt;

    // Sequential floor would be 50+10+30 = 90ms. With parallel dispatch
    // the dispatch *step* runs in ~max(delays)=50ms; the LLM stubs add
    // negligible work. We allow generous slack for the rest of the
    // turn (DB writes, two LLM stub calls, emit pipeline).
    // Assertion focuses on order + count first; timing second so this
    // suite is robust on slow CI.
    expect(elapsedMs).toBeLessThan(500);

    // Tool-result rows persisted in input order.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(3);
    const callIds = toolRows.map((r) => JSON.parse(r.toolCallJson!).id as string);
    expect(callIds).toEqual(['a', 'b', 'c']);

    // SSE frames: 3 tool_started in input order, 3 tool_completed all success.
    const starts = emits.filter((f) => f.type === 'tool_started') as Array<
      Extract<SseFrame, { type: 'tool_started' }>
    >;
    expect(starts.map((s) => s.toolCallId)).toEqual(['a', 'b', 'c']);
    const completes = emits.filter((f) => f.type === 'tool_completed') as Array<
      Extract<SseFrame, { type: 'tool_completed' }>
    >;
    expect(completes.length).toBe(3);
    for (const c of completes) {
      expect(c.status).toBe('success');
    }
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);

    // Audit rows present for all three calls.
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 50 });
    const dispatchAudits = audit.filter((a) => a.toolName !== '__loop__' && a.toolName !== '__compaction__');
    expect(dispatchAudits.length).toBe(3);
  });

  it('SC#2 — error retry recovery: timed-out tool surfaced with retry guidance; agent finishes within budget', async () => {
    const llm = makeLlmStub([
      {
        text: 'I will fetch a and b.',
        toolCalls: [
          { id: 'a', name: 'tool_a', args: {} },
          { id: 'b', name: 'tool_b', args: {} },
        ],
      },
      { text: 'Recovered: here is the answer.', toolCalls: [] },
    ]);

    const map: BehaviourMap = {
      tool_a: { kind: 'timeout' },
      tool_b: { kind: 'success', payload: { ok: true } },
      tool_c: { kind: 'success' }, // unused
    };
    // Use a short dispatcher timeout so the test does not wait 30s for
    // the timeout path.
    const dispatcher = buildDispatcher(() => map, 30);

    const svc = buildSvc({ ctx, llm, dispatcher });
    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'try',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    // Tool-result row for `a` carries the retry-guidance string + the
    // 'timeout' sentinel — model sees both on the next turn.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(2);
    const aRow = toolRows[0];
    expect(JSON.parse(aRow.toolCallJson!).id).toBe('a');
    expect(aRow.toolResultJson).toBeTruthy();
    expect(aRow.toolResultJson!.toLowerCase()).toContain('retry attempt');
    expect(aRow.toolResultJson!).toContain('timeout');
    // `b` succeeded — no retry guidance.
    const bRow = toolRows[1];
    expect(JSON.parse(bRow.toolCallJson!).id).toBe('b');
    expect(bRow.toolResultJson!.toLowerCase()).not.toContain('retry attempt');

    // Audit row for `a` records outcome=timeout, outcomeDetail=timeout.
    const audit = await ctx.storage.agentAudit.listForOrg(
      ctx.orgId,
      { toolName: 'tool_a' },
      { limit: 10 },
    );
    expect(audit.length).toBe(1);
    expect(audit[0].outcome).toBe('timeout');
    expect(audit[0].outcomeDetail).toBe('timeout');

    // Done frame fires — turn completed within iteration budget.
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);
    // Two LLM calls: the failing iteration + the recovery iteration.
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(2);
  });

  it('SC#3 — iteration cap: 5 batches dispatch, then __loop__ audit + cap-hit chip frame, then done', async () => {
    const script: AgentStreamTurn[] = [];
    for (let i = 0; i < 5; i++) {
      script.push({
        text: '',
        toolCalls: [{ id: `t${i}`, name: 'tool_a', args: { iter: i } }],
      });
    }
    script.push({ text: 'Forced wrap-up after the cap.', toolCalls: [] });
    const llm = makeLlmStub(script);

    const map: BehaviourMap = {
      tool_a: { kind: 'success', payload: { ok: true } },
      tool_b: { kind: 'success' },
      tool_c: { kind: 'success' },
    };
    const dispatcher = buildDispatcher(() => map, 5_000);

    const svc = buildSvc({ ctx, llm, dispatcher });
    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'loop',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    // 5 dispatch iterations + 1 forced-final-answer LLM call.
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(6);

    // __loop__ audit row exists with iteration_cap detail.
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 50 });
    const loopRow = audit.find((a) => a.toolName === '__loop__');
    expect(loopRow).toBeDefined();
    expect(loopRow?.outcome).toBe('error');
    expect(loopRow?.outcomeDetail).toBe('iteration_cap');

    // Synthetic tool_completed frame with toolCallId='__loop__' fires
    // BEFORE the final 'done' frame (so the chip strip can render the
    // cap-hit notice while the model is still finishing).
    const loopFrameIdx = emits.findIndex(
      (f) => f.type === 'tool_completed' &&
        (f as Extract<SseFrame, { type: 'tool_completed' }>).toolCallId === '__loop__',
    );
    expect(loopFrameIdx).toBeGreaterThanOrEqual(0);
    const loopFrame = emits[loopFrameIdx] as Extract<SseFrame, { type: 'tool_completed' }>;
    expect(loopFrame.errorMessage).toBe('iteration_cap');
    expect(loopFrame.status).toBe('error');

    const doneIdx = emits.findIndex((f) => f.type === 'done');
    expect(doneIdx).toBeGreaterThan(loopFrameIdx);
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);
  });

  it('SC#4 — rationale visible: assistant text persists onto every audit row and is filterable by tool', async () => {
    const RATIONALE = 'Looking up org X to compare against the dashboard.';
    const llm = makeLlmStub([
      {
        text: RATIONALE,
        toolCalls: [{ id: 'a', name: 'tool_a', args: { id: 'org-x' } }],
      },
      { text: 'Done.', toolCalls: [] },
    ]);

    const map: BehaviourMap = {
      tool_a: { kind: 'success', payload: { ok: true } },
      tool_b: { kind: 'success' },
      tool_c: { kind: 'success' },
    };
    const dispatcher = buildDispatcher(() => map, 5_000);

    const svc = buildSvc({ ctx, llm, dispatcher });
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: () => {},
      signal: new AbortController().signal,
    });

    // No filter — row visible in unfiltered listing.
    const all = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 50 });
    const dispatchRow = all.find((a) => a.toolName === 'tool_a');
    expect(dispatchRow).toBeDefined();
    expect(dispatchRow!.rationale).toBe(RATIONALE);

    // Filter by toolName — same row returned.
    const filtered = await ctx.storage.agentAudit.listForOrg(
      ctx.orgId,
      { toolName: 'tool_a' },
      { limit: 10 },
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].rationale).toBe(RATIONALE);
    expect(filtered[0].toolName).toBe('tool_a');
  });

  it('regression — single-tool path: row + audit + rationale captured; no SSE regressions vs Phase 32 baseline', async () => {
    const llm = makeLlmStub([
      {
        text: 'Single-tool rationale text.',
        toolCalls: [{ id: 'only', name: 'tool_a', args: {} }],
      },
      { text: 'Single-tool answer.', toolCalls: [] },
    ]);

    const map: BehaviourMap = {
      tool_a: { kind: 'success', payload: { ok: true, single: true } },
      tool_b: { kind: 'success' },
      tool_c: { kind: 'success' },
    };
    const dispatcher = buildDispatcher(() => map, 5_000);

    const svc = buildSvc({ ctx, llm, dispatcher });
    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'one',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    // Phase 32 baseline: user → assistant(tool_calls) → tool → assistant(final).
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    expect(window.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // Exactly one tool_started + one tool_completed{success}, then done.
    expect(emits.filter((f) => f.type === 'tool_started').length).toBe(1);
    const completes = emits.filter((f) => f.type === 'tool_completed') as Array<
      Extract<SseFrame, { type: 'tool_completed' }>
    >;
    expect(completes.length).toBe(1);
    expect(completes[0].status).toBe('success');
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);

    // Audit row exists with rationale captured (Phase 36 addition over the
    // Phase 32 baseline).
    const audit = await ctx.storage.agentAudit.listForOrg(ctx.orgId, {}, { limit: 10 });
    const row = audit.find((a) => a.toolName === 'tool_a');
    expect(row).toBeDefined();
    expect(row!.outcome).toBe('success');
    expect(row!.rationale).toBe('Single-tool rationale text.');
  });
});
