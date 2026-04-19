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
  revoke(clientId: string): Promise<void>;
}
