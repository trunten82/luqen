/**
 * OauthSigningKeyRepository — Phase 31.1 (MCPAUTH-02 / D-24, D-25, D-26).
 *
 * Persists the dashboard's RS256 token-signing keys with a retire →
 * cutoff → remove lifecycle:
 *
 *   1. `insertKey(kid, public_pem, encrypted_private_pem)` creates a new
 *      active key. All new tokens are minted with its `kid`.
 *   2. `listActiveKeys()` — rows where `retired_at IS NULL`. The most
 *      recent active key is the "primary" (used for signing).
 *   3. `listPublishableKeys()` — rows where `removed_at IS NULL` (active
 *      + retiring). Feeds `/.well-known/jwks.json` so verifiers can still
 *      validate tokens minted with the retired-but-not-removed `kid`.
 *   4. `retireKey(kid)` — marks a key retired (stops minting with it; JWKS
 *      still publishes it during overlap window).
 *   5. `listRemovable(cutoffIso)` — rows where `retired_at < cutoff` AND
 *      `removed_at IS NULL`. Cutoff is Plan 04's scheduler value.
 *   6. `markRemoved(kid)` — removes from JWKS; tokens minted with this
 *      key will no longer validate.
 *
 * Private-key-at-rest (T-31.1-01-02): callers encrypt with
 * `plugins/crypto.ts#encryptSecret` BEFORE calling `insertKey`. This
 * repository stores the opaque ciphertext — decryption happens only in
 * Plan 02's token-signer at mint time.
 */

export interface SigningKey {
  readonly kid: string;
  readonly publicKeyPem: string;
  /** AES-256-GCM ciphertext of the PEM-encoded private key. */
  readonly encryptedPrivateKeyPem: string;
  readonly algorithm: 'RS256';
  readonly createdAt: string;
  readonly retiredAt: string | null;
  readonly removedAt: string | null;
}

export interface InsertKeyInput {
  readonly kid: string;
  readonly publicKeyPem: string;
  readonly encryptedPrivateKeyPem: string;
}

export interface OauthSigningKeyRepository {
  insertKey(input: InsertKeyInput): Promise<SigningKey>;
  findByKid(kid: string): Promise<SigningKey | null>;

  /** retired_at IS NULL — all still-minting keys. */
  listActiveKeys(): Promise<readonly SigningKey[]>;

  /** removed_at IS NULL — active + retiring; feeds JWKS. */
  listPublishableKeys(): Promise<readonly SigningKey[]>;

  retireKey(kid: string): Promise<void>;

  /** retired_at < cutoff AND removed_at IS NULL — ready to purge from JWKS. */
  listRemovable(cutoffIso: string): Promise<readonly SigningKey[]>;

  markRemoved(kid: string): Promise<void>;
}
