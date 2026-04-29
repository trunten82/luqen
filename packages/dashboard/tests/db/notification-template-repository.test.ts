import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  seedSystemNotificationTemplates,
  SYSTEM_TEMPLATE_COUNT,
} from '../../src/notifications/seed-templates.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `nt-test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('NotificationTemplateRepository', () => {
  describe('create / getById', () => {
    it('round-trips a system template with version=1', async () => {
      const created = await storage.notificationTemplates.create({
        eventType: 'scan.complete',
        channel: 'email',
        scope: 'system',
        orgId: null,
        subjectTemplate: 'sub',
        bodyTemplate: 'body',
      });
      expect(created.id).toBeTruthy();
      expect(created.version).toBe(1);
      expect(created.scope).toBe('system');
      expect(created.orgId).toBeNull();
      expect(created.llmEnabled).toBe(false);

      const fetched = await storage.notificationTemplates.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.subjectTemplate).toBe('sub');
      expect(fetched?.bodyTemplate).toBe('body');
    });

    it('rejects org-scoped template without orgId', async () => {
      await expect(
        storage.notificationTemplates.create({
          eventType: 'scan.complete',
          channel: 'email',
          scope: 'org',
          orgId: null,
          subjectTemplate: 's',
          bodyTemplate: 'b',
        }),
      ).rejects.toThrow(/orgId/);
    });
  });

  describe('list', () => {
    it('filters by scope, channel, and eventType', async () => {
      await seedSystemNotificationTemplates(storage.notificationTemplates);
      const all = await storage.notificationTemplates.list();
      expect(all.length).toBe(SYSTEM_TEMPLATE_COUNT);

      const emailOnly = await storage.notificationTemplates.list({ channel: 'email' });
      expect(emailOnly.length).toBe(4);

      const completeEmail = await storage.notificationTemplates.list({
        eventType: 'scan.complete',
        channel: 'email',
      });
      expect(completeEmail.length).toBe(1);
      expect(completeEmail[0].subjectTemplate).toContain('{{siteUrl}}');
    });
  });

  describe('resolve', () => {
    it('returns null when neither org nor system row exists', async () => {
      const t = await storage.notificationTemplates.resolve(
        'scan.complete',
        'email',
        'org-1',
      );
      expect(t).toBeNull();
    });

    it('falls back to system template when org row missing', async () => {
      await seedSystemNotificationTemplates(storage.notificationTemplates);
      const t = await storage.notificationTemplates.resolve(
        'scan.complete',
        'slack',
        'org-1',
      );
      expect(t).not.toBeNull();
      expect(t?.scope).toBe('system');
      expect(t?.orgId).toBeNull();
    });

    it('org template wins over system template', async () => {
      await seedSystemNotificationTemplates(storage.notificationTemplates);
      const orgT = await storage.notificationTemplates.create({
        eventType: 'scan.complete',
        channel: 'slack',
        scope: 'org',
        orgId: 'org-1',
        subjectTemplate: 'org-sub',
        bodyTemplate: 'org-body',
      });

      const resolved = await storage.notificationTemplates.resolve(
        'scan.complete',
        'slack',
        'org-1',
      );
      expect(resolved?.id).toBe(orgT.id);
      expect(resolved?.scope).toBe('org');
      expect(resolved?.orgId).toBe('org-1');

      // Other orgs still get the system template
      const otherOrg = await storage.notificationTemplates.resolve(
        'scan.complete',
        'slack',
        'org-2',
      );
      expect(otherOrg?.scope).toBe('system');
    });
  });

  describe('update', () => {
    it('bumps version and writes a history row of the prior state', async () => {
      const created = await storage.notificationTemplates.create({
        eventType: 'scan.complete',
        channel: 'email',
        scope: 'system',
        orgId: null,
        subjectTemplate: 'v1-sub',
        bodyTemplate: 'v1-body',
      });

      const updated = await storage.notificationTemplates.update(
        created.id,
        { subjectTemplate: 'v2-sub', bodyTemplate: 'v2-body' },
        'alice',
      );
      expect(updated.version).toBe(2);
      expect(updated.subjectTemplate).toBe('v2-sub');
      expect(updated.updatedBy).toBe('alice');

      const history = await storage.notificationTemplates.listHistory(created.id);
      expect(history.length).toBe(1);
      expect(history[0].version).toBe(1);
      expect(history[0].subjectTemplate).toBe('v1-sub');
      expect(history[0].bodyTemplate).toBe('v1-body');
    });

    it('throws when updating a missing id', async () => {
      await expect(
        storage.notificationTemplates.update(
          'no-such-id',
          { bodyTemplate: 'x' },
          'alice',
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('delete', () => {
    it('deletes an org-scoped template + its history', async () => {
      const t = await storage.notificationTemplates.create({
        eventType: 'scan.complete',
        channel: 'email',
        scope: 'org',
        orgId: 'org-1',
        subjectTemplate: 's',
        bodyTemplate: 'b',
      });
      await storage.notificationTemplates.update(
        t.id,
        { bodyTemplate: 'b2' },
        'alice',
      );
      await storage.notificationTemplates.delete(t.id);
      const fetched = await storage.notificationTemplates.getById(t.id);
      expect(fetched).toBeNull();
      const history = await storage.notificationTemplates.listHistory(t.id);
      expect(history.length).toBe(0);
    });

    it('refuses to delete a system template', async () => {
      const t = await storage.notificationTemplates.create({
        eventType: 'scan.complete',
        channel: 'email',
        scope: 'system',
        orgId: null,
        subjectTemplate: 's',
        bodyTemplate: 'b',
      });
      await expect(
        storage.notificationTemplates.delete(t.id),
      ).rejects.toThrow(/system templates/);
    });
  });

  describe('seedSystemNotificationTemplates', () => {
    it('inserts 12 templates on first call, 0 on second (idempotent)', async () => {
      const first = await seedSystemNotificationTemplates(
        storage.notificationTemplates,
      );
      expect(first).toBe(SYSTEM_TEMPLATE_COUNT);
      expect(SYSTEM_TEMPLATE_COUNT).toBe(12);

      const second = await seedSystemNotificationTemplates(
        storage.notificationTemplates,
      );
      expect(second).toBe(0);

      const all = await storage.notificationTemplates.list({ scope: 'system' });
      expect(all.length).toBe(12);
    });
  });
});
