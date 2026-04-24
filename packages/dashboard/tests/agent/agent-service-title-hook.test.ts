/**
 * Phase 35 Plan 03 Task 1 (RED) — AgentService post-first-assistant title hook.
 *
 * Behaviour contract (per 35-03 plan):
 *   1. First assistant turn on a title-less conversation triggers the hook
 *      exactly once; the resulting title is persisted via
 *      storage.conversations.renameConversation.
 *   2. The hook is fire-and-forget — the `done` SSE frame emits before the
 *      title write resolves (SSE latency unaffected).
 *   3. A conversation that already has a non-null title does NOT trigger.
 *   4. The second assistant turn on the same conversation does NOT trigger
 *      again (the plan's isFirstAssistantTurn guard OR title-null check).
 *   5. Generator rejection does NOT crash the turn — the exception is
 *      swallowed because the generator itself guarantees a fallback title.
 *      (AgentService.catch-only-swallow policy, documented inline.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import type { ToolMetadata } from '@luqen/core/mcp';
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
  setEncryptionSalt('phase-35-03-title-hook-salt');
  const dbPath = join(tmpdir(), `test-agent-title-hook-${randomUUID()}.db`);
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

function makeDispatcherStub() {
  return {
    dispatch: vi.fn(async (_call: ToolCallInput): Promise<ToolDispatchResult> => ({ ok: true })),
  };
}

const TOOLS: readonly ToolMetadata[] = [];

/**
 * Wait until all pending microtasks (including the fire-and-forget title write)
 * settle. The hook is `void this.#titleGenerator(...).then(renameConversation)`,
 * which resolves on a microtask — a single await is enough to flush it in the
 * happy path; we add a short tick to be safe under CI scheduling.
 */
async function flushFireAndForget(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe('AgentService — post-first-assistant title hook', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildCtx();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('fires once on first assistant turn of a title-less conversation and persists the generated title', async () => {
    const llm = makeLlmStub([{ text: 'Here is your answer.', toolCalls: [] }]);
    const titleGenerator = vi.fn(async () => 'Generated Title');
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator,
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'what can you do?',
      emit: () => {},
      signal: new AbortController().signal,
    });

    await flushFireAndForget();

    expect(titleGenerator).toHaveBeenCalledTimes(1);
    const firstArgs = titleGenerator.mock.calls[0][0] as {
      orgId: string;
      userId: string;
      userMessage: string;
      assistantReply: string;
      agentDisplayName: string;
    };
    expect(firstArgs.orgId).toBe(ctx.orgId);
    expect(firstArgs.userId).toBe(ctx.userId);
    expect(firstArgs.userMessage).toBe('what can you do?');
    expect(firstArgs.assistantReply).toBe('Here is your answer.');

    const conv = await ctx.storage.conversations.getConversation(ctx.conversationId, ctx.orgId);
    expect(conv?.title).toBe('Generated Title');
  });

  it('does NOT fire when the conversation already has a non-null title', async () => {
    await ctx.storage.conversations.renameConversation(
      ctx.conversationId,
      ctx.orgId,
      'Pre-existing Title',
    );
    const llm = makeLlmStub([{ text: 'OK.', toolCalls: [] }]);
    const titleGenerator = vi.fn(async () => 'Should Not Happen');
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator,
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'hi',
      emit: () => {},
      signal: new AbortController().signal,
    });
    await flushFireAndForget();

    expect(titleGenerator).not.toHaveBeenCalled();
    const conv = await ctx.storage.conversations.getConversation(ctx.conversationId, ctx.orgId);
    expect(conv?.title).toBe('Pre-existing Title');
  });

  it('does NOT fire on the second assistant turn of the same conversation', async () => {
    const llm = makeLlmStub([
      { text: 'First reply.', toolCalls: [] },
      { text: 'Second reply.', toolCalls: [] },
    ]);
    const titleGenerator = vi.fn(async () => 'Generated Title');
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator,
    });

    // Turn 1 — should trigger.
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'first',
      emit: () => {},
      signal: new AbortController().signal,
    });
    await flushFireAndForget();

    // Turn 2 — must NOT trigger again (conversation now has a title).
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'second',
      emit: () => {},
      signal: new AbortController().signal,
    });
    await flushFireAndForget();

    expect(titleGenerator).toHaveBeenCalledTimes(1);
  });

  it('emits the SSE done frame BEFORE the title-write resolves (fire-and-forget)', async () => {
    const llm = makeLlmStub([{ text: 'Answer.', toolCalls: [] }]);
    let resolveTitle: (v: string) => void = () => {};
    const titlePromise = new Promise<string>((r) => { resolveTitle = r; });
    const titleGenerator = vi.fn(async () => titlePromise);
    const doneAt: number[] = [];
    const renameSpy = vi.spyOn(ctx.storage.conversations, 'renameConversation');

    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator,
    });

    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'go',
      emit: (f) => {
        if (f.type === 'done') doneAt.push(Date.now());
      },
      signal: new AbortController().signal,
    });

    // runTurn has returned AND the done frame fired while the title promise
    // is still pending. Rename must not have been called yet.
    expect(doneAt.length).toBe(1);
    expect(renameSpy).not.toHaveBeenCalled();

    // Now resolve the title and flush — rename should fire.
    resolveTitle('Delayed Title');
    await flushFireAndForget();
    expect(renameSpy).toHaveBeenCalledTimes(1);
    const conv = await ctx.storage.conversations.getConversation(ctx.conversationId, ctx.orgId);
    expect(conv?.title).toBe('Delayed Title');
  });

  it('generator rejection is swallowed (never throws up to caller) and conversation stays untitled', async () => {
    const llm = makeLlmStub([{ text: 'Answer.', toolCalls: [] }]);
    const titleGenerator = vi.fn(async () => {
      throw new Error('boom');
    });
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOLS,
      dispatcher: makeDispatcherStub() as never,
      resolvePermissions: async () => new Set(),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator,
    });

    await expect(
      svc.runTurn({
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        orgId: ctx.orgId,
        userMessage: 'hi',
        emit: () => {},
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
    await flushFireAndForget();

    expect(titleGenerator).toHaveBeenCalledTimes(1);
    // Rejection is swallowed — conversation is left untitled (the generator's
    // own fallback normally handles this; stub here skips that path).
    const conv = await ctx.storage.conversations.getConversation(ctx.conversationId, ctx.orgId);
    expect(conv?.title).toBeNull();
  });
});
