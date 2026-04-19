/**
 * OauthClientRepository — Phase 31.1 (MCPAUTH-02).
 *
 * Persists OAuth 2.1 client registrations (RFC 7591 Dynamic Client
 * Registration). Two flavours are supported:
 *
 *   - Public clients (`token_endpoint_auth_method: 'none'`) — PKCE-only,
 *     no client_secret returned or stored.
 *   - Confidential clients (`token_endpoint_auth_method: 'client_secret_basic'`)
 *     — a raw 32-byte hex secret is returned ONCE at registration; only the
 *     bcrypt hash is persisted. Subsequent `verifyClientSecret` calls use
 *     `bcrypt.compare` — the raw secret is never readable from the DB.
 *
 * Scoping:
 *   - Clients are user-scoped (registered_by_user_id), NOT org-scoped
 *     (D-12: the org claim in a minted token is derived from the user's
 *     active session, not the client record).
 *   - `listByUserId` returns all clients a user has registered. Admin-wide
 *     listing uses `listAll` (for /admin/clients).
 *
 * Security (T-31.1-01-01 Information Disclosure): `findByClientId` returns
 * the row with `clientSecretHash` — callers MUST NOT serialize this to any
 * client-facing payload. Use `verifyClientSecret` instead of comparing
 * hashes manually.
 */

export interface OauthClient {
  readonly id: string;
  readonly clientId: string;
  readonly clientSecretHash: string | null;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
  readonly tokenEndpointAuthMethod: 'none' | 'client_secret_basic';
  readonly scope: string;
  readonly softwareId: string | null;
  readonly softwareVersion: string | null;
  readonly registeredByUserId: string | null;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  /**
   * 31.2 D-24: display-label for the Org column on /admin/clients.
   * Populated ONLY by `findByOrg` (via SELECT JOIN on organizations.name).
   * `listAll` / `listByUserId` leave this undefined — callers resolve via
   * `organizations.getUserOrgs` when rendering admin.system views.
   */
  readonly registrantOrgName?: string;
}

export interface RegisterClientInput {
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
  readonly tokenEndpointAuthMethod: 'none' | 'client_secret_basic';
  readonly scope: string;
  readonly softwareId?: string;
  readonly softwareVersion?: string;
  readonly registeredByUserId?: string;
}

export interface RegisterClientResult {
  readonly clientId: string;
  /** Non-null only for `client_secret_basic` — returned ONCE at registration. */
  readonly clientSecret: string | null;
  readonly createdAt: string;
}

export interface OauthClientRepository {
  register(input: RegisterClientInput): Promise<RegisterClientResult>;
  findByClientId(clientId: string): Promise<OauthClient | null>;
  verifyClientSecret(clientId: string, presentedSecret: string): Promise<boolean>;
  listByUserId(userId: string): Promise<readonly OauthClient[]>;
  listAll(): Promise<readonly OauthClient[]>;
  /**
   * 31.2 D-19: list DCR clients whose `registered_by_user_id` maps to any
   * user who is a team_member of at least one team in this org. Rows with
   * `registered_by_user_id IS NULL` are deliberately excluded — those are
   * pre-backfill (pre-D-18) rows, visible only to admin.system via listAll.
   * Caller should NOT pass orgId='system'; admin.system branch uses listAll.
   *
   * Revoked rows (`revoked_at IS NOT NULL`) are INCLUDED — forward-compat for
   * Plan 04's soft-revoke (DELETE -> UPDATE revoked_at) so the admin UI can
   * render the Revoked badge per D-24.
   */
  findByOrg(orgId: string): Promise<readonly OauthClient[]>;
  /**
   * 31.2 D-18: first-consent-wins backfill of the user-link column.
   * Only updates rows where `registered_by_user_id IS NULL`. Subsequent
   * consents from other users do NOT overwrite. DCR is pre-auth per
   * RFC 7591 §3 — user identity first appears at consent time, and the
   * user who grants it is the natural "owner" for /admin/clients scoping.
   *
   * No-op if the client_id is unknown (does not throw, does not insert).
   */
  recordRegistrationUser(clientId: string, userId: string): Promise<void>;
  /**
   * 31.2 D-20: soft revoke — sets `revoked_at` (idempotent via IS NULL
   * guard) and cascade-rotates every live refresh token for this client.
   * Access tokens remain cryptographically valid until their TTL, but the
   * Plan 04 `mcp/middleware.ts` post-JWT client-status check rejects them
   * on next call (D-20 bullet 3).
   *
   * The DELETE-based semantic is gone — callers that previously expected
   * `findByClientId` to return `null` post-revoke must now expect
   * `revokedAt !== null`.
   */
  revoke(clientId: string): Promise<void>;
}
