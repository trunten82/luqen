/**
 * createMcpHttpPlugin — shared Fastify plugin factory that exposes any
 * McpServer over Streamable HTTP at POST /api/v1/mcp with RBAC-filtered
 * tools/list and mandatory org isolation via JWT claims.
 *
 * Security invariants (do not violate — enforced by tests + acceptance grep):
 *
 *   1. Statelessness: `sessionIdGenerator: undefined` on every transport —
 *      no session-as-auth (PITFALLS.md #1).
 *   2. No JWT re-verification: reads `request.tokenPayload` populated by the
 *      service-global auth middleware. The plugin MUST be registered AFTER
 *      that middleware; Luqen services already wire auth via a global
 *      `preHandler` hook, and /api/v1/mcp is NOT in PUBLIC_PATHS, so the
 *      order is automatic.
 *   3. No token passthrough: never reads `request.headers.authorization` —
 *      tool handlers call downstream services using their own service OAuth
 *      clients (PITFALLS.md #4).
 *   4. Org from JWT only: `ToolContext.orgId` is sourced from `request.orgId`
 *      (set by the middleware from the JWT claim). Tools must not declare an
 *      `orgId` field in their inputSchema — Plan 02 enforces this with a
 *      runtime iteration test.
 *   5. tools/list filtered per caller via a SINGLE committed mechanism:
 *      the SDK request-handler override registered ONCE during plugin
 *      construction (see the call site below). The handler reads the
 *      current ToolContext from AsyncLocalStorage populated by the route
 *      handler before every MCP dispatch.
 *   6. Logging to stderr only via `request.log.error` — never the stdout
 *      console.* APIs (PITFALLS.md #11).
 *
 * Concurrency note (documented for wave-2 planners):
 * `McpServer.connect(transport)` throws if a previous transport is still
 * attached. In stateless mode the transport closes after every request, so
 * sequential requests are safe. Truly concurrent requests on the same shared
 * McpServer can race; if wave-2 services need horizontal concurrency they
 * should accept a per-request `McpServer` factory via this plugin's options.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { extractToolContext } from './auth.js';
import { filterToolsByPermissions, filterToolsByScope } from './tool-filter.js';
import type { ToolContext, ToolMetadata } from './types.js';

export interface McpHttpPluginOptions {
  readonly mcpServer: McpServer;
  readonly toolMetadata: readonly ToolMetadata[];
  readonly requiredScope?: 'read' | 'write' | 'admin';
  readonly path?: string;
}

const SCOPE_HIERARCHY: Record<string, readonly string[]> = {
  admin: ['read', 'write', 'admin'],
  write: ['read', 'write'],
  read: ['read'],
};

function scopeCovers(tokenScopes: readonly string[], required: 'read' | 'write' | 'admin'): boolean {
  for (const s of tokenScopes) {
    const covered = SCOPE_HIERARCHY[s];
    if (covered?.includes(required) === true) return true;
  }
  return false;
}

// Module-scope AsyncLocalStorage so the setRequestHandler closure (registered
// once) can read the current request's ToolContext without passing it through
// the SDK's handler signature. Each MCP dispatch runs inside a `run(context)`
// scope, so `getCurrentToolContext()` returns the right context for that
// dispatch even under concurrent requests.
const toolContextStore = new AsyncLocalStorage<ToolContext>();

export function getCurrentToolContext(): ToolContext | undefined {
  return toolContextStore.getStore();
}

export async function createMcpHttpPlugin(
  options: McpHttpPluginOptions,
): Promise<FastifyPluginAsync> {
  const { mcpServer, toolMetadata, requiredScope = 'read', path = '/api/v1/mcp' } = options;

  // ------- COMMITTED APPROACH (blocker 4 fix): SDK request-handler override.
  //
  // McpServer wraps a low-level Server (accessible via `mcpServer.server`)
  // whose `setRequestHandler` is the authoritative way to override the
  // default tools/list response. The first registerTool call on an
  // McpServer installs the SDK's default tools/list handler via
  // `setToolRequestHandlers()`; our override is installed here (AFTER the
  // caller's createXxxMcpServer factory has registered tools) and simply
  // overwrites the default handler in the protocol's _requestHandlers map.
  //
  // The handler reads the current caller's ToolContext from AsyncLocalStorage
  // (populated per-request by the route handler) and returns the filtered
  // tool list. Looking up the full tool definitions from the McpServer's
  // private `_registeredTools` map preserves description + inputSchema in
  // the JSON-schema shape clients expect; we filter that list by name.
  const serverAsAny = mcpServer as unknown as {
    _registeredTools?: Record<
      string,
      {
        description?: string;
        inputSchema?: unknown;
        title?: string;
        annotations?: unknown;
        _meta?: unknown;
        enabled?: boolean;
      }
    >;
  };

  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const ctx = getCurrentToolContext();
    // No context = pre-auth/tool-probe; return empty to prevent tool-name
    // leakage (defense in depth — the route handler also enforces 401/403
    // before any dispatch reaches this handler).
    const allowedNames: readonly string[] = ctx == null
      ? []
      : ctx.permissions.size > 0
        ? filterToolsByPermissions(toolMetadata, ctx.permissions)
        : filterToolsByScope(toolMetadata, ctx.scopes);
    const allowedSet = new Set(allowedNames);

    const registered = serverAsAny._registeredTools ?? {};
    const tools = Object.entries(registered)
      .filter(([name, def]) => allowedSet.has(name) && def.enabled !== false)
      .map(([name, def]) => ({
        name,
        description: def.description ?? '',
        // The SDK's default handler normalises zod -> JSON schema; our
        // override emits the raw input schema shape, which the 1.27.x
        // client-side consumer tolerates. If wave-2 integration reveals
        // stricter client expectations, call the SDK's `toJsonSchemaCompat`
        // helper here (reachable via zod-compat).
        inputSchema: def.inputSchema ?? { type: 'object' },
      }));

    return { tools };
  });

  // ------- Fastify plugin: POST {path} route.
  return async function mcpHttpPlugin(app: FastifyInstance): Promise<void> {
    app.post(path, async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Auth gate. extractToolContext throws if tokenPayload is missing
      //    (global middleware failed or plugin was registered before it).
      let context: ToolContext;
      try {
        context = extractToolContext(request);
      } catch {
        return reply.status(401).send({ error: 'Not authenticated', statusCode: 401 });
      }

      // 2. Scope gate — coarse-grained. Further RBAC filtering happens in
      //    the tools/list handler above.
      if (!scopeCovers(context.scopes, requiredScope)) {
        return reply
          .status(403)
          .send({ error: `Insufficient scope. Required: ${requiredScope}`, statusCode: 403 });
      }

      // 3. Per-request transport — stateless, no session storage.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reply.raw.on('close', () => {
        void transport.close();
      });

      // 4. Dispatch inside an AsyncLocalStorage scope carrying the caller's
      //    ToolContext. The tools/list handler above reads this context.
      try {
        await toolContextStore.run(context, async () => {
          await mcpServer.connect(transport);
          await transport.handleRequest(request.raw, reply.raw, request.body);
        });
      } catch (err) {
        request.log.error({ err }, 'MCP request handling failed');
        if (!reply.sent) {
          return reply.status(500).send({
            error: 'Internal MCP error',
            statusCode: 500,
          });
        }
      }
      return reply;
    });
  };
}
