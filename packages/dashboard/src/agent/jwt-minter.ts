/**
 * Phase 32 Plan 04 — per-dispatch internal JWT minter.
 *
 * Produces short-lived RS256 JWTs used by the ToolDispatcher to authenticate
 * in-process MCP tool invocations on behalf of the authenticated dashboard
 * user. Minted PER DISPATCH (AI-SPEC §3 Pitfall 5 / §6.1 Guardrail 7) so the
 * embedded `scopes` claim reflects the user's CURRENT effective permissions —
 * a mid-conversation role revoke cannot be bypassed by a long-lived token.
 *
 * Reuses the existing `DashboardSigner` from `auth/oauth-signer.ts`. No new
 * signing key material is introduced — the same encrypted-at-rest RSA private
 * key that signs OAuth access tokens signs agent-internal tokens. Rotation,
 * JWKS publication, and legacy-key handling are inherited unchanged.
 *
 * Payload shape per D-03 / D-04:
 *   - sub      = dashboard_users.id     (NOT __agent-internal__)
 *   - orgId    = user's active org
 *   - scopes   = flattened effective-permission set
 *   - aud      = [dashboard MCP resource URI]
 *   - client_id = '__agent-internal__'  (Phase 31.2 D-20 carve-out signal)
 *   - exp - iat = 300s
 */

import type { DashboardSigner } from '../auth/oauth-signer.js';

/**
 * Reserved pseudo-client id for agent-internal tokens. The MCP middleware
 * revoked-client check (Phase 31.2 D-20 bullet 3) treats this as an
 * always-valid sentinel — agent-internal tokens bypass the oauth_clients_v2
 * revoke cascade because no OAuth client row owns them.
 */
export const AGENT_INTERNAL_CLIENT_ID = '__agent-internal__';

/**
 * Short TTL covers the worst-case tool loop (5 iterations × 30s per-dispatch
 * timeout = ~150s) with safety margin. Tokens are minted per dispatch so a
 * single long-running agent turn does not need a longer-lived token.
 */
export const AGENT_TOKEN_TTL_SECONDS = 300;

/**
 * Mint a single agent-internal access token for a specific tool dispatch.
 *
 * Called once per `ToolDispatcher.dispatch` invocation. Cost is sub-millisecond
 * with RSA 2048 + jose's WebCrypto fast path; cheaper than the round-trip saved
 * by not re-running resolveEffectivePermissions elsewhere.
 */
export async function mintAgentToken(
  signer: DashboardSigner,
  userId: string,
  orgId: string,
  scopes: readonly string[],
  audience: string,
): Promise<string> {
  return signer.mintAccessToken({
    sub: userId,
    orgId,
    scopes,
    aud: [audience],
    clientId: AGENT_INTERNAL_CLIENT_ID,
    expiresInSeconds: AGENT_TOKEN_TTL_SECONDS,
  });
}
