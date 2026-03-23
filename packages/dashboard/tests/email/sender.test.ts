import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock nodemailer — factory must not reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('nodemailer', () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-123' });
  const verify = vi.fn().mockResolvedValue(true);
  return {
    createTransport: vi.fn().mockReturnValue({ sendMail, verify }),
  };
});

import { sendEmail, testSmtpConnection } from '../../src/email/sender.js';
import { createTransport } from 'nodemailer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTransportMock() {
  return vi.mocked(createTransport).mock.results[
    vi.mocked(createTransport).mock.results.length - 1
  ].value as { sendMail: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
}

function makeSmtpOptions() {
  return {
    host: 'smtp.test.com',
    port: 587,
    secure: false,
    username: 'user',
    password: 'pass',
    fromAddress: 'from@test.com',
    fromName: 'Test Sender',
  } as const;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a transport with correct SMTP config', async () => {
    const smtp = makeSmtpOptions();
    await sendEmail({ smtp, to: ['a@b.com'], subject: 'S', html: '<p>Hi</p>' });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'user', pass: 'pass' },
    });
  });

  it('sends mail with correct from, to, subject, and html', async () => {
    const smtp = makeSmtpOptions();
    await sendEmail({
      smtp,
      to: ['alice@test.com', 'bob@test.com'],
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });

    const transport = getTransportMock();
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: '"Test Sender" <from@test.com>',
      to: 'alice@test.com, bob@test.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      attachments: undefined,
    });
  });

  it('passes attachments when provided', async () => {
    const smtp = makeSmtpOptions();
    const attachments = [
      { filename: 'report.pdf', content: 'base64data', contentType: 'application/pdf' },
      { filename: 'issues.csv', content: 'csv-data', contentType: 'text/csv' },
    ];

    await sendEmail({
      smtp,
      to: ['a@b.com'],
      subject: 'S',
      html: '<p>Hi</p>',
      attachments,
    });

    const transport = getTransportMock();
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { filename: 'report.pdf', content: 'base64data', contentType: 'application/pdf' },
          { filename: 'issues.csv', content: 'csv-data', contentType: 'text/csv' },
        ],
      }),
    );
  });

  it('sends to a single recipient', async () => {
    const smtp = makeSmtpOptions();
    await sendEmail({ smtp, to: ['solo@test.com'], subject: 'S', html: '<p>Hi</p>' });

    const transport = getTransportMock();
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'solo@test.com' }),
    );
  });

  it('propagates transport.sendMail errors', async () => {
    const smtp = makeSmtpOptions();
    // Need to make sendMail reject for this call
    const mockTransport = vi.mocked(createTransport).getMockImplementation();
    vi.mocked(createTransport).mockReturnValueOnce({
      sendMail: vi.fn().mockRejectedValue(new Error('SMTP timeout')),
      verify: vi.fn(),
    } as any);

    await expect(
      sendEmail({ smtp, to: ['a@b.com'], subject: 'S', html: '<p>Hi</p>' }),
    ).rejects.toThrow('SMTP timeout');
  });
});

describe('testSmtpConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when verify succeeds', async () => {
    const result = await testSmtpConnection(makeSmtpOptions());
    expect(result).toBe(true);
  });

  it('returns false when verify throws', async () => {
    vi.mocked(createTransport).mockReturnValueOnce({
      verify: vi.fn().mockRejectedValue(new Error('connection refused')),
      sendMail: vi.fn(),
    } as any);

    const result = await testSmtpConnection(makeSmtpOptions());
    expect(result).toBe(false);
  });

  it('creates transport with correct auth config', async () => {
    await testSmtpConnection(makeSmtpOptions());

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'user', pass: 'pass' },
    });
  });
});
