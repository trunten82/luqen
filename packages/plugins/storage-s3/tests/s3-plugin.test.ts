import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('plugin-storage-s3', () => {
  let plugin: typeof import('../src/index.js');
  let mockFetch: ReturnType<typeof vi.fn>;

  const validConfig = {
    bucket: 'my-bucket',
    region: 'eu-west-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    prefix: 'reports/',
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
      expect(plugin.manifest.name).toBe('storage-s3');
      expect(plugin.manifest.type).toBe('storage');
      expect(plugin.manifest.version).toBe('1.0.0');
    });

    it('has configSchema with required fields', () => {
      const bucketField = plugin.manifest.configSchema.find((f) => f.key === 'bucket');
      expect(bucketField).toBeDefined();
      expect(bucketField!.required).toBe(true);

      const accessKeyField = plugin.manifest.configSchema.find((f) => f.key === 'accessKeyId');
      expect(accessKeyField).toBeDefined();
      expect(accessKeyField!.type).toBe('secret');
    });
  });

  // ── Activate ──────────────────────────────────────────────────────────────

  describe('activate', () => {
    it('activates with valid config', async () => {
      await expect(plugin.activate(validConfig)).resolves.not.toThrow();
    });

    it('throws without bucket', async () => {
      await expect(plugin.activate({ ...validConfig, bucket: '' }))
        .rejects.toThrow('bucket is required');
    });

    it('throws without accessKeyId', async () => {
      await expect(plugin.activate({ ...validConfig, accessKeyId: '' }))
        .rejects.toThrow('accessKeyId is required');
    });

    it('throws without secretAccessKey', async () => {
      await expect(plugin.activate({ ...validConfig, secretAccessKey: '' }))
        .rejects.toThrow('secretAccessKey is required');
    });

    it('uses defaults for region and prefix', async () => {
      await plugin.activate({
        bucket: 'b',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
      });
      // save should use default prefix and region
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });
      await plugin.save('test.json', new Uint8Array([1]));

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('s3.us-east-1.amazonaws.com');
      expect(url).toContain('luqen/test.json');
    });
  });

  // ── Health check ──────────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns false when not activated', async () => {
      expect(await plugin.healthCheck()).toBe(false);
    });

    it('returns true when HEAD bucket succeeds', async () => {
      await plugin.activate(validConfig);
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await plugin.healthCheck()).toBe(true);
    });

    it('returns false when HEAD bucket fails', async () => {
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
      expect(url).toBe('https://my-bucket.s3.eu-west-1.amazonaws.com/reports/report.json');
      expect(opts.method).toBe('PUT');
    });

    it('includes Authorization header', async () => {
      await plugin.activate(validConfig);
      await plugin.save('file.bin', new Uint8Array([1, 2, 3]));

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['Authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    });

    it('throws on S3 error', async () => {
      await plugin.activate(validConfig);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('AccessDenied'),
      });

      await expect(plugin.save('x', new Uint8Array([1])))
        .rejects.toThrow('S3 PUT failed');
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
      expect(url).toBe('https://my-bucket.s3.eu-west-1.amazonaws.com/reports/data.bin');
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
      await plugin.delete('old-report.json');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://my-bucket.s3.eu-west-1.amazonaws.com/reports/old-report.json');
      expect(opts.method).toBe('DELETE');
    });
  });
});
