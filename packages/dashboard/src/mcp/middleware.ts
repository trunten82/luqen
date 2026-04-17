/**
 * Bearer-only MCP authentication preHandler for the dashboard's /api/v1/mcp
 * endpoint.
 *
 * PITFALLS.md #9 — MCP endpoint is Bearer-only. Cookie sessions are REJECTED
 * even when present, because cookie auth without CSRF protection on a
 * tool-invoking endpoint is vulnerable to cross-origin POST. The MCP
 * endpoint uses ONLY the Authorization: Bearer header.
 *
 * This preHandler:
 *   1. Reads Authorization: Bearer ... (reply 401 if missing/wrong scheme)
 *   2. Calls the injected verifyToken (RS256 jose.jwtVerify) — reply 401 on failure
 *   3. Decorates the request with tokenPayload / authType='jwt' / orgId / permissions
 *      in the shape @luqen/core/mcp's extractToolContext expects
 *
 * RBAC is resolved here via resolveEffectivePermissions (the dashboard's
 * authoritative permission resolver) so the scoped Bearer context matches
 * what cookie-session users see for the same (userId, orgId).
 *
 * The preHandler does NOT read the cookie session decorator or any user
 * object set by the cookie-session auth guard — the MCP endpoint is
 * entirely Bearer-driven by design. The acceptance grep enforces this.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { resolveEffectivePermissions } from '../permissions.js';

// Local re-declaration — avoids cross-package import of compliance/auth/oauth.
// Must remain structurally compatible with packages/compliance/src/auth/oauth.ts
// TokenPayload (extended with optional `role` for RBAC admin shortcut).
export interface McpTokenPayload {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId?: string;
  readonly role?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export type McpTokenVerifier = (token: string) => Promise<McpTokenPayload>;

export interface McpAuthPreHandlerOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: {
    readonly roles: {
      getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>>;
    };
  };
}

export function createMcpAuthPreHandler(opts: McpAuthPreHandlerOptions) {
  return async function mcpAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      await reply.status(401).send({ error: 'Bearer token required', statusCode: 401 });
      return;
    }

    const token = authHeader.slice(7);
    let payload: McpTokenPayload;
    try {
      payload = await opts.verifyToken(token);
    } catch {
      await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
      return;
    }

    const userRole = payload.role ?? 'member';
    const permissions = await resolveEffectivePermissions(
      opts.storage.roles,
      payload.sub,
      userRole,
      payload.orgId,
    );

    (request as FastifyRequest & { tokenPayload: McpTokenPayload }).tokenPayload = payload;
    (request as FastifyRequest & { authType: string }).authType = 'jwt';
    (request as FastifyRequest & { orgId: string }).orgId = payload.orgId ?? 'system';
    (request as FastifyRequest & { permissions: Set<string> }).permissions = permissions;
  };
}
