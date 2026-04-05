import type Database from 'better-sqlite3';
import { encryptSecret, decryptSecret } from '../../plugins/crypto.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
  ServiceConnectionUpsertInput,
  ServiceId,
} from '../service-connections-repository.js';

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface ServiceConnectionRow {
  service_id: string;
  url: string;
  client_id: string;
  client_secret_encrypted: string;
  updated_at: string;
  updated_by: string | null;
}

// ---------------------------------------------------------------------------
// SqliteServiceConnectionsRepository
// ---------------------------------------------------------------------------

/**
 * SQLite-backed implementation of {@link ServiceConnectionsRepository}.
 *
 * Every row returned by `list()`, `get()` and `upsert()` is stamped with
 * `source: 'db'` — this repository only ever surfaces DB-backed rows. The
 * `source: 'config'` value is produced exclusively by the admin route GET
 * handler when synthesizing a row for a service that has no DB entry yet
 * (per-service fallback per phase 06 D-14).
 *
 * Secrets are encrypted with the existing `encryptSecret` / `decryptSecret`
 * helpers keyed on `sessionSecret` (D-05). An empty `client_secret_encrypted`
 * column is treated as "no secret configured" and is NEVER passed to the
 * decrypt function (D-06).
 */
export class SqliteServiceConnectionsRepository
  implements ServiceConnectionsRepository
{
  constructor(
    private readonly db: Database.Database,
    private readonly sessionSecret: string,
  ) {}

  async list(): Promise<ServiceConnection[]> {
    const rows = this.db
      .prepare(
        `SELECT service_id, url, client_id, client_secret_encrypted, updated_at, updated_by
         FROM service_connections
         ORDER BY service_id`,
      )
      .all() as ServiceConnectionRow[];

    return rows.map((row) => this.rowToConnection(row));
  }

  async get(serviceId: ServiceId): Promise<ServiceConnection | null> {
    const row = this.db
      .prepare(
        `SELECT service_id, url, client_id, client_secret_encrypted, updated_at, updated_by
         FROM service_connections
         WHERE service_id = @serviceId`,
      )
      .get({ serviceId }) as ServiceConnectionRow | undefined;

    if (row === undefined) {
      return null;
    }
    return this.rowToConnection(row);
  }

  async upsert(
    input: ServiceConnectionUpsertInput,
  ): Promise<ServiceConnection> {
    const { serviceId, url, clientId, clientSecret, updatedBy } = input;
    const updatedAt = new Date().toISOString();

    if (clientSecret === null) {
      // Blank-to-keep: preserve the existing encrypted secret. If the row
      // does not exist yet, COALESCE on the target column defaults to ''
      // (empty = no secret), which matches the D-06 empty-case contract.
      this.db
        .prepare(
          `INSERT INTO service_connections
             (service_id, url, client_id, client_secret_encrypted, updated_at, updated_by)
           VALUES
             (@serviceId, @url, @clientId, '', @updatedAt, @updatedBy)
           ON CONFLICT(service_id) DO UPDATE SET
             url = excluded.url,
             client_id = excluded.client_id,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
        )
        .run({ serviceId, url, clientId, updatedAt, updatedBy });
    } else {
      // Explicit write: empty string clears the secret without invoking the
      // cipher; a non-empty string is encrypted before being stored.
      const encrypted =
        clientSecret === '' ? '' : encryptSecret(clientSecret, this.sessionSecret);

      this.db
        .prepare(
          `INSERT INTO service_connections
             (service_id, url, client_id, client_secret_encrypted, updated_at, updated_by)
           VALUES
             (@serviceId, @url, @clientId, @encrypted, @updatedAt, @updatedBy)
           ON CONFLICT(service_id) DO UPDATE SET
             url = excluded.url,
             client_id = excluded.client_id,
             client_secret_encrypted = excluded.client_secret_encrypted,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
        )
        .run({ serviceId, url, clientId, encrypted, updatedAt, updatedBy });
    }

    const saved = await this.get(serviceId);
    if (saved === null) {
      // Unreachable in practice: INSERT ... ON CONFLICT guarantees a row.
      throw new Error(
        `SqliteServiceConnectionsRepository.upsert: row disappeared for ${serviceId}`,
      );
    }
    return saved;
  }

  async clearSecret(
    serviceId: ServiceId,
    updatedBy: string | null,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE service_connections
         SET client_secret_encrypted = '',
             updated_at = @updatedAt,
             updated_by = @updatedBy
         WHERE service_id = @serviceId`,
      )
      .run({ serviceId, updatedAt, updatedBy });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private rowToConnection(row: ServiceConnectionRow): ServiceConnection {
    const clientSecret =
      row.client_secret_encrypted === ''
        ? ''
        : decryptSecret(row.client_secret_encrypted, this.sessionSecret);

    return {
      serviceId: row.service_id as ServiceId,
      url: row.url,
      clientId: row.client_id,
      clientSecret,
      hasSecret: clientSecret !== '',
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      source: 'db',
    };
  }
}
