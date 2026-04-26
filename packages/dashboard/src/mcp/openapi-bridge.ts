/**
 * Phase 41-05 (OAPI-05) — MCP → OpenAPI bridge.
 *
 * The dashboard hosts the MCP Streamable HTTP endpoint at POST /api/v1/mcp.
 * From the OpenAPI consumer's perspective that single endpoint accepts a
 * JSON-RPC body and dispatches to one of N tools. This bridge augments the
 * Fastify swagger spec with one virtual operation per registered MCP tool
 * mounted at POST /api/v1/mcp/tools/{toolName}, each carrying the JSON
 * Schema converted at runtime from the tool's existing Zod input schema
 * via `zod-to-json-schema`. The virtual route handlers return 405 with a
 * pointer back to the JSON-RPC entry — they exist purely for OpenAPI
 * discoverability per Phase 41 D-03 (tools remain the single source of
 * truth; no hand-written JSON Schemas).
 *
 * Determinism:
 *   - snapshotRegisteredTools() sorts the resulting array by `name` so the
 *     downstream snapshot is stable regardless of Map iteration order.
 *   - Output JSON is sourced from `zod-to-json-schema`, which is itself
 *     deterministic for a given input.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface RegisteredToolSnapshot {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputJsonSchema: Record<string, unknown>;
  readonly outputJsonSchema?: Record<string, unknown>;
}

interface RegisteredToolLike {
  readonly title?: string;
  readonly description?: string;
  // The MCP SDK stores the registered Zod schemas (already wrapped in
  // z.object() at registration time by getZodSchemaObject).
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly enabled?: boolean;
}

interface McpServerWithInternals {
  // The SDK exposes registered tools on the inner Server via this private
  // field. Mirrors the pattern used by packages/dashboard/src/agent/mcp-bridge.ts
  // (Phase 32.1) for the in-process agent dispatcher.
  readonly _registeredTools?: Record<string, RegisteredToolLike>;
}

const FALLBACK_OBJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
};

/**
 * Strip JSON-Schema-only top-level keys (`$schema`) and force tolerant
 * `additionalProperties: true` to honour Phase 41 D-05. Mutates a copy
 * (the caller hands in the conversion result, never a Zod-internal object).
 */
function normaliseJsonSchema(json: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = json;
  void _drop;
  // D-05: tolerant by default. zod's emitter sets additionalProperties=false on
  // objects; the OpenAPI surface elsewhere in this codebase intentionally
  // accepts extra fields silently (existing internal callers send superset
  // payloads). Override unconditionally for top-level objects.
  if (rest['type'] === 'object') {
    rest['additionalProperties'] = true;
  }
  return rest;
}

/**
 * Convert a Zod schema to a JSON Schema, preferring zod v4's native
 * `z.toJSONSchema()` (the dashboard runs on zod ^4.3.6 — see
 * packages/dashboard/package.json). Falls back to the `zod-to-json-schema`
 * library for any v3 schema that may slip through (the MCP SDK supports
 * both v3 and v4 — see node_modules/.../server/zod-compat.js — and the
 * v3 emitter's output for v4 schemas is `{}`, so we must dispatch by
 * version detection).
 */
function convertZod(schema: unknown): Record<string, unknown> | undefined {
  if (schema === undefined || schema === null) return undefined;

  // zod v4 schemas carry a `_zod` internal property; v3 carries `_def`.
  const isV4 =
    typeof schema === 'object' &&
    (schema as { _zod?: unknown })._zod !== undefined;

  try {
    if (isV4) {
      // Zod v4 native emitter — produces JSON Schema 2020-12 by default.
      const json = (z as unknown as { toJSONSchema: (s: unknown) => unknown }).toJSONSchema(
        schema,
      );
      if (json !== null && typeof json === 'object') {
        return normaliseJsonSchema(json as Record<string, unknown>);
      }
      return undefined;
    }
    // v3 — `target: 'openApi3'` is OpenAPI 3.0 friendly; `$refStrategy: 'none'`
    // inlines sub-schemas so each operation is self-contained.
    const json = zodToJsonSchema(schema as never, {
      target: 'openApi3',
      $refStrategy: 'none',
    });
    if (json !== null && typeof json === 'object') {
      return normaliseJsonSchema(json as Record<string, unknown>);
    }
    return undefined;
  } catch {
    // Defensive: a malformed/unsupported schema must not break snapshot
    // generation for the rest of the catalogue.
    return undefined;
  }
}

/**
 * Walk the registered tool table on an McpServer instance and produce a
 * stable, sorted list of snapshots whose Zod inputs have been converted
 * to JSON Schema. Source of truth: tool registration calls in
 * packages/dashboard/src/mcp/tools/{data,admin}.ts.
 */
export function snapshotRegisteredTools(
  server: McpServer,
): readonly RegisteredToolSnapshot[] {
  const internals = server as unknown as McpServerWithInternals;
  const registered = internals._registeredTools ?? {};

  const entries: RegisteredToolSnapshot[] = [];
  for (const [name, tool] of Object.entries(registered)) {
    if (tool === undefined || tool.enabled === false) continue;
    const inputJsonSchema = convertZod(tool.inputSchema) ?? FALLBACK_OBJECT_SCHEMA;
    const outputJsonSchema = convertZod(tool.outputSchema);
    entries.push({
      name,
      ...(tool.title !== undefined ? { title: tool.title } : {}),
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      inputJsonSchema,
      ...(outputJsonSchema !== undefined ? { outputJsonSchema } : {}),
    });
  }

  // Deterministic ordering — Map/Object key order depends on insertion which
  // depends on registration order in tools/{data,admin}.ts. Sorting once here
  // means the snapshot is stable even if registration order is reshuffled.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/**
 * Register one virtual GET-405 route per MCP tool so the Fastify swagger
 * generator emits a discoverable OpenAPI operation per tool. The actual
 * MCP traffic is served by POST /api/v1/mcp (the JSON-RPC entry — owned
 * by routes/api/mcp.ts). These virtual routes are spec-only.
 */
export function registerMcpOpenApiOperations(
  app: FastifyInstance,
  tools: readonly RegisteredToolSnapshot[],
): void {
  const handler405 = async (
    _req: unknown,
    reply: FastifyReply,
  ): Promise<unknown> => {
    return reply.status(405).send({
      error: 'Use POST /api/v1/mcp with a JSON-RPC body',
      statusCode: 405,
    });
  };

  for (const tool of tools) {
    const path = `/api/v1/mcp/tools/${tool.name}`;
    app.route({
      method: 'POST',
      url: path,
      schema: {
        tags: ['mcp-tool'],
        operationId: `mcp.tool.${tool.name}`,
        summary: tool.title ?? tool.name,
        description:
          (tool.description ?? '') +
          '\n\nCall via POST /api/v1/mcp with a JSON-RPC `tools/call` body. ' +
          'This path exists in the OpenAPI spec for tool discoverability only ' +
          '— direct POSTs to this URL return 405.',
        body: tool.inputJsonSchema,
        response: {
          200: tool.outputJsonSchema ?? {
            type: 'object',
            additionalProperties: true,
            description: 'MCP tool result envelope (JSON-RPC response)',
          },
          405: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              statusCode: { type: 'number' },
            },
          },
        },
      },
      handler: handler405,
    });
  }
}
