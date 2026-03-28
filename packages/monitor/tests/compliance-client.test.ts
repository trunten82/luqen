import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getToken,
  clearTokenCache,
  listSources,
  listProposals,
  getSeedStatus,
  proposeUpdate,
  updateSourceLastChecked,
  addSource,
  type MonitoredSource,
  type UpdateProposal,
  type SeedStatus,
} from '../src/compliance-client.js';

const BASE_URL = 'https://compliance.example.com';
const TOKEN = 'test-access-token';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  clearTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- getToken ----

describe('getToken', () => {
  it('returns access_token on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'tok-123',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read write',
        }),
        { status: 200 },
      ),
    );

    const token = await getToken(BASE_URL, 'client-id', 'client-secret');
    expect(token).toBe('tok-123');
  });

  it('sends correct request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'read write' }),
        { status: 200 },
      ),
    );

    await getToken(BASE_URL, 'my-client', 'my-secret', 'custom-scope');

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/oauth/token`);
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = options?.body as string;
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=my-client');
    expect(body).toContain('client_secret=my-secret');
    expect(body).toContain('scope=custom-scope');
  });

  it('uses default scope when not specified', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'read write' }),
        { status: 200 },
      ),
    );

    await getToken(BASE_URL, 'id', 'secret');

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as string;
    expect(body).toContain('scope=read+write');
  });

  it('throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(getToken(BASE_URL, 'id', 'secret')).rejects.toThrow(
      'Token request failed (401): Unauthorized',
    );
  });

  it('throws on non-OK response even when body read fails', async () => {
    const badResponse = new Response(null, { status: 500 });
    // Override text() to simulate a failure
    vi.spyOn(badResponse, 'text').mockRejectedValueOnce(new Error('read error'));
    vi.mocked(fetch).mockResolvedValueOnce(badResponse);

    await expect(getToken(BASE_URL, 'id', 'secret')).rejects.toThrow(
      'Token request failed (500):',
    );
  });

  it('returns cached token on second call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'cached-tok', token_type: 'Bearer', expires_in: 3600, scope: 'read write' }),
        { status: 200 },
      ),
    );

    const first = await getToken(BASE_URL, 'id', 'secret');
    const second = await getToken(BASE_URL, 'id', 'secret');

    expect(first).toBe('cached-tok');
    expect(second).toBe('cached-tok');
    // fetch should only have been called once
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('fetches a new token when cached one has expired', async () => {
    // First call: return token with 0 seconds expiry (already expired after margin)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'old-tok', token_type: 'Bearer', expires_in: 0, scope: 'read write' }),
        { status: 200 },
      ),
    );
    // Second call: new token
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-tok', token_type: 'Bearer', expires_in: 3600, scope: 'read write' }),
        { status: 200 },
      ),
    );

    const first = await getToken(BASE_URL, 'id', 'secret');
    const second = await getToken(BASE_URL, 'id', 'secret');

    expect(first).toBe('old-tok');
    expect(second).toBe('new-tok');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('uses different cache entries for different scopes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'tok-scope-a', token_type: 'Bearer', expires_in: 3600, scope: 'a' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'tok-scope-b', token_type: 'Bearer', expires_in: 3600, scope: 'b' }),
          { status: 200 },
        ),
      );

    const tokA = await getToken(BASE_URL, 'id', 'secret', 'a');
    const tokB = await getToken(BASE_URL, 'id', 'secret', 'b');

    expect(tokA).toBe('tok-scope-a');
    expect(tokB).toBe('tok-scope-b');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

// ---- listSources ----

describe('listSources', () => {
  const mockSources: MonitoredSource[] = [
    {
      id: 'src-1',
      name: 'Source One',
      url: 'https://example.com/one',
      type: 'html',
      schedule: 'daily',
      createdAt: '2025-01-01T00:00:00Z',
    },
  ];

  it('returns sources from paginated envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockSources }), { status: 200 }),
    );

    const result = await listSources(BASE_URL, TOKEN);
    expect(result).toEqual(mockSources);
  });

  it('returns sources from plain array response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockSources), { status: 200 }),
    );

    const result = await listSources(BASE_URL, TOKEN);
    expect(result).toEqual(mockSources);
  });

  it('sends Authorization header and calls correct URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listSources(BASE_URL, TOKEN);

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/sources`);
    expect((options?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('sends X-Org-Id header when orgId is provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listSources(BASE_URL, TOKEN, 'org-42');

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Org-Id']).toBe('org-42');
  });

  it('omits X-Org-Id header when orgId is "system"', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listSources(BASE_URL, TOKEN, 'system');

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Org-Id']).toBeUndefined();
  });

  it('throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Server error', { status: 500 }),
    );

    await expect(listSources(BASE_URL, TOKEN)).rejects.toThrow('API GET');
  });
});

// ---- getSeedStatus ----

describe('getSeedStatus', () => {
  it('returns seed status', async () => {
    const status: SeedStatus = { seeded: true, jurisdictions: 5, regulations: 10, requirements: 50 };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(status), { status: 200 }),
    );

    const result = await getSeedStatus(BASE_URL, TOKEN);
    expect(result).toEqual(status);
  });

  it('calls the correct endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ seeded: false, jurisdictions: 0, regulations: 0, requirements: 0 }), { status: 200 }),
    );

    await getSeedStatus(BASE_URL, TOKEN, 'org-1');

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/seed/status`);
  });
});

// ---- proposeUpdate ----

describe('proposeUpdate', () => {
  const proposalInput = {
    source: 'https://example.com/law',
    type: 'amendment' as const,
    summary: 'Content changed',
    proposedChanges: {
      action: 'update' as const,
      entityType: 'regulation' as const,
      after: { contentHash: 'abc123' },
    },
  };

  const mockProposal: UpdateProposal = {
    id: 'prop-1',
    source: 'https://example.com/law',
    detectedAt: '2025-01-01T00:00:00Z',
    type: 'amendment',
    summary: 'Content changed',
    proposedChanges: {
      action: 'update',
      entityType: 'regulation',
      after: { contentHash: 'abc123' },
    },
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
  };

  it('creates a proposal and returns it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockProposal), { status: 200 }),
    );

    const result = await proposeUpdate(BASE_URL, TOKEN, proposalInput);
    expect(result).toEqual(mockProposal);
  });

  it('sends POST to correct endpoint with body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockProposal), { status: 200 }),
    );

    await proposeUpdate(BASE_URL, TOKEN, proposalInput, 'org-5');

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/updates/propose`);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual(proposalInput);
  });
});

// ---- updateSourceLastChecked ----

describe('updateSourceLastChecked', () => {
  it('sends PATCH with hash and timestamp', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await updateSourceLastChecked(BASE_URL, TOKEN, 'src-1', 'hash-abc');

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/sources/src-1`);
    expect(options?.method).toBe('PATCH');
    const body = JSON.parse(options?.body as string);
    expect(body.lastContentHash).toBe('hash-abc');
    expect(body.lastCheckedAt).toBeTruthy();
  });

  it('does not throw on API failure (best-effort)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Error', { status: 500 }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(updateSourceLastChecked(BASE_URL, TOKEN, 'src-1', 'hash')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not update source src-1'));

    warnSpy.mockRestore();
  });

  it('passes orgId header when specified', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await updateSourceLastChecked(BASE_URL, TOKEN, 'src-1', 'hash', 'org-7');

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Org-Id']).toBe('org-7');
  });
});

// ---- listProposals ----

describe('listProposals', () => {
  const mockProposals: UpdateProposal[] = [
    {
      id: 'prop-1',
      source: 'https://example.com/law',
      detectedAt: '2025-01-01T00:00:00Z',
      type: 'amendment',
      summary: 'Change detected',
      proposedChanges: { action: 'update', entityType: 'regulation' },
      status: 'pending',
      createdAt: '2025-01-01T00:00:00Z',
    },
  ];

  it('returns proposals from paginated envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockProposals }), { status: 200 }),
    );

    const result = await listProposals(BASE_URL, TOKEN, 'pending');
    expect(result).toEqual(mockProposals);
  });

  it('returns proposals from plain array response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockProposals), { status: 200 }),
    );

    const result = await listProposals(BASE_URL, TOKEN);
    expect(result).toEqual(mockProposals);
  });

  it('appends status query parameter when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listProposals(BASE_URL, TOKEN, 'pending');

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/updates/proposals?status=pending`);
  });

  it('omits query parameter when status is not provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listProposals(BASE_URL, TOKEN);

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/updates/proposals`);
  });

  it('sends X-Org-Id header when orgId is provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await listProposals(BASE_URL, TOKEN, 'pending', 'org-99');

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Org-Id']).toBe('org-99');
  });
});

// ---- addSource ----

describe('addSource', () => {
  const input = { name: 'New Source', url: 'https://example.com/new', type: 'html' as const, schedule: 'weekly' as const };

  const mockSource: MonitoredSource = {
    id: 'src-new',
    name: 'New Source',
    url: 'https://example.com/new',
    type: 'html',
    schedule: 'weekly',
    createdAt: '2025-01-01T00:00:00Z',
  };

  it('creates a source and returns it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockSource), { status: 200 }),
    );

    const result = await addSource(BASE_URL, TOKEN, input);
    expect(result).toEqual(mockSource);
  });

  it('sends POST to correct endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockSource), { status: 200 }),
    );

    await addSource(BASE_URL, TOKEN, input, 'org-3');

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/sources`);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual(input);
  });
});
