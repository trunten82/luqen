/**
 * Phase 46 Plan 01 — Integration test for the async-honesty wiring.
 *
 * Validates the dispatcher path end-to-end:
 *   1. LLM (mocked) returns a tool_use block targeting dashboard_get_scan_progress.
 *   2. ToolDispatcher routes the call to the registered handler.
 *   3. Handler returns a progress payload.
 *   4. LLM (mocked) is invoked a second time with the tool result in context
 *      and produces a plain-text final answer.
 *
 * Scope: validates the MCP tool registration, dispatch wiring, and result
 * round-trip — NOT the LLM's behaviour against a real model. Model behaviour
 * (does the agent actually call the tool when asked "is it done?") is covered
 * by Phase 46 UAT against the live deployment.
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
  type ToolManifestEntry,
} from '../../src/agent/tool-dispatch.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { SseFrame } from '../../src/agent/sse-frames.js';

const TEST_PERMISSION = 'reports.view';

const TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'dashboard_get_scan_progress', requiredPermission: TEST_PERMISSION },
];

interface ProgressResponse {
  readonly scanId: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly pagesScanned: number;
  readonly totalPages: number | null;
  readonly etaSeconds: number | null;
  readonly lastUpdated: string;
  readonly finished: boolean;
  readonly siteUrl: string;
}

function makeProgressManifest(payload: ProgressResponse): {
  manifest: readonly ToolManifestEntry[];
  handler: ReturnType<typeof vi.fn>;
} {
  const handler = vi.fn().mockResolvedValue(payload);
  const manifest: readonly ToolManifestEntry[] = [
    {
      name: 'dashboard_get_scan_progress',
      inputSchema: z.object({ scanId: z.string() }),
      handler,
    },
  ];
  return { manifest, handler };
}

function makeLlmStub(script: AgentStreamTurn[]): {
  readonly streamAgentConversation: ReturnType<typeof vi.fn>;
  readonly calls: Array<{ readonly input: AgentStreamInput; readonly opts: AgentStreamOptions }>;
} {
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
  };
}

interface Ctx {
  storage: SqliteStorageAdapter;
  dbPath: string;
  userId: string;
  orgId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-46-async-honesty-integration-salt');
  const dbPath = join(tmpdir(), `test-async-honesty-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw
    .prepare(
      `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
       VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
    )
    .run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());

  const org = await storage.organizations.createOrg({
    name: 'Phase 46 Test Org',
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

function buildDispatcher(manifest: readonly ToolManifestEntry[]): ToolDispatcher {
  return new ToolDispatcher({
    tools: manifest,
    signer: {
      currentKid: 'phase46-test-kid',
      mintAccessToken: vi.fn().mockResolvedValue('test.jwt.string'),
    },
    dashboardMcpAudience: 'https://dashboard.test/mcp',
    resolveScopes: async () => ['admin.system'],
    timeoutMs: 5_000,
  });
}

describe('Phase 46 — async-honesty integration: LLM → dashboard_get_scan_progress → LLM', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildCtx();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('dispatches dashboard_get_scan_progress and routes the result back to the LLM', async () => {
    const progressPayload: ProgressResponse = {
      scanId: 'scan-abc',
      status: 'running',
      pagesScanned: 7,
      totalPages: null,
      etaSeconds: null,
      lastUpdated: '2026-04-28T12:00:00.000Z',
      finished: false,
      siteUrl: 'https://example.com',
    };
    const { manifest, handler } = makeProgressManifest(progressPayload);

    // Turn 1: LLM emits a single tool_use targeting the new tool.
    // Turn 2: LLM (with tool result in window) emits the final answer.
    const llm = makeLlmStub([
      {
        text: 'Checking the current scan progress.',
        toolCalls: [
          { id: 'call-1', name: 'dashboard_get_scan_progress', args: { scanId: 'scan-abc' } },
        ],
      },
      {
        text: 'The scan is still running — 7 pages scanned so far.',
        toolCalls: [],
      },
    ]);

    const dispatcher = buildDispatcher(manifest);
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOL_METADATA,
      dispatcher,
      resolvePermissions: async () => new Set([TEST_PERMISSION]),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => {
        throw new Error('noop in phase-46 integration suite');
      },
    });

    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'is the scan done?',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    // 1) Handler dispatched exactly once, with the right scanId.
    expect(handler).toHaveBeenCalledTimes(1);
    const [dispatchedArgs] = handler.mock.calls[0] as [Record<string, unknown>];
    expect(dispatchedArgs['scanId']).toBe('scan-abc');

    // 2) LLM called twice: once to emit the tool_use, once with the result in context.
    expect(llm.streamAgentConversation).toHaveBeenCalledTimes(2);

    // 3) Tool-result message persisted in the conversation window with the
    //    progress payload — so the next LLM turn sees the live status.
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(1);
    const toolResult = toolRows[0]?.toolResultJson ?? '';
    expect(toolResult).toContain('"running"');
    expect(toolResult).toContain('"pagesScanned":7');
    expect(toolResult).toContain('"siteUrl":"https://example.com"');
    expect(toolResult).toContain('"finished":false');

    // 4) Audit row records the dispatch.
    const audit = await ctx.storage.agentAudit.listForOrg(
      ctx.orgId,
      { toolName: 'dashboard_get_scan_progress' },
      { limit: 10 },
    );
    expect(audit.length).toBe(1);
    expect(audit[0].outcome).toBe('success');

    // 5) Done frame fires — turn completed.
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);
  });

  it('routes a "completed" progress payload through the dispatcher unchanged', async () => {
    const progressPayload: ProgressResponse = {
      scanId: 'scan-done',
      status: 'completed',
      pagesScanned: 50,
      totalPages: null,
      etaSeconds: null,
      lastUpdated: '2026-04-28T12:30:00.000Z',
      finished: true,
      siteUrl: 'https://example.com',
    };
    const { manifest, handler } = makeProgressManifest(progressPayload);
    const llm = makeLlmStub([
      {
        text: 'Probing scan status.',
        toolCalls: [
          { id: 'c1', name: 'dashboard_get_scan_progress', args: { scanId: 'scan-done' } },
        ],
      },
      { text: 'Yes — the scan completed.', toolCalls: [] },
    ]);

    const dispatcher = buildDispatcher(manifest);
    const svc = new AgentService({
      storage: ctx.storage,
      llm: llm as never,
      allTools: TOOL_METADATA,
      dispatcher,
      resolvePermissions: async () => new Set([TEST_PERMISSION]),
      config: { agentDisplayNameDefault: 'Luqen Assistant' },
      titleGenerator: async () => {
        throw new Error('noop in phase-46 integration suite');
      },
    });

    const emits: SseFrame[] = [];
    await svc.runTurn({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      userMessage: 'has scan-done finished?',
      emit: (f) => emits.push(f),
      signal: new AbortController().signal,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const window = await ctx.storage.conversations.getWindow(ctx.conversationId);
    const toolRows = window.filter((m) => m.role === 'tool');
    expect(toolRows.length).toBe(1);
    expect(toolRows[0]?.toolResultJson ?? '').toContain('"finished":true');
    expect(toolRows[0]?.toolResultJson ?? '').toContain('"status":"completed"');
    expect(emits.filter((f) => f.type === 'done').length).toBe(1);
  });
});
