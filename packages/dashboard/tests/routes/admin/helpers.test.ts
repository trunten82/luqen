import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getToken, getOrgId } from '../../../src/routes/admin/helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    session: {},
    user: undefined,
    ...overrides,
  } as unknown as FastifyRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getToken()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns session token when available', () => {
    const request = makeRequest({ session: { token: 'session-token-123' } });

    expect(getToken(request)).toBe('session-token-123');
  });

  it('returns _orgServiceToken when session token not available', () => {
    const request = makeRequest({ _orgServiceToken: 'org-service-token-456' });

    expect(getToken(request)).toBe('org-service-token-456');
  });

  it('returns _serviceToken (global) when no org token', () => {
    const request = makeRequest({ _serviceToken: 'global-service-token-789' });

    expect(getToken(request)).toBe('global-service-token-789');
  });

  it('returns env var fallback when no tokens available', () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, DASHBOARD_COMPLIANCE_API_KEY: 'env-api-key' },
    });

    const request = makeRequest();

    expect(getToken(request)).toBe('env-api-key');
  });

  it('follows priority order: session > org > global > env', () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, DASHBOARD_COMPLIANCE_API_KEY: 'env-key' },
    });

    const request = makeRequest({
      session: { token: 'session-token' },
      _orgServiceToken: 'org-token',
      _serviceToken: 'global-token',
    });

    // Session token should win
    expect(getToken(request)).toBe('session-token');

    // Without session token, org token wins
    const requestNoSession = makeRequest({
      _orgServiceToken: 'org-token',
      _serviceToken: 'global-token',
    });
    expect(getToken(requestNoSession)).toBe('org-token');

    // Without org token, global token wins
    const requestGlobalOnly = makeRequest({
      _serviceToken: 'global-token',
    });
    expect(getToken(requestGlobalOnly)).toBe('global-token');

    // Without any token, env var wins
    const requestEnvOnly = makeRequest();
    expect(getToken(requestEnvOnly)).toBe('env-key');
  });

  it('returns empty string when no tokens and no env var', () => {
    const originalEnv = process.env['DASHBOARD_COMPLIANCE_API_KEY'];
    delete process.env['DASHBOARD_COMPLIANCE_API_KEY'];

    const request = makeRequest();
    expect(getToken(request)).toBe('');

    // Restore
    if (originalEnv !== undefined) {
      process.env['DASHBOARD_COMPLIANCE_API_KEY'] = originalEnv;
    }
  });
});

describe('getOrgId()', () => {
  it('returns currentOrgId from request.user', () => {
    const request = makeRequest({
      user: { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'org-42' },
    });

    expect(getOrgId(request)).toBe('org-42');
  });

  it('returns undefined when no user', () => {
    const request = makeRequest({ user: undefined });

    expect(getOrgId(request)).toBeUndefined();
  });

  it('returns undefined when user has no currentOrgId', () => {
    const request = makeRequest({
      user: { id: 'user-1', username: 'alice', role: 'admin' },
    });

    expect(getOrgId(request)).toBeUndefined();
  });
});
