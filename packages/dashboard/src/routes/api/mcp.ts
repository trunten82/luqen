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
 * Phase 41-05 (OAPI-05): the MCP route now declares a schema so the
 * Fastify swagger generator emits a substantive entry for POST /api/v1/mcp,
 * and the dashboard MCP server's registered tools are bridged into the
 * spec as virtual operations under /api/v1/mcp/tools/{toolName} via
 * `registerMcpOpenApiOperations` from ../../mcp/openapi-bridge.js. Tool
 * Zod schemas are converted at runtime — no parallel hand-written JSON
 * Schemas (D-03).
 *
 * PITFALLS.md #9 — the MCP endpoint is Bearer-only. Cookie sessions are
 * deliberately NOT accepted here. server.ts bypasses the cookie-session
 * guard for /api/v1/mcp (using isBearerOnlyPath) so this scoped preHandler
 * is the sole authentication gate.
 */

import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { createMcpHttpPlugin, type McpHttpPluginOptions } from '@luqen/core/mcp';
import {
  createDashboardMcpServer,
  DASHBOARD_TOOL_METADATA,
  DASHBOARD_RESOURCE_METADATA,
} from '../../mcp/server.js';
import { createMcpAuthPreHandler, type McpTokenVerifier } from '../../mcp/middleware.js';
import {
  snapshotRegisteredTools,
  registerMcpOpenApiOperations,
} from '../../mcp/openapi-bridge.js';
import type { StorageAdapter } from '../../db/index.js';
import type { ScanService } from '../../services/scan-service.js';
import type { ServiceConnectionsRepository } from '../../db/service-connections-repository.js';
import type { ComplianceAccess } from '../../mcp/server.js';

export interface McpRouteOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
  readonly serviceConnections: ServiceConnectionsRepository;
  /**
   * Resolves the compliance service URL + service token per call. Used by
   * the four compliance discovery tools and the expanded dashboard_scan_site.
   * Optional — when omitted, those tools are skipped during registration.
   */
  readonly complianceAccess?: ComplianceAccess;
  /**
   * Absolute URL of this RS's `/.well-known/oauth-protected-resource`.
   * Surfaced in the `WWW-Authenticate` header on 401 so MCP clients can
   * discover the AS per RFC 6750 + MCP Authorization spec 2025-06-18.
   */
  readonly resourceMetadataUrl: string;
}

// JSON-RPC 2.0 body envelope for POST /api/v1/mcp. The route accepts every
// MCP method (tools/list, tools/call, resources/list, prompts/list, etc.)
// so the body is intentionally tolerant: only `jsonrpc` + `method` are
// required, `params` is method-specific, `id` is absent on notifications.
// additionalProperties: true tolerates SDK-version add-ons (e.g. _meta).
const JsonRpcRequest = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    method: Type.String(),
    id: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    params: Type.Optional(Type.Any()),
  },
  { additionalProperties: true },
);

const JsonRpcResponse = Type.Any();

const ErrorBody = Type.Object(
  {
    error: Type.String(),
    statusCode: Type.Optional(Type.Number()),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const MCP_ROUTE_SCHEMA = {
  tags: ['mcp'],
  summary: 'MCP Streamable HTTP JSON-RPC endpoint',
  description:
    'Single entry point for all MCP JSON-RPC traffic. Per-tool operations exposed at /api/v1/mcp/tools/{toolName} are virtual spec stubs — call this endpoint with a JSON-RPC body specifying method (e.g. "tools/call") and params.',
  body: JsonRpcRequest,
  response: {
    200: JsonRpcResponse,
    400: ErrorBody,
    401: ErrorBody,
  },
} as const;

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: McpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createDashboardMcpServer({
    storage: opts.storage,
    scanService: opts.scanService,
    serviceConnections: opts.serviceConnections,
    ...(opts.complianceAccess !== undefined
      ? { complianceAccess: opts.complianceAccess }
      : {}),
  });

  // Phase 41-05: snapshot the registered tools and inject one virtual
  // OpenAPI operation per tool. Done BEFORE the JSON-RPC route is wired
  // so the swagger generator captures all spec entries in a single pass.
  // Virtual routes mount on the parent `app` (not the encapsulated bearer
  // scope) — they are spec-only stubs that return 405 and need no auth.
  const toolSnapshots = snapshotRegisteredTools(mcpServer);
  registerMcpOpenApiOperations(app, toolSnapshots);

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
    routeSchema: MCP_ROUTE_SCHEMA as unknown as Record<string, unknown>,
  };
  const plugin = await createMcpHttpPlugin(
    pluginOptions as unknown as McpHttpPluginOptions,
  );
  await app.register(async (scoped) => {
    scoped.addHook(
      'preHandler',
      createMcpAuthPreHandler({
        verifyToken: opts.verifyToken,
        storage: opts.storage,
        resourceMetadataUrl: opts.resourceMetadataUrl,
      }),
    );
    await plugin(scoped, {});
  });
}
