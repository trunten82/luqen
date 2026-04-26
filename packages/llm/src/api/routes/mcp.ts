/**
 * LLM MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp.
 *
 * Phase 31.1 Plan 03: when a JWKS-backed verifier is supplied, this route
 * installs a SCOPED preHandler that verifies dashboard-issued Bearer
 * tokens (audience-enforced). When absent, falls back to the service-global
 * middleware (Phase 28 / 29 behaviour).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import type { TokenPayload, TokenVerifier } from '../../auth/oauth.js';
import { createLlmMcpServer, LLM_TOOL_METADATA } from '../../mcp/server.js';

// Phase 41-03 — JSON-RPC envelope (loose) for the MCP Streamable HTTP route.
// Tool inputs/outputs are documented per-tool inside the MCP protocol itself;
// this route schema documents the transport envelope only.
const McpJsonRpcBody = Type.Object(
  {
    jsonrpc: Type.Optional(Type.Literal('2.0')),
    id: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    method: Type.Optional(Type.String()),
    params: Type.Optional(Type.Any()),
  },
  { additionalProperties: true },
);

// schema: passed to the MCP plugin via routeSchema below — registers as the
// `app.post('/api/v1/mcp', { schema: ... })` Fastify route schema.
const McpRouteSchema = {
  tags: ['mcp'],
  summary: 'MCP Streamable HTTP endpoint (JSON-RPC over POST)',
  description:
    'Bearer-token gated. Body is a JSON-RPC 2.0 envelope; per-tool input/output schemas are advertised via tools/list.',
  body: McpJsonRpcBody,
  response: {
    200: LuqenResponse(Type.Any()),
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    500: ErrorEnvelope,
  },
} as const;

export interface LlmMcpRouteOptions {
  readonly db: DbAdapter;
  readonly verifyMcpToken?: TokenVerifier;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: LlmMcpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createLlmMcpServer({ db: opts.db });
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: LLM_TOOL_METADATA,
    requiredScope: 'read',
    routeSchema: McpRouteSchema as unknown as Record<string, unknown>,
  });

  if (opts.verifyMcpToken != null) {
    const verifyMcpToken = opts.verifyMcpToken;
    await app.register(async (scoped) => {
      scoped.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization;
        if (authHeader == null || !authHeader.startsWith('Bearer ')) {
          await reply.status(401).send({ error: 'Bearer token required', statusCode: 401 });
          return;
        }
        const token = authHeader.slice(7);
        let payload: TokenPayload;
        try {
          payload = await verifyMcpToken(token);
        } catch {
          await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
          return;
        }
        (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = payload;
        (request as FastifyRequest & { authType: string }).authType = 'jwt';
        (request as FastifyRequest & { orgId: string }).orgId = payload.orgId ?? 'system';
      });
      await plugin(scoped, {});
    });
    return;
  }

  await app.register(plugin);
}
