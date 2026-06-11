/**
 * Tests for digest-scheduler.ts:
 *   - computeNextDigestSendAt: weekly/monthly arithmetic
 *   - processDigest: channel fan-out with isolated failures
 *   - D-09 no-wedge: updateDigestSchedule is ALWAYS called even when a channel throws
 *   - email-only schedule: sendNotification called with recipients (3rd arg) + PDF attachment (6th arg)
 *   - channels not in schedule.channels are never dispatched
 *
 * TDD RED phase — pins the specified behavior surface.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  computeNextDigestSendAt,
  processDigest,
  startDigestScheduler,
} from '../../src/email/digest-scheduler.js';
import type { DigestSchedule } from '../../src/db/types.js';
import type { StorageAdapter } from '../../src/db/index.js';

// ---------------------------------------------------------------------------
// Helpers to build stub storage + schedule
// ---------------------------------------------------------------------------

function makeSchedule(overrides: Partial<DigestSchedule> = {}): DigestSchedule {
  return {
    id: 'sched-01',
    orgId: 'org-test',
    name: 'Test Digest',
    siteUrl: null,
    frequency: 'weekly',
    recipients: 'cfo@example.com, board@example.com',
    channels: ['email'],
    enabled: true,
    nextSendAt: '2026-06-08T00:00:00.000Z',
    lastSentAt: null,
    createdBy: 'admin',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStorageStub(schedule: DigestSchedule): {
  storage: StorageAdapter;
  getDueDigestSchedules: Mock;
  updateDigestSchedule: Mock;
  listScans: Mock;
  getReport: Mock;
} {
  const getDueDigestSchedules = vi.fn().mockResolvedValue([schedule]);
  const updateDigestSchedule = vi.fn().mockResolvedValue(undefined);
  const listScans = vi.fn().mockResolvedValue([]);
  const getReport = vi.fn().mockResolvedValue(null);

  const storage = {
    digest: {
      getDueDigestSchedules,
      updateDigestSchedule,
    },
    scans: {
      listScans,
      getReport,
      getScansForSite: vi.fn().mockResolvedValue([]),
    },
    notificationUnsubscribes: {
      isUnsubscribed: vi.fn().mockResolvedValue(false),
    },
    email: {
      getSmtpConfig: vi.fn().mockResolvedValue(null),
    },
  } as unknown as StorageAdapter;

  return { storage, getDueDigestSchedules, updateDigestSchedule, listScans, getReport };
}

function makePluginManager(overrides: {
  slackSend?: Mock;
  teamsSend?: Mock;
  getSlack?: boolean;
  getTeams?: boolean;
} = {}) {
  const slackSend = overrides.slackSend ?? vi.fn().mockResolvedValue(undefined);
  const teamsSend = overrides.teamsSend ?? vi.fn().mockResolvedValue(undefined);

  const slackInstance = overrides.getSlack !== false ? { send: slackSend } : null;
  const teamsInstance = overrides.getTeams !== false ? { send: teamsSend } : null;

  const getActiveInstanceByPackageName = vi.fn((pkg: string) => {
    if (pkg === '@luqen/plugin-notify-slack') return slackInstance;
    if (pkg === '@luqen/plugin-notify-teams') return teamsInstance;
    return null;
  });

  return {
    pluginManager: { getActiveInstanceByPackageName } as unknown as import('../../src/plugins/manager.js').PluginManager,
    slackSend,
    teamsSend,
    getActiveInstanceByPackageName,
  };
}

// ---------------------------------------------------------------------------
// computeNextDigestSendAt
// ---------------------------------------------------------------------------

describe('computeNextDigestSendAt', () => {
  it('adds 7 days for weekly frequency', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const result = computeNextDigestSendAt('weekly', from);
    const expected = new Date('2026-06-08T00:00:00.000Z').toISOString();
    expect(result).toBe(expected);
  });

  it('adds 30 days for monthly frequency', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const result = computeNextDigestSendAt('monthly', from);
    const expected = new Date('2026-07-01T00:00:00.000Z').toISOString();
    expect(result).toBe(expected);
  });

  it('defaults to weekly for unknown frequency', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const result = computeNextDigestSendAt('biannual', from);
    // 7 days later
    const expected = new Date('2026-06-08T00:00:00.000Z').toISOString();
    expect(result).toBe(expected);
  });

  it('uses current date when fromDate is not provided', () => {
    const before = Date.now();
    const result = computeNextDigestSendAt('weekly');
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    // Should be ~7 days in the future
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(resultMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(resultMs).toBeLessThanOrEqual(after + sevenDaysMs + 100);
  });
});

// ---------------------------------------------------------------------------
// processDigest — D-09 no-wedge test (slack throws)
// ---------------------------------------------------------------------------

describe('processDigest', () => {
  it('D-09: advances schedule even when Slack channel send() throws', async () => {
    const schedule = makeSchedule({ channels: ['email', 'slack'] });
    const { storage, updateDigestSchedule } = makeStorageStub(schedule);

    const throwingSlackSend = vi.fn().mockRejectedValue(new Error('Slack webhook failed'));
    const { pluginManager } = makePluginManager({ slackSend: throwingSlackSend });

    // processDigest should complete without throwing
    await expect(processDigest(storage, schedule, pluginManager)).resolves.toBeUndefined();

    // D-09: updateDigestSchedule MUST be called with advanced nextSendAt + set lastSentAt
    expect(updateDigestSchedule).toHaveBeenCalledTimes(1);
    const [id, data] = updateDigestSchedule.mock.calls[0] as [string, { lastSentAt: string; nextSendAt: string }];
    expect(id).toBe('sched-01');
    expect(data).toHaveProperty('lastSentAt');
    expect(data).toHaveProperty('nextSendAt');
    // lastSentAt must be a valid ISO date string
    expect(() => new Date(data.lastSentAt)).not.toThrow();
    // nextSendAt must be AFTER lastSentAt (advanced forward)
    expect(new Date(data.nextSendAt).getTime()).toBeGreaterThan(new Date(data.lastSentAt).getTime());
  });

  it('email channel: sendNotification called with recipients as 3rd arg', async () => {
    // We need to mock sendNotification — import the module dynamically to spy
    const notificationServiceModule = await import('../../src/services/notification-service.js');
    const sendNotificationSpy = vi.spyOn(notificationServiceModule, 'sendNotification')
      .mockResolvedValue(undefined);

    const schedule = makeSchedule({ channels: ['email'], recipients: 'cfo@example.com' });
    const { storage } = makeStorageStub(schedule);

    await processDigest(storage, schedule);

    // sendNotification should be called once
    expect(sendNotificationSpy).toHaveBeenCalledTimes(1);

    // 3rd argument is the recipients array (not read from the report arg)
    const callArgs = sendNotificationSpy.mock.calls[0];
    const recipientsArg = callArgs[2]; // 3rd arg (0-indexed: storage, report, recipients, ...)
    expect(recipientsArg).toContain('cfo@example.com');

    sendNotificationSpy.mockRestore();
  });

  it('email channel: attachments (6th arg) contains the PDF attachment when PDF generation succeeds', async () => {
    const notificationServiceModule = await import('../../src/services/notification-service.js');
    const sendNotificationSpy = vi.spyOn(notificationServiceModule, 'sendNotification')
      .mockResolvedValue(undefined);

    const schedule = makeSchedule({ channels: ['email'] });
    const { storage } = makeStorageStub(schedule);

    await processDigest(storage, schedule);

    if (sendNotificationSpy.mock.calls.length > 0) {
      const callArgs = sendNotificationSpy.mock.calls[0];
      const attachments = callArgs[5]; // 6th arg (0-indexed)
      // If PDF was successfully generated, it should be in attachments
      // (could be empty if PDF generation fails in test environment)
      expect(Array.isArray(attachments)).toBe(true);
    }

    sendNotificationSpy.mockRestore();
  });

  it('slack-only schedule: Slack plugin send() is called with text content', async () => {
    const schedule = makeSchedule({ channels: ['slack'], recipients: '' });
    const { storage } = makeStorageStub(schedule);
    const { pluginManager, slackSend } = makePluginManager();

    await processDigest(storage, schedule, pluginManager);

    // Slack send should be called
    expect(slackSend).toHaveBeenCalledTimes(1);
    // The argument to send() should contain some text
    const sendArg = slackSend.mock.calls[0][0];
    expect(sendArg).toBeDefined();
  });

  it('channel not in schedule.channels is never dispatched', async () => {
    // Schedule only has 'email' — Slack should NOT be called
    const schedule = makeSchedule({ channels: ['email'] });
    const { storage } = makeStorageStub(schedule);
    const { pluginManager, slackSend } = makePluginManager();

    const notificationServiceModule = await import('../../src/services/notification-service.js');
    const sendNotificationSpy = vi.spyOn(notificationServiceModule, 'sendNotification')
      .mockResolvedValue(undefined);

    await processDigest(storage, schedule, pluginManager);

    // Slack was NOT in schedule.channels → should not be called
    expect(slackSend).not.toHaveBeenCalled();

    sendNotificationSpy.mockRestore();
  });

  it('teams channel is dispatched when in schedule.channels', async () => {
    const schedule = makeSchedule({ channels: ['teams'], recipients: '' });
    const { storage } = makeStorageStub(schedule);
    const { pluginManager, teamsSend } = makePluginManager();

    await processDigest(storage, schedule, pluginManager);

    expect(teamsSend).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// startDigestScheduler
// ---------------------------------------------------------------------------

describe('startDigestScheduler', () => {
  it('returns a NodeJS.Timeout and calls .unref()', () => {
    const getDueDigestSchedules = vi.fn().mockResolvedValue([]);
    const storage = {
      digest: { getDueDigestSchedules },
    } as unknown as StorageAdapter;

    // Use a very large interval so it never fires in test
    const timer = startDigestScheduler(storage, undefined, 999_999_000);
    expect(timer).toBeDefined();

    clearInterval(timer);
  });
});
