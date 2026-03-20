import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('plugin-notify-teams', () => {
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
      expect(plugin.manifest.name).toBe('notify-teams');
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
        webhookUrl: 'https://outlook.office.com/webhook/test',
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

    it('returns true when activated with valid Teams URL', async () => {
      await plugin.activate({ webhookUrl: 'https://outlook.office.com/webhook/test' });
      expect(await plugin.healthCheck()).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('deactivates cleanly', async () => {
      await plugin.activate({ webhookUrl: 'https://outlook.office.com/webhook/test' });
      await expect(plugin.deactivate()).resolves.not.toThrow();
      expect(await plugin.healthCheck()).toBe(false);
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await plugin.activate({
        webhookUrl: 'https://outlook.office.com/webhook/test',
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

    it('sends scan.complete event as MessageCard', async () => {
      await plugin.send({
        type: 'scan.complete',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://example.com', totalIssues: 5, pagesScanned: 10 },
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://outlook.office.com/webhook/test');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body['@type']).toBe('MessageCard');
      expect(body['@context']).toBe('http://schema.org/extensions');
      expect(body.themeColor).toBe('00C851');
      expect(body.title).toBe('Scan Complete');
      expect(body.summary).toContain('example.com');
      expect(body.summary).toContain('5 issues');
      expect(body.sections[0].facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'URL', value: 'https://example.com' }),
          expect.objectContaining({ name: 'Issues', value: '5' }),
        ]),
      );
    });

    it('sends scan.failed event with red theme', async () => {
      await plugin.send({
        type: 'scan.failed',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://broken.com', error: 'Connection refused' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.themeColor).toBe('FF4444');
      expect(body.title).toBe('Scan Failed');
      expect(body.summary).toContain('broken.com');
      expect(body.summary).toContain('Connection refused');
    });

    it('sends violation.found event with orange theme', async () => {
      await plugin.send({
        type: 'violation.found',
        timestamp: '2026-03-20T12:00:00Z',
        data: { wcagCriterion: '1.1.1', count: 3 },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.themeColor).toBe('FF8800');
      expect(body.title).toBe('Violation Found');
      expect(body.summary).toContain('1.1.1');
    });

    it('sends regulation.changed event with blue theme', async () => {
      await plugin.send({
        type: 'regulation.changed',
        timestamp: '2026-03-20T12:00:00Z',
        data: { regulationName: 'ADA', summary: 'New requirements added' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.themeColor).toBe('0078D7');
      expect(body.title).toBe('Regulation Changed');
      expect(body.summary).toContain('ADA');
    });

    it('skips events not in enabled list', async () => {
      await plugin.deactivate();
      await plugin.activate({
        webhookUrl: 'https://outlook.office.com/webhook/test',
        events: 'scan.complete',
      });

      await plugin.send({
        type: 'violation.found',
        timestamp: '2026-03-20T12:00:00Z',
        data: { wcagCriterion: '1.1.1' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when Teams returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('invalid_webhook'),
      });

      await expect(plugin.send({
        type: 'scan.complete',
        timestamp: '2026-03-20T12:00:00Z',
        data: { siteUrl: 'https://example.com' },
      })).rejects.toThrow('Teams webhook failed');
    });
  });
});
