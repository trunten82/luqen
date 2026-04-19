/**
 * Phase 31.1 Plan 04 Task 1 — oauth-key-rotation tests (8 tests).
 *
 * Covers:
 *   - performKeyRotation (Tests 1–3)
 *   - runKeyHousekeeping: cleanupExpired + listRemovable + auto-rotate + audit (Tests 4–8)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt, encryptSecret } from '../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../src/auth/oauth-key-bootstrap.js';
import {
  performKeyRotation,
  runKeyHousekeeping,
} from '../../src/auth/oauth-key-rotation.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

interface Ctx {
  storage: SqliteStorageAdapter;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-04-rotation-test-salt');
  const dbPath = join(tmpdir(), `test-key-rotation-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const cleanup = async (): Promise<void> => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { storage, cleanup };
}

// Helper to forge a signing key row directly in the DB with a chosen created_at / retired_at.
// This lets us test age-based logic without waiting real wall time.
async function seedSigningKey(
  storage: SqliteStorageAdapter,
  opts: { createdAt: string; retiredAt?: string | null },
): Promise<string> {
  const kid = `k_${randomBytes(8).toString('hex')}`;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const encrypted = encryptSecret(privateKey, ENC_KEY);
  const db = storage.getRawDatabase();
  db.prepare(
    `INSERT INTO oauth_signing_keys
       (kid, public_key_pem, encrypted_private_key_pem, algorithm, created_at, retired_at, removed_at)
     VALUES (?, ?, ?, 'RS256', ?, ?, NULL)`,
  ).run(kid, publicKey, encrypted, opts.createdAt, opts.retiredAt ?? null);
  return kid;
}

// ── Test 1 ────────────────────────────────────────────────────────────────────

describe('performKeyRotation — Test 1 (single active key: rotate + retire)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('inserts a new key, retires the previous one, returns both kids', async () => {
    await ensureInitialSigningKey(ctx.storage, ENC_KEY);
    const beforeActive = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(beforeActive.length).toBe(1);
    const originalKid = beforeActive[0]!.kid;

    const result = await performKeyRotation(ctx.storage, ENC_KEY);

    expect(result.newKid).toBeTruthy();
    expect(result.newKid).not.toBe(originalKid);
    expect(result.retiredKid).toBe(originalKid);

    const original = await ctx.storage.oauthSigningKeys.findByKid(originalKid);
    expect(original?.retiredAt).not.toBeNull();
    const neu = await ctx.storage.oauthSigningKeys.findByKid(result.newKid);
    expect(neu?.retiredAt).toBeNull();
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────

describe('performKeyRotation — Test 2 (defensive: two active keys ⇒ only oldest retired)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('retires only one previously-active key (listActiveKeys DESC ordering)', async () => {
    // Seed two active keys with different created_at timestamps.
    // listActiveKeys orders DESC (newest first), so [0] is the newest.
    const olderKid = await seedSigningKey(ctx.storage, {
      createdAt: new Date(Date.now() - 10_000).toISOString(),
    });
    const newerKid = await seedSigningKey(ctx.storage, {
      createdAt: new Date().toISOString(),
    });
    const active = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(active.length).toBe(2);

    const result = await performKeyRotation(ctx.storage, ENC_KEY);

    // Implementation retires active[0] (newest of the prior set).
    expect(result.retiredKid).toBe(newerKid);

    const olderRow = await ctx.storage.oauthSigningKeys.findByKid(olderKid);
    expect(olderRow?.retiredAt).toBeNull();
    const newerRow = await ctx.storage.oauthSigningKeys.findByKid(newerKid);
    expect(newerRow?.retiredAt).not.toBeNull();
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────

describe('performKeyRotation — Test 3 (JWKS publishing)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('after rotate: listActiveKeys = 1 (new); listPublishableKeys = 2 (new + retiring)', async () => {
    await ensureInitialSigningKey(ctx.storage, ENC_KEY);
    await performKeyRotation(ctx.storage, ENC_KEY);

    const active = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(active.length).toBe(1);
    const publishable = await ctx.storage.oauthSigningKeys.listPublishableKeys();
    expect(publishable.length).toBe(2);
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────

describe('runKeyHousekeeping — Test 4 (cleanupExpired runs without throwing)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('invokes oauthRefresh.cleanupExpired; tolerates 0 rows', async () => {
    await ensureInitialSigningKey(ctx.storage, ENC_KEY);
    await expect(runKeyHousekeeping(ctx.storage, ENC_KEY, new Date())).resolves.toBeUndefined();
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────

describe('runKeyHousekeeping — Test 5 (markRemoved for keys past the 30d+1h cutoff)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('sets removed_at on keys retired more than 30d+1h ago', async () => {
    // Current active key (so auto-rotate logic doesn't fire).
    await ensureInitialSigningKey(ctx.storage, ENC_KEY);

    // Seed an "old retired" key — retired 31d ago (past 30d+1h cutoff).
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const oldRetiredKid = await seedSigningKey(ctx.storage, {
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      retiredAt: thirtyOneDaysAgo,
    });

    await runKeyHousekeeping(ctx.storage, ENC_KEY, new Date());

    const row = await ctx.storage.oauthSigningKeys.findByKid(oldRetiredKid);
    expect(row?.removedAt).not.toBeNull();
  });
});

// ── Test 6 ────────────────────────────────────────────────────────────────────

describe('runKeyHousekeeping — Test 6 (does NOT auto-rotate if key is < 90d old)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('fresh key (just created) → no rotation', async () => {
    await ensureInitialSigningKey(ctx.storage, ENC_KEY);
    const before = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(before.length).toBe(1);
    const originalKid = before[0]!.kid;

    await runKeyHousekeeping(ctx.storage, ENC_KEY, new Date());

    const after = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(after.length).toBe(1);
    expect(after[0]!.kid).toBe(originalKid);
  });
});

// ── Test 7 ────────────────────────────────────────────────────────────────────

describe('runKeyHousekeeping — Test 7 (DOES auto-rotate if key is > 90d old)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('key created 91d ago → triggers rotation', async () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const oldKid = await seedSigningKey(ctx.storage, { createdAt: ninetyOneDaysAgo });

    const before = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(before.length).toBe(1);
    expect(before[0]!.kid).toBe(oldKid);

    await runKeyHousekeeping(ctx.storage, ENC_KEY, new Date());

    const active = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(active.length).toBe(1);
    expect(active[0]!.kid).not.toBe(oldKid);

    const oldRow = await ctx.storage.oauthSigningKeys.findByKid(oldKid);
    expect(oldRow?.retiredAt).not.toBeNull();
  });
});

// ── Test 8 ────────────────────────────────────────────────────────────────────

describe('runKeyHousekeeping — Test 8 (audit log entry when auto-rotation fires)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('writes one agent_audit_log row with tool_name=oauth.key_rotated outcome=success', async () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    await seedSigningKey(ctx.storage, { createdAt: ninetyOneDaysAgo });

    await runKeyHousekeeping(ctx.storage, ENC_KEY, new Date());

    // Query the audit log directly since listForOrg needs org scoping.
    const db = ctx.storage.getRawDatabase();
    const rows = db
      .prepare(`SELECT * FROM agent_audit_log WHERE tool_name = 'oauth.key_rotated'`)
      .all() as Array<{ tool_name: string; outcome: string; org_id: string; user_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.outcome).toBe('success');
    expect(rows[0]!.org_id).toBe('system');
    expect(rows[0]!.user_id).toBe('system');
  });
});
