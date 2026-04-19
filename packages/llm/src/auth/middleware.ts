import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { TokenVerifier, TokenPayload } from './oauth.js';
import { scopeCoversEndpoint } from './scopes.js';
import type { Scope } from './scopes.js';

// Paths that skip authentication entirely. /api/v1/mcp is in this list as
// of Phase 31.1 Plan 03 — the MCP route installs its OWN scoped preHandler
// that verifies dashboard-issued JWKS-signed Bearer tokens with RFC 8707
// audience enforcement. The /.well-known/oauth-protected-resource endpoint
// is also public per RFC 9728.
const PUBLIC_PATHS = [
  '/api/v1/health',
  '/api/v1/openapi.json',
  '/api/v1/docs',
  '/api/v1/oauth/token',
  '/api/v1/oauth/revoke',
  '/api/v1/mcp',
  '/.well-known/oauth-protected-resource',
];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith('/api/v1/docs')) return true;
  if (path.startsWith('/.well-known/')) return true;
  return false;
}

/**
 * Phase 31.2 Plan 05 D-22: options for the service-global auth middleware.
 *
 * `resourceMetadataUrl` is advertised in the `WWW-Authenticate` response
 * header on 401s so external MCP clients can discover the authorization
 * server per RFC 6750 §3.1 + MCP Authorization spec 2025-06-18. Mirrors
 * the dashboard fix shipped in Phase 31.1 commit e0637ac.
 */
export interface AuthMiddlewareOptions {
  readonly resourceMetadataUrl: string;
}

export function createAuthMiddleware(
  verifier: TokenVerifier,
  options: AuthMiddlewareOptions,
) {
  const wwwAuthBase = `Bearer resource_metadata="${options.resourceMetadataUrl}"`;

  return async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isPublicPath(request.url)) return;

    const authHeader = request.headers.authorization;
    if (authHeader == null || !authHeader.startsWith('Bearer ')) {
      reply.header('WWW-Authenticate', wwwAuthBase);
      await reply.status(401).send({ error: 'Missing or invalid Authorization header', statusCode: 401 });
      return;
    }

    // API key authentication (service-to-service)
    const apiKey = process.env['LLM_API_KEY'];
    if (apiKey != null && apiKey.length > 0) {
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const received = Buffer.from(authHeader);
      if (expected.length === received.length && timingSafeEqual(expected, received)) {
        const headerOrgId = request.headers['x-org-id'];
        const orgId = (Array.isArray(headerOrgId) ? headerOrgId[0] : headerOrgId) ?? 'system';
        (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = {
          sub: 'api-key',
          scopes: ['read', 'write', 'admin'],
          orgId,
        };
        (request as FastifyRequest & { authType: string }).authType = 'apikey';
        (request as FastifyRequest & { orgId: string }).orgId = orgId;
        return;
      }
    }

    // JWT authentication
    const token = authHeader.slice(7);
    try {
      const payload = await verifier(token);
      (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = payload;
      (request as FastifyRequest & { authType: string }).authType = 'jwt';
      let jwtOrgId = payload.orgId ?? 'system';
      if (jwtOrgId === 'system' && payload.scopes.includes('admin')) {
        const headerOrgId = request.headers['x-org-id'];
        const headerVal = Array.isArray(headerOrgId) ? headerOrgId[0] : headerOrgId;
        if (headerVal && headerVal !== 'system') {
          jwtOrgId = headerVal;
        }
      }
      (request as FastifyRequest & { orgId: string }).orgId = jwtOrgId;
    } catch {
      reply.header('WWW-Authenticate', `${wwwAuthBase}, error="invalid_token"`);
      await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
    }
  };
}

export function requireScope(scope: Scope) {
  return async function scopeMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const payload = (request as FastifyRequest & { tokenPayload?: TokenPayload }).tokenPayload;
    if (payload == null) {
      await reply.status(401).send({ error: 'Not authenticated', statusCode: 401 });
      return;
    }
    if (!scopeCoversEndpoint(payload.scopes, scope)) {
      await reply.status(403).send({ error: `Insufficient scope. Required: ${scope}`, statusCode: 403 });
    }
  };
}
