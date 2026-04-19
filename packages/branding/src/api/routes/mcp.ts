/**
 * Branding MCP HTTP route — mounts the shared @luqen/core/mcp plugin at
 * POST /api/v1/mcp.
 *
 * Phase 31.1 Plan 03: when a JWKS-backed verifier is supplied, this route
 * installs a SCOPED preHandler that verifies dashboard-issued Bearer
 * tokens (audience-enforced). When absent, falls back to the service-global
 * middleware (Phase 28 / 29 behaviour).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SqliteAdapter } from '../../db/sqlite-adapter.js';
import { createMcpHttpPlugin } from '@luqen/core/mcp';
import type { TokenPayload, TokenVerifier } from '../../auth/oauth.js';
import { createBrandingMcpServer, BRANDING_TOOL_METADATA } from '../../mcp/server.js';

export interface BrandingMcpRouteOptions {
  readonly db: SqliteAdapter;
  readonly verifyMcpToken?: TokenVerifier;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: BrandingMcpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createBrandingMcpServer({ db: opts.db });
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: BRANDING_TOOL_METADATA,
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
