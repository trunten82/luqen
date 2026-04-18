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
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { extractToolContext } from './auth.js';
import {
  filterToolsByPermissions,
  filterToolsByScope,
  filterResourcesByPermissions,
  filterResourcesByScope,
} from './tool-filter.js';
import type { ResourceMetadata, ToolContext, ToolMetadata } from './types.js';

export interface McpHttpPluginOptions {
  readonly mcpServer: McpServer;
  readonly toolMetadata: readonly ToolMetadata[];
  /**
   * Phase 30 D-12: metadata-driven RBAC filter for MCP Resources. When provided
   * and non-empty, the plugin installs ListResourcesRequestSchema +
   * ReadResourceRequestSchema overrides that gate resource visibility and read
   * access by URI scheme. When omitted or empty, resources/list and
   * resources/read fall through to the SDK defaults (Phase 28 backwards-compat).
   */
  readonly resourceMetadata?: readonly ResourceMetadata[];
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

  // ------- Phase 30 D-12: Resources RBAC overrides.
  //
  // When `resourceMetadata` is non-empty, install two SDK request-handler
  // overrides that gate Resources per caller:
  //
  //   1. ListResourcesRequestSchema — filters both static resources and
  //      template-list results to URI schemes the caller's perms/scopes allow.
  //   2. ReadResourceRequestSchema — re-checks the RBAC gate on every direct
  //      read (does NOT trust the list filter to have excluded the URI) and
  //      throws McpError InvalidParams 'Forbidden' when the scheme is denied.
  //
  // When `resourceMetadata` is undefined/empty, these overrides are NOT
  // installed — the SDK's default resource dispatch remains authoritative
  // (backwards-compat with Phase 28 call sites that don't opt in).
  const resourceMetadata = options.resourceMetadata ?? [];
  if (resourceMetadata.length > 0) {
    // Private-field access to SDK's internal resource registries. Mirrors the
    // _registeredTools access pattern used above for the tools override.
    const serverForResources = mcpServer as unknown as {
      _registeredResources?: Record<
        string,
        {
          enabled: boolean;
          name: string;
          metadata?: Record<string, unknown>;
          readCallback: (uri: URL, extra: unknown) => unknown | Promise<unknown>;
        }
      >;
      _registeredResourceTemplates?: Record<
        string,
        {
          resourceTemplate: {
            uriTemplate: {
              toString(): string;
              match(uri: string): Record<string, string> | null;
            };
            listCallback?: (
              extra: unknown,
            ) =>
              | { resources: Array<Record<string, unknown>> }
              | Promise<{ resources: Array<Record<string, unknown>> }>;
          };
          metadata?: Record<string, unknown>;
          readCallback: (
            uri: URL,
            variables: Record<string, string>,
            extra: unknown,
          ) => unknown | Promise<unknown>;
        }
      >;
    };

    function computeAllowedSchemes(ctx: ToolContext | undefined): readonly string[] {
      if (ctx == null) return [];
      return ctx.permissions.size > 0
        ? filterResourcesByPermissions(resourceMetadata, ctx.permissions)
        : filterResourcesByScope(resourceMetadata, ctx.scopes);
    }

    function uriScheme(uri: string): string {
      const idx = uri.indexOf('://');
      return idx < 0 ? '' : uri.slice(0, idx);
    }

    mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async (_request, extra) => {
      const ctx = getCurrentToolContext();
      // No context = defense-in-depth empty response. Route handler already
      // rejects unauthenticated requests with 401 before dispatch.
      if (ctx == null) return { resources: [] };

      const allowedSet = new Set(computeAllowedSchemes(ctx));

      // Merge static resources + template list results (mirrors SDK default
      // dispatch in @modelcontextprotocol/sdk/server/mcp.js setResourceRequestHandlers).
      const staticEntries = Object.entries(serverForResources._registeredResources ?? {})
        .filter(([, r]) => r.enabled !== false)
        .map(([uri, r]) => ({ uri, name: r.name, ...(r.metadata ?? {}) }));

      const templateEntries: Array<Record<string, unknown>> = [];
      for (const t of Object.values(serverForResources._registeredResourceTemplates ?? {})) {
        if (t.resourceTemplate.listCallback == null) continue;
        const listed = await t.resourceTemplate.listCallback(extra);
        for (const entry of listed.resources ?? []) {
          // Spread template metadata first, then entry — entry fields win.
          templateEntries.push({ ...(t.metadata ?? {}), ...entry });
        }
      }

      const all = [...staticEntries, ...templateEntries];
      const filtered = all.filter((r) => {
        const uri = typeof r['uri'] === 'string' ? (r['uri'] as string) : '';
        return allowedSet.has(uriScheme(uri));
      });

      return { resources: filtered };
    });

    mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const ctx = getCurrentToolContext();
      if (ctx == null) {
        throw new McpError(ErrorCode.InvalidParams, 'Not authenticated');
      }
      const uri = String(request.params.uri);
      const scheme = uriScheme(uri);
      const allowedSchemes = computeAllowedSchemes(ctx);
      if (!allowedSchemes.includes(scheme)) {
        // Exact string 'Forbidden' per threat model T-30-01-03 — no URI echo,
        // no row data, no internal state leaked.
        throw new McpError(ErrorCode.InvalidParams, 'Forbidden');
      }

      // Exact-match static resource first (mirrors SDK default).
      const exact = serverForResources._registeredResources?.[uri];
      if (exact != null && exact.enabled !== false) {
        const parsed = new URL(uri);
        return (await exact.readCallback(parsed, extra)) as never;
      }

      // Otherwise walk templates, invoke the first matching readCallback.
      for (const t of Object.values(serverForResources._registeredResourceTemplates ?? {})) {
        const vars = t.resourceTemplate.uriTemplate.match(uri);
        if (vars != null) {
          const parsed = new URL(uri);
          return (await t.readCallback(parsed, vars, extra)) as never;
        }
      }

      throw new McpError(ErrorCode.InvalidParams, `Resource ${uri} not found`);
    });
  }

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
