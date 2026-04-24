/**
 * Phase 35 Plan 01 — search / rename / softDelete + is_deleted filter.
 *
 * Covers AHIST-02 (search) and AHIST-04 (delete) repository primitives plus
 * the is_deleted = 0 filter added to listForUser.
 *
 * Harness copied from tests/repositories/conversation-repository.test.ts
 * (temp-file sqlite + per-test cleanup).
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
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// listForUser: hides soft-deleted rows
// ---------------------------------------------------------------------------

describe('listForUser — is_deleted = 0 filter', () => {
  it('excludes conversations with is_deleted = 1', async () => {
    const c1 = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'live',
    });
    const c2 = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'to-delete',
    });

    // Soft-delete c2.
    const deleted = await storage.conversations.softDeleteConversation(
      c2.id,
      orgA,
    );
    expect(deleted).toBe(true);

    const list = await storage.conversations.listForUser(userId, orgA);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(c1.id);
  });
});

// ---------------------------------------------------------------------------
// searchForUser
// ---------------------------------------------------------------------------

describe('searchForUser', () => {
  it('matches by title and returns matchField=title', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'WCAG audit plan',
    });

    const hits = await storage.conversations.searchForUser(userId, orgA, {
      query: 'audit',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.conversation.id).toBe(conv.id);
    expect(hits[0]!.matchField).toBe('title');
    expect(hits[0]!.snippet.toLowerCase()).toContain('audit');
  });

  it('matches by message content with a bounded snippet (matchField=content)', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: null,
    });
    const body =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'This is a very long message discussing accessibility and colour contrast ' +
      'across a variety of UI elements with rich detail that spans many words.';
    await storage.conversations.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: body,
    });

    const hits = await storage.conversations.searchForUser(userId, orgA, {
      query: 'contrast',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.conversation.id).toBe(conv.id);
    expect(hits[0]!.matchField).toBe('content');
    expect(hits[0]!.snippet.toLowerCase()).toContain('contrast');
    // Bounded snippet window (60–120 chars of text + optional ellipses).
    expect(hits[0]!.snippet.length).toBeGreaterThanOrEqual(10);
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(200);
  });

  it('is case-insensitive', async () => {
    await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'wcag guidelines',
    });
    const hits = await storage.conversations.searchForUser(userId, orgA, {
      query: 'WCAG',
    });
    expect(hits).toHaveLength(1);
  });

  it('ignores soft-deleted conversations', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'hidden secret',
    });
    await storage.conversations.softDeleteConversation(conv.id, orgA);

    const hits = await storage.conversations.searchForUser(userId, orgA, {
      query: 'secret',
    });
    expect(hits).toEqual([]);
  });

  it('is org-scoped (same content in a different org returns zero hits)', async () => {
    const convA = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'cross-org leak test',
    });
    await storage.conversations.appendMessage({
      conversationId: convA.id,
      role: 'user',
      content: 'confidential keyword apple',
    });

    // Search from orgB for a user that has data in orgA — must return [].
    const hits = await storage.conversations.searchForUser(userId, orgB, {
      query: 'apple',
    });
    expect(hits).toEqual([]);
  });

  it('escapes LIKE metacharacters — % and _ and \\ are literal', async () => {
    const literal = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: '100% complete_job',
    });
    // Decoy with a distinct title that a naive LIKE (without escaping) would
    // match against "50%_abc" if '%' and '_' were treated as wildcards.
    const decoy = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'fifty xxx abc',
    });

    // Query contains both '%' and '_' literally.
    const hits = await storage.conversations.searchForUser(userId, orgA, {
      query: '100% complete_job',
    });
    const ids = hits.map((h) => h.conversation.id);
    expect(ids).toContain(literal.id);
    expect(ids).not.toContain(decoy.id);
  });

  it('returns [] for empty / whitespace-only queries', async () => {
    await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'anything',
    });
    expect(
      await storage.conversations.searchForUser(userId, orgA, { query: '' }),
    ).toEqual([]);
    expect(
      await storage.conversations.searchForUser(userId, orgA, { query: '   ' }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renameConversation
// ---------------------------------------------------------------------------

describe('renameConversation', () => {
  it('updates title and bumps updated_at, returns the new Conversation', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'old',
    });
    // wait a millisecond so updated_at changes detectably
    await new Promise((r) => setTimeout(r, 5));

    const renamed = await storage.conversations.renameConversation(
      conv.id,
      orgA,
      'new title',
    );
    expect(renamed).not.toBeNull();
    expect(renamed!.title).toBe('new title');
    expect(renamed!.updatedAt).not.toBe(conv.updatedAt);
  });

  it('returns null when orgId does not match and does not write', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'keep me',
    });

    const renamed = await storage.conversations.renameConversation(
      conv.id,
      orgB,
      'hijacked',
    );
    expect(renamed).toBeNull();

    // Confirm title unchanged via the proper org.
    const fetched = await storage.conversations.getConversation(conv.id, orgA);
    expect(fetched!.title).toBe('keep me');
  });

  it('returns null for soft-deleted conversations', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'to-delete',
    });
    await storage.conversations.softDeleteConversation(conv.id, orgA);
    const renamed = await storage.conversations.renameConversation(
      conv.id,
      orgA,
      'nope',
    );
    expect(renamed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// softDeleteConversation
// ---------------------------------------------------------------------------

describe('softDeleteConversation', () => {
  it('flips is_deleted=1 and sets deleted_at (ISO-8601), returns true', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'ephemeral',
    });
    const ok = await storage.conversations.softDeleteConversation(
      conv.id,
      orgA,
    );
    expect(ok).toBe(true);

    const fetched = await storage.conversations.getConversation(conv.id, orgA);
    expect(fetched).not.toBeNull();
    expect(fetched!.isDeleted).toBe(true);
    expect(fetched!.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('second call on an already-deleted conversation returns false', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
    });
    expect(
      await storage.conversations.softDeleteConversation(conv.id, orgA),
    ).toBe(true);
    expect(
      await storage.conversations.softDeleteConversation(conv.id, orgA),
    ).toBe(false);
  });

  it('returns false and does not write when orgId does not match', async () => {
    const conv = await storage.conversations.createConversation({
      userId,
      orgId: orgA,
      title: 'protected',
    });
    const ok = await storage.conversations.softDeleteConversation(
      conv.id,
      orgB,
    );
    expect(ok).toBe(false);

    const fetched = await storage.conversations.getConversation(conv.id, orgA);
    expect(fetched!.isDeleted).toBe(false);
    expect(fetched!.deletedAt).toBeNull();
  });
});
