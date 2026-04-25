/**
 * Phase 37 Plan 03 Task 1 (RED) — AgentService stop-persistence on AbortSignal.
 *
 * Behaviour contract (per 37-03 plan):
 *   1. AbortSignal fires mid-stream after N chunks → markMessageStopped is
 *      called once with the concatenated chunk text.
 *   2. AbortSignal fires before any chunk arrives → markMessageStopped is
 *      called with the empty string and status='stopped'.
 *   3. An audit row lands with toolName='message_stopped', outcome='success',
 *      outcomeDetail='stopped_by_user'.
 *   4. Natural stream completion (no abort) → markMessageStopped is NOT
 *      called; existing 'sent'/'final' append path preserved.
 *   5. Provider error mid-stream (NOT abort) → markMessageStopped is NOT
 *      called; existing error path unchanged.
 *   6. After abort fires, no further `done` SSE frame is emitted to the
 *      (already-closed) consumer.
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
import { AgentService } from '../../src/agent/agent-service.js';
import type {
  AgentStreamTurn,
  AgentStreamInput,
  AgentStreamOptions,
} from '../../src/agent/agent-service.js';
import type { ToolCallInput, ToolDispatchResult } from '../../src/agent/tool-dispatch.js';

interface Ctx {
  storage: SqliteStorageAdapter;
  dbPath: string;
  userId: string;
  orgId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-37-03-stop-persist-salt');
  const dbPath = join(tmpdir(), `test-agent-stop-persist-${randomUUID()}.db`);
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

/**
 * LLM stub that emits scripted chunks one at a time, polling the AbortSignal
 * between each. When aborted mid-stream it throws an AbortError-shaped
 * exception (matches what real provider streams do — fetch's AbortSignal
 * propagates as an Error with name='AbortError').
 *
 * `stopBeforeIndex`: when set, after emitting that many chunks the stub awaits
 * an external abort. The test signals abort, then resolves the stub's pending
 * promise so the throw happens.
 */
function makeAbortableLlmStub(opts: {
  readonly chunks: readonly string[];
  /** When set, the stub aborts (throws) instead of returning naturally. */
  readonly abortAfterChunk?: number;
  /** When set, throws this error on the chunk index instead of aborting. */
  readonly errorAfterChunk?: number;
  readonly errorToThrow?: Error;
  /** Returned when stream completes naturally. */
  readonly finalText?: string;
}) {
  return {
    streamAgentConversation: vi.fn(
      async (_input: AgentStreamInput, sopts: AgentStreamOptions): Promise<AgentStreamTurn> => {
        for (let i = 0; i < opts.chunks.length; i++) {
          // Check abort before emitting next chunk.
          if (sopts.signal.aborted) {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          sopts.onFrame({ type: 'token', text: opts.chunks[i] });
          // Allow microtasks to run (so test can flip abort after this chunk).
          await new Promise((r) => setImmediate(r));
          if (opts.abortAfterChunk !== undefined && i + 1 === opts.abortAfterChunk) {
            // Wait until signal is aborted by the test.
            await new Promise<void>((resolve) => {
              if (sopts.signal.aborted) { resolve(); return; }
              sopts.signal.addEventListener('abort', () => resolve(), { once: true });
            });
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          if (opts.errorAfterChunk !== undefined && i + 1 === opts.errorAfterChunk) {
            throw opts.errorToThrow ?? new Error('provider boom');
          }
        }
        // Natural completion — return the assembled text.
        const text = opts.finalText ?? opts.chunks.join('');
        return { text, toolCalls: [] };
      },
    ),
  };
}

function makeDispatcherStub() {
  return {
    dispatch: vi.fn(async (_call: ToolCallInput): Promise<ToolDispatchResult> => ({ ok: true })),
  };
}

const TOOLS: readonly ToolMetadata[] = [];

describe('AgentService — stop-persistence on AbortSignal', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildCtx();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('case 1: AbortSignal fires mid-stream after 2 chunks → markMessageStopped called with concatenated text', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['Hello ', 'world '],
      abortAfterChunk: 2,
    });
    const stoppedSpy = vi.spyOn(ctx.storage.conversations, 'markMessageStopped');
    const controller = new AbortController();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    // Kick off runTurn; abort it once token frames have flowed.
    let tokenCount = 0;
    const turnPromise = svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: (f) => {
        if (f.type === 'token') {
          tokenCount += 1;
          if (tokenCount === 2) controller.abort();
        }
      },
      signal: controller.signal,
    });

    await turnPromise;

    expect(stoppedSpy).toHaveBeenCalledTimes(1);
    const args = stoppedSpy.mock.calls[0];
    // (messageId, conversationId, orgId, finalContent)
    expect(args[1]).toBe(ctx.conversationId);
    expect(args[2]).toBe(ctx.orgId);
    expect(args[3]).toBe('Hello world ');
  });

  it('case 2: AbortSignal fires before any chunk arrives → markMessageStopped called with empty string', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['Hello'],
      abortAfterChunk: 1,
    });
    const stoppedSpy = vi.spyOn(ctx.storage.conversations, 'markMessageStopped');
    const controller = new AbortController();
    // Pre-abort — signal already aborted before runTurn enters the LLM.
    controller.abort();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: () => {},
      signal: controller.signal,
    });

    expect(stoppedSpy).toHaveBeenCalledTimes(1);
    expect(stoppedSpy.mock.calls[0][3]).toBe('');
  });

  it('case 3: audit row appended with toolName=message_stopped, outcome=success, outcomeDetail=stopped_by_user', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['Hi '],
      abortAfterChunk: 1,
    });
    const auditSpy = vi.spyOn(ctx.storage.agentAudit, 'append');
    const controller = new AbortController();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'hi',
      emit: (f) => {
        if (f.type === 'token') controller.abort();
      },
      signal: controller.signal,
    });

    const stopRows = auditSpy.mock.calls
      .map((c) => c[0])
      .filter((r) => r.toolName === 'message_stopped');
    expect(stopRows.length).toBe(1);
    expect(stopRows[0].outcome).toBe('success');
    expect(stopRows[0].outcomeDetail).toBe('stopped_by_user');
    expect(stopRows[0].userId).toBe(ctx.userId);
    expect(stopRows[0].orgId).toBe(ctx.orgId);
    expect(stopRows[0].conversationId).toBe(ctx.conversationId);
  });

  it('case 4: natural completion → markMessageStopped NOT called; assistant row persisted as sent', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['All ', 'good.'],
      finalText: 'All good.',
    });
    const stoppedSpy = vi.spyOn(ctx.storage.conversations, 'markMessageStopped');
    const controller = new AbortController();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: (f) => emits.push(f),
      signal: controller.signal,
    });

    expect(stoppedSpy).not.toHaveBeenCalled();
    // done frame fired naturally.
    expect(emits.some((f) => f.type === 'done')).toBe(true);
    // Assistant row persisted normally (not as 'stopped').
    const history = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant?.content).toBe('All good.');
    expect(lastAssistant?.status).not.toBe('stopped');
  });

  it('case 5: provider error mid-stream (not abort) → markMessageStopped NOT called', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['partial '],
      errorAfterChunk: 1,
      errorToThrow: new Error('upstream 502'),
    });
    const stoppedSpy = vi.spyOn(ctx.storage.conversations, 'markMessageStopped');
    const controller = new AbortController();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: (f) => emits.push(f),
      signal: controller.signal,
    });

    expect(stoppedSpy).not.toHaveBeenCalled();
    // The existing error path is preserved — error frame emitted.
    expect(emits.some((f) => f.type === 'error')).toBe(true);
  });

  it('case 6: after abort, no done frame is emitted', async () => {
    const llm = makeAbortableLlmStub({
      chunks: ['x ', 'y '],
      abortAfterChunk: 2,
    });
    const controller = new AbortController();

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => { throw new Error('noop'); },
    });

    const emits: SseFrame[] = [];
    let tokens = 0;
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: (f) => {
        emits.push(f);
        if (f.type === 'token') {
          tokens += 1;
          if (tokens === 2) controller.abort();
        }
      },
      signal: controller.signal,
    });

    const doneFrames = emits.filter((f) => f.type === 'done');
    expect(doneFrames.length).toBe(0);
  });
});
