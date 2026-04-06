/**
 * Phase 12 Plan 02 — E2E org API key lifecycle (E2E-02).
 *
 * End-to-end validation of org API key lifecycle on live SQLite data:
 *   create key → validate (verify scoped access) → revoke → verify revocation.
 *   Also proves cross-org revocation guard (org admin cannot revoke another org's key).
 *
 * Requirement: E2E-02
 * Uses: real SQLite + real migrations + real SqliteApiKeyRepository.
 * No mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey, validateApiKey } from '../../src/auth/api-key.js';
import { API_KEY_RATE_LIMITS } from '../../src/db/types.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-e2e-org-api-key-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Scenario 1 — Create and validate key (OAK-01, OAK-02)
// ---------------------------------------------------------------------------

describe('Scenario 1: create and validate org-scoped API key', () => {
  it('creates a key for an org and validateApiKey returns valid=true, correct role and orgId', async () => {
    const key = generateApiKey();
    await storage.apiKeys.storeKey(key, 'e2e-test', 'org-e2e-keys', 'read-only');

    const result = validateApiKey(storage.getRawDatabase(), key);

    expect(result.valid).toBe(true);
    expect(result.role).toBe('read-only');
    expect(result.orgId).toBe('org-e2e-keys');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Scoped access: key for org-A does not resolve as org-B (OAK-02)
// ---------------------------------------------------------------------------

describe('Scenario 2: org-scoped key isolation — each key belongs to its own org', () => {
  it('keys for different orgs resolve to their respective orgs and list results are isolated', async () => {
    const keyA = generateApiKey();
    const keyB = generateApiKey();

    const idA = await storage.apiKeys.storeKey(keyA, 'key-a', 'org-a-e2e', 'admin');
    const idB = await storage.apiKeys.storeKey(keyB, 'key-b', 'org-b-e2e', 'scan-only');

    const resultA = validateApiKey(storage.getRawDatabase(), keyA);
    const resultB = validateApiKey(storage.getRawDatabase(), keyB);

    expect(resultA.orgId).toBe('org-a-e2e');
    expect(resultB.orgId).toBe('org-b-e2e');

    const listA = await storage.apiKeys.listKeys('org-a-e2e');
    const listB = await storage.apiKeys.listKeys('org-b-e2e');

    expect(listA.length).toBe(1);
    expect(listA[0].orgId).toBe('org-a-e2e');
    expect(listB.length).toBe(1);
    expect(listB[0].orgId).toBe('org-b-e2e');

    expect(idA).not.toBe(idB);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Revoke key then verify revocation (OAK-01)
// ---------------------------------------------------------------------------

describe('Scenario 3: revoke key — validateApiKey returns valid=false after revocation', () => {
  it('creates a key, validates it, revokes it with orgId, then validateApiKey returns valid=false', async () => {
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'revoke-test', 'org-revoke-e2e', 'admin');

    const before = validateApiKey(storage.getRawDatabase(), key);
    expect(before.valid).toBe(true);

    await storage.apiKeys.revokeKey(id, 'org-revoke-e2e');

    const after = validateApiKey(storage.getRawDatabase(), key);
    expect(after.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Cross-org revocation is blocked (OAK-02 isolation guard)
// ---------------------------------------------------------------------------

describe('Scenario 4: cross-org revocation guard — wrong orgId cannot deactivate the key', () => {
  it('revokeKey with wrong orgId leaves the key active; correct orgId revokes it', async () => {
    const key = generateApiKey();
    const id = await storage.apiKeys.storeKey(key, 'guard-test', 'org-owner-e2e', 'read-only');

    // Attacker attempts revocation with wrong orgId — key must remain active.
    await storage.apiKeys.revokeKey(id, 'org-attacker-e2e');
    const afterAttack = validateApiKey(storage.getRawDatabase(), key);
    expect(afterAttack.valid).toBe(true);

    // Owner revokes with correct orgId — key must now be inactive.
    await storage.apiKeys.revokeKey(id, 'org-owner-e2e');
    const afterRevoke = validateApiKey(storage.getRawDatabase(), key);
    expect(afterRevoke.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Rate limits are correct per role (OAK-04)
// ---------------------------------------------------------------------------

describe('Scenario 5: rate limit constants are correct per role', () => {
  it('API_KEY_RATE_LIMITS defines 200 for admin, 100 for read-only, 50 for scan-only', () => {
    expect(API_KEY_RATE_LIMITS['admin']).toBe(200);
    expect(API_KEY_RATE_LIMITS['read-only']).toBe(100);
    expect(API_KEY_RATE_LIMITS['scan-only']).toBe(50);
  });
});
