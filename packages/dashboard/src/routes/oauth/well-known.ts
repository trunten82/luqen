/**
 * OAuth 2.1 Authorization Server metadata (RFC 8414) — Phase 31.1 Plan 02 Task 3.
 *
 * GET /.well-known/oauth-authorization-server
 *
 * Returns the static metadata document that external MCP clients discover
 * before initiating DCR or Authorization Code flows. All required fields per
 * RFC 8414 §2 are populated; the issuer is read from `DASHBOARD_PUBLIC_URL`
 * and falls back to the default dashboard URL when unset.
 *
 * Response headers include `Cache-Control: public, max-age=3600` — the
 * metadata is stable so clients cache aggressively.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDashboardIssuer } from '../../auth/oauth-signer.js';

interface AsMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly registration_endpoint: string;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly response_modes_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
}

export async function registerWellKnownRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/.well-known/oauth-authorization-server',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const issuer = getDashboardIssuer();
      const metadata: AsMetadata = {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        jwks_uri: `${issuer}/oauth/jwks.json`,
        response_types_supported: ['code'],
        // Phase 31.2 D-15: dashboard /oauth/token is now exclusively user flows.
        // Service-to-service bootstrap continues via each service's own
        // /api/v1/oauth/token (31.1 D-10 invariant preserved).
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
        // Phase 31.2 D-10: admin.* scopes retired at the OAuth layer. Admin
        // tool visibility now comes from the user's real RBAC (Plan 03
        // filterToolsByRbac) — NOT from a broad scope bundle.
        scopes_supported: ['read', 'write'],
        response_modes_supported: ['query'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      };
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.header('Content-Type', 'application/json');
      return reply.send(metadata);
    },
  );
}
