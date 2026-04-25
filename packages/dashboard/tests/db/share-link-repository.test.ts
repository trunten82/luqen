/**
 * Phase 37 Plan 01 — ShareLinkRepository (AUX-05).
 *
 * Persistence primitive for org-scoped read-only conversation permalinks.
 * Tokens are unguessable base64url strings (≥128 bits of entropy from
 * crypto.randomBytes(16)). The repo intentionally does NOT enforce org
 * membership on getShareLink — that gate lives in the route handler
 * (T-37-02 disposition: route enforces auth, repo hides revoked rows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let userId: string;
let convA: string;
let convB: string;
const orgA = 'org-a';
const orgB = 'org-b';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser(
    `u-${randomUUID()}`,
    'pass123',
    'user',
  );
  userId = user.id;

  const a = await storage.conversations.createConversation({
    userId,
    orgId: orgA,
    title: 'a',
  });
  convA = a.id;
  const b = await storage.conversations.createConversation({
    userId,
    orgId: orgB,
    title: 'b',
  });
  convB = b.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// createShareLink
// ---------------------------------------------------------------------------

describe('createShareLink', () => {
  it('returns a ShareLink with a 22-char base64url id and persists it', async () => {
    const link = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });

    expect(link.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(link.conversationId).toBe(convA);
    expect(link.orgId).toBe(orgA);
    expect(link.anchorMessageId).toBeNull();
    expect(link.createdByUserId).toBe(userId);
    expect(typeof link.createdAt).toBe('string');
    expect(link.revokedAt).toBeNull();

    const fetched = await storage.shareLinks.getShareLink(link.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(link.id);
  });

  it('generates 100 unique ids (≥128 bits of entropy proxy)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const link = await storage.shareLinks.createShareLink({
        conversationId: convA,
        orgId: orgA,
        anchorMessageId: null,
        createdByUserId: userId,
      });
      ids.add(link.id);
    }
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getShareLink
// ---------------------------------------------------------------------------

describe('getShareLink', () => {
  it('returns the row when present and not revoked', async () => {
    const link = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });
    const got = await storage.shareLinks.getShareLink(link.id);
    expect(got).not.toBeNull();
    expect(got!.conversationId).toBe(convA);
  });

  it('returns null for a missing id', async () => {
    const got = await storage.shareLinks.getShareLink('does-not-exist');
    expect(got).toBeNull();
  });

  it('returns null once the link has been revoked', async () => {
    const link = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });
    const ok = await storage.shareLinks.revokeShareLink(link.id, orgA);
    expect(ok).toBe(true);

    const got = await storage.shareLinks.getShareLink(link.id);
    expect(got).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listForConversation
// ---------------------------------------------------------------------------

describe('listForConversation', () => {
  it('is org-scoped — does not return links from a foreign-org conversation', async () => {
    await storage.shareLinks.createShareLink({
      conversationId: convB,
      orgId: orgB,
      anchorMessageId: null,
      createdByUserId: userId,
    });

    // Wrong org for convB → must return empty.
    const list = await storage.shareLinks.listForConversation(convB, orgA);
    expect(list).toEqual([]);
  });

  it('excludes revoked links', async () => {
    const live = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });
    const dead = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });
    await storage.shareLinks.revokeShareLink(dead.id, orgA);

    const list = await storage.shareLinks.listForConversation(convA, orgA);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(live.id);
  });
});

// ---------------------------------------------------------------------------
// revokeShareLink
// ---------------------------------------------------------------------------

describe('revokeShareLink', () => {
  it('first call returns true, second call returns false (idempotent)', async () => {
    const link = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });

    const first = await storage.shareLinks.revokeShareLink(link.id, orgA);
    expect(first).toBe(true);
    const second = await storage.shareLinks.revokeShareLink(link.id, orgA);
    expect(second).toBe(false);
  });

  it('refuses to revoke when org does not match', async () => {
    const link = await storage.shareLinks.createShareLink({
      conversationId: convA,
      orgId: orgA,
      anchorMessageId: null,
      createdByUserId: userId,
    });

    const ok = await storage.shareLinks.revokeShareLink(link.id, orgB);
    expect(ok).toBe(false);

    // Still resolvable (not revoked).
    const got = await storage.shareLinks.getShareLink(link.id);
    expect(got).not.toBeNull();
  });
});
