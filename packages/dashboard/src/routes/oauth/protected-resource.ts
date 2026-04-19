/**
 * Phase 31.1 Plan 03 Task 3 — GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 Resource Server metadata for the dashboard.
 *
 * Per D-02 the dashboard is BOTH the Authorization Server (issuing tokens
 * at /oauth/token) AND a Resource Server (its own /mcp endpoint verifies
 * tokens). This endpoint advertises that self-referential relationship:
 *
 *   {
 *     resource: https://dashboard.../mcp,
 *     authorization_servers: [https://dashboard...],
 *     scopes_supported: [read, write, admin.system, admin.org, admin.users],
 *     bearer_methods_supported: ['header'],
 *     resource_documentation: ...
 *   }
 *
 * Public endpoint (no auth required) per RFC 9728 — external MCP clients
 * discover which AS is trusted for this resource before they present any
 * Bearer token.
 */

import type { FastifyInstance } from 'fastify';

const SCOPES_SUPPORTED = Object.freeze([
  'read',
  'write',
  'admin.system',
  'admin.org',
  'admin.users',
]);

export async function registerProtectedResourceMetadata(
  server: FastifyInstance,
): Promise<void> {
  const issuer = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';
  const mcpUrl = `${issuer}/mcp`;

  server.get('/.well-known/oauth-protected-resource', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('Content-Type', 'application/json');
    return reply.send({
      resource: mcpUrl,
      authorization_servers: [issuer],
      scopes_supported: [...SCOPES_SUPPORTED],
      bearer_methods_supported: ['header'],
      resource_documentation: `${issuer}/docs/mcp`,
    });
  });
}
