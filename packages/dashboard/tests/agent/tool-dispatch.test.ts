/**
 * Phase 32 Plan 04 Task 1 (RED) — tool-dispatch tests.
 *
 * Tests 11-15 of plan 32-04. Exercises ToolDispatcher:
 *   - in-process invocation for a known tool returns handler result
 *   - zod validation failure returns invalid_args and skips dispatch
 *   - unknown tool name returns unknown_tool
 *   - 30s timeout converts to a typed timeout error
 *   - per-dispatch JWT mint records the current user's scopes
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import {
  ToolDispatcher,
  type ToolHandler,
  type ToolManifestEntry,
} from '../../src/agent/tool-dispatch.js';

function makeTool(name: string, inputSchema: z.ZodTypeAny, handler: ToolHandler): ToolManifestEntry {
  return { name, inputSchema, handler };
}

function makeSigner() {
  return {
    currentKid: 'test-kid',
    mintAccessToken: vi.fn().mockResolvedValue('test.jwt.string'),
  };
}

describe('ToolDispatcher.dispatch', () => {
  it('Test 11: invokes the in-process handler and returns its result', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true, value: 42 });
    const tool = makeTool(
      'dashboard_list_reports',
      z.object({}).strict(),
      handler,
    );
    const signer = makeSigner();
    const dispatcher = new ToolDispatcher({
      tools: [tool],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
    });

    const result = await dispatcher.dispatch(
      { id: 'c1', name: 'dashboard_list_reports', args: {} },
      { userId: 'u1', orgId: 'o1' },
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('Test 12: zod-invalid args → invalid_args, handler NOT called', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const tool = makeTool(
      'dashboard_list_reports',
      z.object({ siteUrl: z.string().url() }).strict(),
      handler,
    );
    const signer = makeSigner();
    const dispatcher = new ToolDispatcher({
      tools: [tool],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
    });

    const result = await dispatcher.dispatch(
      { id: 'c1', name: 'dashboard_list_reports', args: { siteUrl: 'not-a-url' } },
      { userId: 'u1', orgId: 'o1' },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: 'invalid_args' });
    expect(Array.isArray((result as { issues?: unknown[] }).issues)).toBe(true);
  });

  it('Test 13: unknown tool name → unknown_tool', async () => {
    const tool = makeTool(
      'dashboard_list_reports',
      z.object({}).strict(),
      vi.fn().mockResolvedValue({}),
    );
    const signer = makeSigner();
    const dispatcher = new ToolDispatcher({
      tools: [tool],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => [],
    });

    const result = await dispatcher.dispatch(
      { id: 'c1', name: 'dashboard_definitely_not_a_tool', args: {} },
      { userId: 'u1', orgId: 'o1' },
    );
    expect(result).toEqual({ error: 'unknown_tool' });
  });

  it('Test 14: 30s timeout → typed timeout error', async () => {
    // handler never resolves
    const handler = vi.fn().mockImplementation(() => new Promise<unknown>(() => {}));
    const tool = makeTool(
      'dashboard_list_reports',
      z.object({}).strict(),
      handler,
    );
    const signer = makeSigner();
    const dispatcher = new ToolDispatcher({
      tools: [tool],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
      timeoutMs: 20, // override default 30000 so the test runs fast
    });

    const result = await dispatcher.dispatch(
      { id: 'c1', name: 'dashboard_list_reports', args: {} },
      { userId: 'u1', orgId: 'o1' },
    );
    expect(result).toEqual({ error: 'timeout' });
  });

  it('Test 15: mintAgentToken called per dispatch with resolved scopes', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const tool = makeTool(
      'dashboard_list_reports',
      z.object({}).strict(),
      handler,
    );
    const signer = makeSigner();
    const resolveScopes = vi.fn().mockResolvedValue(['scans.view', 'reports.view']);
    const dispatcher = new ToolDispatcher({
      tools: [tool],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes,
    });

    await dispatcher.dispatch(
      { id: 'c1', name: 'dashboard_list_reports', args: {} },
      { userId: 'u1', orgId: 'o1' },
    );
    await dispatcher.dispatch(
      { id: 'c2', name: 'dashboard_list_reports', args: {} },
      { userId: 'u1', orgId: 'o1' },
    );
    // Per-dispatch resolution (Pitfall 5): called once per dispatch, not cached.
    expect(resolveScopes).toHaveBeenCalledTimes(2);
    expect(signer.mintAccessToken).toHaveBeenCalledTimes(2);
    const firstCallArgs = signer.mintAccessToken.mock.calls[0][0];
    expect(firstCallArgs.sub).toBe('u1');
    expect(firstCallArgs.orgId).toBe('o1');
    expect(firstCallArgs.scopes).toEqual(['scans.view', 'reports.view']);
    expect(firstCallArgs.clientId).toBe('__agent-internal__');
    expect(firstCallArgs.expiresInSeconds).toBe(300);
  });
});
