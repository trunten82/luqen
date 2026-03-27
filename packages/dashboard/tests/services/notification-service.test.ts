import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScanRecord, EmailReport } from '../../src/db/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/email/report-generator.js', () => ({
  generateIssuesCsv: vi.fn().mockResolvedValue(null),
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

import {
  buildEmailSubject,
  parseRecipients,
  buildPdfAttachment,
  buildCsvAttachment,
  buildAttachments,
  sendNotification,
} from '../../src/services/notification-service.js';
import { generateIssuesCsv } from '../../src/email/report-generator.js';
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
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildEmailSubject', () => {
  it('includes total issues and error count', () => {
    const scan = makeScan({ errors: 10, warnings: 5, notices: 3 });
    const subject = buildEmailSubject(scan);
    expect(subject).toBe('Accessibility Report: https://example.com — 18 issues (10 errors)');
  });

  it('handles undefined issue counts', () => {
    const scan = makeScan({ errors: undefined, warnings: undefined, notices: undefined });
    const subject = buildEmailSubject(scan);
    expect(subject).toContain('0 issues (0 errors)');
  });
});

describe('parseRecipients', () => {
  it('splits comma-separated emails', () => {
    expect(parseRecipients('alice@test.com, bob@test.com')).toEqual(['alice@test.com', 'bob@test.com']);
  });

  it('filters empty entries', () => {
    expect(parseRecipients(', , ')).toEqual([]);
  });

  it('trims whitespace', () => {
    expect(parseRecipients('  alice@test.com  ,  bob@test.com  ')).toEqual(['alice@test.com', 'bob@test.com']);
  });
});

describe('buildPdfAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generatePdfFromData).mockResolvedValue(Buffer.from('%PDF-fake'));
    vi.mocked(normalizeReportData).mockReturnValue({
      summary: { pagesScanned: 10, totalIssues: 10, byLevel: { error: 5, warning: 3, notice: 2 } },
      topActionItems: [],
      complianceMatrix: null,
      templateComponents: [],
    } as any);
  });

  it('builds PDF attachment from DB report data', async () => {
    const storage = makeStorage();
    const scan = makeScan();
    const result = await buildPdfAttachment(storage, scan, '/tmp/report.json');

    expect(result).not.toBeNull();
    expect(result!.filename).toContain('.pdf');
    expect(result!.contentType).toBe('application/pdf');
  });

  it('falls back to file when DB report is null', async () => {
    const storage = makeStorage();
    storage.scans.getReport.mockResolvedValue(null);
    vi.mocked(existsSync).mockReturnValue(true);
    const scan = makeScan();

    const result = await buildPdfAttachment(storage, scan, '/tmp/report.json');

    expect(result).not.toBeNull();
    expect(normalizeReportData).toHaveBeenCalledTimes(1);
  });

  it('returns null when no report data available', async () => {
    const storage = makeStorage();
    storage.scans.getReport.mockResolvedValue(null);
    vi.mocked(existsSync).mockReturnValue(false);
    const scan = makeScan();

    const result = await buildPdfAttachment(storage, scan, '/tmp/report.json');

    expect(result).toBeNull();
  });

  it('returns null and warns when PDF generation fails', async () => {
    vi.mocked(generatePdfFromData).mockRejectedValue(new Error('PDFKit error'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = makeStorage();
    const scan = makeScan();

    const result = await buildPdfAttachment(storage, scan, '/tmp/report.json');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles invalid URL gracefully for hostname', async () => {
    const storage = makeStorage();
    const scan = makeScan({ siteUrl: 'not-a-url' });

    const result = await buildPdfAttachment(storage, scan, '/tmp/report.json');

    expect(result).not.toBeNull();
    expect(result!.filename).toContain('not-a-url');
  });
});

describe('buildCsvAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns CSV attachment when data is available', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('col1,col2\nval1,val2');
    const scan = makeScan();

    const result = await buildCsvAttachment(scan, '/tmp/report.json');

    expect(result).not.toBeNull();
    expect(result!.filename).toContain('.csv');
    expect(result!.contentType).toBe('text/csv');
  });

  it('returns null when generateIssuesCsv returns null', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue(null);
    const scan = makeScan();

    const result = await buildCsvAttachment(scan, '/tmp/report.json');

    expect(result).toBeNull();
  });
});

describe('buildAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generatePdfFromData).mockResolvedValue(Buffer.from('%PDF-fake'));
    vi.mocked(normalizeReportData).mockReturnValue({
      summary: { pagesScanned: 10, totalIssues: 10, byLevel: { error: 5, warning: 3, notice: 2 } },
      topActionItems: [],
      complianceMatrix: null,
      templateComponents: [],
    } as any);
    vi.mocked(generateIssuesCsv).mockResolvedValue(null);
  });

  it('builds PDF attachment for pdf format', async () => {
    const storage = makeStorage();
    const scan = makeScan();
    const report = makeReport({ format: 'pdf' });

    const result = await buildAttachments(storage, scan, report);

    expect(result.length).toBe(1);
    expect(result[0].contentType).toBe('application/pdf');
  });

  it('builds CSV attachment for csv format', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('csv-data');
    const storage = makeStorage();
    const scan = makeScan();
    const report = makeReport({ format: 'csv' });

    const result = await buildAttachments(storage, scan, report);

    expect(result.length).toBe(1);
    expect(result[0].contentType).toBe('text/csv');
  });

  it('builds both attachments for both format', async () => {
    vi.mocked(generateIssuesCsv).mockResolvedValue('csv-data');
    const storage = makeStorage();
    const scan = makeScan();
    const report = makeReport({ format: 'both' });

    const result = await buildAttachments(storage, scan, report);

    expect(result.length).toBe(2);
  });

  it('returns empty when scan has no jsonReportPath', async () => {
    const storage = makeStorage();
    const scan = makeScan({ jsonReportPath: undefined });
    const report = makeReport({ format: 'pdf' });

    const result = await buildAttachments(storage, scan, report);

    expect(result.length).toBe(0);
  });
});

describe('sendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends via legacy SMTP when no plugin is available', async () => {
    const storage = makeStorage();
    const report = makeReport();

    await sendNotification(
      storage, report,
      ['alice@test.com'],
      'Test Subject',
      '<html>body</html>',
      [],
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.smtp.host).toBe('smtp.example.com');
  });

  it('sends via plugin when available', async () => {
    const mockSendReport = vi.fn().mockResolvedValue(undefined);
    const pluginManager = {
      getActiveInstanceByPackageName: vi.fn().mockReturnValue({
        sendReport: mockSendReport,
      }),
      getPluginConfigForOrg: vi.fn().mockReturnValue(null),
    } as any;

    const storage = makeStorage();
    const report = makeReport();

    await sendNotification(
      storage, report,
      ['alice@test.com'],
      'Test Subject',
      '<html>body</html>',
      [],
      pluginManager,
    );

    expect(mockSendReport).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('throws when plugin lacks sendReport method', async () => {
    const pluginManager = {
      getActiveInstanceByPackageName: vi.fn().mockReturnValue({}),
      getPluginConfigForOrg: vi.fn().mockReturnValue(null),
    } as any;

    const storage = makeStorage();
    const report = makeReport();

    await expect(
      sendNotification(storage, report, ['a@b.com'], 'Sub', 'html', [], pluginManager),
    ).rejects.toThrow('Email plugin does not expose sendReport method');
  });

  it('throws when no SMTP config exists', async () => {
    const storage = makeStorage();
    storage.email.getSmtpConfig.mockResolvedValue(null);
    const report = makeReport();

    await expect(
      sendNotification(storage, report, ['a@b.com'], 'Sub', 'html', []),
    ).rejects.toThrow('No email plugin active and no SMTP config found');

    expect(sendEmail).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(systemConfig);
    const report = makeReport();

    await sendNotification(storage, report, ['a@b.com'], 'Sub', 'html', []);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.smtp.host).toBe('system-smtp.example.com');
  });
});
