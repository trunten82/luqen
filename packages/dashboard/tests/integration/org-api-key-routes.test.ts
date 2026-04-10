/**
 * Phase 14 Plan 02 — Org API key routes: TTL creation + DELETE route + sweep.
 *
 * Tests A–L per 14-02-PLAN.md.
 *
 * Uses real SQLite + real migrations + real SqliteApiKeyRepository.
 * Route logic is tested via direct handler extraction (parseTtl helper) and
 * repository calls. The sweep module (runApiKeySweep) is exercised directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import { parseTtl, ALLOWED_TTL_DAYS, computeExpiresAt } from '../../src/routes/admin/org-api-keys.js';
import { runApiKeySweep } from '../../src/api-key-sweep.js';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-14-02-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// TTL whitelist validation (Tests A–F via parseTtl + computeExpiresAt helpers)
// ---------------------------------------------------------------------------

describe('parseTtl — TTL validation', () => {
  it('Test A: ttl=90 parses to 90 and produces a non-null ISO string ~90 days out', () => {
    const result = parseTtl('90');
    expect(result.valid).toBe(true);
    expect(result.ttlDays).toBe(90);
    const expiresAt = computeExpiresAt(90);
    expect(expiresAt).not.toBeNull();
    const diff = new Date(expiresAt!).getTime() - Date.now();
    // Allow 5s slack
    expect(diff).toBeGreaterThan(89 * 86400 * 1000 - 5000);
    expect(diff).toBeLessThan(91 * 86400 * 1000);
  });

  it('Test B: ttl=0 parses to 0 and produces null expiresAt', () => {
    const result = parseTtl('0');
    expect(result.valid).toBe(true);
    expect(result.ttlDays).toBe(0);
    const expiresAt = computeExpiresAt(0);
    expect(expiresAt).toBeNull();
  });

  it('Test C: ttl=45 is rejected (not in whitelist)', () => {
    const result = parseTtl('45');
    expect(result.valid).toBe(false);
  });

  it('Test D: ttl=abc is rejected (non-numeric)', () => {
    const result = parseTtl('abc');
    expect(result.valid).toBe(false);
  });

  it('Test E: ttl omitted (undefined) defaults to 90 and produces non-null expiresAt', () => {
    const result = parseTtl(undefined);
    expect(result.valid).toBe(true);
    expect(result.ttlDays).toBe(90);
    const expiresAt = computeExpiresAt(result.ttlDays!);
    expect(expiresAt).not.toBeNull();
  });

  it('Test F: ttl=365 parses to 365 and produces expiresAt ~365 days out', () => {
    const result = parseTtl('365');
    expect(result.valid).toBe(true);
    expect(result.ttlDays).toBe(365);
    const expiresAt = computeExpiresAt(365);
    expect(expiresAt).not.toBeNull();
    const diff = new Date(expiresAt!).getTime() - Date.now();
    expect(diff).toBeGreaterThan(364 * 86400 * 1000 - 5000);
    expect(diff).toBeLessThan(366 * 86400 * 1000);
  });

  it('ALLOWED_TTL_DAYS exports the correct whitelist', () => {
    expect([...ALLOWED_TTL_DAYS]).toEqual([0, 30, 90, 180, 365]);
  });
});

// ---------------------------------------------------------------------------
// Integration: storeKey with expiresAt (validating through repository)
// ---------------------------------------------------------------------------

describe('storeKey with TTL-computed expiresAt (integration)', () => {
  it('Test A-integration: ttl=90 → stored key has expiresAt ~90 days out', async () => {
    const key = generateApiKey();
    const expiresAt = computeExpiresAt(90);
    const id = await storage.apiKeys.storeKey(key, 'ttl-90', 'org-ttl', 'admin', expiresAt);
    const keys = await storage.apiKeys.listKeys('org-ttl');
    const record = keys.find(k => k.id === id);
    expect(record).toBeDefined();
    expect(record!.expiresAt).not.toBeNull();
    const diff = new Date(record!.expiresAt!).getTime() - Date.now();
    expect(diff).toBeGreaterThan(89 * 86400 * 1000 - 5000);
  });

  it('Test B-integration: ttl=0 → stored key has expiresAt null', async () => {
    const key = generateApiKey();
    const expiresAt = computeExpiresAt(0);
    const id = await storage.apiKeys.storeKey(key, 'ttl-0', 'org-ttl', 'admin', expiresAt);
    const keys = await storage.apiKeys.listKeys('org-ttl');
    const record = keys.find(k => k.id === id);
    expect(record).toBeDefined();
    expect(record!.expiresAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE route logic (Tests G–J via repository-level tests)
// ---------------------------------------------------------------------------

describe('deleteKey — DELETE /admin/org-api-keys/:id behavior', () => {
  it('Test G: DELETE on revoked key in same org → true, key removed from listKeys', async () => {
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'to-delete', 'org-delete', 'admin');
    await storage.apiKeys.revokeKey(id, 'org-delete');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-delete');
    expect(deleted).toBe(true);

    const keys = await storage.apiKeys.listKeys('org-delete');
    expect(keys.find(k => k.id === id)).toBeUndefined();
  });

  it('Test H: DELETE on active key returns false, key NOT removed', async () => {
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'active-key', 'org-delete', 'admin');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-delete');
    expect(deleted).toBe(false);

    const keys = await storage.apiKeys.listKeys('org-delete');
    expect(keys.find(k => k.id === id)).toBeDefined();
  });

  it('Test I: DELETE with another org ID returns false, key NOT removed', async () => {
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'cross-org-key', 'org-owner', 'admin');
    await storage.apiKeys.revokeKey(id, 'org-owner');

    const deleted = await storage.apiKeys.deleteKey(id, 'org-attacker');
    expect(deleted).toBe(false);

    const keys = await storage.apiKeys.listKeys('org-owner');
    expect(keys.find(k => k.id === id)).toBeDefined();
  });

  it('Test J: deleteKey with non-existent id returns false', async () => {
    const deleted = await storage.apiKeys.deleteKey('non-existent-id', 'org-delete');
    expect(deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sweep helper (Tests K–L)
// ---------------------------------------------------------------------------

describe('runApiKeySweep', () => {
  it('Test K: sweep revokes expired+active key, writes audit entry with api_key.auto_revoke', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'expired-key', 'org-sweep', 'admin', past);

    // Verify key is initially active
    const beforeKeys = await storage.apiKeys.listKeys('org-sweep');
    expect(beforeKeys.find(k => k.id === id)?.active).toBe(true);

    // Mock logger
    const loggedEntries: unknown[] = [];
    const mockLog = {
      info: vi.fn((obj: unknown) => { loggedEntries.push(obj); }),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: vi.fn(),
    } as unknown as FastifyBaseLogger;

    const auditCalls: unknown[] = [];
    const mockStorage = {
      apiKeys: storage.apiKeys,
      audit: {
        log: vi.fn((entry: unknown) => {
          auditCalls.push(entry);
          return Promise.resolve();
        }),
      },
    } as unknown as SqliteStorageAdapter;

    const count = await runApiKeySweep(mockStorage, mockLog, 'startup');
    expect(count).toBe(1);

    // Key should now be inactive
    const afterKeys = await storage.apiKeys.listKeys('org-sweep');
    expect(afterKeys.find(k => k.id === id)?.active).toBe(false);

    // Audit log called with api_key.auto_revoke
    expect(mockStorage.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'system',
        action: 'api_key.auto_revoke',
        details: expect.objectContaining({ count: 1, trigger: 'startup' }),
      }),
    );
  });

  it('Test L: sweep on empty DB returns 0 and does NOT write audit entry', async () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: vi.fn(),
    } as unknown as FastifyBaseLogger;

    const mockStorage = {
      apiKeys: storage.apiKeys,
      audit: {
        log: vi.fn(),
      },
    } as unknown as SqliteStorageAdapter;

    const count = await runApiKeySweep(mockStorage, mockLog, 'startup');
    expect(count).toBe(0);

    // No audit entry when count = 0
    expect(mockStorage.audit.log).not.toHaveBeenCalled();
  });
});
