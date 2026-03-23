import type pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly orgId: string;
}

interface ApiKeyRepository {
  storeKey(key: string, label: string, orgId?: string): Promise<string>;
  validateKey(key: string): Promise<boolean>;
  getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }>;
  revokeAllKeys(): Promise<void>;
  listKeys(orgId?: string): Promise<ApiKeyRecord[]>;
  revokeKey(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface ApiKeyRow {
  id: string;
  key_hash: string;
  label: string;
  active: boolean;
  created_at: string | Date;
  last_used_at: string | Date | null;
  org_id: string;
}

function toIso(val: string | Date | null): string | null {
  if (val === null) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    active: row.active,
    createdAt: toIso(row.created_at as string | Date)!,
    lastUsedAt: toIso(row.last_used_at as string | Date | null),
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// PgApiKeyRepository
// ---------------------------------------------------------------------------

export class PgApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async storeKey(key: string, label: string, orgId?: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    const keyHash = hashApiKey(key);
    const createdAt = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO api_keys (id, key_hash, label, active, created_at, org_id)
       VALUES ($1, $2, $3, true, $4, $5)`,
      [id, keyHash, label, createdAt, orgId ?? 'system'],
    );

    return id;
  }

  async validateKey(key: string): Promise<boolean> {
    const keyHash = hashApiKey(key);
    const result = await this.pool.query<{ id: string }>(
      'SELECT id FROM api_keys WHERE key_hash = $1 AND active = true',
      [keyHash],
    );

    if (result.rows.length > 0) {
      await this.pool.query(
        'UPDATE api_keys SET last_used_at = $1 WHERE key_hash = $2',
        [new Date().toISOString(), keyHash],
      );
    }

    return result.rows.length > 0;
  }

  async getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }> {
    const existing = await this.pool.query<{ id: string }>(
      'SELECT id FROM api_keys WHERE active = true LIMIT 1',
    );

    if (existing.rows.length > 0) {
      return { key: null, isNew: false };
    }

    const key = generateApiKey();
    await this.storeKey(key, 'default');
    return { key, isNew: true };
  }

  async revokeAllKeys(): Promise<void> {
    await this.pool.query('UPDATE api_keys SET active = false');
  }

  async listKeys(orgId?: string): Promise<ApiKeyRecord[]> {
    if (orgId !== undefined) {
      const result = await this.pool.query<ApiKeyRow>(
        'SELECT * FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC',
        [orgId],
      );
      return result.rows.map(rowToRecord);
    }

    const result = await this.pool.query<ApiKeyRow>(
      'SELECT * FROM api_keys ORDER BY created_at DESC',
    );
    return result.rows.map(rowToRecord);
  }

  async revokeKey(id: string): Promise<void> {
    await this.pool.query('UPDATE api_keys SET active = false WHERE id = $1', [id]);
  }
}
