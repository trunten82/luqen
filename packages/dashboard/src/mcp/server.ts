/**
 * Dashboard MCP server stub — the dashboard's McpServer for Phase 28.
 *
 * Phase 28 delivers MCP TRANSPORT for the dashboard. Dashboard tools
 * (user mgmt, org mgmt, service connections, etc.) arrive in Phase 30
 * (MCPT-04) — Phase 28 registers ZERO tools so we can prove the transport
 * + Bearer-only auth end-to-end without leaking admin tool names or
 * surface area.
 *
 * Downstream consumers:
 *   - registerMcpRoutes (routes/api/mcp.ts) calls this factory and hands
 *     the returned McpServer to createMcpHttpPlugin.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import { VERSION } from '../version.js';

export const DASHBOARD_TOOL_METADATA: readonly ToolMetadata[] = [];

export async function createDashboardMcpServer(): Promise<{
  readonly server: McpServer;
  readonly toolNames: readonly string[];
  readonly metadata: readonly ToolMetadata[];
}> {
  const server = new McpServer({
    name: 'luqen-dashboard',
    version: VERSION,
  });
  // The SDK only auto-registers the 'tools' capability when registerTool is
  // invoked at least once. Phase 28 ships with ZERO tools (Phase 30 populates),
  // so we must declare the capability explicitly — otherwise
  // createMcpHttpPlugin's setRequestHandler(ListToolsRequestSchema, ...)
  // override throws "Server does not support tools".
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return { server, toolNames: [], metadata: DASHBOARD_TOOL_METADATA };
}
