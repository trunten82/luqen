import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-digest-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDigestScheduleInput(overrides: Partial<{
  id: string;
  orgId: string;
  name: string;
  siteUrl: string | null;
  frequency: string;
  recipients: string;
  channels: string;
  nextSendAt: string;
  createdBy: string;
}> = {}) {
  return {
    id: randomUUID(),
    orgId: 'org-1',
    name: 'Weekly Digest',
    siteUrl: null,
    frequency: 'weekly',
    recipients: 'exec@example.com',
    channels: JSON.stringify(['email']),
    nextSendAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'user-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DigestRepository tests
// ---------------------------------------------------------------------------

describe('DigestRepository - createDigestSchedule', () => {
  it('creates a schedule and returns it with channels parsed as string[]', async () => {
    const input = makeDigestScheduleInput({
      name: 'Board Monthly',
      siteUrl: null,
      frequency: 'monthly',
      recipients: 'board@example.com',
      channels: JSON.stringify(['email', 'slack']),
      createdBy: 'admin-1',
    });

    const schedule = await storage.digest!.createDigestSchedule(input);

    expect(schedule.id).toBe(input.id);
    expect(schedule.orgId).toBe('org-1');
    expect(schedule.name).toBe('Board Monthly');
    expect(schedule.siteUrl).toBeNull();
    expect(schedule.frequency).toBe('monthly');
    expect(schedule.recipients).toBe('board@example.com');
    // channels must be parsed back from JSON
    expect(Array.isArray(schedule.channels)).toBe(true);
    expect(schedule.channels).toEqual(['email', 'slack']);
    expect(schedule.enabled).toBe(true);
    expect(schedule.lastSentAt).toBeNull();
    expect(schedule.createdBy).toBe('admin-1');
    expect(schedule.createdAt).toBeTruthy();
  });

  it('creates a schedule scoped to a specific site', async () => {
    const input = makeDigestScheduleInput({ siteUrl: 'https://site.example.com' });
    const schedule = await storage.digest!.createDigestSchedule(input);
    expect(schedule.siteUrl).toBe('https://site.example.com');
  });
});

describe('DigestRepository - getDigestSchedule', () => {
  it('returns the schedule by id', async () => {
    const input = makeDigestScheduleInput({ name: 'Get Test' });
    await storage.digest!.createDigestSchedule(input);

    const fetched = await storage.digest!.getDigestSchedule(input.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(input.id);
    expect(fetched!.name).toBe('Get Test');
  });

  it('returns null for a non-existent id', async () => {
    const result = await storage.digest!.getDigestSchedule(randomUUID());
    expect(result).toBeNull();
  });
});

describe('DigestRepository - listDigestSchedules', () => {
  it('lists all schedules when no orgId filter is given', async () => {
    await storage.digest!.createDigestSchedule(makeDigestScheduleInput({ orgId: 'org-a', name: 'A' }));
    await storage.digest!.createDigestSchedule(makeDigestScheduleInput({ orgId: 'org-b', name: 'B' }));

    const all = await storage.digest!.listDigestSchedules();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by orgId', async () => {
    await storage.digest!.createDigestSchedule(makeDigestScheduleInput({ orgId: 'org-x', name: 'Org X' }));
    await storage.digest!.createDigestSchedule(makeDigestScheduleInput({ orgId: 'org-y', name: 'Org Y' }));

    const orgX = await storage.digest!.listDigestSchedules('org-x');
    expect(orgX).toHaveLength(1);
    expect(orgX[0]!.orgId).toBe('org-x');

    const orgY = await storage.digest!.listDigestSchedules('org-y');
    expect(orgY).toHaveLength(1);
    expect(orgY[0]!.orgId).toBe('org-y');
  });
});

describe('DigestRepository - getDueDigestSchedules', () => {
  it('returns a past-due enabled schedule', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    const dueInput = makeDigestScheduleInput({ nextSendAt: pastDate, name: 'Due Digest' });
    await storage.digest!.createDigestSchedule(dueInput);

    const due = await storage.digest!.getDueDigestSchedules();
    const dueIds = due.map((s) => s.id);
    expect(dueIds).toContain(dueInput.id);
  });

  it('excludes a future schedule', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    const notDueInput = makeDigestScheduleInput({ nextSendAt: futureDate, name: 'Not Due Digest' });
    await storage.digest!.createDigestSchedule(notDueInput);

    const due = await storage.digest!.getDueDigestSchedules();
    const dueIds = due.map((s) => s.id);
    expect(dueIds).not.toContain(notDueInput.id);
  });

  it('excludes a disabled past-due schedule', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const disabledInput = makeDigestScheduleInput({ nextSendAt: pastDate, name: 'Disabled Digest' });
    await storage.digest!.createDigestSchedule(disabledInput);

    // Disable the schedule
    await storage.digest!.updateDigestSchedule(disabledInput.id, { enabled: false });

    const due = await storage.digest!.getDueDigestSchedules();
    const dueIds = due.map((s) => s.id);
    expect(dueIds).not.toContain(disabledInput.id);
  });

  it('returns only the past-due enabled schedule among mixed inputs', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const dueInput = makeDigestScheduleInput({ nextSendAt: pastDate, name: 'Should Be Due' });
    const notDueInput = makeDigestScheduleInput({ nextSendAt: futureDate, name: 'Not Due' });
    const disabledInput = makeDigestScheduleInput({ nextSendAt: pastDate, name: 'Disabled' });

    await storage.digest!.createDigestSchedule(dueInput);
    await storage.digest!.createDigestSchedule(notDueInput);
    await storage.digest!.createDigestSchedule(disabledInput);
    await storage.digest!.updateDigestSchedule(disabledInput.id, { enabled: false });

    const due = await storage.digest!.getDueDigestSchedules();
    const dueIds = due.map((s) => s.id);
    expect(dueIds).toContain(dueInput.id);
    expect(dueIds).not.toContain(notDueInput.id);
    expect(dueIds).not.toContain(disabledInput.id);
  });
});

describe('DigestRepository - updateDigestSchedule', () => {
  it('toggles enabled to false and back to true', async () => {
    const input = makeDigestScheduleInput({ name: 'Toggle Test' });
    await storage.digest!.createDigestSchedule(input);

    await storage.digest!.updateDigestSchedule(input.id, { enabled: false });
    const disabled = await storage.digest!.getDigestSchedule(input.id);
    expect(disabled!.enabled).toBe(false);

    await storage.digest!.updateDigestSchedule(input.id, { enabled: true });
    const enabled = await storage.digest!.getDigestSchedule(input.id);
    expect(enabled!.enabled).toBe(true);
  });

  it('advances nextSendAt and sets lastSentAt', async () => {
    const input = makeDigestScheduleInput();
    await storage.digest!.createDigestSchedule(input);

    const newNextSendAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const lastSentAt = new Date().toISOString();

    await storage.digest!.updateDigestSchedule(input.id, { nextSendAt: newNextSendAt, lastSentAt });

    const updated = await storage.digest!.getDigestSchedule(input.id);
    expect(updated!.nextSendAt).toBe(newNextSendAt);
    expect(updated!.lastSentAt).toBe(lastSentAt);
  });

  it('updates name, recipients, frequency, and channels', async () => {
    const input = makeDigestScheduleInput({
      name: 'Original Name',
      recipients: 'old@example.com',
      frequency: 'weekly',
      channels: JSON.stringify(['email']),
    });
    await storage.digest!.createDigestSchedule(input);

    await storage.digest!.updateDigestSchedule(input.id, {
      name: 'Updated Name',
      recipients: 'new@example.com',
      frequency: 'monthly',
      channels: JSON.stringify(['email', 'slack']),
    });

    const updated = await storage.digest!.getDigestSchedule(input.id);
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.recipients).toBe('new@example.com');
    expect(updated!.frequency).toBe('monthly');
    expect(updated!.channels).toEqual(['email', 'slack']);
  });

  it('is a no-op when no fields provided', async () => {
    const input = makeDigestScheduleInput({ name: 'No-op Test' });
    await storage.digest!.createDigestSchedule(input);

    // Should not throw
    await expect(storage.digest!.updateDigestSchedule(input.id, {})).resolves.toBeUndefined();

    const unchanged = await storage.digest!.getDigestSchedule(input.id);
    expect(unchanged!.name).toBe('No-op Test');
  });
});

describe('DigestRepository - deleteDigestSchedule', () => {
  it('removes the schedule so getDigestSchedule returns null', async () => {
    const input = makeDigestScheduleInput({ name: 'To Delete' });
    await storage.digest!.createDigestSchedule(input);

    await storage.digest!.deleteDigestSchedule(input.id);

    const deleted = await storage.digest!.getDigestSchedule(input.id);
    expect(deleted).toBeNull();
  });
});
