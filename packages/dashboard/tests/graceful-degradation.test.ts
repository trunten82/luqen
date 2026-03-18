import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Graceful degradation when compliance service is unavailable', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('safeListJurisdictions', () => {
    it('returns empty array when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const { safeListJurisdictions } = await import('../src/compliance-client.js');
      const result = await safeListJurisdictions('http://localhost:9999', 'token');

      expect(result).toEqual([]);
    });

    it('returns empty array when HTTP error occurs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        }),
      );

      const { safeListJurisdictions } = await import('../src/compliance-client.js');
      const result = await safeListJurisdictions('http://localhost:9999', 'token');

      expect(result).toEqual([]);
    });

    it('passes through correct results when service is available', async () => {
      const jurisdictions = [
        { id: 'eu', name: 'European Union', type: 'supranational' },
        { id: 'us', name: 'United States', type: 'federal' },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(jurisdictions),
        }),
      );

      const { safeListJurisdictions } = await import('../src/compliance-client.js');
      const result = await safeListJurisdictions('http://localhost:3000', 'token');

      expect(result).toEqual(jurisdictions);
    });
  });

  describe('safeGetSystemHealth', () => {
    it('returns degraded status when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const { safeGetSystemHealth } = await import('../src/compliance-client.js');
      const result = await safeGetSystemHealth('http://localhost:9999');

      expect(result).toEqual({
        compliance: { status: 'degraded' },
        pa11y: undefined,
      });
    });

    it('returns degraded status when HTTP error occurs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const { safeGetSystemHealth } = await import('../src/compliance-client.js');
      const result = await safeGetSystemHealth('http://localhost:9999', 'http://localhost:8888');

      expect(result.compliance.status).toBe('degraded');
    });

    it('passes through correct results when service is available', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        }),
      );

      const { safeGetSystemHealth } = await import('../src/compliance-client.js');
      const result = await safeGetSystemHealth('http://localhost:3000');

      expect(result.compliance.status).toBe('ok');
    });
  });
});
