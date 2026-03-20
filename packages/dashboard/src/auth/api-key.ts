import { randomBytes, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface ApiKeyResult {
  readonly key: string | null;
  readonly isNew: boolean;
}

/**
 * Generate a 32-byte hex API key (64 characters).
 */
export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * SHA-256 hash of an API key. Fast and appropriate for high-entropy secrets.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Store a hashed API key in the database. Returns the row id.
 */
export function storeApiKey(
  db: Database.Database,
  key: string,
  label: string,
): string {
  const id = randomBytes(16).toString('hex');
  const keyHash = hashApiKey(key);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO api_keys (id, key_hash, label, active, created_at)
     VALUES (@id, @keyHash, @label, 1, @createdAt)`,
  ).run({ id, keyHash, label, createdAt });

  return id;
}

/**
 * Validate an API key against active keys in the database.
 */
export function validateApiKey(
  db: Database.Database,
  key: string,
): boolean {
  const keyHash = hashApiKey(key);
  const row = db
    .prepare('SELECT id FROM api_keys WHERE key_hash = @keyHash AND active = 1')
    .get({ keyHash }) as { id: string } | undefined;

  if (row !== undefined) {
    updateLastUsed(db, keyHash);
  }

  return row !== undefined;
}

/**
 * Return an existing active key status or create a new key if none exist.
 * The plaintext key is only returned when newly generated.
 */
export function getOrCreateApiKey(db: Database.Database): ApiKeyResult {
  const existing = db
    .prepare('SELECT id FROM api_keys WHERE active = 1 LIMIT 1')
    .get() as { id: string } | undefined;

  if (existing !== undefined) {
    return { key: null, isNew: false };
  }

  const key = generateApiKey();
  storeApiKey(db, key, 'default');
  return { key, isNew: true };
}

/**
 * Revoke all API keys by setting active = 0.
 */
export function revokeAllKeys(db: Database.Database): void {
  db.prepare('UPDATE api_keys SET active = 0').run();
}

/**
 * Update the last_used_at timestamp for a key hash.
 */
export function updateLastUsed(
  db: Database.Database,
  keyHash: string,
): void {
  db.prepare(
    'UPDATE api_keys SET last_used_at = @now WHERE key_hash = @keyHash',
  ).run({ now: new Date().toISOString(), keyHash });
}
