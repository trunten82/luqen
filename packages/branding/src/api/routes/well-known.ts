/**
 * Phase 31.1 Plan 03 Task 3 — GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 Resource Server metadata for the branding service. See
 * packages/compliance/src/api/routes/well-known.ts for the pattern.
 */

import type { FastifyInstance } from 'fastify';

const SCOPES_SUPPORTED = Object.freeze([
  'read',
  'write',
  'admin.system',
  'admin.org',
  'admin.users',
]);

export async function registerBrandingProtectedResourceMetadata(
  app: FastifyInstance,
): Promise<void> {
  const brandingUrl = process.env['BRANDING_PUBLIC_URL'] ?? 'http://localhost:4100';
  const mcpUrl = `${brandingUrl}/api/v1/mcp`;
  const asIssuer = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';

  app.get('/.well-known/oauth-protected-resource', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('Content-Type', 'application/json');
    return reply.send({
      resource: mcpUrl,
      authorization_servers: [asIssuer],
      scopes_supported: [...SCOPES_SUPPORTED],
      bearer_methods_supported: ['header'],
      resource_documentation: `${asIssuer}/docs/mcp`,
    });
  });
}
