/**
 * registerMcpRoutes — wires the dashboard MCP server behind the shared
 * @luqen/core/mcp HTTP plugin, scoped under a Bearer-only preHandler.
 *
 * The route is registered in an encapsulated Fastify context so the
 * dashboard's cookie-session preHandlers (globally attached) do not govern
 * the MCP endpoint. The scoped Bearer preHandler authenticates and
 * populates request.tokenPayload / request.orgId / request.authType /
 * request.permissions in the shape extractToolContext (from @luqen/core/mcp)
 * expects. The shared plugin then filters tools/list by RBAC and dispatches
 * tool calls over Streamable HTTP.
 *
 * Phase 30-02 extends McpRouteOptions with a full StorageAdapter (so data
 * tools can reach storage.scans + storage.brandScores) and a ScanService
 * (so dashboard_scan_site can kick off async scans via initiateScan). It
 * also threads DASHBOARD_RESOURCE_METADATA from the resources module into
 * createMcpHttpPlugin; plan 30-01 (Wave 1, parallel) adds the
 * `resourceMetadata` option to the core plugin's interface. Until that
 * change lands, the extra option is passed via a typed object cast so the
 * current isolated TypeScript build still compiles (documented as a
 * Rule 3 cross-plan deviation in 30-02-SUMMARY.md).
 *
 * PITFALLS.md #9 — the MCP endpoint is Bearer-only. Cookie sessions are
 * deliberately NOT accepted here. server.ts bypasses the cookie-session
 * guard for /api/v1/mcp (using isBearerOnlyPath) so this scoped preHandler
 * is the sole authentication gate.
 */

import type { FastifyInstance } from 'fastify';
import { createMcpHttpPlugin, type McpHttpPluginOptions } from '@luqen/core/mcp';
import {
  createDashboardMcpServer,
  DASHBOARD_TOOL_METADATA,
  DASHBOARD_RESOURCE_METADATA,
} from '../../mcp/server.js';
import { createMcpAuthPreHandler, type McpTokenVerifier } from '../../mcp/middleware.js';
import type { StorageAdapter } from '../../db/index.js';
import type { ScanService } from '../../services/scan-service.js';
import type { ServiceConnectionsRepository } from '../../db/service-connections-repository.js';

export interface McpRouteOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
  readonly serviceConnections: ServiceConnectionsRepository;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: McpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createDashboardMcpServer({
    storage: opts.storage,
    scanService: opts.scanService,
    serviceConnections: opts.serviceConnections,
  });

  // Phase 30-01 (Wave 1, parallel) extends McpHttpPluginOptions with a
  // `resourceMetadata` field used by the ListResourcesRequestSchema
  // override. Until that branch is merged, we construct the options with
  // the extra field and cast through `unknown` so excess-property checking
  // does not reject the isolated Wave 1 build. Once 30-01 lands the cast
  // becomes a no-op and the option is consumed for real. Value here is an
  // empty array in plan 30-02 (populated by plan 30-04), so runtime
  // behaviour is unaffected either way.
  const pluginOptions = {
    mcpServer,
    toolMetadata: DASHBOARD_TOOL_METADATA,
    resourceMetadata: DASHBOARD_RESOURCE_METADATA,
    requiredScope: 'read' as const,
  };
  const plugin = await createMcpHttpPlugin(
    pluginOptions as unknown as McpHttpPluginOptions,
  );
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', createMcpAuthPreHandler(opts));
    await plugin(scoped, {});
  });
}
