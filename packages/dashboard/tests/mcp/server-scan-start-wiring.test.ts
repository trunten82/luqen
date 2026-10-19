/**
 * HARD-15 — createDashboardMcpServer hands the page scan tool the scan service it was given.
 *
 * The page tool's own tests build the tool directly with an injected spender, and the createServer
 * wiring test only observes the scan service handed to registerMcpRoutes. Neither covers the
 * hand-off inside createDashboardMcpServer: if the tool were registered without the service, it
 * would fall back to a limiter of its own and every other test would stay green while the page
 * tool drew from a different bucket than the scan form. This test builds the real MCP server
 * through createDashboardMcpServer and drives the page tool through a client.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runInToolContext, type ToolContext } from '@luqen/core/mcp';
import type { DirectScanner } from '@luqen/core';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { SCAN_RATE_LIMIT_ERROR, ScanService, createScanStartLimiter } from '../../src/services/scan-service.js';

const CALLER = 'user-wiring-page-tool';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function build() {
  const store = new Map<string, readonly number[]>();
  const limiter = createScanStartLimiter({ now: () => 1_000_000, store });
  // consumeScanStart reads only the limiter; storage, orchestrator and config are not touched.
  const scanService = new ScanService({} as never, {} as never, {} as never, undefined, limiter);
  const scan = vi.fn().mockResolvedValue({ url: 'data:text/html,example', issues: [] });
  const { server } = await createDashboardMcpServer({
    storage: {} as never,
    scanService,
    serviceConnections: {} as never,
    scanner: { scan } as unknown as DirectScanner,
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close());
  const context: ToolContext = {
    orgId: 'org-fabrikam',
    userId: CALLER,
    // The state a caller holding scans.create reaches over HTTP (a write-tier permission needs the write scope).
    scopes: ['read', 'write'],
    permissions: new Set<string>(['scans.create']),
    authType: 'jwt',
  };
  const call = () =>
    runInToolContext(context, () =>
      client.callTool({ name: 'dashboard_scan_page', arguments: { html: '<p>example</p>' } }));
  return { call, scan, store, limiter };
}

const textOf = (r: Awaited<ReturnType<Client['callTool']>>): string =>
  (r.content as Array<{ text: string }>)[0]?.text ?? '';

describe('createDashboardMcpServer scan start wiring', () => {
  it('HARD-15 createDashboardMcpServer hands the page tool the scan service it was given', async () => {
    const full = await build();
    for (let i = 0; i < 30; i += 1) full.limiter.record(`user:${CALLER}`);
    const refused = await full.call();
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain(SCAN_RATE_LIMIT_ERROR);
    expect(full.scan).not.toHaveBeenCalled();

    const room = await build();
    const started = await room.call();
    expect(started.isError).toBeFalsy();
    // The start was charged to the limiter of the service the server was built with.
    expect(room.store.get(`user:${CALLER}`)).toHaveLength(1);
    expect(room.scan).toHaveBeenCalledTimes(1);
  });
});
