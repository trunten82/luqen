/**
 * OauthRefreshRepository — Phase 31.1 (MCPAUTH-02 / D-29).
 *
 * Persists OAuth 2.1 refresh tokens with rotate-on-use + reuse-detection.
 *
 * Rotation chain model:
 *   - A chain starts with `parentId: null` → the mint row's own `id`
 *     becomes the `chainId`. All descendants carry the same `chainId`.
 *   - `absoluteExpiresAt` is inherited from the chain root at mint time
 *     and remains fixed (30-day absolute cap per D-29) across rotations.
 *   - Each `rotate()` call marks the presented row `rotated=1` and inserts
 *     a new child with `parentId` = the presented row's id.
 *
 * Reuse detection (T-31.1-01-04):
 *   - If a caller presents a token whose row has `rotated=1`, the entire
 *     chain is DELETEd (`revokeChain(chainId)`) and the result carries
 *     `kind: 'reuse_detected'`. Plan 02's /oauth/token handler turns this
 *     into an `oauth.refresh_reuse_detected` audit event.
 *
 * Tokens are stored by `token_hash` (SHA-256 of the raw token, hex) — the
 * raw refresh token is never written to disk.
 */

export interface RefreshToken {
  readonly id: string;
  /** SHA-256(raw token) → hex. Never the raw token. */
  readonly tokenHash: string;
  /** Root ancestor's id — shared across all rotations of this grant. */
  readonly chainId: string;
  readonly parentId: string | null;
  readonly clientId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly scope: string;
  readonly resource: string;
  readonly rotated: boolean;
  readonly createdAt: string;
  /** 30d from chain root issuance (D-29). */
  readonly absoluteExpiresAt: string;
}

export interface MintRefreshInput {
  readonly tokenHash: string;
  readonly clientId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly scope: string;
  readonly resource: string;
  /** null → new chain (this row becomes the chain root). */
  readonly parentId?: string | null;
  readonly absoluteExpiresAt: string;
}

export type RotateResult =
  | { readonly kind: 'success'; readonly child: RefreshToken; readonly parent: RefreshToken }
  | { readonly kind: 'reuse_detected'; readonly revokedChainId: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'not_found' };

export interface OauthRefreshRepository {
  mint(input: MintRefreshInput): Promise<RefreshToken>;

  /**
   * Rotate the refresh token identified by `presentedTokenHash`:
   *   - not_found: no row matches the hash
   *   - expired:  absolute_expires_at < now (chain auto-revoked)
   *   - reuse_detected: row.rotated=1 (T-31.1-01-04; chain revoked)
   *   - success:  parent flipped rotated=1, child inserted
   */
  rotate(presentedTokenHash: string, newTokenHash: string): Promise<RotateResult>;

  findByTokenHash(hash: string): Promise<RefreshToken | null>;
  revokeChain(chainId: string): Promise<void>;
  /** Bulk-delete all chains where absolute_expires_at < now. Returns count. */
  cleanupExpired(): Promise<number>;
}
