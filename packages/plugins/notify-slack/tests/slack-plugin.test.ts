import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('plugin-notify-slack', () => {
  let plugin: typeof import('../src/index.js');
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('ok') });
    vi.stubGlobal('fetch', mockFetch);
    plugin = await import('../src/index.js');
  });

  afterEach(async () => {
    await plugin.deactivate();
    vi.restoreAllMocks();
  });

  describe('manifest', () => {
    it('has correct metadata', () => {
      expect(plugin.manifest.name).toBe('notify-slack');
      expect(plugin.manifest.type).toBe('notification');
      expect(plugin.manifest.version).toBe('1.0.0');
    });

    it('has configSchema with webhookUrl', () => {
      const webhookField = plugin.manifest.configSchema.find((f) => f.key === 'webhookUrl');
      expect(webhookField).toBeDefined();
      expect(webhookField!.required).toBe(true);
      expect(webhookField!.type).toBe('secret');
    });
  });

  describe('activate', () => {
    it('activates with valid config', async () => {
      await expect(plugin.activate({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      })).resolves.not.toThrow();
    });

    it('throws without webhookUrl', async () => {
      await expect(plugin.activate({})).rejects.toThrow('webhookUrl is required');
    });

    it('throws with empty webhookUrl', async () => {
      await expect(plugin.activate({ webhookUrl: '' })).rejects.toThrow('webhookUrl is required');
    });
  });

  describe('healthCheck', () => {
    it('returns false when not activated', async () => {
      expect(await plugin.healthCheck()).toBe(false);
    });

    it('returns true when activated with valid Slack URL', async () => {
      await plugin.activate({ webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx' });
      expect(await plugin.healthCheck()).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('deactivates cleanly', async () => {
      await plugin.activate({ webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx' });
      await expect(plugin.deactivate()).resolves.not.toThrow();
      expect(await plugin.healthCheck()).toBe(false);
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await plugin.activate({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        channel: '#test',
        username: 'Test Bot',
      });
    });

    it('throws when not activated', async () => {
      await plugin.deactivate();
      await expect(plugin.send({
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: {},
      })).rejects.toThrow('not activated');
    });

    it('sends scan.complete event to Slack', async () => {
      await plugin.send({
        type: 'scan.complete',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://example.com', totalIssues: 5, pagesScanned: 10 },
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.text).toContain('example.com');
      expect(body.text).toContain('5 issues');
      expect(body.channel).toBe('#test');
      expect(body.username).toBe('Test Bot');
    });

    it('sends scan.failed event', async () => {
      await plugin.send({
        type: 'scan.failed',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://broken.com', error: 'Connection refused' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('broken.com');
      expect(body.text).toContain('Connection refused');
    });

    it('sends violation.found event', async () => {
      await plugin.send({
        type: 'violation.found',
        timestamp: '2026-03-20T12:00:00Z',
        data: { wcagCriterion: '1.1.1', count: 3 },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('1.1.1');
    });

    it('sends regulation.changed event', async () => {
      await plugin.send({
        type: 'regulation.changed',
        timestamp: '2026-03-20T12:00:00Z',
        data: { regulationName: 'ADA', summary: 'New requirements added' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('ADA');
    });

    it('skips events not in enabled list', async () => {
      await plugin.deactivate();
      await plugin.activate({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        events: 'scan.complete',
      });

      await plugin.send({
        type: 'violation.found',
        timestamp: '2026-03-20T12:00:00Z',
        data: { wcagCriterion: '1.1.1' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when Slack returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('invalid_token'),
      });

      await expect(plugin.send({
        type: 'scan.complete',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://example.com' },
      })).rejects.toThrow('Slack webhook failed');
    });
  });
});
