import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScanRecord, EmailReport } from '../../src/db/types.js';

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../src/email/report-generator.js', () => ({
  generateIssuesCsv: vi.fn(),
  buildEmailBody: vi.fn().mockReturnValue('<html>email body</html>'),
}));

vi.mock('../../src/pdf/generator.js', () => ({
  generatePdfFromData: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
}));

vi.mock('../../src/services/report-service.js', () => ({
  normalizeReportData: vi.fn().mockReturnValue({
    summary: { pagesScanned: 10, totalIssues: 10, byLevel: { error: 5, warning: 3, notice: 2 } },
    topActionItems: [],
    complianceMatrix: null,
    templateComponents: [],
  }),
}));

vi.mock('../../src/email/sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { computeNextSendAt, processEmailReport, startEmailScheduler } from '../../src/email/scheduler.js';
import { generateIssuesCsv, buildEmailBody } from '../../src/email/report-generator.js';
import { generatePdfFromData } from '../../src/pdf/generator.js';
import { normalizeReportData } from '../../src/services/report-service.js';
import { sendEmail } from '../../src/email/sender.js';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScan(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: 'scan-1',
    siteUrl: 'https://example.com',
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: ['EU'],
    createdBy: 'user-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    completedAt: '2025-01-01T01:00:00.000Z',
    pagesScanned: 10,
    errors: 5,
    warnings: 3,
    notices: 2,
    jsonReportPath: '/tmp/report.json',
    orgId: 'org-1',
    ...overrides,
  };
}

function makeReport(overrides: Partial<EmailReport> = {}): EmailReport {
  return {
    id: 'report-1',
    name: 'Weekly Report',
    siteUrl: 'https://example.com',
    recipients: 'alice@test.com, bob@test.com',
    frequency: 'weekly',
    format: 'pdf',
    includeCsv: false,
    nextSendAt: '2025-01-01T00:00:00.000Z',
    lastSentAt: null,
    enabled: true,
    createdBy: 'user-1',
    orgId: 'org-1',
    ...overrides,
  };
}

function makeStorage(overrides: Record<string, unknown> = {}) {
  return {
    scans: {
      listScans: vi.fn().mockResolvedValue([makeScan()]),
      getReport: vi.fn().mockResolvedValue({ summary: { pagesScanned: 10, totalIssues: 10 } }),
    },
    email: {
      getSmtpConfig: vi.fn().mockResolvedValue({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'noreply@example.com',
        fromName: 'Luqen',
      }),
      updateEmailReport: vi.fn().mockResolvedValue(undefined),
      getDueEmailReports: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeNextSendAt', () => {
  const baseDate = new Date('2025-06-15T12:00:00.000Z');

  it('computes next daily send', () => {
    const result = computeNextSendAt('daily', baseDate);
    const expected = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(result).toBe(expected);
  });

  it('computes next weekly send', () => {
    const result = computeNextSendAt('weekly', baseDate);
    const expected = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(result).toBe(expected);
  });

  it('computes next monthly send (30 days)', () => {
    const result = computeNextSendAt('monthly', baseDate);
    const expected = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(result).toBe(expected);
  });

  it('defaults to weekly for unknown frequency', () => {
    const result = computeNextSendAt('biweekly', baseDate);
    const weekly = computeNextSendAt('weekly', baseDate);
    expect(result).toBe(weekly);
  });

  it('uses current date when no fromDate is provided', () => {
    const before = Date.now();
    const result = computeNextSendAt('daily');
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    // Should be roughly 24h from now
    expect(resultMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
    expect(resultMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
  });
});

describe('processEmailReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateIssuesCsv).mockResolvedValue(null);
    vi.mocked(buildEmailBody).mockReturnValue('<html>email body</html>');
    vi.mocked(generatePdfFromData).mockResolvedValue(Buffer.from('%PDF-fake'));
    vi.mocked(normalizeReportData).mockReturnValue({
      summary: { pagesScanned: 10, totalIssues: 10, byLevel: { error: 5, warning: 3, notice: 2 } },
      topActionItems: [],
      complianceMatrix: null,
      templateComponents: [],
    } as any);
  });

  it('skips when no completed scans exist', async () => {
    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([]);
    const report = makeReport();

    await processEmailReport(storage, report);

    expect(storage.email.updateEmailReport).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips when scan has no jsonReportPath', async () => {
    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([makeScan({ jsonReportPath: undefined })]);
    const report = makeReport();

    await processEmailReport(storage, report);

    expect(storage.email.updateEmailReport).not.toHaveBeenCalled();
  });

  it('skips when no valid recipients', async () => {
    const storage = makeStorage();
    const report = makeReport({ recipients: ', , ' });

    await processEmailReport(storage, report);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(storage.email.updateEmailReport).not.toHaveBeenCalled();
  });

  it('sends email via legacy SMTP when no plugin is available', async () => {
    const storage = makeStorage();
    const report = makeReport({ format: 'csv', includeCsv: false });

    await processEmailReport(storage, report);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toEqual(['alice@test.com', 'bob@test.com']);
    expect(call.subject).toContain('Accessibility Report');
    expect(call.subject).toContain('example.com');
    expect(call.smtp.host).toBe('smtp.example.com');
  });

  it('updates nextSendAt and lastSentAt after sending', async () => {
    const storage = makeStorage();
    const report = makeReport({ frequency: 'daily' });

    await processEmailReport(storage, report);

    expect(storage.email.updateEmailReport).toHaveBeenCalledTimes(1);
    const [id, updates] = storage.email.updateEmailReport.mock.calls[0];
    expect(id).toBe('report-1');
    expect(updates.lastSentAt).toBeDefined();
    expect(updates.nextSendAt).toBeDefined();
    // nextSendAt should be roughly 24h from now
    const nextMs = new Date(updates.nextSendAt).getTime();
    const nowMs = Date.now();
    expect(nextMs).toBeGreaterThan(nowMs);
    expect(nextMs).toBeLessThan(nowMs + 25 * 60 * 60 * 1000);
  });

  it('attaches PDF when format is pdf and report data is available', async () => {
    const storage = makeStorage();
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    expect(normalizeReportData).toHaveBeenCalledTimes(1);
    expect(generatePdfFromData).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toContain('.pdf');
    expect(call.attachments[0].contentType).toBe('application/pdf');
  });

  it('skips PDF when report data is not available (getReport returns null, file missing)', async () => {
    const storage = makeStorage();
    storage.scans.getReport.mockResolvedValue(null);
    vi.mocked(existsSync).mockReturnValue(false);
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    expect(generatePdfFromData).not.toHaveBeenCalled();
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(0);
  });

  it('falls back to file when getReport returns null but file exists', async () => {
    const storage = makeStorage();
    storage.scans.getReport.mockResolvedValue(null);
    vi.mocked(existsSync).mockReturnValue(true);
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    expect(normalizeReportData).toHaveBeenCalledTimes(1);
    expect(generatePdfFromData).toHaveBeenCalledTimes(1);
  });

  it('warns and skips PDF when generatePdfFromData throws', async () => {
    vi.mocked(generatePdfFromData).mockRejectedValue(new Error('PDFKit error'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const storage = makeStorage();
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    expect(consoleSpy).toHaveBeenCalled();
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('attaches CSV when format is csv', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('col1,col2\nval1,val2');

    const storage = makeStorage();
    const report = makeReport({ format: 'csv' });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toContain('.csv');
    expect(call.attachments[0].contentType).toBe('text/csv');
  });

  it('attaches both PDF and CSV when format is both', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('csv-data');

    const storage = makeStorage();
    const report = makeReport({ format: 'both' });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(2);
  });

  it('includes CSV attachment when includeCsv flag is true', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('csv-data');

    const storage = makeStorage();
    const report = makeReport({ format: 'pdf', includeCsv: true });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments.some((a: any) => a.contentType === 'text/csv')).toBe(true);
  });

  it('handles invalid site URL gracefully for hostname extraction', async () => {
    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([makeScan({ siteUrl: 'not-a-url' })]);
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toContain('not-a-url');
  });

  it('handles invalid site URL for CSV hostname extraction', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('csv-data');

    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([makeScan({ siteUrl: 'not-a-url' })]);
    const report = makeReport({ format: 'csv' });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments[0].filename).toContain('not-a-url');
  });

  it('uses email plugin sendReport when plugin is available', async () => {
    const mockSendReport = vi.fn().mockResolvedValue(undefined);
    const pluginManager = {
      getActiveInstanceByPackageName: vi.fn().mockReturnValue({
        sendReport: mockSendReport,
      }),
    } as any;

    const storage = makeStorage();
    const report = makeReport();

    await processEmailReport(storage, report, pluginManager);

    expect(mockSendReport).toHaveBeenCalledTimes(1);
    expect(mockSendReport.mock.calls[0][0].to).toEqual(['alice@test.com', 'bob@test.com']);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('throws when email plugin lacks sendReport method', async () => {
    const pluginManager = {
      getActiveInstanceByPackageName: vi.fn().mockReturnValue({
        // no sendReport method
      }),
    } as any;

    const storage = makeStorage();
    const report = makeReport();

    await expect(processEmailReport(storage, report, pluginManager)).rejects.toThrow(
      'Email plugin does not expose sendReport method',
    );
  });

  it('falls back to system SMTP config when org config is null', async () => {
    const systemConfig = {
      host: 'system-smtp.example.com',
      port: 465,
      secure: true,
      username: 'system',
      password: 'syspass',
      fromAddress: 'system@example.com',
      fromName: 'System',
    };
    const storage = makeStorage();
    storage.email.getSmtpConfig
      .mockResolvedValueOnce(null)   // org config
      .mockResolvedValueOnce(systemConfig);  // system config

    const report = makeReport();
    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.smtp.host).toBe('system-smtp.example.com');
  });

  it('logs error and returns when no SMTP config exists at all', async () => {
    const storage = makeStorage();
    storage.email.getSmtpConfig.mockResolvedValue(null);

    const report = makeReport();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await processEmailReport(storage, report);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(storage.email.updateEmailReport).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('builds correct subject line with issue counts', async () => {
    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([
      makeScan({ errors: 10, warnings: 5, notices: 3 }),
    ]);
    const report = makeReport();

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.subject).toBe('Accessibility Report: https://example.com — 18 issues (10 errors)');
  });

  it('handles scan with null issue counts in subject', async () => {
    const storage = makeStorage();
    storage.scans.listScans.mockResolvedValue([
      makeScan({ errors: undefined, warnings: undefined, notices: undefined }),
    ]);
    const report = makeReport();

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.subject).toContain('0 issues (0 errors)');
  });

  it('does not attach CSV when generateIssuesCsv returns null', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue(null);

    const storage = makeStorage();
    const report = makeReport({ format: 'csv' });

    await processEmailReport(storage, report);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.attachments).toHaveLength(0);
  });

  it('passes scanMeta with correct fields to generatePdfFromData', async () => {
    const storage = makeStorage();
    const report = makeReport({ format: 'pdf' });

    await processEmailReport(storage, report);

    const [scanMeta] = vi.mocked(generatePdfFromData).mock.calls[0];
    expect(scanMeta.siteUrl).toBe('https://example.com');
    expect(scanMeta.standard).toBe('WCAG2AA');
    expect(scanMeta.jurisdictions).toBe('EU');
    expect(scanMeta.createdAtDisplay).toBeDefined();
  });
});

describe('startEmailScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a timer handle', () => {
    const storage = makeStorage();
    const timer = startEmailScheduler(storage, undefined, 5000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it('processes due reports on each interval tick', async () => {
    const report = makeReport();
    const storage = makeStorage();
    storage.email.getDueEmailReports.mockResolvedValue([report]);
    storage.scans.listScans.mockResolvedValue([makeScan()]);

    const timer = startEmailScheduler(storage, undefined, 1000);

    // Advance timers and flush promises
    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.email.getDueEmailReports).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it('does nothing when no reports are due', async () => {
    const storage = makeStorage();
    storage.email.getDueEmailReports.mockResolvedValue([]);

    const timer = startEmailScheduler(storage, undefined, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.email.getDueEmailReports).toHaveBeenCalledTimes(1);
    expect(storage.scans.listScans).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  it('catches and logs errors from individual report processing', async () => {
    const report = makeReport();
    const storage = makeStorage();
    storage.email.getDueEmailReports.mockResolvedValue([report]);
    storage.scans.listScans.mockRejectedValue(new Error('db error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const timer = startEmailScheduler(storage, undefined, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    clearInterval(timer);
  });

  it('catches and logs errors from getDueEmailReports itself', async () => {
    const storage = makeStorage();
    storage.email.getDueEmailReports.mockRejectedValue(new Error('connection lost'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const timer = startEmailScheduler(storage, undefined, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(consoleSpy).toHaveBeenCalled();
    const errorMessage = consoleSpy.mock.calls[0].join(' ');
    expect(errorMessage).toContain('connection lost');

    consoleSpy.mockRestore();
    clearInterval(timer);
  });

  it('uses custom interval', async () => {
    const storage = makeStorage();

    const timer = startEmailScheduler(storage, undefined, 5000);

    await vi.advanceTimersByTimeAsync(4999);
    expect(storage.email.getDueEmailReports).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(storage.email.getDueEmailReports).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it('passes pluginManager to processEmailReport', async () => {
    const mockSendReport = vi.fn().mockResolvedValue(undefined);
    const pluginManager = {
      getActiveInstanceByPackageName: vi.fn().mockReturnValue({
        sendReport: mockSendReport,
      }),
    } as any;

    const report = makeReport();
    const storage = makeStorage();
    storage.email.getDueEmailReports.mockResolvedValue([report]);

    const timer = startEmailScheduler(storage, pluginManager, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(pluginManager.getActiveInstanceByPackageName).toHaveBeenCalledWith('@luqen/plugin-notify-email');

    clearInterval(timer);
  });
});
