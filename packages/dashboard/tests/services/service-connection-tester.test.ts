/**
 * Tests for testServiceConnection — Phase 06 plan 03 task 1.
 *
 * Behaviour per CONTEXT D-20, D-21:
 *   1. POST {url}/oauth/token with client_credentials grant
 *   2. GET  {url}/health with Bearer token from step 1
 *   3. Return { ok: true, latencyMs } on full success
 *   4. Return { ok: false, step: 'oauth'|'health', error } on failure
 *   5. 10-second timeout on each network call
 *   6. Never leak the clientSecret in error output
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testServiceConnection } from '../../src/services/service-connection-tester.js';

const VALID_INPUT = {
  url: 'http://example.test',
  clientId: 'test-client',
  clientSecret: 'super-secret-value-never-leak',
};

describe('testServiceConnection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns { ok: true, latencyMs } on happy path (oauth + health both succeed)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const healthCall = fetchMock.mock.calls[1]!;
    const healthInit = healthCall[1] as RequestInit | undefined;
    const headers = new Headers(healthInit?.headers as HeadersInit | undefined);
    expect(headers.get('authorization')).toBe('Bearer tok-abc');
  });

  it('returns { ok: false, step: "oauth" } when token endpoint returns 401', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe('oauth');
      expect(result.error).toBeTruthy();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns { ok: false, step: "oauth" } when the token response is missing access_token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ not_a_token: 'oops' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe('oauth');
      expect(result.error.toLowerCase()).toContain('access_token');
    }
  });

  it('returns { ok: false, step: "health" } when /health returns 503', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response('Service Unavailable', { status: 503 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe('health');
      expect(result.error).toBeTruthy();
    }
  });

  it('returns { ok: false, step: "oauth" } when fetch throws on the token call', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:4000');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe('oauth');
      expect(result.error).toContain('ECONNREFUSED');
    }
  });

  it('never leaks the clientSecret in error output', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error(`boom ${VALID_INPUT.clientSecret}`); // simulate a misbehaving transport
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection(VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(VALID_INPUT.clientSecret);
    }
  });

  it('trims trailing slash from url before composing endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      // If we had not trimmed, the URL would contain a double-slash.
      expect(url).not.toContain('//oauth');
      expect(url).not.toContain('//health');
      if (url.endsWith('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testServiceConnection({ ...VALID_INPUT, url: 'http://example.test/' });
    expect(result.ok).toBe(true);
  });
});
