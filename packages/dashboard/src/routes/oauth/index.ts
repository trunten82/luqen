/**
 * OAuth 2.1 route registrar — Phase 31.1 Plan 02 Task 3.
 *
 * Single entry point for server.ts to mount every dashboard OAuth endpoint
 * (Authorization Server + JWKS + AS metadata + DCR). Does NOT register the
 * MCP-side resource-server verifier — Plan 03 handles that migration.
 *
 * Order is intentional:
 *   1. /.well-known/oauth-authorization-server — metadata is static, mount first
 *   2. /oauth/jwks.json + /.well-known/jwks.json — requires storage only
 *   3. /oauth/authorize (+ /oauth/authorize/consent POST) — browser flow
 *   4. /oauth/token — requires storage + signer
 *   5. /oauth/register — rate-limited, encapsulated in its own plugin scope
 */

import type { FastifyInstance } from 'fastify';
import type { StorageAdapter } from '../../db/adapter.js';
import type { DashboardSigner } from '../../auth/oauth-signer.js';
import { registerWellKnownRoutes } from './well-known.js';
import { registerJwksRoutes } from './jwks.js';
import { registerAuthorizeRoutes } from './authorize.js';
import { registerTokenRoutes } from './token.js';
import { registerRegisterRoutes } from './register.js';
import { registerProtectedResourceMetadata } from './protected-resource.js';

export async function registerOauthRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  signer: DashboardSigner,
): Promise<void> {
  await registerWellKnownRoutes(server);
  await registerProtectedResourceMetadata(server);
  await registerJwksRoutes(server, storage);
  await registerAuthorizeRoutes(server, storage);
  await registerTokenRoutes(server, storage, signer);
  await registerRegisterRoutes(server, storage);
}
