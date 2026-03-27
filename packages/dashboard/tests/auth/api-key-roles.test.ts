import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import type { ApiKeyRole } from '../../src/db/types.js';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('API Key Roles', () => {
  describe('storeKey with role', () => {
    it('defaults to admin role when no role specified', async () => {
      const rawKey = 'test-key-admin-default-long-enough';
      await storage.apiKeys.storeKey(rawKey, 'default-role-key', 'org-1');

      const keys = await storage.apiKeys.listKeys('org-1');
      expect(keys[0].role).toBe('admin');
    });

    it('stores the specified role', async () => {
      const rawKey = 'test-key-readonly-role-long-enough';
      await storage.apiKeys.storeKey(rawKey, 'readonly-key', 'org-1', 'read-only');

      const keys = await storage.apiKeys.listKeys('org-1');
      expect(keys[0].role).toBe('read-only');
    });

    it('stores scan-only role', async () => {
      const rawKey = 'test-key-scanonly-role-long-enough';
      await storage.apiKeys.storeKey(rawKey, 'scanonly-key', 'org-1', 'scan-only');

      const keys = await storage.apiKeys.listKeys('org-1');
      expect(keys[0].role).toBe('scan-only');
    });
  });

  describe('validateKey returns role', () => {
    it('returns valid true and admin role for admin key', async () => {
      const rawKey = 'admin-key-for-validation-test-long-enough';
      await storage.apiKeys.storeKey(rawKey, 'admin-key', 'org-1', 'admin');

      const result = await storage.apiKeys.validateKey(rawKey);
      expect(result.valid).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('returns valid true and read-only role', async () => {
      const rawKey = 'readonly-key-for-validation-test-long';
      await storage.apiKeys.storeKey(rawKey, 'ro-key', 'org-1', 'read-only');

      const result = await storage.apiKeys.validateKey(rawKey);
      expect(result.valid).toBe(true);
      expect(result.role).toBe('read-only');
    });

    it('returns valid false for non-existent key', async () => {
      const result = await storage.apiKeys.validateKey('nonexistent-key-that-does-not-exist');
      expect(result.valid).toBe(false);
      expect(result.role).toBeUndefined();
    });

    it('returns valid false for revoked key', async () => {
      const rawKey = 'revoked-key-role-test-long-enough-value';
      const id = await storage.apiKeys.storeKey(rawKey, 'to-revoke', 'org-1', 'admin');
      await storage.apiKeys.revokeKey(id);

      const result = await storage.apiKeys.validateKey(rawKey);
      expect(result.valid).toBe(false);
    });
  });

  describe('existing keys default to admin', () => {
    it('getOrCreateKey creates key with admin role', async () => {
      const result = await storage.apiKeys.getOrCreateKey();
      expect(result.isNew).toBe(true);

      const keys = await storage.apiKeys.listKeys();
      expect(keys[0].role).toBe('admin');
    });
  });
});
