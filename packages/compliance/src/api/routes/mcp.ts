/**
 * Compliance MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp. Auth inheritance: this route is NOT in PUBLIC_PATHS of
 * the global auth middleware, so the service-wide preHandler populates
 * request.tokenPayload / request.orgId / request.authType BEFORE the plugin
 * runs. No JWT re-verification happens here.
 */

import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import { createComplianceMcpServer, COMPLIANCE_TOOL_METADATA } from '../../mcp/server.js';

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: { readonly db: DbAdapter },
): Promise<void> {
  const { server: mcpServer } = await createComplianceMcpServer({ db: opts.db });
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: COMPLIANCE_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(plugin);
}
