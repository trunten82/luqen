/**
 * Dashboard RS256 token signer — Phase 31.1 Plan 02 Task 1 (D-24 / D-26 / D-28).
 *
 * Loads the current active signing key at construction time, decrypts the
 * PEM-encoded private key (stored encrypted at rest per D-26 + T-31.1-02-13),
 * and exposes `mintAccessToken(input)` — the single chokepoint through which
 * all dashboard-issued OAuth access tokens are minted.
 *
 * Tokens carry:
 *   - alg: 'RS256' (D-24)
 *   - kid: <active key id>  (so /.well-known/jwks.json consumers route to the right key)
 *   - sub: userId (user-flow grants only — Phase 31.2 D-15 retired client_credentials)
 *   - scopes: [string]   (flows directly into Phase 30.1 filterToolsByScope)
 *   - orgId: user's active session org at /oauth/authorize time (D-12)
 *   - aud: [resource URIs]  (RFC 8707; enforced by Plan 03 verifier)
 *   - client_id: owning OAuth client id (31.2 D-20 bullet 3 — enables
 *                post-JWT revoked-client check in mcp/middleware.ts)
 *   - iat + exp            (D-28: 3600s default)
 *   - iss:  DASHBOARD_PUBLIC_URL (fallback: https://dashboard.luqen.local)
 *
 * Private-key handling: the plaintext PEM is held ONLY inside this module's
 * closure (as an imported `jose` KeyObject). The ciphertext in the DB remains
 * the single durable copy. Rotation (Plan 04) will replace the whole signer
 * instance atomically; callers should resolve through `dashboardSigner` at
 * request time to pick up the new key without restart.
 */

import { importPKCS8, SignJWT, type JWTPayload } from 'jose';
import { decryptSecret } from '../plugins/crypto.js';
import type { StorageAdapter } from '../db/adapter.js';

export interface MintAccessTokenInput {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId: string;
  readonly aud: readonly string[];
  readonly role?: string;
  readonly expiresInSeconds: number;
  /**
   * 31.2 D-20 bullet 3: the OAuth client that minted this access token.
   * Embedded in the JWT payload as `client_id` so the RS verifier's post-JWT
   * client-status check (packages/dashboard/src/mcp/middleware.ts, Plan 04)
   * can reject access tokens whose owning client has been revoked.
   *
   * REQUIRED — making this optional would let a call site silently skip the
   * claim and defeat the revoke cascade. The TypeScript compiler will refuse
   * to compile if any mint call site omits it.
   */
  readonly clientId: string;
}

export interface DashboardSigner {
  readonly currentKid: string;
  mintAccessToken(input: MintAccessTokenInput): Promise<string>;
}

/**
 * Resolve the issuer URL advertised at /.well-known/oauth-authorization-server.
 * Symmetric with Plan 02 Task 3's `registerWellKnownRoutes` — both read the
 * same env var and fall back to the same default so the issued tokens' `iss`
 * matches the AS metadata response.
 */
export function getDashboardIssuer(): string {
  return process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';
}

export async function createDashboardSigner(
  storage: StorageAdapter,
  encryptionKey: string,
): Promise<DashboardSigner> {
  const activeKeys = await storage.oauthSigningKeys.listActiveKeys();
  const activeKey = activeKeys[0];
  if (activeKey === undefined) {
    throw new Error(
      'No active OAuth signing key — run ensureInitialSigningKey() first',
    );
  }
  const privateKeyPem = decryptSecret(activeKey.encryptedPrivateKeyPem, encryptionKey);
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  const issuer = getDashboardIssuer();

  return {
    currentKid: activeKey.kid,
    async mintAccessToken(input: MintAccessTokenInput): Promise<string> {
      const claims: JWTPayload = {
        sub: input.sub,
        scopes: [...input.scopes],
        orgId: input.orgId,
        aud: [...input.aud],
        // Phase 31.2 D-20 bullet 3 — snake_case `client_id` per RFC 8693 /
        // OAuth 2.1; the verifier reads payload.client_id.
        client_id: input.clientId,
        ...(input.role !== undefined ? { role: input.role } : {}),
      };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: activeKey.kid })
        .setIssuedAt()
        .setExpirationTime(`${input.expiresInSeconds}s`)
        .setIssuer(issuer)
        .sign(privateKey);
    },
  };
}
