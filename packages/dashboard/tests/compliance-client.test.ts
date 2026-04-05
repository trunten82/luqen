import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('compliance-client X-Org-Id header', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('apiFetch via listJurisdictions', () => {
    it('sets X-Org-Id header when orgId is provided', async () => {
      const { listJurisdictions } = await import('../src/compliance-client.js');
      await listJurisdictions('http://localhost:3000', 'tok', 'org-42');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-42');
    });

    it('does NOT set X-Org-Id header when orgId is undefined', async () => {
      const { listJurisdictions } = await import('../src/compliance-client.js');
      await listJurisdictions('http://localhost:3000', 'tok');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).not.toHaveProperty('X-Org-Id');
    });

    it('does NOT set X-Org-Id header when orgId is "system"', async () => {
      const { listJurisdictions } = await import('../src/compliance-client.js');
      await listJurisdictions('http://localhost:3000', 'tok', 'system');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).not.toHaveProperty('X-Org-Id');
    });
  });

  describe('checkCompliance passes orgId', () => {
    it('includes X-Org-Id in POST request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0 },
            matrix: {},
            regulationMatrix: {},
          }),
      });

      const { checkCompliance } = await import('../src/compliance-client.js');
      await checkCompliance('http://localhost:3000', 'tok', ['eu'], [], [], 'org-99');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-99');
    });
  });

  describe('checkCompliance with regulations (REG-01)', () => {
    it('sends jurisdictions, regulations, issues in POST body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            summary: { totalJurisdictions: 1, passing: 0, failing: 0, totalMandatoryViolations: 0 },
            matrix: {},
            regulationMatrix: {},
          }),
      });

      const { checkCompliance } = await import('../src/compliance-client.js');
      const issues = [
        { code: 'W.1.1.1', type: 'error', message: 'm', selector: 's', context: 'c' },
      ];
      await checkCompliance(
        'http://localhost:3000',
        'tok',
        ['eu'],
        ['en301549'],
        issues,
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/compliance/check');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({
        jurisdictions: ['eu'],
        regulations: ['en301549'],
        issues,
      });
    });

    it('sends regulations:[] when caller passes an empty array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            summary: { totalJurisdictions: 1, passing: 0, failing: 0, totalMandatoryViolations: 0 },
            matrix: {},
            regulationMatrix: {},
          }),
      });

      const { checkCompliance } = await import('../src/compliance-client.js');
      await checkCompliance('http://localhost:3000', 'tok', ['eu'], [], []);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({ jurisdictions: ['eu'], regulations: [], issues: [] });
    });
  });

  describe('deleteOrgData', () => {
    it('sends DELETE to correct URL', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      const { deleteOrgData } = await import('../src/compliance-client.js');
      await deleteOrgData('http://localhost:3000', 'tok', 'org-42');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/v1/orgs/org-42/data');
      expect(opts.method).toBe('DELETE');
      expect(opts.headers).toHaveProperty('Authorization', 'Bearer tok');
    });
  });

  describe('functions that bypass apiFetch also pass orgId', () => {
    it('deleteJurisdiction includes X-Org-Id when orgId provided', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const { deleteJurisdiction } = await import('../src/compliance-client.js');
      await deleteJurisdiction('http://localhost:3000', 'tok', 'eu', 'org-7');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-7');
    });

    it('deleteRegulation includes X-Org-Id when orgId provided', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const { deleteRegulation } = await import('../src/compliance-client.js');
      await deleteRegulation('http://localhost:3000', 'tok', 'wcag', 'org-8');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-8');
    });

    it('deleteSource includes X-Org-Id when orgId provided', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const { deleteSource } = await import('../src/compliance-client.js');
      await deleteSource('http://localhost:3000', 'tok', 's1', 'org-9');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-9');
    });

    it('deactivateUser includes X-Org-Id when orgId provided', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const { deactivateUser } = await import('../src/compliance-client.js');
      await deactivateUser('http://localhost:3000', 'tok', 'u1', 'org-10');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers).toHaveProperty('X-Org-Id', 'org-10');
    });
  });
});
