import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { TokenVerifier, TokenPayload } from './oauth.js';
import { scopeCoversEndpoint } from './scopes.js';
import type { Scope } from './scopes.js';

// Paths that skip authentication entirely
const PUBLIC_PATHS = ['/api/v1/health', '/api/v1/openapi.json', '/api/v1/docs', '/api/v1/oauth/token', '/api/v1/oauth/revoke'];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith('/api/v1/docs')) return true;
  return false;
}

export function createAuthMiddleware(verifier: TokenVerifier) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (isPublicPath(request.url)) return;

    const authHeader = request.headers.authorization;
    if (authHeader == null || !authHeader.startsWith('Bearer ')) {
      await reply.status(401).send({ error: 'Missing or invalid Authorization header', statusCode: 401 });
      return;
    }

    // API key authentication (service-to-service)
    const apiKey = process.env['COMPLIANCE_API_KEY'];
    if (apiKey != null && apiKey.length > 0) {
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const received = Buffer.from(authHeader);
      if (expected.length === received.length && timingSafeEqual(expected, received)) {
        (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = {
          sub: 'api-key',
          scopes: ['read', 'write', 'admin'],
        };
        return;
      }
    }

    // JWT authentication
    const token = authHeader.slice(7);
    try {
      const payload = await verifier(token);
      (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = payload;
    } catch {
      await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
    }
  };
}

export function requireScope(scope: Scope) {
  return async function scopeMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
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
