/**
 * HARD-19: AgentService runs only the tool calls whose name is in the list it offered the model in
 * that iteration. Any other call is answered { error: 'denied' } before it reaches the dispatcher and
 * before the destructive-confirmation scan, and leaves one tool row and one agent audit row.
 *
 * The dispatcher here is a permissive spy that never refuses, so what is observed is AgentService's
 * own check.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ToolMetadata } from '@luqen/core/mcp';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { AgentService, type AgentStreamTurn } from '../../src/agent/agent-service.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import type { ToolCallInput } from '../../src/agent/tool-dispatch.js';
import type { SseFrame } from '../../src/agent/sse-frames.js';

const TOOLS: readonly ToolMetadata[] = [
  { name: 'tool_view', requiredPermission: 'reports.view' },
  { name: 'tool_users', requiredPermission: 'admin.users' },
  { name: 'tool_start', requiredPermission: 'scans.create', destructive: true },
];

interface Ctx {
  storage: SqliteStorageAdapter;
  userId: string;
  orgId: string;
  conversationId: string;
  dispatch: ReturnType<typeof vi.fn>;
  run(steps: Array<{ text: string; toolCalls: ToolCallInput[] }>): Promise<SseFrame[]>;
  toolRows(): Array<{ status: string; name: string; error: unknown }>;
  audit(): Array<{ toolName: string; outcome: string; outcomeDetail: string | null }>;
  cleanup(): Promise<void>;
}

async function buildCtx(perms: readonly string[]): Promise<Ctx> {
  setEncryptionSalt('agent-offered-tools-salt');
  const dbPath = join(tmpdir(), `test-agent-offered-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser('fabrikam-offered', 'Pass-word-123!', 'viewer');
  const org = await storage.organizations.createOrg({ name: 'Fabrikam Offered', slug: `fabrikam-offered-${randomUUID().slice(0, 6)}` });
  const conv = await storage.conversations.createConversation({ userId: user.id, orgId: org.id });
  const dispatch = vi.fn(async (call: ToolCallInput) => ({ ok: true, ran: call.name }));
  const raw = storage.getRawDatabase();

  const run = async (steps: Array<{ text: string; toolCalls: ToolCallInput[] }>): Promise<SseFrame[]> => {
    const queue = [...steps];
    const svc = new AgentService({
      storage,
      llm: {
        streamAgentConversation: async (): Promise<AgentStreamTurn> =>
          (queue.shift() ?? { text: 'done', toolCalls: [] }) as AgentStreamTurn,
      } as never,
      allTools: TOOLS,
      dispatcher: { dispatch },
      resolvePermissions: async () => new Set(perms),
      config: { agentDisplayNameDefault: 'Assistant' },
      titleGenerator: async () => {
        throw new Error('no title');
      },
      turnRegistry: new ActiveTurnRegistry(),
    });
    const frames: SseFrame[] = [];
    await svc.runTurn({
      conversationId: conv.id,
      userId: user.id,
      orgId: org.id,
      userMessage: 'go',
      emit: (f: SseFrame) => frames.push(f),
      signal: new AbortController().signal,
    });
    return frames;
  };

  return {
    storage,
    userId: user.id,
    orgId: org.id,
    conversationId: conv.id,
    dispatch,
    run,
    toolRows: () =>
      (raw.prepare(`SELECT status, tool_call_json, tool_result_json FROM agent_messages
                    WHERE conversation_id = ? AND role = 'tool' ORDER BY created_at, rowid`)
        .all(conv.id) as Array<{ status: string; tool_call_json: string; tool_result_json: string | null }>)
        .map((r) => ({
          status: r.status,
          name: (JSON.parse(r.tool_call_json) as { name: string }).name,
          error: r.tool_result_json === null ? undefined : (JSON.parse(r.tool_result_json) as Record<string, unknown>)['error'],
        })),
    audit: () =>
      (raw.prepare(`SELECT tool_name, outcome, outcome_detail FROM agent_audit_log WHERE conversation_id = ? ORDER BY created_at, rowid`)
        .all(conv.id) as Array<{ tool_name: string; outcome: string; outcome_detail: string | null }>)
        .map((r) => ({ toolName: r.tool_name, outcome: r.outcome, outcomeDetail: r.outcome_detail })),
    cleanup: async () => {
      await storage.disconnect();
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
    },
  };
}

describe('HARD-19 AgentService runs only the tools it offered', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('a user holding reports.view only', () => {
    beforeEach(async () => {
      ctx = await buildCtx(['reports.view']);
    });

    it('HARD-19 the assistant refuses a tool outside the offered list before dispatch', async () => {
      const frames = await ctx.run([
        { text: 'x', toolCalls: [{ id: 'c1', name: 'tool_users', args: {} }] },
        { text: 'done', toolCalls: [] },
      ]);
      expect(ctx.dispatch).not.toHaveBeenCalled();
      expect(ctx.toolRows()).toEqual([{ status: 'failed', name: 'tool_users', error: 'denied' }]);
      expect(ctx.audit()).toEqual([{ toolName: 'tool_users', outcome: 'denied', outcomeDetail: 'denied' }]);
      expect(frames[frames.length - 1]).toEqual({ type: 'done' });
    });

    it('HARD-19 the assistant asks no confirmation for a tool outside the offered list', async () => {
      const frames = await ctx.run([
        { text: 'x', toolCalls: [{ id: 'c1', name: 'tool_start', args: {} }] },
        { text: 'done', toolCalls: [] },
      ]);
      expect(frames.some((f) => f.type === 'pending_confirmation')).toBe(false);
      expect(ctx.toolRows().some((r) => r.status === 'pending_confirmation')).toBe(false);
      expect(ctx.dispatch).not.toHaveBeenCalled();
      expect(ctx.toolRows()).toEqual([{ status: 'failed', name: 'tool_start', error: 'denied' }]);
    });

    it('HARD-19 the assistant runs the offered calls of a batch and refuses the rest', async () => {
      await ctx.run([
        {
          text: 'x',
          toolCalls: [
            { id: 'c1', name: 'tool_view', args: { n: 1 } },
            { id: 'c2', name: 'tool_users', args: {} },
            { id: 'c3', name: 'tool_view', args: { n: 3 } },
          ],
        },
        { text: 'done', toolCalls: [] },
      ]);
      expect(ctx.dispatch.mock.calls.map((c) => (c[0] as ToolCallInput).id)).toEqual(['c1', 'c3']);
      expect(ctx.toolRows()).toEqual([
        { status: 'sent', name: 'tool_view', error: undefined },
        { status: 'failed', name: 'tool_users', error: 'denied' },
        { status: 'sent', name: 'tool_view', error: undefined },
      ]);
      expect(ctx.audit().map((a) => a.outcome)).toEqual(['success', 'denied', 'success']);
    });
  });
});
