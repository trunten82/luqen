/**
 * Branding MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp. Auth is inherited from the service-global preHandler
 * hook (see api/server.ts). Tool catalogue is empty in Phase 28; populated
 * in Phase 29 (MCPT-02).
 */

import type { FastifyInstance } from 'fastify';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import { createBrandingMcpServer, BRANDING_TOOL_METADATA } from '../../mcp/server.js';

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const { server: mcpServer } = await createBrandingMcpServer();
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: BRANDING_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(plugin);
}
