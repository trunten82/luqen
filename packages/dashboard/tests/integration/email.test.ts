import { describe, it, expect } from 'vitest';
import { sendEmail, testSmtpConnection } from '../../src/email/sender.js';
import { buildEmailBody } from '../../src/email/report-generator.js';
import type { SmtpOptions } from '../../src/email/sender.js';
import type { ScanRecord } from '../../src/db/types.js';

const SMTP_OPTIONS: SmtpOptions = {
  host: process.env['TEST_SMTP_HOST'] ?? 'localhost',
  port: parseInt(process.env['TEST_SMTP_PORT'] ?? '587'),
  secure: false,
  username: process.env['TEST_SMTP_USER'] ?? 'test',
  password: process.env['TEST_SMTP_PASS'] ?? 'test',
  fromAddress: process.env['TEST_SMTP_FROM'] ?? 'test@example.com',
  fromName: 'Luqen Test',
};

const TEST_RECIPIENT = process.env['TEST_EMAIL_RECIPIENT'] ?? 'test@example.com';

const makeScanRecord = (overrides: Partial<ScanRecord> = {}): ScanRecord => ({
  id: 'test-scan-001',
  siteUrl: 'https://example.com',
  status: 'completed',
  standard: 'WCAG2AA',
  jurisdictions: ['EU', 'IT'],
  createdBy: 'integration-test',
  createdAt: '2026-03-23T10:00:00Z',
  completedAt: '2026-03-23T10:05:00Z',
  pagesScanned: 5,
  totalIssues: 12,
  errors: 4,
  warnings: 5,
  notices: 3,
  orgId: 'org-test',
  ...overrides,
});

// Check SMTP availability at module level (top-level await)
let smtpAvailable = false;
try {
  smtpAvailable = await testSmtpConnection(SMTP_OPTIONS);
} catch {
  smtpAvailable = false;
}

// ── SMTP tests: skip when server unreachable ──────────────────────────────

describe.skipIf(!smtpAvailable)('SMTP integration', () => {
  describe('testSmtpConnection', () => {
    it('returns true with valid credentials', async () => {
      const result = await testSmtpConnection(SMTP_OPTIONS);
      expect(result).toBe(true);
    }, 30_000);

    it('returns false with wrong credentials', async () => {
      const badOptions: SmtpOptions = {
        ...SMTP_OPTIONS,
        password: 'wrong-password',
      };
      const result = await testSmtpConnection(badOptions);
      expect(result).toBe(false);
    }, 30_000);
  });

  describe('sendEmail', () => {
    it('sends a real test email', async () => {
      const timestamp = new Date().toISOString();
      const scan = makeScanRecord();
      const html = buildEmailBody(scan);

      await expect(
        sendEmail({
          smtp: SMTP_OPTIONS,
          to: [TEST_RECIPIENT],
          subject: `[LUQEN TEST] Integration test - ${timestamp}`,
          html,
        }),
      ).resolves.toBeUndefined();
    }, 30_000);

    it('sends an email with HTML attachment', async () => {
      const timestamp = new Date().toISOString();
      const scan = makeScanRecord();
      const html = buildEmailBody(scan);

      const attachmentHtml = `<!DOCTYPE html>
<html><body><h1>Test Report</h1><p>Generated at ${timestamp}</p></body></html>`;

      await expect(
        sendEmail({
          smtp: SMTP_OPTIONS,
          to: [TEST_RECIPIENT],
          subject: `[LUQEN TEST] Integration test with attachment - ${timestamp}`,
          html,
          attachments: [
            {
              filename: 'report.html',
              content: attachmentHtml,
              contentType: 'text/html',
            },
          ],
        }),
      ).resolves.toBeUndefined();
    }, 30_000);
  });
});

// ── buildEmailBody tests: always run (no external service needed) ─────────

describe('buildEmailBody', () => {
  it('generates valid HTML from scan data', () => {
    const scan = makeScanRecord();
    const html = buildEmailBody(scan);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Luqen Accessibility Report');
    expect(html).toContain('example.com');
    expect(html).toContain('WCAG2AA');
    expect(html).toContain('>5</div>'); // pagesScanned
    expect(html).toContain('>4</div>'); // errors
    expect(html).toContain('>3</div>'); // notices
  });

  it('handles scan with no completedAt (uses createdAt)', () => {
    const scan = makeScanRecord({ completedAt: undefined });
    const html = buildEmailBody(scan);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Luqen Accessibility Report');
  });

  it('handles scan with zero counts', () => {
    const scan = makeScanRecord({
      errors: 0,
      warnings: 0,
      notices: 0,
      pagesScanned: 0,
    });
    const html = buildEmailBody(scan);

    expect(html).toContain('>0</div>');
  });

  it('escapes HTML in site URL', () => {
    const scan = makeScanRecord({
      siteUrl: 'https://example.com/<script>alert("xss")</script>',
    });
    const html = buildEmailBody(scan);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
