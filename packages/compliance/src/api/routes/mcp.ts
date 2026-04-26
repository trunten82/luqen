/**
 * Compliance MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp.
 *
 * Phase 31.1 Plan 03 (D-33 / D-04): when a JWKS-backed verifier is
 * supplied, this route installs a SCOPED preHandler that verifies
 * dashboard-issued Bearer tokens (audience-enforced) and populates
 * request.tokenPayload / request.orgId / request.authType in the shape
 * the shared MCP plugin's extractToolContext expects. The service-wide
 * global middleware (which validates local-signed tokens from
 * /api/v1/oauth/token) adds /api/v1/mcp to PUBLIC_PATHS so only this
 * scoped preHandler governs MCP auth — preserving D-10 (internal
 * /api/v1/oauth/token path untouched) while enforcing RFC 8707 audience
 * binding on the MCP-facing bearer.
 *
 * Backwards-compat: if `verifyMcpToken` is not supplied, falls through
 * to the Phase 28 behaviour where global middleware governs MCP auth.
 *
 * Phase 41-01: an `onRoute` hook injects an OpenAPI schema for the
 * `/api/v1/mcp` POST that the shared core plugin registers, so the
 * route appears in `app.swagger()` output and the route-vs-spec gate
 * passes. The body is a permissive JSON-RPC envelope (D-05 tolerant).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import type { TokenPayload, TokenVerifier } from '../../auth/oauth.js';
import { createComplianceMcpServer, COMPLIANCE_TOOL_METADATA } from '../../mcp/server.js';

const McpJsonRpcBody = Type.Object(
  {
    jsonrpc: Type.Optional(Type.Literal('2.0')),
    method: Type.Optional(Type.String()),
    id: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    params: Type.Optional(Type.Any()),
  },
  { additionalProperties: true },
);

const McpJsonRpcResponse = Type.Any();

const McpRouteSchema = {
  // schema: openapi for the MCP /api/v1/mcp POST endpoint
  tags: ['mcp'],
  summary: 'MCP Streamable HTTP endpoint (JSON-RPC 2.0)',
  body: McpJsonRpcBody,
  response: {
    200: McpJsonRpcResponse,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
  },
};

export interface ComplianceMcpRouteOptions {
  readonly db: DbAdapter;
  /**
   * Phase 31.1 Plan 03: JWKS-backed verifier for the external MCP endpoint.
   * When provided, a scoped preHandler gates /api/v1/mcp with this verifier
   * (audience-enforced). When absent, falls back to the service-global
   * middleware (Phase 28 behaviour).
   */
  readonly verifyMcpToken?: TokenVerifier;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: ComplianceMcpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createComplianceMcpServer({ db: opts.db });
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: COMPLIANCE_TOOL_METADATA,
    requiredScope: 'read',
  });

  if (opts.verifyMcpToken != null) {
    const verifyMcpToken = opts.verifyMcpToken;
    await app.register(async (scoped) => {
      // Phase 41-01: inject OpenAPI schema for the MCP route registered
      // by the shared core plugin (which has no schema-injection hook).
      scoped.addHook('onRoute', (route) => {
        if (route.path === '/api/v1/mcp' && route.method === 'POST' && route.schema == null) {
          route.schema = McpRouteSchema;
        }
      });
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

  // Phase 41-01: same schema injection on the global registration path
  // when no JWKS verifier is supplied (Phase 28 backwards-compat).
  app.addHook('onRoute', (route) => {
    if (route.path === '/api/v1/mcp' && route.method === 'POST' && route.schema == null) {
      route.schema = McpRouteSchema;
    }
  });
  await app.register(plugin);
}
