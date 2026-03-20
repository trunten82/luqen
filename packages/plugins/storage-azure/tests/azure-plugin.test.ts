import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CONN_STRING =
  'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net';

describe('plugin-storage-azure', () => {
  let plugin: typeof import('../src/index.js');
  let mockFetch: ReturnType<typeof vi.fn>;

  const validConfig = {
    connectionString: CONN_STRING,
    containerName: 'reports',
    prefix: 'scans/',
  };

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', mockFetch);
    plugin = await import('../src/index.js');
  });

  afterEach(async () => {
    await plugin.deactivate();
    vi.restoreAllMocks();
  });

  // ── Manifest ──────────────────────────────────────────────────────────────

  describe('manifest', () => {
    it('has correct metadata', () => {
      expect(plugin.manifest.name).toBe('storage-azure');
      expect(plugin.manifest.type).toBe('storage');
      expect(plugin.manifest.version).toBe('1.0.0');
    });

    it('has configSchema with required fields', () => {
      const connField = plugin.manifest.configSchema.find((f) => f.key === 'connectionString');
      expect(connField).toBeDefined();
      expect(connField!.required).toBe(true);
      expect(connField!.type).toBe('secret');

      const containerField = plugin.manifest.configSchema.find((f) => f.key === 'containerName');
      expect(containerField).toBeDefined();
      expect(containerField!.required).toBe(true);
    });
  });

  // ── Activate ──────────────────────────────────────────────────────────────

  describe('activate', () => {
    it('activates with valid config', async () => {
      await expect(plugin.activate(validConfig)).resolves.not.toThrow();
    });

    it('throws without connectionString', async () => {
      await expect(plugin.activate({ ...validConfig, connectionString: '' }))
        .rejects.toThrow('connectionString is required');
    });

    it('throws without containerName', async () => {
      await expect(plugin.activate({ ...validConfig, containerName: '' }))
        .rejects.toThrow('containerName is required');
    });

    it('throws with invalid connection string (missing AccountName)', async () => {
      await expect(plugin.activate({
        ...validConfig,
        connectionString: 'AccountKey=abc;EndpointSuffix=core.windows.net',
      })).rejects.toThrow('AccountName');
    });

    it('uses default prefix when not provided', async () => {
      await plugin.activate({
        connectionString: CONN_STRING,
        containerName: 'c',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });
      await plugin.save('test.json', new Uint8Array([1]));

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('pally-agent/test.json');
    });
  });

  // ── Health check ──────────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns false when not activated', async () => {
      expect(await plugin.healthCheck()).toBe(false);
    });

    it('returns true when list succeeds', async () => {
      await plugin.activate(validConfig);
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await plugin.healthCheck()).toBe(true);
    });

    it('returns false when list fails', async () => {
      await plugin.activate(validConfig);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      expect(await plugin.healthCheck()).toBe(false);
    });
  });

  // ── Deactivate ────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivates cleanly', async () => {
      await plugin.activate(validConfig);
      await plugin.deactivate();
      expect(await plugin.healthCheck()).toBe(false);
    });
  });

  // ── Save ──────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('throws when not activated', async () => {
      await expect(plugin.save('key', new Uint8Array([1])))
        .rejects.toThrow('not activated');
    });

    it('PUTs to correct URL', async () => {
      await plugin.activate(validConfig);
      await plugin.save('report.json', new Uint8Array([0x7b, 0x7d]));

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://myaccount.blob.core.windows.net/reports/scans/report.json');
      expect(opts.method).toBe('PUT');
    });

    it('includes SharedKey Authorization header', async () => {
      await plugin.activate(validConfig);
      await plugin.save('file.bin', new Uint8Array([1, 2, 3]));

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['Authorization']).toMatch(/^SharedKey myaccount:/);
    });

    it('throws on Azure error', async () => {
      await plugin.activate(validConfig);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('AuthorizationFailure'),
      });

      await expect(plugin.save('x', new Uint8Array([1])))
        .rejects.toThrow('Azure PUT failed');
    });
  });

  // ── Load ──────────────────────────────────────────────────────────────────

  describe('load', () => {
    it('throws when not activated', async () => {
      await expect(plugin.load('key')).rejects.toThrow('not activated');
    });

    it('GETs from correct URL and returns Uint8Array', async () => {
      await plugin.activate(validConfig);
      const payload = new Uint8Array([10, 20, 30]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(payload.buffer),
      });

      const result = await plugin.load('data.bin');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://myaccount.blob.core.windows.net/reports/scans/data.bin');
      expect(opts.method).toBe('GET');
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('throws when not activated', async () => {
      await expect(plugin.delete('key')).rejects.toThrow('not activated');
    });

    it('DELETEs at correct URL', async () => {
      await plugin.activate(validConfig);
      await plugin.delete('old.json');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://myaccount.blob.core.windows.net/reports/scans/old.json');
      expect(opts.method).toBe('DELETE');
    });
  });
});
