/**
 * registerMcpRoutes — wires the dashboard's empty McpServer stub behind the
 * shared @luqen/core/mcp HTTP plugin, scoped under a Bearer-only preHandler.
 *
 * The route is registered in an encapsulated Fastify context so the
 * dashboard's cookie-session preHandlers (globally attached) do not govern
 * the MCP endpoint. The scoped Bearer preHandler authenticates and
 * populates request.tokenPayload / request.orgId / request.authType /
 * request.permissions in the shape extractToolContext (from @luqen/core/mcp)
 * expects. The shared plugin then filters tools/list by RBAC and dispatches
 * tool calls over Streamable HTTP.
 *
 * PITFALLS.md #9 — the MCP endpoint is Bearer-only. Cookie sessions are
 * deliberately NOT accepted here. server.ts bypasses the cookie-session
 * guard for /api/v1/mcp (using isBearerOnlyPath) so this scoped preHandler
 * is the sole authentication gate.
 */

import type { FastifyInstance } from 'fastify';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import { createDashboardMcpServer, DASHBOARD_TOOL_METADATA } from '../../mcp/server.js';
import { createMcpAuthPreHandler, type McpTokenVerifier } from '../../mcp/middleware.js';

export interface McpRouteOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: {
    readonly roles: {
      getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>>;
    };
  };
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: McpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createDashboardMcpServer();
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: DASHBOARD_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', createMcpAuthPreHandler(opts));
    await plugin(scoped, {});
  });
}
