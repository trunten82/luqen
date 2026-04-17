/**
 * createLlmMcpServer — MCP transport stub for the LLM service.
 *
 * Phase 28 delivers the MCP TRANSPORT layer for this service. Tool definitions
 * land in Phase 29 (MCPT-03). The server is intentionally empty here; the
 * HTTP plugin wraps it and responds with a valid but empty `tools/list`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import { VERSION } from '../version.js';

export const LLM_TOOL_METADATA: readonly ToolMetadata[] = [];

export async function createLlmMcpServer(
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
    { name: 'luqen-llm', version: VERSION },
    { capabilities: { tools: {} } },
  );
  return { server, toolNames: [], metadata: LLM_TOOL_METADATA };
}
