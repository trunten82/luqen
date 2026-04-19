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
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import type { TokenPayload, TokenVerifier } from '../../auth/oauth.js';
import { createComplianceMcpServer, COMPLIANCE_TOOL_METADATA } from '../../mcp/server.js';

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
