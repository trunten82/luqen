/**
 * Phase 31.1 Plan 03 Task 3 — GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 Resource Server metadata for the compliance service. This
 * endpoint tells external MCP clients that compliance delegates
 * authorization to the dashboard AS — the client will discover, via this
 * endpoint, where to run the OAuth flow before presenting any Bearer
 * token against /api/v1/mcp.
 *
 * Public endpoint (no auth) per RFC 9728. Added to PUBLIC_PATHS in
 * compliance/src/auth/middleware.ts via the /.well-known/ prefix rule.
 */

import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';

const SCOPES_SUPPORTED = Object.freeze([
  'read',
  'write',
  'admin.system',
  'admin.org',
  'admin.users',
]);

const ProtectedResourceMetadata = Type.Object(
  {
    resource: Type.String(),
    authorization_servers: Type.Array(Type.String()),
    scopes_supported: Type.Array(Type.String()),
    bearer_methods_supported: Type.Array(Type.String()),
    resource_documentation: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export async function registerComplianceProtectedResourceMetadata(
  app: FastifyInstance,
): Promise<void> {
  const complianceUrl = process.env['COMPLIANCE_PUBLIC_URL'] ?? 'http://localhost:4000';
  const mcpUrl = `${complianceUrl}/api/v1/mcp`;
  const asIssuer = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';

  app.get('/.well-known/oauth-protected-resource', {
    schema: {
      tags: ['well-known'],
      summary: 'RFC 9728 OAuth Protected Resource metadata',
      response: {
        200: ProtectedResourceMetadata,
        500: ErrorEnvelope,
      },
    },
  }, async (_req, reply) => {
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
