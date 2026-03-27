import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

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

describe('ApiKeyRepository', () => {
  describe('storeKey', () => {
    it('creates a hashed key record and returns the ID', async () => {
      const rawKey = 'my-secret-api-key-value-that-is-long-enough';
      const id = await storage.apiKeys.storeKey(rawKey, 'test-label', 'org-1');

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const keys = await storage.apiKeys.listKeys('org-1');
      expect(keys.length).toBe(1);
      expect(keys[0].label).toBe('test-label');
      expect(keys[0].active).toBe(true);
      expect(keys[0].orgId).toBe('org-1');
    });
  });

  describe('validateKey', () => {
    it('returns valid true for a valid active key', async () => {
      const rawKey = 'valid-active-key-long-enough-for-testing';
      await storage.apiKeys.storeKey(rawKey, 'active-key', 'org-1');

      const result = await storage.apiKeys.validateKey(rawKey);
      expect(result.valid).toBe(true);
      expect(result.role).toBe('admin');
    });

    it('returns valid false for a revoked key', async () => {
      const rawKey = 'revoked-key-long-enough-for-testing-purposes';
      const id = await storage.apiKeys.storeKey(rawKey, 'to-revoke', 'org-1');

      await storage.apiKeys.revokeKey(id);

      const result = await storage.apiKeys.validateKey(rawKey);
      expect(result.valid).toBe(false);
    });

    it('returns valid false for a non-existent key', async () => {
      const result = await storage.apiKeys.validateKey('non-existent-key-that-was-never-stored');
      expect(result.valid).toBe(false);
    });
  });

  describe('getOrCreateKey', () => {
    it('returns a new key with isNew true on first call', async () => {
      const result = await storage.apiKeys.getOrCreateKey();

      expect(result.isNew).toBe(true);
      expect(typeof result.key).toBe('string');
      expect(result.key!.length).toBeGreaterThan(0);
    });

    it('returns null key with isNew false on subsequent call', async () => {
      await storage.apiKeys.getOrCreateKey();
      const second = await storage.apiKeys.getOrCreateKey();

      expect(second.isNew).toBe(false);
      expect(second.key).toBeNull();
    });
  });

  describe('revokeAllKeys', () => {
    it('deactivates all keys', async () => {
      await storage.apiKeys.storeKey('key-one-long-enough-for-tests', 'key-1', 'org-1');
      await storage.apiKeys.storeKey('key-two-long-enough-for-tests', 'key-2', 'org-1');

      await storage.apiKeys.revokeAllKeys();

      const keys = await storage.apiKeys.listKeys('org-1');
      expect(keys.length).toBe(2);
      expect(keys.every((k) => k.active === false)).toBe(true);
    });
  });

  describe('revokeKey', () => {
    it('deactivates a single key by ID', async () => {
      const id1 = await storage.apiKeys.storeKey('key-alpha-long-for-testing', 'key-alpha', 'org-1');
      await storage.apiKeys.storeKey('key-beta-long-for-testing', 'key-beta', 'org-1');

      await storage.apiKeys.revokeKey(id1);

      const keys = await storage.apiKeys.listKeys('org-1');
      const alpha = keys.find((k) => k.id === id1);
      const beta = keys.find((k) => k.label === 'key-beta');

      expect(alpha!.active).toBe(false);
      expect(beta!.active).toBe(true);
    });
  });

  describe('listKeys', () => {
    it('returns all keys for a given orgId', async () => {
      await storage.apiKeys.storeKey('org1-key-one-long-for-tests', 'org1-key-1', 'org-1');
      await storage.apiKeys.storeKey('org1-key-two-long-for-tests', 'org1-key-2', 'org-1');
      await storage.apiKeys.storeKey('org2-key-one-long-for-tests', 'org2-key-1', 'org-2');

      const org1Keys = await storage.apiKeys.listKeys('org-1');
      expect(org1Keys.length).toBe(2);
      expect(org1Keys.every((k) => k.orgId === 'org-1')).toBe(true);

      const org2Keys = await storage.apiKeys.listKeys('org-2');
      expect(org2Keys.length).toBe(1);
    });

    it('returns all keys when no orgId provided', async () => {
      await storage.apiKeys.storeKey('any-key-one-long-for-tests', 'key-1', 'org-1');
      await storage.apiKeys.storeKey('any-key-two-long-for-tests', 'key-2', 'org-2');

      const all = await storage.apiKeys.listKeys();
      expect(all.length).toBe(2);
    });
  });
});
