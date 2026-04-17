/**
 * LLM MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp. Auth is inherited from the service-global preHandler
 * hook (see api/server.ts). Tool catalogue is empty in Phase 28; populated
 * in Phase 29 (MCPT-03).
 */

import type { FastifyInstance } from 'fastify';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import { createLlmMcpServer, LLM_TOOL_METADATA } from '../../mcp/server.js';

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const { server: mcpServer } = await createLlmMcpServer();
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: LLM_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(plugin);
}
