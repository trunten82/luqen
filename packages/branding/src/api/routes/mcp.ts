/**
 * Branding MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp. Auth is inherited from the service-global preHandler
 * hook (see api/server.ts). Tool catalogue (4 tools) registered in Phase 29.
 */

import type { FastifyInstance } from 'fastify';
import type { SqliteAdapter } from '../../db/sqlite-adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import { createBrandingMcpServer, BRANDING_TOOL_METADATA } from '../../mcp/server.js';

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: { readonly db: SqliteAdapter },
): Promise<void> {
  const { server: mcpServer } = await createBrandingMcpServer({ db: opts.db });
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: BRANDING_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(plugin);
}
