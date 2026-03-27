import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  generateApiKey,
  hashApiKey,
  storeApiKey,
  validateApiKey,
  getOrCreateApiKey,
  revokeAllKeys,
} from '../../src/auth/api-key.js';

describe('API Key Auth', () => {
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    storage = new SqliteStorageAdapter(':memory:');
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.disconnect();
  });

  describe('generateApiKey', () => {
    it('returns a 64-char hex string', () => {
      const key = generateApiKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('hashApiKey', () => {
    it('returns consistent hash for same input', () => {
      const key = generateApiKey();
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });
  });

  describe('storeApiKey', () => {
    it('inserts into database', () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      const id = storeApiKey(db, key, 'test-label');

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const row = db
        .prepare('SELECT * FROM api_keys WHERE id = ?')
        .get(id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row['label']).toBe('test-label');
      expect(row['key_hash']).toBe(hashApiKey(key));
      expect(row['active']).toBe(1);
    });
  });

  describe('validateApiKey', () => {
    it('returns true for valid active key', () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'active-key');

      expect(validateApiKey(db, key).valid).toBe(true);
    });

    it('returns false for invalid key', () => {
      const db = storage.getRawDatabase();
      expect(validateApiKey(db, 'nonexistent-key').valid).toBe(false);
    });

    it('returns false for revoked key', () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'revoked-key');
      revokeAllKeys(db);

      expect(validateApiKey(db, key).valid).toBe(false);
    });
  });

  describe('getOrCreateApiKey', () => {
    it('creates new key when none exist, returns { key, isNew: true }', () => {
      const db = storage.getRawDatabase();
      const result = getOrCreateApiKey(db);

      expect(result.isNew).toBe(true);
      expect(result.key).not.toBeNull();
      expect(typeof result.key).toBe('string');
      expect(result.key!).toHaveLength(64);

      // The newly created key should be valid
      expect(validateApiKey(db, result.key!).valid).toBe(true);
    });

    it('returns { key: null, isNew: false } when active key exists', () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'existing-key');

      const result = getOrCreateApiKey(db);
      expect(result.isNew).toBe(false);
      expect(result.key).toBeNull();
    });
  });

  describe('revokeAllKeys', () => {
    it('deactivates all keys', () => {
      const db = storage.getRawDatabase();
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      storeApiKey(db, key1, 'key-1');
      storeApiKey(db, key2, 'key-2');

      revokeAllKeys(db);

      expect(validateApiKey(db, key1).valid).toBe(false);
      expect(validateApiKey(db, key2).valid).toBe(false);

      const activeCount = db
        .prepare('SELECT COUNT(*) as cnt FROM api_keys WHERE active = 1')
        .get() as { cnt: number };
      expect(activeCount.cnt).toBe(0);
    });
  });
});
