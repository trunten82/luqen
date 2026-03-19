import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchComplianceCheck, fetchComplianceEnrichment } from '../src/compliance-client.js';
import type { ComplianceIssueInput } from '../src/compliance-client.js';

const SAMPLE_ISSUES: ComplianceIssueInput[] = [
  {
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'error',
    message: 'Missing alt attribute',
    selector: 'img',
    context: '<img src="photo.jpg">',
  },
];

const SAMPLE_RESPONSE = {
  jurisdictions: [
    {
      jurisdictionId: 'EU',
      jurisdictionName: 'European Union',
      status: 'fail',
      mandatoryViolations: 1,
      recommendedViolations: 0,
      regulations: [
        {
          regulationId: 'eu-accessibility-act',
          regulationName: 'EU Accessibility Act',
          shortName: 'EAA',
          status: 'fail',
          enforcementDate: '2025-06-28',
          violationCount: 1,
        },
      ],
    },
    {
      jurisdictionId: 'US',
      jurisdictionName: 'United States',
      status: 'pass',
      mandatoryViolations: 0,
      recommendedViolations: 0,
      regulations: [],
    },
  ],
  issueAnnotations: [
    {
      issueCode: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      annotations: [
        {
          regulationName: 'EU Accessibility Act',
          shortName: 'EAA',
          jurisdictionId: 'EU',
          obligation: 'mandatory',
        },
      ],
    },
  ],
};

describe('fetchComplianceCheck', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls the compliance check endpoint and returns enrichment', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU', 'US'],
      SAMPLE_ISSUES,
    );

    expect(result).not.toBeNull();
    expect(result!.summary.totalJurisdictions).toBe(2);
    expect(result!.summary.failing).toBe(1);
    expect(result!.summary.passing).toBe(1);
    expect(result!.summary.totalMandatoryViolations).toBe(1);
  });

  it('builds the jurisdiction matrix correctly', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU', 'US'],
      SAMPLE_ISSUES,
    );

    expect(result!.matrix['EU']).toBeDefined();
    expect(result!.matrix['EU'].status).toBe('fail');
    expect(result!.matrix['EU'].jurisdictionName).toBe('European Union');
    expect(result!.matrix['EU'].mandatoryViolations).toBe(1);
    expect(result!.matrix['EU'].regulations[0].shortName).toBe('EAA');

    expect(result!.matrix['US']).toBeDefined();
    expect(result!.matrix['US'].status).toBe('pass');
  });

  it('builds the issue annotations map correctly', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU', 'US'],
      SAMPLE_ISSUES,
    );

    const annotations = result!.issueAnnotations.get(
      'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    );
    expect(annotations).toBeDefined();
    expect(annotations![0].shortName).toBe('EAA');
    expect(annotations![0].obligation).toBe('mandatory');
  });

  it('returns null when the service returns a non-OK response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
    );

    expect(result).toBeNull();
  });

  it('returns null when fetch throws (service unreachable)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
    );

    expect(result).toBeNull();
  });

  it('includes the Authorization header when a token is provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
    });

    await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
      'my-token',
    );

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
  });

  it('omits Authorization header when no token is provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
    });

    await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
    );

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('sends the correct payload to the endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
    });

    await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU', 'US'],
      SAMPLE_ISSUES,
    );

    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/v1/compliance/check');
    const body = JSON.parse(options.body as string) as { jurisdictions: string[]; issues: unknown[] };
    expect(body.jurisdictions).toEqual(['EU', 'US']);
    expect(body.issues).toHaveLength(1);
  });

  it('returns an empty map for issueAnnotations when service returns empty list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
    });

    const result = await fetchComplianceCheck(
      'http://localhost:4000',
      ['EU'],
      [],
    );

    expect(result).not.toBeNull();
    expect(result!.issueAnnotations.size).toBe(0);
    expect(result!.summary.totalJurisdictions).toBe(0);
  });
});

describe('fetchComplianceEnrichment', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches a token first when client credentials are provided', async () => {
    // First call: token endpoint
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-123' }),
      })
      // Second call: compliance check
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
      });

    const result = await fetchComplianceEnrichment(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
      'client-id',
      'client-secret',
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [tokenUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(tokenUrl).toBe('http://localhost:4000/api/v1/oauth/token');
    expect(result).not.toBeNull();
  });

  it('skips token fetch when no credentials are provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
    });

    await fetchComplianceEnrichment(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:4000/api/v1/compliance/check');
  });

  it('proceeds without auth when token fetch fails', async () => {
    // Token call fails
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('token endpoint error'))
      // Compliance check proceeds without token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jurisdictions: [], issueAnnotations: [] }),
      });

    const result = await fetchComplianceEnrichment(
      'http://localhost:4000',
      ['EU'],
      SAMPLE_ISSUES,
      'client-id',
      'client-secret',
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Should still return a result (without auth)
    expect(result).not.toBeNull();
  });
});
