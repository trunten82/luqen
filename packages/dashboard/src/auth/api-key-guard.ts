import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKeyRole } from '../db/types.js';

/**
 * Paths that read-only API keys are allowed to access (GET only).
 * All API paths are allowed for GET requests with read-only keys.
 */
const SCAN_PATHS = new Set(['/api/v1/scan', '/api/v1/scans']);

/**
 * Check whether a scan-only key can access a path.
 * Scan-only keys can: GET any /api/ route + POST to scan endpoints.
 */
function isScanAllowed(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' && (SCAN_PATHS.has(path) || path.startsWith('/api/v1/scan'))) return true;
  return false;
}

/**
 * Enforce API key role restrictions.
 * Should be called as a preHandler hook after authentication.
 *
 * - admin: full access (no restrictions)
 * - read-only: GET/HEAD requests only on /api/ routes
 * - scan-only: GET/HEAD + scan-related POST on /api/ routes
 */
export async function enforceApiKeyRole(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Only applies to API key authenticated requests
  if (request.user?.id !== 'api-key') return;

  const path = request.url.split('?')[0];

  // Org-scoped keys cannot access admin/org management endpoints
  if (request.user.currentOrgId !== undefined) {
    if (path.startsWith('/api/v1/orgs') || path.startsWith('/api/v1/admin')) {
      await reply.code(403).send({
        error: 'Forbidden: org-scoped API keys cannot access admin endpoints',
      });
      return;
    }
  }

  const role = (request.user.role ?? 'admin') as ApiKeyRole;
  if (role === 'admin') return;

  const method = request.method;

  // Only enforce on API routes — API keys are only used for /api/ paths
  if (!path.startsWith('/api/')) return;

  if (role === 'read-only') {
    if (method !== 'GET' && method !== 'HEAD') {
      await reply.code(403).send({
        error: 'Forbidden: this API key has read-only access',
      });
      return;
    }
    return;
  }

  if (role === 'scan-only') {
    if (!isScanAllowed(method, path)) {
      await reply.code(403).send({
        error: 'Forbidden: this API key has scan-only access',
      });
      return;
    }
    return;
  }
}
