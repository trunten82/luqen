import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OktaProvider, type UserInfo, type TokenResponse } from '../src/okta-provider.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validConfig = {
  orgUrl: 'https://dev-123456.okta.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: '/auth/callback/auth-okta',
} as const;

const fakeDiscovery = {
  authorization_endpoint: 'https://dev-123456.okta.com/oauth2/v1/authorize',
  token_endpoint: 'https://dev-123456.okta.com/oauth2/v1/token',
  userinfo_endpoint: 'https://dev-123456.okta.com/oauth2/v1/userinfo',
  end_session_endpoint: 'https://dev-123456.okta.com/oauth2/v1/logout',
  issuer: 'https://dev-123456.okta.com',
};

function fakeTokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: 'fake-access-token',
    id_token: buildFakeJwt({
      sub: 'user-123',
      preferred_username: 'alice@example.com',
      email: 'alice@example.com',
      groups: ['Developers', 'Admins'],
    }),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid profile email groups',
    ...overrides,
  };
}

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

function mockDiscoveryFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OktaProvider', () => {
  let provider: OktaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OktaProvider(validConfig);
  });

  afterEach(() => {
    provider.destroy();
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // initialise / destroy
  // -----------------------------------------------------------------------

  describe('initialise', () => {
    it('fetches discovery document and marks provider as initialised', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());

      expect(provider.isInitialised).toBe(false);
      await provider.initialise();
      expect(provider.isInitialised).toBe(true);
    });

    it('throws when discovery endpoint returns non-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' }),
      );

      await expect(provider.initialise()).rejects.toThrow('Failed to fetch OIDC discovery');
    });
  });

  describe('destroy', () => {
    it('cleans up provider state', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();
      expect(provider.isInitialised).toBe(true);

      provider.destroy();
      expect(provider.isInitialised).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getAuthCodeUrl
  // -----------------------------------------------------------------------

  describe('getAuthCodeUrl', () => {
    it('throws when provider is not initialised', () => {
      expect(() => provider.getAuthCodeUrl('/callback')).toThrow('not been initialised');
    });

    it('returns authorization URL with required params', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getAuthCodeUrl('/callback');

      expect(url).toContain(fakeDiscovery.authorization_endpoint);
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('redirect_uri=%2Fcallback');
      expect(url).toContain('scope=openid+profile+email+groups');
    });

    it('accepts custom scopes', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getAuthCodeUrl('/callback', ['openid', 'profile']);

      expect(url).toContain('scope=openid+profile');
      expect(url).not.toContain('groups');
    });

    it('uses provided state parameter', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getAuthCodeUrl('/callback', undefined, 'custom-state');

      expect(url).toContain('state=custom-state');
    });
  });

  // -----------------------------------------------------------------------
  // acquireTokenByCode
  // -----------------------------------------------------------------------

  describe('acquireTokenByCode', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.acquireTokenByCode('code', '/callback'),
      ).rejects.toThrow('not been initialised');
    });

    it('exchanges auth code for tokens', async () => {
      const tokenRes = fakeTokenResponse();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(tokenRes),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      const result = await provider.acquireTokenByCode('auth-code-123', '/callback');

      expect(result.access_token).toBe('fake-access-token');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify the token endpoint call
      const tokenCall = fetchMock.mock.calls[1];
      expect(tokenCall[0]).toBe(fakeDiscovery.token_endpoint);
      expect(tokenCall[1].method).toBe('POST');
      expect(tokenCall[1].headers['Authorization']).toContain('Basic');
    });

    it('throws when token endpoint returns non-ok', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: vi.fn().mockResolvedValueOnce('invalid_grant'),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      await expect(
        provider.acquireTokenByCode('bad-code', '/callback'),
      ).rejects.toThrow('Token exchange failed: 400 Bad Request');
    });
  });

  // -----------------------------------------------------------------------
  // refreshToken
  // -----------------------------------------------------------------------

  describe('refreshToken', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.refreshToken('refresh-token'),
      ).rejects.toThrow('not been initialised');
    });

    it('exchanges refresh token for new tokens', async () => {
      const tokenRes = fakeTokenResponse();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(tokenRes),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      const result = await provider.refreshToken('old-refresh-token');

      expect(result.access_token).toBe('fake-access-token');

      const tokenCall = fetchMock.mock.calls[1];
      expect(tokenCall[1].body).toContain('grant_type=refresh_token');
      expect(tokenCall[1].body).toContain('refresh_token=old-refresh-token');
    });

    it('throws when refresh endpoint returns non-ok', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: vi.fn().mockResolvedValueOnce('invalid_token'),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      await expect(
        provider.refreshToken('expired-refresh-token'),
      ).rejects.toThrow('Token refresh failed: 401 Unauthorized');
    });
  });

  // -----------------------------------------------------------------------
  // fetchUserInfo
  // -----------------------------------------------------------------------

  describe('fetchUserInfo', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.fetchUserInfo('access-token'),
      ).rejects.toThrow('not been initialised');
    });

    it('fetches user info from userinfo endpoint', async () => {
      const userInfoResponse = {
        sub: 'user-123',
        preferred_username: 'alice@example.com',
        email: 'alice@example.com',
        groups: ['Developers', 'Admins'],
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(userInfoResponse),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      const userInfo = await provider.fetchUserInfo('access-token');

      expect(userInfo).toEqual({
        id: 'user-123',
        username: 'alice@example.com',
        email: 'alice@example.com',
        groups: ['Developers', 'Admins'],
      });

      const userinfoCall = fetchMock.mock.calls[1];
      expect(userinfoCall[0]).toBe(fakeDiscovery.userinfo_endpoint);
      expect(userinfoCall[1].headers.Authorization).toBe('Bearer access-token');
    });

    it('throws when userinfo endpoint returns non-ok', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      await expect(
        provider.fetchUserInfo('bad-token'),
      ).rejects.toThrow('UserInfo request failed: 401 Unauthorized');
    });

    it('handles missing optional fields gracefully', async () => {
      const userInfoResponse = {
        sub: 'user-456',
        email: 'bob@example.com',
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(fakeDiscovery),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(userInfoResponse),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialise();
      const userInfo = await provider.fetchUserInfo('access-token');

      expect(userInfo.id).toBe('user-456');
      expect(userInfo.username).toBe('bob@example.com');
      expect(userInfo.groups).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // extractUserInfoFromIdToken
  // -----------------------------------------------------------------------

  describe('extractUserInfoFromIdToken', () => {
    it('extracts user info from a JWT ID token', () => {
      const idToken = buildFakeJwt({
        sub: 'user-123',
        preferred_username: 'alice@example.com',
        email: 'alice@example.com',
        groups: ['Developers', 'Admins'],
      });

      const userInfo = provider.extractUserInfoFromIdToken(idToken);

      expect(userInfo).toEqual({
        id: 'user-123',
        username: 'alice@example.com',
        email: 'alice@example.com',
        groups: ['Developers', 'Admins'],
      });
    });

    it('throws on invalid JWT format', () => {
      expect(() => provider.extractUserInfoFromIdToken('not-a-jwt')).toThrow(
        'Invalid JWT format',
      );
    });

    it('uses custom group claim name', () => {
      const idToken = buildFakeJwt({
        sub: 'user-123',
        preferred_username: 'alice@example.com',
        myGroups: ['TeamA'],
      });

      const userInfo = provider.extractUserInfoFromIdToken(idToken, 'myGroups');

      expect(userInfo.groups).toEqual(['TeamA']);
    });

    it('falls back to email when preferred_username is missing', () => {
      const idToken = buildFakeJwt({
        sub: 'user-123',
        email: 'bob@example.com',
      });

      const userInfo = provider.extractUserInfoFromIdToken(idToken);

      expect(userInfo.username).toBe('bob@example.com');
    });

    it('returns undefined groups when group claim is not an array', () => {
      const idToken = buildFakeJwt({
        sub: 'user-123',
        preferred_username: 'alice@example.com',
      });

      const userInfo = provider.extractUserInfoFromIdToken(idToken);

      expect(userInfo.groups).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getLogoutUrl
  // -----------------------------------------------------------------------

  describe('getLogoutUrl', () => {
    it('throws when provider is not initialised', () => {
      expect(() => provider.getLogoutUrl()).toThrow('not been initialised');
    });

    it('returns logout URL without params', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getLogoutUrl();
      expect(url).toBe(fakeDiscovery.end_session_endpoint);
    });

    it('returns logout URL with id_token_hint', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getLogoutUrl('my-id-token');
      expect(url).toContain('id_token_hint=my-id-token');
    });

    it('returns logout URL with post-logout redirect', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getLogoutUrl(undefined, 'https://app.example.com');
      expect(url).toContain(
        'post_logout_redirect_uri=https%3A%2F%2Fapp.example.com',
      );
    });

    it('returns logout URL with both params', async () => {
      vi.stubGlobal('fetch', mockDiscoveryFetch());
      await provider.initialise();

      const url = provider.getLogoutUrl('my-id-token', 'https://app.example.com');
      expect(url).toContain('id_token_hint=my-id-token');
      expect(url).toContain('post_logout_redirect_uri=https%3A%2F%2Fapp.example.com');
    });
  });

  // -----------------------------------------------------------------------
  // checkHealth
  // -----------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns true when discovery endpoint is reachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        `${validConfig.orgUrl}/.well-known/openid-configuration`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when discovery endpoint is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new Error('Network error')),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);
    });

    it('returns false when discovery endpoint returns non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);
    });
  });
});
