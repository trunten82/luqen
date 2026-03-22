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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSmtpConfig(overrides: Partial<{
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  orgId: string;
}> = {}) {
  return {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    username: 'user@example.com',
    password: 'secret',
    fromAddress: 'noreply@example.com',
    fromName: 'Luqen',
    ...overrides,
  };
}

function makeEmailReportInput(overrides: Partial<{
  id: string;
  name: string;
  siteUrl: string;
  recipients: string;
  frequency: string;
  format: string;
  includeCsv: boolean;
  nextSendAt: string;
  createdBy: string;
  orgId: string;
}> = {}) {
  return {
    id: randomUUID(),
    name: 'Weekly Report',
    siteUrl: 'https://example.com',
    recipients: 'team@example.com',
    frequency: 'weekly',
    format: 'pdf',
    includeCsv: false,
    nextSendAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'user-1',
    orgId: 'org-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SMTP Config tests
// ---------------------------------------------------------------------------

describe('EmailRepository - SMTP Config', () => {
  it('upsertSmtpConfig creates config', async () => {
    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system' }));

    const config = await storage.email.getSmtpConfig('system');
    expect(config).not.toBeNull();
    expect(config!.host).toBe('smtp.example.com');
    expect(config!.port).toBe(587);
    expect(config!.username).toBe('user@example.com');
    expect(config!.fromAddress).toBe('noreply@example.com');
  });

  it('upsertSmtpConfig updates on conflict', async () => {
    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system', host: 'smtp.old.com' }));
    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system', host: 'smtp.new.com' }));

    const config = await storage.email.getSmtpConfig('system');
    expect(config!.host).toBe('smtp.new.com');
  });

  it('getSmtpConfig returns config for org', async () => {
    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system' }));

    const config = await storage.email.getSmtpConfig('system');
    expect(config).not.toBeNull();
    expect(config!.orgId).toBe('system');
  });

  it('getSmtpConfig returns null when not configured', async () => {
    const config = await storage.email.getSmtpConfig('system');
    expect(config).toBeNull();
  });

  it('stores boolean secure field correctly', async () => {
    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system', secure: true }));
    const configTrue = await storage.email.getSmtpConfig('system');
    expect(configTrue!.secure).toBe(true);

    await storage.email.upsertSmtpConfig(makeSmtpConfig({ orgId: 'system', secure: false }));
    const configFalse = await storage.email.getSmtpConfig('system');
    expect(configFalse!.secure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Email Report tests
// ---------------------------------------------------------------------------

describe('EmailRepository - Email Reports', () => {
  describe('createEmailReport', () => {
    it('creates email report with all fields', async () => {
      const input = makeEmailReportInput({
        name: 'Monthly Accessibility',
        siteUrl: 'https://example.com',
        recipients: 'a@b.com,c@d.com',
        frequency: 'monthly',
        format: 'pdf',
        includeCsv: true,
        createdBy: 'user-abc',
        orgId: 'org-1',
      });

      const report = await storage.email.createEmailReport(input);

      expect(report.id).toBe(input.id);
      expect(report.name).toBe('Monthly Accessibility');
      expect(report.siteUrl).toBe('https://example.com');
      expect(report.recipients).toBe('a@b.com,c@d.com');
      expect(report.frequency).toBe('monthly');
      expect(report.format).toBe('pdf');
      expect(report.includeCsv).toBe(true);
      expect(report.enabled).toBe(true);
      expect(report.createdBy).toBe('user-abc');
      expect(report.orgId).toBe('org-1');
      expect(report.lastSentAt).toBeNull();
    });
  });

  describe('getEmailReport', () => {
    it('returns email report by ID', async () => {
      const input = makeEmailReportInput();
      await storage.email.createEmailReport(input);

      const fetched = await storage.email.getEmailReport(input.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(input.id);
      expect(fetched!.name).toBe(input.name);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.email.getEmailReport(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('listEmailReports', () => {
    it('lists all email reports for an org', async () => {
      const orgId = 'org-list';
      await storage.email.createEmailReport(makeEmailReportInput({ orgId, name: 'Report A' }));
      await storage.email.createEmailReport(makeEmailReportInput({ orgId, name: 'Report B' }));

      const reports = await storage.email.listEmailReports(orgId);
      expect(reports).toHaveLength(2);
    });

    it('filters by orgId', async () => {
      await storage.email.createEmailReport(makeEmailReportInput({ orgId: 'org-a', name: 'Org A Report' }));
      await storage.email.createEmailReport(makeEmailReportInput({ orgId: 'org-b', name: 'Org B Report' }));

      const orgAReports = await storage.email.listEmailReports('org-a');
      expect(orgAReports).toHaveLength(1);
      expect(orgAReports[0]!.orgId).toBe('org-a');

      const orgBReports = await storage.email.listEmailReports('org-b');
      expect(orgBReports).toHaveLength(1);
      expect(orgBReports[0]!.orgId).toBe('org-b');
    });
  });

  describe('updateEmailReport', () => {
    it('updates name, frequency, enabled, and boolean fields', async () => {
      const input = makeEmailReportInput({ includeCsv: false, frequency: 'weekly' });
      await storage.email.createEmailReport(input);

      await storage.email.updateEmailReport(input.id, {
        name: 'Updated Name',
        frequency: 'daily',
        enabled: false,
        includeCsv: true,
      });

      const updated = await storage.email.getEmailReport(input.id);
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.frequency).toBe('daily');
      expect(updated!.enabled).toBe(false);
      expect(updated!.includeCsv).toBe(true);
    });
  });

  describe('deleteEmailReport', () => {
    it('deletes an email report', async () => {
      const input = makeEmailReportInput();
      await storage.email.createEmailReport(input);

      await storage.email.deleteEmailReport(input.id);

      const deleted = await storage.email.getEmailReport(input.id);
      expect(deleted).toBeNull();
    });
  });

  describe('getDueEmailReports', () => {
    it('returns reports where nextSendAt <= now AND enabled', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour ahead

      const dueInput = makeEmailReportInput({ nextSendAt: pastDate, name: 'Due Report' });
      const notDueInput = makeEmailReportInput({ nextSendAt: futureDate, name: 'Not Due Report' });

      await storage.email.createEmailReport(dueInput);
      await storage.email.createEmailReport(notDueInput);

      const due = await storage.email.getDueEmailReports();
      const dueIds = due.map((r) => r.id);

      expect(dueIds).toContain(dueInput.id);
      expect(dueIds).not.toContain(notDueInput.id);
    });

    it('excludes disabled reports even if nextSendAt <= now', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000).toISOString();

      const enabledInput = makeEmailReportInput({ nextSendAt: pastDate, name: 'Enabled Due' });
      const disabledInput = makeEmailReportInput({ nextSendAt: pastDate, name: 'Disabled Due' });

      await storage.email.createEmailReport(enabledInput);
      await storage.email.createEmailReport(disabledInput);

      // Disable the second report
      await storage.email.updateEmailReport(disabledInput.id, { enabled: false });

      const due = await storage.email.getDueEmailReports();
      const dueIds = due.map((r) => r.id);

      expect(dueIds).toContain(enabledInput.id);
      expect(dueIds).not.toContain(disabledInput.id);
    });
  });
});
