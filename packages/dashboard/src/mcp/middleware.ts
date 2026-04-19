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
  /**
   * Phase 31.2 D-20 bullet 3 — the OAuth client that issued this token.
   * Optional because pre-31.2 tokens lack it; the middleware silently skips
   * the revoked-client check when absent (no forced re-auth on deploy).
   */
  readonly client_id?: string;
}

export type McpTokenVerifier = (token: string) => Promise<McpTokenPayload>;

export interface McpAuthPreHandlerOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: {
    readonly roles: {
      getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>>;
    };
    /**
     * Phase 31.2 D-20 bullet 3 — post-verifyToken client-status check.
     * Only `revokedAt` is read; other fields are irrelevant to the middleware.
     */
    readonly oauthClients: {
      findByClientId(clientId: string): Promise<{ readonly revokedAt: Date | string | null } | null>;
    };
  };
  /**
   * Absolute URL of this resource server's `/.well-known/oauth-protected-resource`
   * endpoint. Emitted in the `WWW-Authenticate` header on 401 responses per RFC 6750
   * + MCP Authorization spec 2025-06-18 so external MCP clients can discover the
   * authorization server. Smoke-surfaced gap 2026-04-19.
   */
  readonly resourceMetadataUrl: string;
}

export function createMcpAuthPreHandler(opts: McpAuthPreHandlerOptions) {
  const wwwAuthenticate = `Bearer resource_metadata="${opts.resourceMetadataUrl}"`;
  return async function mcpAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      reply.header('WWW-Authenticate', wwwAuthenticate);
      await reply.status(401).send({ error: 'Bearer token required', statusCode: 401 });
      return;
    }

    const token = authHeader.slice(7);
    let payload: McpTokenPayload;
    try {
      payload = await opts.verifyToken(token);
    } catch {
      reply.header('WWW-Authenticate', `${wwwAuthenticate}, error="invalid_token"`);
      await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
      return;
    }

    // Phase 31.2 D-20 bullet 3: post-JWT client-status check. A cryptographically
    // valid token whose owning OAuth client has been revoked (via /admin/clients
    // soft-revoke) must be rejected on next use — otherwise the ≤1h access-token
    // TTL delays the revoke UX in ways the D-20 toast copy does not permit.
    // Pre-31.2 tokens lack `client_id` and silent-skip here (back-compat).
    if (payload.client_id !== undefined) {
      const clientRow = await opts.storage.oauthClients.findByClientId(payload.client_id);
      if (clientRow !== null && clientRow.revokedAt !== null) {
        reply.header(
          'WWW-Authenticate',
          `${wwwAuthenticate}, error="invalid_token", error_description="client_revoked"`,
        );
        await reply.status(401).send({ error: 'Client revoked', statusCode: 401 });
        return;
      }
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
