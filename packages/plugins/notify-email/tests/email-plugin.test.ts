import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock nodemailer before importing the plugin
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const mockVerify = vi.fn().mockResolvedValue(true);
const mockClose = vi.fn();

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
    verify: mockVerify,
    close: mockClose,
  })),
}));

describe('plugin-notify-email', () => {
  let plugin: typeof import('../src/index.js');

  const validConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: true,
    username: 'user@example.com',
    password: 'secret123',
    fromAddress: 'noreply@example.com',
    fromName: 'Pally Dashboard',
    events: 'scan.complete,scan.failed',
  };

  beforeEach(async () => {
    vi.resetModules();
    mockSendMail.mockClear();
    mockVerify.mockClear().mockResolvedValue(true);
    mockClose.mockClear();

    // Re-mock after resetModules
    vi.doMock('nodemailer', () => ({
      createTransport: vi.fn(() => ({
        sendMail: mockSendMail,
        verify: mockVerify,
        close: mockClose,
      })),
    }));

    plugin = await import('../src/index.js');
  });

  afterEach(async () => {
    try {
      await plugin.deactivate();
    } catch {
      // Ignore if not activated
    }
    vi.restoreAllMocks();
  });

  describe('manifest', () => {
    it('has correct metadata', () => {
      expect(plugin.manifest.name).toBe('notify-email');
      expect(plugin.manifest.type).toBe('notification');
      expect(plugin.manifest.version).toBe('1.0.0');
    });

    it('has configSchema with required SMTP fields', () => {
      const hostField = plugin.manifest.configSchema.find((f) => f.key === 'host');
      expect(hostField).toBeDefined();
      expect(hostField!.required).toBe(true);

      const passwordField = plugin.manifest.configSchema.find((f) => f.key === 'password');
      expect(passwordField).toBeDefined();
      expect(passwordField!.type).toBe('secret');

      const fromField = plugin.manifest.configSchema.find((f) => f.key === 'fromAddress');
      expect(fromField).toBeDefined();
      expect(fromField!.required).toBe(true);
    });
  });

  describe('activate', () => {
    it('activates with valid config', async () => {
      await expect(plugin.activate(validConfig)).resolves.not.toThrow();
    });

    it('throws without host', async () => {
      await expect(plugin.activate({ ...validConfig, host: '' })).rejects.toThrow('SMTP host is required');
    });

    it('throws without username', async () => {
      await expect(plugin.activate({ ...validConfig, username: '' })).rejects.toThrow('SMTP username is required');
    });

    it('throws without password', async () => {
      await expect(plugin.activate({ ...validConfig, password: '' })).rejects.toThrow('SMTP password is required');
    });

    it('throws without fromAddress', async () => {
      await expect(plugin.activate({ ...validConfig, fromAddress: '' })).rejects.toThrow('From email address is required');
    });

    it('throws when SMTP verification fails', async () => {
      mockVerify.mockRejectedValueOnce(new Error('Auth failed'));
      await expect(plugin.activate(validConfig)).rejects.toThrow('SMTP connection verification failed');
    });

    it('uses default port and secure when not provided', async () => {
      const { port: _port, secure: _secure, ...configWithoutPortSecure } = validConfig;
      await expect(plugin.activate(configWithoutPortSecure)).resolves.not.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('returns false when not activated', async () => {
      expect(await plugin.healthCheck()).toBe(false);
    });

    it('returns true when activated and transport verifies', async () => {
      await plugin.activate(validConfig);
      expect(await plugin.healthCheck()).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('deactivates cleanly', async () => {
      await plugin.activate(validConfig);
      await expect(plugin.deactivate()).resolves.not.toThrow();
      expect(await plugin.healthCheck()).toBe(false);
    });

    it('calls close on transport', async () => {
      await plugin.activate(validConfig);
      await plugin.deactivate();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await plugin.activate(validConfig);
    });

    it('throws when not activated', async () => {
      await plugin.deactivate();
      await expect(plugin.send({
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: {},
      })).rejects.toThrow('not activated');
    });

    it('sends scan.complete event as email', async () => {
      await plugin.send({
        type: 'scan.complete',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://example.com', totalIssues: 5, pagesScanned: 10 },
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.from).toContain('noreply@example.com');
      expect(mailOptions.from).toContain('Pally Dashboard');
      expect(mailOptions.subject).toContain('example.com');
      expect(mailOptions.html).toContain('Scan Complete');
    });

    it('sends scan.failed event', async () => {
      await plugin.send({
        type: 'scan.failed',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://broken.com', error: 'Connection refused' },
      });

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.subject).toContain('Scan Failed');
      expect(mailOptions.html).toContain('Connection refused');
    });

    it('skips events not in enabled list', async () => {
      await plugin.send({
        type: 'violation.found',
        timestamp: '2026-03-20T12:00:00Z',
        data: { wcagCriterion: '1.1.1' },
      });

      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('sendReport', () => {
    beforeEach(async () => {
      await plugin.activate(validConfig);
    });

    it('throws when not activated', async () => {
      await plugin.deactivate();
      await expect(plugin.sendReport({
        to: ['test@example.com'],
        subject: 'Test Report',
        html: '<h1>Report</h1>',
      })).rejects.toThrow('not activated');
    });

    it('sends report email to specified recipients', async () => {
      await plugin.sendReport({
        to: ['alice@example.com', 'bob@example.com'],
        subject: 'Accessibility Report: example.com',
        html: '<h1>Report</h1>',
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe('alice@example.com, bob@example.com');
      expect(mailOptions.subject).toBe('Accessibility Report: example.com');
      expect(mailOptions.html).toBe('<h1>Report</h1>');
      expect(mailOptions.from).toContain('noreply@example.com');
    });

    it('sends report with attachments', async () => {
      await plugin.sendReport({
        to: ['test@example.com'],
        subject: 'Report',
        html: '<h1>Report</h1>',
        attachments: [
          { filename: 'report.html', content: '<html></html>', contentType: 'text/html' },
          { filename: 'issues.csv', content: 'col1,col2', contentType: 'text/csv' },
        ],
      });

      const mailOptions = mockSendMail.mock.calls[0][0];
      expect(mailOptions.attachments).toHaveLength(2);
      expect(mailOptions.attachments[0].filename).toBe('report.html');
      expect(mailOptions.attachments[1].filename).toBe('issues.csv');
    });
  });

  describe('testConnection', () => {
    it('throws when not activated', async () => {
      await expect(plugin.testConnection()).rejects.toThrow('not activated');
    });

    it('returns true when transport verifies', async () => {
      await plugin.activate(validConfig);
      const result = await plugin.testConnection();
      expect(result).toBe(true);
    });
  });
});
