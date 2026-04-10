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

// ---------------------------------------------------------------------------
// New methods: storeKey with expiresAt, deleteKey, revokeExpiredKeys
// ---------------------------------------------------------------------------

describe('ApiKeyRepository — storeKey with expiresAt', () => {
  it('Test 1: stores key with explicit expiresAt and round-trips via listKeys', async () => {
    const id = await storage.apiKeys.storeKey(
      'key-with-expiry-long-enough',
      'expiry-key',
      'org-1',
      'admin',
      '2027-01-01T00:00:00.000Z',
    );

    const keys = await storage.apiKeys.listKeys('org-1');
    const record = keys.find((k) => k.id === id);
    expect(record).toBeDefined();
    expect(record!.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('Test 2: storeKey without expiresAt param produces expiresAt null', async () => {
    const id = await storage.apiKeys.storeKey('key-no-expiry-long-enough', 'no-expiry', 'org-1');

    const keys = await storage.apiKeys.listKeys('org-1');
    const record = keys.find((k) => k.id === id);
    expect(record).toBeDefined();
    expect(record!.expiresAt).toBeNull();
  });

  it('Test 3: storeKey with explicit null expiresAt produces expiresAt null', async () => {
    const id = await storage.apiKeys.storeKey(
      'key-explicit-null-long-enough',
      'explicit-null',
      'org-1',
      'admin',
      null,
    );

    const keys = await storage.apiKeys.listKeys('org-1');
    const record = keys.find((k) => k.id === id);
    expect(record).toBeDefined();
    expect(record!.expiresAt).toBeNull();
  });
});

describe('ApiKeyRepository — deleteKey', () => {
  it('Test 4: deleteKey returns true after revoke and removes row', async () => {
    const id = await storage.apiKeys.storeKey('delete-key-a-long-enough', 'delete-a', 'org-1');
    await storage.apiKeys.revokeKey(id, 'org-1');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-1');
    expect(deleted).toBe(true);

    const keys = await storage.apiKeys.listKeys('org-1');
    expect(keys.find((k) => k.id === id)).toBeUndefined();
  });

  it('Test 5: deleteKey returns false for an active key and leaves it intact', async () => {
    const id = await storage.apiKeys.storeKey('delete-key-b-long-enough', 'delete-b', 'org-1');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-1');
    expect(deleted).toBe(false);

    const keys = await storage.apiKeys.listKeys('org-1');
    expect(keys.find((k) => k.id === id)).toBeDefined();
  });

  it('Test 6: deleteKey cross-org guard — cannot delete key from another org', async () => {
    const id = await storage.apiKeys.storeKey('delete-key-c-long-enough', 'delete-c', 'org-1');
    await storage.apiKeys.revokeKey(id, 'org-1');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-2');
    expect(deleted).toBe(false);

    // Key still visible in org-1
    const keys = await storage.apiKeys.listKeys('org-1');
    expect(keys.find((k) => k.id === id)).toBeDefined();
  });

  it('Test 7: deleteKey returns false for non-existent id', async () => {
    const deleted = await storage.apiKeys.deleteKey('non-existent-id-value', 'org-1');
    expect(deleted).toBe(false);
  });
});

describe('ApiKeyRepository — revokeExpiredKeys', () => {
  it('Test 8: revokes only active+expired keys, leaves others unchanged, returns count 1', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // (a) active + expired -> should be revoked
    const idA = await storage.apiKeys.storeKey('key-a-expired-long', 'a-expired', 'org-1', 'admin', past);

    // (b) active + future -> should remain active
    const idB = await storage.apiKeys.storeKey('key-b-future-long', 'b-future', 'org-1', 'admin', future);

    // (c) active + no expiry -> should remain active
    const idC = await storage.apiKeys.storeKey('key-c-null-long', 'c-null', 'org-1');

    // (d) already revoked + expired -> no double-update
    const idD = await storage.apiKeys.storeKey('key-d-rev-exp-long', 'd-revoked-expired', 'org-1', 'admin', past);
    await storage.apiKeys.revokeKey(idD, 'org-1');

    const count = await storage.apiKeys.revokeExpiredKeys();
    expect(count).toBe(1);

    const keys = await storage.apiKeys.listKeys('org-1');
    const a = keys.find((k) => k.id === idA)!;
    const b = keys.find((k) => k.id === idB)!;
    const c = keys.find((k) => k.id === idC)!;
    const d = keys.find((k) => k.id === idD)!;

    expect(a.active).toBe(false);
    expect(b.active).toBe(true);
    expect(c.active).toBe(true);
    expect(d.active).toBe(false); // was already revoked
  });

  it('Test 9: returns 0 when no expired keys exist', async () => {
    await storage.apiKeys.storeKey('key-fresh-long', 'fresh', 'org-1');
    const count = await storage.apiKeys.revokeExpiredKeys();
    expect(count).toBe(0);
  });

  it('Test 10: rowToRecord round-trip — revoked expired key retains expiresAt', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const id = await storage.apiKeys.storeKey('key-roundtrip-long', 'roundtrip', 'org-1', 'admin', past);

    await storage.apiKeys.revokeExpiredKeys();

    const keys = await storage.apiKeys.listKeys('org-1');
    const record = keys.find((k) => k.id === id)!;
    expect(record.active).toBe(false);
    expect(record.expiresAt).toBe(past);
  });
});
