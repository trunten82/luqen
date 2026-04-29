import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  seedSystemNotificationTemplates,
  seedSystemNotificationTemplatesDetailed,
  SYSTEM_TEMPLATE_COUNT,
  _phase47BodyFor,
  _phase49BodyFor,
} from '../../src/notifications/seed-templates.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import type { NotificationChannel, NotificationEventType } from '../../src/db/types.js';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `seed-test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

const EVENTS: readonly NotificationEventType[] = [
  'scan.complete',
  'scan.failed',
  'violation.found',
  'regulation.changed',
];
const CHANNELS: readonly NotificationChannel[] = ['email', 'slack', 'teams'];

describe('seedSystemNotificationTemplates', () => {
  it('exposes 12 template definitions (4 events × 3 channels)', () => {
    expect(SYSTEM_TEMPLATE_COUNT).toBe(12);
  });

  it('inserts all 12 system rows on first run', async () => {
    const inserted = await seedSystemNotificationTemplates(
      storage.notificationTemplates,
    );
    expect(inserted).toBe(12);
    const all = await storage.notificationTemplates.list({ scope: 'system' });
    expect(all).toHaveLength(12);
  });

  it('is idempotent — second run inserts nothing', async () => {
    await seedSystemNotificationTemplates(storage.notificationTemplates);
    const r2 = await seedSystemNotificationTemplatesDetailed(
      storage.notificationTemplates,
    );
    expect(r2.inserted).toBe(0);
    expect(r2.upgraded).toBe(0);
    expect(r2.preserved).toBe(12);
  });

  it.each(
    EVENTS.flatMap((e) => CHANNELS.map((c) => [e, c] as const)),
  )('seeds %s/%s with channel-appropriate body', async (event, channel) => {
    await seedSystemNotificationTemplates(storage.notificationTemplates);
    const rows = await storage.notificationTemplates.list({
      scope: 'system',
      eventType: event,
      channel,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    if (channel === 'email') {
      expect(row.bodyTemplate).toMatch(/<[a-z][^>]*>/i);
    } else if (channel === 'slack') {
      // Markdown — bold, links, or emoji code.
      expect(row.bodyTemplate).toMatch(/[*:`<]/);
    } else {
      // Teams: parseable JSON with a `text` field.
      const json = JSON.parse(row.bodyTemplate) as { text?: unknown };
      expect(typeof json.text).toBe('string');
    }
  });

  it('upgrades a Phase 47 placeholder body to the Phase 49 body', async () => {
    // Pretend a Phase 47 row was already seeded: insert directly.
    const phase47 = _phase47BodyFor('scan.complete::email');
    expect(phase47).toBeDefined();
    const original = await storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'system',
      orgId: null,
      subjectTemplate: 'Scan complete: {{siteUrl}}',
      bodyTemplate: phase47 as string,
    });
    expect(original.version).toBe(1);

    const result = await seedSystemNotificationTemplatesDetailed(
      storage.notificationTemplates,
    );
    expect(result.upgraded).toBeGreaterThanOrEqual(1);

    const upgraded = await storage.notificationTemplates.getById(original.id);
    expect(upgraded?.bodyTemplate).toBe(_phase49BodyFor('scan.complete', 'email'));
    expect(upgraded?.version).toBeGreaterThan(1);

    // History row recorded for the original v1.
    const history = await storage.notificationTemplates.listHistory(original.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1].bodyTemplate).toBe(phase47);
  });

  it('preserves admin-edited rows on re-seed (no overwrite)', async () => {
    // Insert an admin-edited row that does NOT match Phase 47 or Phase 49.
    const created = await storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'system',
      orgId: null,
      subjectTemplate: 'Custom subject',
      bodyTemplate: 'Hand-written admin body — keep me!',
    });

    const result = await seedSystemNotificationTemplatesDetailed(
      storage.notificationTemplates,
    );
    expect(result.preserved).toBeGreaterThanOrEqual(1);

    const after = await storage.notificationTemplates.getById(created.id);
    expect(after?.bodyTemplate).toBe('Hand-written admin body — keep me!');
    expect(after?.version).toBe(1);
  });
});
