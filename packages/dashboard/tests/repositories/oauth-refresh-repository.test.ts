/**
 * Phase 31.1 Plan 01 Task 2 — OauthRefreshRepository contract tests.
 *
 * Covers D-29 rotation + reuse detection (T-31.1-01-04):
 *   - mint() creates chain root (chainId === self.id, rotated=false)
 *   - rotate() flips parent.rotated=1 and chains child with parent_id + same chainId
 *   - reuse: rotate(already-rotated-token) revokes the chain (kind=reuse_detected)
 *   - expiry: rotate(expired-token) revokes chain (kind=expired)
 *   - cleanupExpired() returns deleted count
 *   - findByTokenHash round-trip
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let clientId: string;
let userId: string;
const orgA = 'org-a';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const reg = await storage.oauthClients.register({
    clientName: 'Test',
    redirectUris: ['https://x/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
  });
  clientId = reg.clientId;
  const user = await storage.users.createUser(
    `u-${randomUUID()}`,
    'pass123',
    'user',
  );
  userId = user.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOauthRefreshRepository — mint', () => {
  it('creates a chain root: chainId === id, parentId === null, rotated === false', async () => {
    const raw = `rt_${randomUUID()}`;
    const absoluteExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const minted = await storage.oauthRefresh.mint({
      tokenHash: hashToken(raw),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read write',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt,
    });

    expect(minted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted.chainId).toBe(minted.id);
    expect(minted.parentId).toBeNull();
    expect(minted.rotated).toBe(false);
    expect(minted.absoluteExpiresAt).toBe(absoluteExpiresAt);
    expect(minted.tokenHash).toBe(hashToken(raw));
  });
});

describe('SqliteOauthRefreshRepository — rotate (success)', () => {
  it('flips parent rotated=1 and inserts child with same chainId + absoluteExpiresAt', async () => {
    const absoluteExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rawA = 'raw-A';
    const parent = await storage.oauthRefresh.mint({
      tokenHash: hashToken(rawA),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt,
    });

    const rawB = 'raw-B';
    const result = await storage.oauthRefresh.rotate(
      hashToken(rawA),
      hashToken(rawB),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('unreachable');

    // Parent is now rotated.
    expect(result.parent.id).toBe(parent.id);
    expect(result.parent.rotated).toBe(true);

    // Child inherits chain + absolute TTL, points back at parent.
    expect(result.child.parentId).toBe(parent.id);
    expect(result.child.chainId).toBe(parent.chainId);
    expect(result.child.absoluteExpiresAt).toBe(absoluteExpiresAt);
    expect(result.child.rotated).toBe(false);
    expect(result.child.tokenHash).toBe(hashToken(rawB));
    expect(result.child.scope).toBe('read');
    expect(result.child.resource).toBe('https://x/mcp');
  });
});

describe('SqliteOauthRefreshRepository — rotate (reuse detection)', () => {
  it('rotating a token whose rotated=1 revokes the entire chain', async () => {
    const absoluteExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rawA = 'raw-A';
    const rawB = 'raw-B';
    const rawC = 'raw-C';

    const root = await storage.oauthRefresh.mint({
      tokenHash: hashToken(rawA),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt,
    });

    // Legit rotation A → B
    const ok = await storage.oauthRefresh.rotate(
      hashToken(rawA),
      hashToken(rawB),
    );
    expect(ok.kind).toBe('success');

    // Attacker replays the old rawA (now rotated=1).
    const reuse = await storage.oauthRefresh.rotate(
      hashToken(rawA),
      hashToken(rawC),
    );
    expect(reuse.kind).toBe('reuse_detected');
    if (reuse.kind !== 'reuse_detected') throw new Error('unreachable');
    expect(reuse.revokedChainId).toBe(root.chainId);

    // Chain is gone — even the still-valid child B is revoked.
    const lookupB = await storage.oauthRefresh.findByTokenHash(hashToken(rawB));
    expect(lookupB).toBeNull();
    const lookupA = await storage.oauthRefresh.findByTokenHash(hashToken(rawA));
    expect(lookupA).toBeNull();
  });
});

describe('SqliteOauthRefreshRepository — rotate (expired)', () => {
  it('rotating a token with absolute_expires_at < now returns expired and deletes the chain', async () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const raw = 'raw-expired';

    await storage.oauthRefresh.mint({
      tokenHash: hashToken(raw),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt: past,
    });

    const result = await storage.oauthRefresh.rotate(
      hashToken(raw),
      hashToken('new-raw'),
    );
    expect(result.kind).toBe('expired');

    const lookup = await storage.oauthRefresh.findByTokenHash(hashToken(raw));
    expect(lookup).toBeNull();
  });
});

describe('SqliteOauthRefreshRepository — cleanupExpired', () => {
  it('bulk-deletes all expired chains and returns the count', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await storage.oauthRefresh.mint({
      tokenHash: hashToken('e1'),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt: past,
    });
    await storage.oauthRefresh.mint({
      tokenHash: hashToken('e2'),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt: past,
    });
    await storage.oauthRefresh.mint({
      tokenHash: hashToken('live'),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt: future,
    });

    const deleted = await storage.oauthRefresh.cleanupExpired();
    expect(deleted).toBe(2);

    // Live token still present.
    const live = await storage.oauthRefresh.findByTokenHash(hashToken('live'));
    expect(live).not.toBeNull();
  });
});

describe('SqliteOauthRefreshRepository — findByTokenHash', () => {
  it('returns the row for a known hash, null for unknown', async () => {
    const raw = 'raw-known';
    const absoluteExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await storage.oauthRefresh.mint({
      tokenHash: hashToken(raw),
      clientId,
      userId,
      orgId: orgA,
      scope: 'read',
      resource: 'https://x/mcp',
      parentId: null,
      absoluteExpiresAt,
    });

    const found = await storage.oauthRefresh.findByTokenHash(hashToken(raw));
    expect(found).not.toBeNull();
    expect(found!.tokenHash).toBe(hashToken(raw));

    const missing = await storage.oauthRefresh.findByTokenHash(
      hashToken('nope'),
    );
    expect(missing).toBeNull();
  });
});
