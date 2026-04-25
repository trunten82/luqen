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

describe('ToolDispatcher.dispatchAll', () => {
  it('Test 1: dispatchAll([]) returns [] without calling signer or resolveScopes', async () => {
    const signer = makeSigner();
    const resolveScopes = vi.fn().mockResolvedValue(['reports.view']);
    const dispatcher = new ToolDispatcher({
      tools: [],
      signer,
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes,
    });

    const results = await dispatcher.dispatchAll([], { userId: 'u1', orgId: 'o1' });
    expect(results).toEqual([]);
    expect(resolveScopes).not.toHaveBeenCalled();
    expect(signer.mintAccessToken).not.toHaveBeenCalled();
  });

  it('Test 2: returns results in INPUT order, not completion order', async () => {
    const handlerA = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ tag: 'A' }), 50)),
    );
    const handlerB = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ tag: 'B' }), 10)),
    );
    const handlerC = vi.fn().mockResolvedValue({ tag: 'C' });

    const dispatcher = new ToolDispatcher({
      tools: [
        makeTool('toolA', z.object({}).strict(), handlerA),
        makeTool('toolB', z.object({}).strict(), handlerB),
        makeTool('toolC', z.object({}).strict(), handlerC),
      ],
      signer: makeSigner(),
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
    });

    const results = await dispatcher.dispatchAll(
      [
        { id: 'a', name: 'toolA', args: {} },
        { id: 'b', name: 'toolB', args: {} },
        { id: 'c', name: 'toolC', args: {} },
      ],
      { userId: 'u1', orgId: 'o1' },
    );

    expect(results).toEqual([{ tag: 'A' }, { tag: 'B' }, { tag: 'C' }]);
  });

  it('Test 3: runs handlers concurrently — wall-clock < 90ms for two 50ms handlers', async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50));
    const dispatcher = new ToolDispatcher({
      tools: [
        makeTool('s1', z.object({}).strict(), slow),
        makeTool('s2', z.object({}).strict(), slow),
      ],
      signer: makeSigner(),
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
    });

    const start = performance.now();
    const results = await dispatcher.dispatchAll(
      [
        { id: '1', name: 's1', args: {} },
        { id: '2', name: 's2', args: {} },
      ],
      { userId: 'u1', orgId: 'o1' },
    );
    const elapsed = performance.now() - start;
    expect(results).toHaveLength(2);
    expect(elapsed).toBeLessThan(90);
  });

  it('Test 4: per-call timeout sentinel does not abort siblings', async () => {
    const fast = vi.fn().mockResolvedValue({ tag: 'fast' });
    const hang = vi.fn().mockImplementation(() => new Promise<unknown>(() => {}));
    const dispatcher = new ToolDispatcher({
      tools: [
        makeTool('fast', z.object({}).strict(), fast),
        makeTool('hang', z.object({}).strict(), hang),
        makeTool('fast2', z.object({}).strict(), fast),
      ],
      signer: makeSigner(),
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
      timeoutMs: 20,
    });

    const results = await dispatcher.dispatchAll(
      [
        { id: '1', name: 'fast', args: {} },
        { id: '2', name: 'hang', args: {} },
        { id: '3', name: 'fast2', args: {} },
      ],
      { userId: 'u1', orgId: 'o1' },
    );

    expect(results[0]).toEqual({ tag: 'fast' });
    expect(results[1]).toEqual({ error: 'timeout' });
    expect(results[2]).toEqual({ tag: 'fast' });
  });

  it('Test 5: unknown_tool sentinel in middle slot does not propagate to siblings', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, value: 1 });
    const dispatcher = new ToolDispatcher({
      tools: [makeTool('known', z.object({}).strict(), ok)],
      signer: makeSigner(),
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
    });

    const results = await dispatcher.dispatchAll(
      [
        { id: '1', name: 'known', args: {} },
        { id: '2', name: 'mystery', args: {} },
        { id: '3', name: 'known', args: {} },
      ],
      { userId: 'u1', orgId: 'o1' },
    );

    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1]).toEqual({ error: 'unknown_tool' });
    expect(results[2]).toEqual({ ok: true, value: 1 });
  });

  it('Test 6: pre-aborted ctx.signal — dispatchAll resolves with per-handler outcomes, does not throw', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise<unknown>(() => {}));
    const dispatcher = new ToolDispatcher({
      tools: [makeTool('hang', z.object({}).strict(), handler)],
      signer: makeSigner(),
      dashboardMcpAudience: 'https://dashboard/mcp',
      resolveScopes: async () => ['reports.view'],
      timeoutMs: 20,
    });

    const ac = new AbortController();
    ac.abort();

    const results = await dispatcher.dispatchAll(
      [
        { id: '1', name: 'hang', args: {} },
        { id: '2', name: 'hang', args: {} },
      ],
      { userId: 'u1', orgId: 'o1', signal: ac.signal },
    );

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toHaveProperty('error');
      expect(['timeout', 'internal']).toContain((r as { error: string }).error);
    }
  });
});
