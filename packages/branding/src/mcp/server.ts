/**
 * createBrandingMcpServer — MCP transport stub for the branding service.
 *
 * Phase 28 delivers the MCP TRANSPORT layer for this service. Tool definitions
 * land in Phase 29 (MCPT-02). The server is intentionally empty here; the
 * HTTP plugin wraps it and responds with a valid but empty `tools/list`.
 *
 * Server identity (name/version) is used by MCP clients to distinguish this
 * service's endpoint from the other three Luqen services.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import { VERSION } from '../version.js';

export const BRANDING_TOOL_METADATA: readonly ToolMetadata[] = [];

export async function createBrandingMcpServer(
  _options: Record<string, never> = {},
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: readonly ToolMetadata[];
}> {
  // Declare `tools` capability up-front so the @luqen/core/mcp plugin can
  // install its `ListToolsRequestSchema` handler even though we have zero
  // tools registered in Phase 28. Without this, Server.setRequestHandler
  // throws "Server does not support tools" (protocol capability gate).
  const server = new McpServer(
    { name: 'luqen-branding', version: VERSION },
    { capabilities: { tools: {} } },
  );
  return { server, toolNames: [], metadata: BRANDING_TOOL_METADATA };
}
