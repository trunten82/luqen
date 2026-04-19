/**
 * OauthCodeRepository — Phase 31.1 (MCPAUTH-02).
 *
 * Persists OAuth 2.1 single-use authorization codes with PKCE S256-only
 * code challenges. Lifecycle:
 *
 *   1. /oauth/authorize mints a 32-byte opaque code, calls `createCode`
 *      with a 60-second TTL (D-30) and the client's S256 code_challenge.
 *   2. /oauth/token calls `findAndConsume(code)`:
 *        - Atomic SELECT + DELETE inside a db transaction (T-31.1-01-03:
 *          replay attack impossible — a second call returns null).
 *        - Expired rows are still DELETEd but return null.
 *
 * PKCE (D-31/D-32): The repository and the underlying CHECK constraint on
 * `oauth_authorization_codes.code_challenge_method` both reject anything
 * other than 'S256'. Defense-in-depth — the caller throws before INSERT,
 * the DB refuses if the caller bypasses the check.
 */

export interface AuthorizationCode {
  readonly code: string;
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  /** Space-separated scope string (OAuth 2.1 §3.3 wire format). */
  readonly scope: string;
  /** Space-separated resource URIs per RFC 8707. */
  readonly resource: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly orgId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateCodeInput {
  /** Opaque 32-byte URL-safe random string, caller-generated. */
  readonly code: string;
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly resource: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly orgId: string;
  /** ISO-8601 timestamp — 60s future per D-30. */
  readonly expiresAt: string;
}

export interface OauthCodeRepository {
  createCode(input: CreateCodeInput): Promise<AuthorizationCode>;

  /**
   * Atomic single-use consumption: SELECT + DELETE inside a db.transaction.
   * Returns the row if the code existed and hasn't expired; null otherwise.
   * A second call with the same code always returns null.
   */
  findAndConsume(code: string): Promise<AuthorizationCode | null>;
}
