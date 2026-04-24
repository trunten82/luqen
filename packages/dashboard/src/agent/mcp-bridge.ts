/**
 * Phase 32.1 Plan 02 — in-process bridge from the dashboard MCP server to
 * the AgentService ToolDispatcher.
 *
 * The MCP server registers tools with (description, inputSchema, handler).
 * Handlers read caller identity via `getCurrentToolContext()` (an
 * AsyncLocalStorage). This bridge:
 *
 *   - extracts the registered tools via the SDK-internal `_registeredTools` map,
 *   - exposes a toolCatalog for the LLM (name → description + inputSchema),
 *   - wraps each MCP handler in a ToolHandler that re-enters the ALS context
 *     so the handler's `getCurrentToolContext()` sees the dispatching user.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { runInToolContext, type ToolContext, type ToolMetadata } from '@luqen/core/mcp';
import type { AgentToolCatalogEntry } from './agent-service.js';
import type { ToolManifestEntry } from './tool-dispatch.js';
import { z as zod } from 'zod';

interface RegisteredToolLike {
  readonly description?: string;
  readonly inputSchema?: z.ZodTypeAny;
  readonly handler: (args: Record<string, unknown>, extra?: unknown) => unknown;
  readonly enabled?: boolean;
}

interface McpServerWithInternals {
  readonly _registeredTools?: Record<string, RegisteredToolLike>;
}

function zodShapeToObject(schema: z.ZodTypeAny | undefined): z.ZodTypeAny {
  if (schema == null) return zod.object({});
  return schema;
}

function jsonSchemaFromZod(schema: z.ZodTypeAny | undefined): Record<string, unknown> {
  if (schema == null) return { type: 'object', properties: {} };
  // Minimal shape — avoid a full zod-to-json-schema dependency. Enumerate top-
  // level keys from ZodObject.shape; anything else falls back to a plain
  // object type so Ollama / OpenAI / Anthropic don't 400.
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (shape == null || typeof shape !== 'object') {
    return { type: 'object', properties: {} };
  }
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const desc = (value as unknown as { description?: string }).description;
    properties[key] = { type: 'string', ...(desc != null ? { description: desc } : {}) };
    const isOptional =
      typeof (value as unknown as { isOptional?: () => boolean }).isOptional === 'function' &&
      (value as unknown as { isOptional: () => boolean }).isOptional();
    if (!isOptional) required.push(key);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export interface McpBridgeOutput {
  readonly catalog: Record<string, AgentToolCatalogEntry>;
  readonly manifest: readonly ToolManifestEntry[];
}

/**
 * Build a {catalog, manifest} pair from an MCP server's registered tools.
 * The catalog is passed to AgentService for LLM-visible tool metadata; the
 * manifest is passed to ToolDispatcher for in-process execution.
 *
 * `allTools` supplies the RBAC metadata surface for scope/permission gating
 * by the AgentService — the bridge covers every registered tool; AgentService
 * filters by RBAC per-turn.
 */
export function bridgeMcpToolsForAgent(
  mcpServer: McpServer,
  allTools: readonly ToolMetadata[],
): McpBridgeOutput {
  const internals = mcpServer as unknown as McpServerWithInternals;
  const registered = internals._registeredTools ?? {};

  const catalog: Record<string, AgentToolCatalogEntry> = {};
  const manifest: ToolManifestEntry[] = [];

  for (const meta of allTools) {
    const entry = registered[meta.name];
    if (entry == null || entry.enabled === false) continue;

    catalog[meta.name] = {
      description: entry.description ?? '',
      inputSchema: jsonSchemaFromZod(entry.inputSchema),
    };

    const zodSchema = zodShapeToObject(entry.inputSchema);

    manifest.push({
      name: meta.name,
      inputSchema: zodSchema,
      handler: async (args, ctx) => {
        // Re-enter the MCP ALS context so handlers that call
        // `getCurrentToolContext()` see the dispatching user's identity.
        //
        // Global admins (ctx.orgId starts with `__admin__:`) are not bound
        // to a specific org — tools must run cross-org. Substitute the
        // synthetic namespace with an empty orgId and stamp admin.system
        // in permissions so the dashboard's admin-scoped handlers pick the
        // cross-org branch.
        const isGlobalAdmin = ctx.orgId.startsWith('__admin__:');
        const toolContext: ToolContext = {
          userId: ctx.userId,
          orgId: isGlobalAdmin ? '' : ctx.orgId,
          scopes: ['read', 'write', 'admin'],
          permissions: isGlobalAdmin
            ? new Set<string>(['admin.system', 'admin.users', 'admin.org', 'scans.create', 'reports.view', 'branding.view'])
            : new Set<string>(),
          authType: 'jwt',
        };
        return runInToolContext(toolContext, async () => {
          // MCP handler expects (args, extra) where extra is the request's
          // `RequestHandlerExtra`. For in-process dispatch an empty object is
          // acceptable since our handlers never read from it.
          const result = await entry.handler(args, {});
          return result;
        });
      },
    });
  }

  return { catalog, manifest };
}
