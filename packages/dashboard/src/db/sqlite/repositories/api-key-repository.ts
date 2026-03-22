import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import type { ApiKeyRepository } from '../../interfaces/api-key-repository.js';
import type { ApiKeyRecord } from '../../types.js';

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
// Private row type
// ---------------------------------------------------------------------------

interface ApiKeyRow {
  id: string;
  key_hash: string;
  label: string;
  active: number;
  created_at: string;
  last_used_at: string | null;
  org_id: string;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    active: row.active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteApiKeyRepository
// ---------------------------------------------------------------------------

export class SqliteApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Database.Database) {}

  async storeKey(key: string, label: string, orgId?: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    const keyHash = hashApiKey(key);
    const createdAt = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO api_keys (id, key_hash, label, active, created_at, org_id)
       VALUES (@id, @keyHash, @label, 1, @createdAt, @orgId)`,
    ).run({ id, keyHash, label, createdAt, orgId: orgId ?? 'system' });

    return id;
  }

  async validateKey(key: string): Promise<boolean> {
    const keyHash = hashApiKey(key);
    const row = this.db
      .prepare('SELECT id FROM api_keys WHERE key_hash = @keyHash AND active = 1')
      .get({ keyHash }) as { id: string } | undefined;

    if (row !== undefined) {
      this.db.prepare(
        'UPDATE api_keys SET last_used_at = @now WHERE key_hash = @keyHash',
      ).run({ now: new Date().toISOString(), keyHash });
    }

    return row !== undefined;
  }

  async getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }> {
    const existing = this.db
      .prepare('SELECT id FROM api_keys WHERE active = 1 LIMIT 1')
      .get() as { id: string } | undefined;

    if (existing !== undefined) {
      return { key: null, isNew: false };
    }

    const key = generateApiKey();
    await this.storeKey(key, 'default');
    return { key, isNew: true };
  }

  async revokeAllKeys(): Promise<void> {
    this.db.prepare('UPDATE api_keys SET active = 0').run();
  }

  async listKeys(orgId?: string): Promise<ApiKeyRecord[]> {
    if (orgId !== undefined) {
      const rows = this.db
        .prepare('SELECT * FROM api_keys WHERE org_id = @orgId ORDER BY created_at DESC')
        .all({ orgId }) as ApiKeyRow[];
      return rows.map(rowToRecord);
    }

    const rows = this.db
      .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
      .all() as ApiKeyRow[];
    return rows.map(rowToRecord);
  }

  async revokeKey(id: string): Promise<void> {
    this.db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(id);
  }
}
