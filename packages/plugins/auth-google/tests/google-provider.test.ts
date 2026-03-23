import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GoogleProvider, type UserInfo, type TokenResponse } from '../src/google-provider.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: '/auth/callback/auth-google',
} as const;

function fakeIdToken(
  claims: Record<string, unknown> = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'google-sub-123',
      email: 'alice@example.com',
      name: 'Alice Example',
      hd: 'example.com',
      ...claims,
    }),
  ).toString('base64url');
  const signature = 'fake-signature';
  return `${header}.${payload}.${signature}`;
}

function fakeTokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: 'fake-access-token',
    id_token: fakeIdToken(),
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'openid profile email',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleProvider', () => {
  let provider: GoogleProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleProvider(validConfig);
  });

  afterEach(() => {
    provider.destroy();
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // initialise / destroy
  // -----------------------------------------------------------------------

  describe('initialise', () => {
    it('marks provider as initialised', () => {
      expect(provider.isInitialised).toBe(false);
      provider.initialise();
      expect(provider.isInitialised).toBe(true);
    });
  });

  describe('destroy', () => {
    it('cleans up provider state', () => {
      provider.initialise();
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
      expect(() => provider.getAuthCodeUrl('/callback')).toThrow(
        'not been initialised',
      );
    });

    it('returns a Google OAuth authorization URL', () => {
      provider.initialise();
      const url = provider.getAuthCodeUrl('/callback');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=%2Fcallback');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=openid+profile+email');
      expect(url).toContain('access_type=offline');
    });

    it('includes hd parameter when hostedDomain is set', () => {
      const p = new GoogleProvider({ ...validConfig, hostedDomain: 'example.com' });
      p.initialise();
      const url = p.getAuthCodeUrl('/callback');

      expect(url).toContain('hd=example.com');
      p.destroy();
    });

    it('accepts custom scopes', () => {
      provider.initialise();
      const url = provider.getAuthCodeUrl('/callback', [
        'openid',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
      ]);

      expect(url).toContain('scope=openid');
      expect(url).toContain('admin.directory.group.readonly');
    });
  });

  // -----------------------------------------------------------------------
  // exchangeCode
  // -----------------------------------------------------------------------

  describe('exchangeCode', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.exchangeCode('code', '/callback'),
      ).rejects.toThrow('not been initialised');
    });

    it('exchanges auth code for tokens', async () => {
      const tokenResponse = fakeTokenResponse();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(tokenResponse),
        }),
      );

      provider.initialise();
      const result = await provider.exchangeCode('auth-code-123', '/callback');

      expect(result.access_token).toBe('fake-access-token');
      expect(result.id_token).toBeTruthy();
      expect(fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
    });

    it('throws when token exchange fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: vi.fn().mockResolvedValueOnce('invalid_grant'),
        }),
      );

      provider.initialise();
      await expect(
        provider.exchangeCode('bad-code', '/callback'),
      ).rejects.toThrow('Google token exchange failed: 400 Bad Request');
    });
  });

  // -----------------------------------------------------------------------
  // refreshAccessToken
  // -----------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.refreshAccessToken('refresh-token'),
      ).rejects.toThrow('not been initialised');
    });

    it('refreshes an access token', async () => {
      const tokenResponse = fakeTokenResponse({
        access_token: 'new-access-token',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce(tokenResponse),
        }),
      );

      provider.initialise();
      const result = await provider.refreshAccessToken('old-refresh-token');

      expect(result.access_token).toBe('new-access-token');
    });

    it('throws when refresh fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: vi.fn().mockResolvedValueOnce('token_revoked'),
        }),
      );

      provider.initialise();
      await expect(
        provider.refreshAccessToken('bad-token'),
      ).rejects.toThrow('Google token refresh failed: 401 Unauthorized');
    });
  });

  // -----------------------------------------------------------------------
  // fetchUserInfo
  // -----------------------------------------------------------------------

  describe('fetchUserInfo', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.fetchUserInfo('token'),
      ).rejects.toThrow('not been initialised');
    });

    it('fetches user info from Google userinfo endpoint', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            sub: 'google-sub-123',
            email: 'alice@example.com',
            name: 'Alice Example',
          }),
        }),
      );

      provider.initialise();
      const userInfo = await provider.fetchUserInfo('access-token');

      expect(userInfo).toEqual({
        id: 'google-sub-123',
        username: 'alice@example.com',
        email: 'alice@example.com',
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://openidconnect.googleapis.com/v1/userinfo',
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-token' },
        }),
      );
    });

    it('throws when userinfo request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        }),
      );

      provider.initialise();
      await expect(
        provider.fetchUserInfo('bad-token'),
      ).rejects.toThrow('Google userinfo request failed: 401 Unauthorized');
    });

    it('rejects users outside hosted domain', async () => {
      const p = new GoogleProvider({ ...validConfig, hostedDomain: 'corp.com' });
      p.initialise();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            sub: 'google-sub-123',
            email: 'alice@other.com',
            hd: 'other.com',
          }),
        }),
      );

      await expect(
        p.fetchUserInfo('access-token'),
      ).rejects.toThrow('does not belong to the required domain');

      p.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // extractUserInfoFromIdToken
  // -----------------------------------------------------------------------

  describe('extractUserInfoFromIdToken', () => {
    it('extracts user info from a valid JWT', () => {
      const idToken = fakeIdToken();
      provider.initialise();
      const userInfo = provider.extractUserInfoFromIdToken(idToken);

      expect(userInfo).toEqual({
        id: 'google-sub-123',
        username: 'alice@example.com',
        email: 'alice@example.com',
      });
    });

    it('throws on invalid JWT format', () => {
      provider.initialise();
      expect(() =>
        provider.extractUserInfoFromIdToken('not-a-jwt'),
      ).toThrow('Invalid JWT format');
    });

    it('falls back to name when email is absent', () => {
      const idToken = fakeIdToken({ email: undefined, name: 'Bob Test' });
      provider.initialise();
      const userInfo = provider.extractUserInfoFromIdToken(idToken);

      expect(userInfo.username).toBe('Bob Test');
      expect(userInfo.email).toBeUndefined();
    });

    it('rejects users outside hosted domain', () => {
      const p = new GoogleProvider({ ...validConfig, hostedDomain: 'corp.com' });
      p.initialise();

      const idToken = fakeIdToken({ hd: 'other.com' });
      expect(() =>
        p.extractUserInfoFromIdToken(idToken),
      ).toThrow('does not belong to the required domain');

      p.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // fetchGroups
  // -----------------------------------------------------------------------

  describe('fetchGroups', () => {
    it('returns group emails from Admin SDK', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            groups: [
              { id: 'g1', email: 'team-a@example.com', name: 'Team A' },
              { id: 'g2', email: 'team-b@example.com', name: 'Team B' },
            ],
          }),
        }),
      );

      provider.initialise();
      const groups = await provider.fetchGroups('access-token', 'alice@example.com');

      expect(groups).toEqual(['team-a@example.com', 'team-b@example.com']);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('admin.googleapis.com/admin/directory/v1/groups'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-token' },
        }),
      );
    });

    it('follows pagination via nextPageToken', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            groups: [{ id: 'g1', email: 'team-a@example.com' }],
            nextPageToken: 'page-2-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            groups: [{ id: 'g2', email: 'team-b@example.com' }],
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      provider.initialise();
      const groups = await provider.fetchGroups('access-token', 'alice@example.com');

      expect(groups).toEqual(['team-a@example.com', 'team-b@example.com']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when Admin Groups API fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }),
      );

      provider.initialise();
      await expect(
        provider.fetchGroups('access-token', 'alice@example.com'),
      ).rejects.toThrow('Google Admin Groups API failed: 403 Forbidden');
    });

    it('returns empty array when no groups exist', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({}),
        }),
      );

      provider.initialise();
      const groups = await provider.fetchGroups('access-token', 'alice@example.com');
      expect(groups).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getLogoutUrl
  // -----------------------------------------------------------------------

  describe('getLogoutUrl', () => {
    it('returns Google logout URL without redirect', () => {
      const url = provider.getLogoutUrl();
      expect(url).toBe('https://accounts.google.com/Logout');
    });

    it('returns Google logout URL with post-logout redirect', () => {
      const url = provider.getLogoutUrl('https://app.example.com');
      expect(url).toBe(
        'https://accounts.google.com/Logout?continue=https%3A%2F%2Fapp.example.com',
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkHealth
  // -----------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns true when OIDC discovery endpoint is reachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }),
      );

      const healthy = await provider.checkHealth();

      expect(healthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://accounts.google.com/.well-known/openid-configuration',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when OIDC discovery endpoint is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new Error('Network error')),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);
    });

    it('returns false when OIDC discovery endpoint returns non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);
    });
  });
});
