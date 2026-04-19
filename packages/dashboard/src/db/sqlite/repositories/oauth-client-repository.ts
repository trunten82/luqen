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
   * Phase 31.2 D-19: DCR clients registered by any user who is a
   * team_member of at least one team in `orgId`.
   *
   *   - `registered_by_user_id IS NULL` rows (pre-D-18) are excluded —
   *     admin.system sees them via `listAll()` only.
   *   - orgId='system' returns an empty array (admin.system uses listAll).
   *   - SELECT DISTINCT: a user can be in multiple teams in the same org.
   *   - No `WHERE revoked_at IS NULL` — revoked rows MUST remain visible
   *     so Plan 04's soft-revoke can render the Revoked badge (D-24).
   *     Plan 04 will extend this SELECT to project the registrant's org
   *     name via an additional JOIN; that extension is intentionally out
   *     of scope for Plan 01.
   */
  async findByOrg(orgId: string): Promise<readonly OauthClient[]> {
    if (orgId === 'system') return [];
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.*
           FROM oauth_clients_v2 c
           JOIN team_members tm ON tm.user_id = c.registered_by_user_id
           JOIN teams t          ON t.id       = tm.team_id
          WHERE c.registered_by_user_id IS NOT NULL
            AND t.org_id = ?
          ORDER BY c.created_at DESC`,
      )
      .all(orgId) as OauthClientRow[];
    return rows.map(rowToClient);
  }

  async revoke(clientId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM oauth_clients_v2 WHERE client_id = ?')
      .run(clientId);
  }
}
