import type Database from 'better-sqlite3';
import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type {
  OauthClient,
  OauthClientRepository,
  RegisterClientInput,
  RegisterClientResult,
} from '../../interfaces/oauth-client-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches oauth_clients_v2 columns (snake_case) verbatim.
// ---------------------------------------------------------------------------

interface OauthClientRow {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  token_endpoint_auth_method: 'none' | 'client_secret_basic';
  scope: string;
  software_id: string | null;
  software_version: string | null;
  registered_by_user_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

const BCRYPT_ROUNDS = 10;

function rowToClient(row: OauthClientRow): OauthClient {
  return {
    id: row.id,
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris) as readonly string[],
    grantTypes: JSON.parse(row.grant_types) as readonly string[],
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    scope: row.scope,
    softwareId: row.software_id,
    softwareVersion: row.software_version,
    registeredByUserId: row.registered_by_user_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteOauthClientRepository — Phase 31.1 (MCPAUTH-02)
// ---------------------------------------------------------------------------

export class SqliteOauthClientRepository implements OauthClientRepository {
  constructor(private readonly db: Database.Database) {}

  async register(input: RegisterClientInput): Promise<RegisterClientResult> {
    const id = randomUUID();
    const clientId = `dcr_${randomBytes(16).toString('hex')}`;
    const createdAt = new Date().toISOString();

    let clientSecret: string | null = null;
    let clientSecretHash: string | null = null;
    if (input.tokenEndpointAuthMethod === 'client_secret_basic') {
      clientSecret = randomBytes(32).toString('hex');
      clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);
    }

    this.db
      .prepare(
        `INSERT INTO oauth_clients_v2
           (id, client_id, client_secret_hash, client_name, redirect_uris,
            grant_types, token_endpoint_auth_method, scope,
            software_id, software_version, registered_by_user_id, created_at)
         VALUES
           (@id, @clientId, @clientSecretHash, @clientName, @redirectUris,
            @grantTypes, @tokenEndpointAuthMethod, @scope,
            @softwareId, @softwareVersion, @registeredByUserId, @createdAt)`,
      )
      .run({
        id,
        clientId,
        clientSecretHash,
        clientName: input.clientName,
        redirectUris: JSON.stringify(input.redirectUris),
        grantTypes: JSON.stringify(input.grantTypes),
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        scope: input.scope,
        softwareId: input.softwareId ?? null,
        softwareVersion: input.softwareVersion ?? null,
        registeredByUserId: input.registeredByUserId ?? null,
        createdAt,
      });

    return { clientId, clientSecret, createdAt };
  }

  async findByClientId(clientId: string): Promise<OauthClient | null> {
    const row = this.db
      .prepare('SELECT * FROM oauth_clients_v2 WHERE client_id = ?')
      .get(clientId) as OauthClientRow | undefined;
    return row !== undefined ? rowToClient(row) : null;
  }

  async verifyClientSecret(clientId: string, presentedSecret: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT client_secret_hash FROM oauth_clients_v2 WHERE client_id = ?')
      .get(clientId) as { client_secret_hash: string | null } | undefined;
    if (row === undefined || row.client_secret_hash === null) {
      return false;
    }
    return bcrypt.compare(presentedSecret, row.client_secret_hash);
  }

  async listByUserId(userId: string): Promise<readonly OauthClient[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM oauth_clients_v2
         WHERE registered_by_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as OauthClientRow[];
    return rows.map(rowToClient);
  }

  async listAll(): Promise<readonly OauthClient[]> {
    const rows = this.db
      .prepare('SELECT * FROM oauth_clients_v2 ORDER BY created_at DESC')
      .all() as OauthClientRow[];
    return rows.map(rowToClient);
  }

  /**
   * Phase 31.2 D-19 + D-24: DCR clients registered by any user who is a
   * team_member of at least one team in `orgId`.
   *
   *   - `registered_by_user_id IS NULL` rows (pre-D-18) are excluded —
   *     admin.system sees them via `listAll()` only.
   *   - orgId='system' returns an empty array (admin.system uses listAll).
   *   - SELECT DISTINCT: a user can be in multiple teams in the same org.
   *   - No `WHERE revoked_at IS NULL` — revoked rows MUST remain visible
   *     so /admin/clients can render the Revoked badge (D-24).
   *   - D-24 (Plan 04 extension): projects `organizations.name` as
   *     `registrant_org_name` for the Org column on /admin/clients.
   */
  async findByOrg(orgId: string): Promise<readonly OauthClient[]> {
    if (orgId === 'system') return [];
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.*, o.name AS registrant_org_name
           FROM oauth_clients_v2 c
           JOIN team_members tm ON tm.user_id = c.registered_by_user_id
           JOIN teams t          ON t.id       = tm.team_id
           JOIN organizations o  ON o.id       = t.org_id
          WHERE c.registered_by_user_id IS NOT NULL
            AND t.org_id = ?
          ORDER BY c.created_at DESC`,
      )
      .all(orgId) as (OauthClientRow & { registrant_org_name: string })[];
    return rows.map((r) => ({ ...rowToClient(r), registrantOrgName: r.registrant_org_name }));
  }

  /**
   * Phase 31.2 D-18: first-consent-wins backfill of `registered_by_user_id`.
   *
   * DCR (RFC 7591 §3) registers clients pre-auth, so the column is NULL at
   * creation time. The first user to complete `/oauth/authorize/consent` on
   * an otherwise-orphan client becomes its recorded owner — later consents
   * from other users must NOT overwrite (the `WHERE registered_by_user_id
   * IS NULL` guard makes the UPDATE atomic and idempotent at the SQL layer,
   * so a concurrent second consenter's UPDATE simply affects 0 rows).
   *
   * Non-existent `clientId` is a silent no-op (zero rows affected).
   */
  async recordRegistrationUser(clientId: string, userId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE oauth_clients_v2
            SET registered_by_user_id = ?
          WHERE client_id = ?
            AND registered_by_user_id IS NULL`,
      )
      .run(userId, clientId);
  }

  /**
   * Phase 31.2 D-20: soft revoke — sets `revoked_at` (idempotent via
   * `AND revoked_at IS NULL` guard) and cascade-rotates every live refresh
   * token for this client. Access tokens remain cryptographically valid
   * until their TTL, but the Plan 04 `mcp/middleware.ts` post-JWT
   * client-status check (D-20 bullet 3) rejects them on next call.
   *
   * The DELETE-based semantic from Plan 01 is gone — callers that
   * previously expected `findByClientId` to return `null` post-revoke
   * must now expect `revokedAt !== null`.
   */
  async revoke(clientId: string): Promise<void> {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE oauth_clients_v2
              SET revoked_at = ?
            WHERE client_id = ?
              AND revoked_at IS NULL`,
        )
        .run(now, clientId);
      // D-20 bullets 1+2 cascade: revoke every live refresh chain on this
      // client. token.ts:handleRefresh already rejects rotated=1 tokens with
      // invalid_grant, killing re-issuance instantly.
      this.db
        .prepare(
          `UPDATE oauth_refresh_tokens
              SET rotated = 1
            WHERE client_id = ?
              AND rotated = 0`,
        )
        .run(clientId);
    });
    tx();
  }
}
