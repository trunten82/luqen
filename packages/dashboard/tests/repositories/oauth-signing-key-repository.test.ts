/**
 * Phase 31.1 Plan 01 Task 3 — OauthSigningKeyRepository contract tests.
 *
 * Covers D-24 (JWKS publish), D-25 (retire → cutoff → remove), D-26 (RS256):
 *   - insertKey persists with retired_at=null, removed_at=null
 *   - listActiveKeys: retired_at IS NULL
 *   - listPublishableKeys: removed_at IS NULL (active + retiring)
 *   - retireKey sets retired_at = now
 *   - listRemovable (cutoff): retired_at < cutoff AND removed_at IS NULL
 *   - markRemoved sets removed_at = now
 */

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

function insert(kid: string) {
  return storage.oauthSigningKeys.insertKey({
    kid,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\npub-${kid}\n-----END PUBLIC KEY-----`,
    encryptedPrivateKeyPem: `enc::priv-${kid}`,
  });
}

describe('SqliteOauthSigningKeyRepository — insertKey', () => {
  it('persists a row with retired_at and removed_at both null', async () => {
    const key = await insert('kid-1');
    expect(key.kid).toBe('kid-1');
    expect(key.algorithm).toBe('RS256');
    expect(key.retiredAt).toBeNull();
    expect(key.removedAt).toBeNull();
    expect(key.publicKeyPem).toContain('pub-kid-1');
    expect(key.encryptedPrivateKeyPem).toBe('enc::priv-kid-1');
    expect(key.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SqliteOauthSigningKeyRepository — listActiveKeys', () => {
  it('returns all rows where retired_at IS NULL, ordered created_at DESC', async () => {
    await insert('old');
    await new Promise((r) => setTimeout(r, 10));
    await insert('middle');
    await new Promise((r) => setTimeout(r, 10));
    await insert('new');

    await storage.oauthSigningKeys.retireKey('old');

    const active = await storage.oauthSigningKeys.listActiveKeys();
    expect(active).toHaveLength(2);
    // DESC — newest first
    expect(active[0]!.kid).toBe('new');
    expect(active[1]!.kid).toBe('middle');
  });
});

describe('SqliteOauthSigningKeyRepository — listPublishableKeys', () => {
  it('returns active + retiring keys (removed_at IS NULL)', async () => {
    await insert('live1');
    await insert('retiring');
    await insert('removed');

    await storage.oauthSigningKeys.retireKey('retiring');
    await storage.oauthSigningKeys.retireKey('removed');
    await storage.oauthSigningKeys.markRemoved('removed');

    const pub = await storage.oauthSigningKeys.listPublishableKeys();
    const kids = pub.map((k) => k.kid);
    expect(kids).toContain('live1');
    expect(kids).toContain('retiring');
    expect(kids).not.toContain('removed');
    expect(pub).toHaveLength(2);
  });
});

describe('SqliteOauthSigningKeyRepository — retireKey', () => {
  it('sets retired_at to a non-null timestamp', async () => {
    await insert('k1');
    const before = await storage.oauthSigningKeys.findByKid('k1');
    expect(before!.retiredAt).toBeNull();

    await storage.oauthSigningKeys.retireKey('k1');

    const after = await storage.oauthSigningKeys.findByKid('k1');
    expect(after!.retiredAt).not.toBeNull();
    expect(after!.retiredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SqliteOauthSigningKeyRepository — listRemovable', () => {
  it('returns rows with retired_at < cutoff AND removed_at IS NULL', async () => {
    await insert('aged');
    await insert('just-retired');
    await insert('still-active');

    await storage.oauthSigningKeys.retireKey('aged');
    // Cutoff = a moment in the future. `aged` retired BEFORE cutoff.
    const cutoff = new Date(Date.now() + 60_000).toISOString();

    // Retire just-retired AFTER cutoff so it's not eligible.
    // Simulate by setting cutoff to BEFORE just-retired.
    await new Promise((r) => setTimeout(r, 50));
    const cutoffBeforeJust = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    await storage.oauthSigningKeys.retireKey('just-retired');

    const removable = await storage.oauthSigningKeys.listRemovable(cutoffBeforeJust);
    const kids = removable.map((k) => k.kid);
    expect(kids).toContain('aged');
    expect(kids).not.toContain('just-retired'); // retired after cutoff
    expect(kids).not.toContain('still-active'); // never retired

    // With a future cutoff, both retired keys are removable.
    const removableAll = await storage.oauthSigningKeys.listRemovable(cutoff);
    const kidsAll = removableAll.map((k) => k.kid);
    expect(kidsAll).toContain('aged');
    expect(kidsAll).toContain('just-retired');
  });
});

describe('SqliteOauthSigningKeyRepository — markRemoved', () => {
  it('sets removed_at to a non-null timestamp', async () => {
    await insert('r1');
    await storage.oauthSigningKeys.retireKey('r1');
    const before = await storage.oauthSigningKeys.findByKid('r1');
    expect(before!.removedAt).toBeNull();

    await storage.oauthSigningKeys.markRemoved('r1');

    const after = await storage.oauthSigningKeys.findByKid('r1');
    expect(after!.removedAt).not.toBeNull();
    expect(after!.removedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
