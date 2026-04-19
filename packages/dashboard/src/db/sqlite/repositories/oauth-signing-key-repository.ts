import type Database from 'better-sqlite3';
import type {
  InsertKeyInput,
  OauthSigningKeyRepository,
  SigningKey,
} from '../../interfaces/oauth-signing-key-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches oauth_signing_keys columns verbatim.
// ---------------------------------------------------------------------------

interface OauthSigningKeyRow {
  kid: string;
  public_key_pem: string;
  encrypted_private_key_pem: string;
  algorithm: 'RS256';
  created_at: string;
  retired_at: string | null;
  removed_at: string | null;
}

function rowToKey(row: OauthSigningKeyRow): SigningKey {
  return {
    kid: row.kid,
    publicKeyPem: row.public_key_pem,
    encryptedPrivateKeyPem: row.encrypted_private_key_pem,
    algorithm: row.algorithm,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    removedAt: row.removed_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteOauthSigningKeyRepository — Phase 31.1 (D-24, D-25, D-26)
//
// This repository does NOT encrypt/decrypt. The caller encrypts the PEM
// via plugins/crypto.ts#encryptSecret before inserting (T-31.1-01-02).
// ---------------------------------------------------------------------------

export class SqliteOauthSigningKeyRepository implements OauthSigningKeyRepository {
  constructor(private readonly db: Database.Database) {}

  async insertKey(input: InsertKeyInput): Promise<SigningKey> {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO oauth_signing_keys
           (kid, public_key_pem, encrypted_private_key_pem, algorithm, created_at, retired_at, removed_at)
         VALUES
           (@kid, @publicKeyPem, @encryptedPrivateKeyPem, 'RS256', @createdAt, NULL, NULL)`,
      )
      .run({
        kid: input.kid,
        publicKeyPem: input.publicKeyPem,
        encryptedPrivateKeyPem: input.encryptedPrivateKeyPem,
        createdAt,
      });

    const row = this.db
      .prepare('SELECT * FROM oauth_signing_keys WHERE kid = ?')
      .get(input.kid) as OauthSigningKeyRow;
    return rowToKey(row);
  }

  async findByKid(kid: string): Promise<SigningKey | null> {
    const row = this.db
      .prepare('SELECT * FROM oauth_signing_keys WHERE kid = ?')
      .get(kid) as OauthSigningKeyRow | undefined;
    return row !== undefined ? rowToKey(row) : null;
  }

  async listActiveKeys(): Promise<readonly SigningKey[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM oauth_signing_keys
         WHERE retired_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all() as OauthSigningKeyRow[];
    return rows.map(rowToKey);
  }

  async listPublishableKeys(): Promise<readonly SigningKey[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM oauth_signing_keys
         WHERE removed_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all() as OauthSigningKeyRow[];
    return rows.map(rowToKey);
  }

  async retireKey(kid: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE oauth_signing_keys SET retired_at = ? WHERE kid = ? AND retired_at IS NULL',
      )
      .run(now, kid);
  }

  async listRemovable(cutoffIso: string): Promise<readonly SigningKey[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM oauth_signing_keys
         WHERE retired_at IS NOT NULL
           AND retired_at < ?
           AND removed_at IS NULL
         ORDER BY retired_at ASC`,
      )
      .all(cutoffIso) as OauthSigningKeyRow[];
    return rows.map(rowToKey);
  }

  async markRemoved(kid: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE oauth_signing_keys SET removed_at = ? WHERE kid = ? AND removed_at IS NULL',
      )
      .run(now, kid);
  }
}
