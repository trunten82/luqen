/**
 * Phase 71 — Notification unsubscribe repository.
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
  dbPath = join(tmpdir(), `test-unsub-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteNotificationUnsubscribeRepository', () => {
  it('isUnsubscribed is false for an unknown recipient', async () => {
    const out = await storage.notificationUnsubscribes.isUnsubscribed(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(out).toBe(false);
  });

  it('unsubscribe + isUnsubscribed round-trips', async () => {
    await storage.notificationUnsubscribes.unsubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    const out = await storage.notificationUnsubscribes.isUnsubscribed(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(out).toBe(true);
  });

  it('normalises recipient case + whitespace', async () => {
    await storage.notificationUnsubscribes.unsubscribe(
      '  ALICE@example.COM ',
      'email-reports',
      'org-1',
    );
    const out = await storage.notificationUnsubscribes.isUnsubscribed(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(out).toBe(true);
  });

  it('scope is per-channel and per-org', async () => {
    await storage.notificationUnsubscribes.unsubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        'email-reports',
        'org-2',
      ),
    ).toBe(false);
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        'other-channel',
        'org-1',
      ),
    ).toBe(false);
  });

  it('resubscribe restores delivery', async () => {
    await storage.notificationUnsubscribes.unsubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    const changed = await storage.notificationUnsubscribes.resubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(changed).toBe(true);
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        'email-reports',
        'org-1',
      ),
    ).toBe(false);
  });

  it('re-unsubscribe after resubscribe works (clears resubscribed_at)', async () => {
    await storage.notificationUnsubscribes.unsubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    await storage.notificationUnsubscribes.resubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    await storage.notificationUnsubscribes.unsubscribe(
      'alice@example.com',
      'email-reports',
      'org-1',
    );
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        'email-reports',
        'org-1',
      ),
    ).toBe(true);
  });

  it('listForOrg returns unsubscribed rows for an org', async () => {
    await storage.notificationUnsubscribes.unsubscribe('a@x.com', 'email-reports', 'org-1');
    await storage.notificationUnsubscribes.unsubscribe('b@x.com', 'email-reports', 'org-1');
    await storage.notificationUnsubscribes.unsubscribe('c@x.com', 'email-reports', 'org-2');
    const rows = await storage.notificationUnsubscribes.listForOrg('org-1');
    expect(rows.map((r) => r.recipientAddress).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
});
