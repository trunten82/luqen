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

function makeScheduleInput(overrides: Partial<Parameters<typeof storage.schedules.createSchedule>[0]> = {}) {
  return {
    id: randomUUID(),
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    scanMode: 'full',
    jurisdictions: ['EU'],
    frequency: 'weekly',
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    createdBy: 'alice',
    orgId: 'org-1',
    ...overrides,
  };
}

describe('ScheduleRepository', () => {
  describe('createSchedule', () => {
    it('creates with all fields', async () => {
      const input = makeScheduleInput({ id: randomUUID() });
      const schedule = await storage.schedules.createSchedule(input);

      expect(schedule.id).toBe(input.id);
      expect(schedule.siteUrl).toBe(input.siteUrl);
      expect(schedule.standard).toBe(input.standard);
      expect(schedule.scanMode).toBe(input.scanMode);
      expect(schedule.frequency).toBe(input.frequency);
      expect(schedule.nextRunAt).toBe(input.nextRunAt);
      expect(schedule.createdBy).toBe(input.createdBy);
      expect(schedule.orgId).toBe(input.orgId);
      expect(schedule.enabled).toBe(true);
      expect(schedule.lastRunAt).toBeNull();
    });

    it('stores jurisdictions as JSON array', async () => {
      const input = makeScheduleInput({ jurisdictions: ['EU', 'US', 'UK'] });
      const schedule = await storage.schedules.createSchedule(input);
      expect(schedule.jurisdictions).toEqual(['EU', 'US', 'UK']);
    });

    it('defaults runner to htmlcs when not provided', async () => {
      const input = makeScheduleInput();
      const schedule = await storage.schedules.createSchedule(input);
      expect(schedule.runner).toBe('htmlcs');
    });

    it('defaults incremental to false when not provided', async () => {
      const input = makeScheduleInput();
      const schedule = await storage.schedules.createSchedule(input);
      expect(schedule.incremental).toBe(false);
    });

    it('stores custom runner and incremental=true', async () => {
      const input = makeScheduleInput({ runner: 'axe', incremental: true });
      const schedule = await storage.schedules.createSchedule(input);
      expect(schedule.runner).toBe('axe');
      expect(schedule.incremental).toBe(true);
    });
  });

  describe('getSchedule', () => {
    it('returns schedule by ID', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      const result = await storage.schedules.getSchedule(input.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(input.id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.schedules.getSchedule('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listSchedules', () => {
    it('returns empty array when no schedules', async () => {
      const result = await storage.schedules.listSchedules();
      expect(result).toEqual([]);
    });

    it('orders by nextRunAt ASC', async () => {
      const now = Date.now();
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();

      await storage.schedules.createSchedule(makeScheduleInput({ id: id3, nextRunAt: new Date(now + 3000).toISOString() }));
      await storage.schedules.createSchedule(makeScheduleInput({ id: id1, nextRunAt: new Date(now + 1000).toISOString() }));
      await storage.schedules.createSchedule(makeScheduleInput({ id: id2, nextRunAt: new Date(now + 2000).toISOString() }));

      const result = await storage.schedules.listSchedules();
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(id1);
      expect(result[1].id).toBe(id2);
      expect(result[2].id).toBe(id3);
    });

    it('filters by orgId', async () => {
      await storage.schedules.createSchedule(makeScheduleInput({ id: randomUUID(), orgId: 'org-A' }));
      await storage.schedules.createSchedule(makeScheduleInput({ id: randomUUID(), orgId: 'org-B' }));

      const result = await storage.schedules.listSchedules('org-A');
      expect(result).toHaveLength(1);
      expect(result[0].orgId).toBe('org-A');
    });

    it('returns empty when none match orgId', async () => {
      await storage.schedules.createSchedule(makeScheduleInput({ orgId: 'org-X' }));
      const result = await storage.schedules.listSchedules('org-NONE');
      expect(result).toEqual([]);
    });
  });

  describe('updateSchedule', () => {
    it('toggles enabled to false', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      await storage.schedules.updateSchedule(input.id, { enabled: false });
      const updated = await storage.schedules.getSchedule(input.id);
      expect(updated?.enabled).toBe(false);
    });

    it('toggles enabled back to true', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      await storage.schedules.updateSchedule(input.id, { enabled: false });
      await storage.schedules.updateSchedule(input.id, { enabled: true });
      const updated = await storage.schedules.getSchedule(input.id);
      expect(updated?.enabled).toBe(true);
    });

    it('updates nextRunAt', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      const newNextRunAt = new Date(Date.now() + 3_600_000).toISOString();
      await storage.schedules.updateSchedule(input.id, { nextRunAt: newNextRunAt });
      const updated = await storage.schedules.getSchedule(input.id);
      expect(updated?.nextRunAt).toBe(newNextRunAt);
    });

    it('updates lastRunAt', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      const lastRunAt = new Date().toISOString();
      await storage.schedules.updateSchedule(input.id, { lastRunAt });
      const updated = await storage.schedules.getSchedule(input.id);
      expect(updated?.lastRunAt).toBe(lastRunAt);
    });

    it('no-op when empty update object', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      await expect(storage.schedules.updateSchedule(input.id, {})).resolves.not.toThrow();
      const unchanged = await storage.schedules.getSchedule(input.id);
      expect(unchanged?.nextRunAt).toBe(input.nextRunAt);
    });
  });

  describe('deleteSchedule', () => {
    it('removes the schedule', async () => {
      const input = makeScheduleInput();
      await storage.schedules.createSchedule(input);
      await storage.schedules.deleteSchedule(input.id);
      expect(await storage.schedules.getSchedule(input.id)).toBeNull();
    });

    it('no error for non-existent ID', async () => {
      await expect(storage.schedules.deleteSchedule('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getDueSchedules', () => {
    it('returns schedules where nextRunAt <= now AND enabled', async () => {
      const pastId = randomUUID();
      const input = makeScheduleInput({
        id: pastId,
        nextRunAt: new Date(Date.now() - 10_000).toISOString(),
      });
      await storage.schedules.createSchedule(input);

      const due = await storage.schedules.getDueSchedules();
      expect(due.some((s) => s.id === pastId)).toBe(true);
    });

    it('excludes disabled schedules', async () => {
      const id = randomUUID();
      await storage.schedules.createSchedule(makeScheduleInput({
        id,
        nextRunAt: new Date(Date.now() - 10_000).toISOString(),
      }));
      await storage.schedules.updateSchedule(id, { enabled: false });

      const due = await storage.schedules.getDueSchedules();
      expect(due.some((s) => s.id === id)).toBe(false);
    });

    it('excludes future schedules', async () => {
      const id = randomUUID();
      await storage.schedules.createSchedule(makeScheduleInput({
        id,
        nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
      }));

      const due = await storage.schedules.getDueSchedules();
      expect(due.some((s) => s.id === id)).toBe(false);
    });
  });
});
