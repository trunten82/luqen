import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthenticationResult } from '@azure/msal-node';

// ---------------------------------------------------------------------------
// Mock @azure/msal-node
// ---------------------------------------------------------------------------

const mockGetAuthCodeUrl = vi.fn();
const mockAcquireTokenByCode = vi.fn();
const mockAcquireTokenSilent = vi.fn();
const mockGetTokenCache = vi.fn();

vi.mock('@azure/msal-node', () => {
  return {
    ConfidentialClientApplication: class MockConfidentialClientApplication {
      constructor() {
        // no-op
      }
      getAuthCodeUrl = mockGetAuthCodeUrl;
      acquireTokenByCode = mockAcquireTokenByCode;
      acquireTokenSilent = mockAcquireTokenSilent;
      getTokenCache = mockGetTokenCache;
    },
  };
});

// Import after mock is defined
import { EntraProvider, type UserInfo } from '../src/entra-provider.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validConfig = {
  tenantId: 'test-tenant-id',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: '/auth/callback/auth-entra',
} as const;

function fakeAuthResult(overrides: Partial<AuthenticationResult> = {}): AuthenticationResult {
  return {
    authority: `https://login.microsoftonline.com/${validConfig.tenantId}`,
    uniqueId: 'unique-123',
    tenantId: validConfig.tenantId,
    scopes: ['openid', 'profile', 'email'],
    account: {
      homeAccountId: 'home-abc',
      environment: 'login.microsoftonline.com',
      tenantId: validConfig.tenantId,
      username: 'alice@contoso.com',
      localAccountId: 'local-123',
    },
    idToken: 'fake-id-token',
    idTokenClaims: {
      oid: 'oid-456',
      preferred_username: 'alice@contoso.com',
      email: 'alice@contoso.com',
      groups: ['group-a', 'group-b'],
    },
    accessToken: 'fake-access-token',
    fromCache: false,
    expiresOn: new Date(Date.now() + 3600_000),
    tokenType: 'Bearer',
    correlationId: 'corr-789',
    ...overrides,
  } as AuthenticationResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntraProvider', () => {
  let provider: EntraProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EntraProvider(validConfig);
  });

  afterEach(() => {
    provider.destroy();
  });

  // -----------------------------------------------------------------------
  // initialise / destroy
  // -----------------------------------------------------------------------

  describe('initialise', () => {
    it('creates MSAL client and marks provider as initialised', () => {
      expect(provider.isInitialised).toBe(false);
      provider.initialise();
      expect(provider.isInitialised).toBe(true);
    });
  });

  describe('destroy', () => {
    it('cleans up MSAL client', () => {
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
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.getAuthCodeUrl('/callback'),
      ).rejects.toThrow('not been initialised');
    });

    it('returns URL from MSAL client', async () => {
      const expectedUrl =
        `https://login.microsoftonline.com/${validConfig.tenantId}/oauth2/v2.0/authorize?client_id=${validConfig.clientId}`;
      mockGetAuthCodeUrl.mockResolvedValueOnce(expectedUrl);

      provider.initialise();
      const url = await provider.getAuthCodeUrl('/callback');

      expect(url).toBe(expectedUrl);
      expect(mockGetAuthCodeUrl).toHaveBeenCalledWith({
        redirectUri: '/callback',
        scopes: ['openid', 'profile', 'email'],
      });
    });

    it('accepts custom scopes', async () => {
      mockGetAuthCodeUrl.mockResolvedValueOnce('https://example.com/auth');
      provider.initialise();
      await provider.getAuthCodeUrl('/callback', ['openid', 'User.Read']);

      expect(mockGetAuthCodeUrl).toHaveBeenCalledWith({
        redirectUri: '/callback',
        scopes: ['openid', 'User.Read'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // acquireTokenByCode
  // -----------------------------------------------------------------------

  describe('acquireTokenByCode', () => {
    it('exchanges auth code for tokens', async () => {
      const authResult = fakeAuthResult();
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      provider.initialise();
      const result = await provider.acquireTokenByCode('auth-code-123', '/callback');

      expect(result).toBe(authResult);
      expect(mockAcquireTokenByCode).toHaveBeenCalledWith({
        code: 'auth-code-123',
        redirectUri: '/callback',
        scopes: ['openid', 'profile', 'email'],
      });
    });

    it('throws when token acquisition returns null', async () => {
      mockAcquireTokenByCode.mockResolvedValueOnce(null);

      provider.initialise();
      await expect(
        provider.acquireTokenByCode('auth-code-123', '/callback'),
      ).rejects.toThrow('Token acquisition returned null');
    });
  });

  // -----------------------------------------------------------------------
  // extractUserInfo
  // -----------------------------------------------------------------------

  describe('extractUserInfo', () => {
    it('maps MSAL AuthenticationResult to UserInfo', () => {
      const authResult = fakeAuthResult();
      const userInfo: UserInfo = provider.extractUserInfo(authResult);

      expect(userInfo).toEqual({
        id: 'oid-456',
        username: 'alice@contoso.com',
        email: 'alice@contoso.com',
        groups: ['group-a', 'group-b'],
      });
    });

    it('falls back to sub claim when oid is missing', () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          sub: 'sub-789',
          preferred_username: 'bob@contoso.com',
        } as Record<string, unknown>,
      });
      const userInfo = provider.extractUserInfo(authResult);

      expect(userInfo.id).toBe('sub-789');
      expect(userInfo.username).toBe('bob@contoso.com');
    });

    it('falls back to uniqueId when both oid and sub are missing', () => {
      const authResult = fakeAuthResult({
        uniqueId: 'unique-fallback',
        idTokenClaims: {} as Record<string, unknown>,
      });
      const userInfo = provider.extractUserInfo(authResult);

      expect(userInfo.id).toBe('unique-fallback');
    });

    it('returns undefined groups when claims have no groups array', () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          oid: 'oid-456',
          preferred_username: 'alice@contoso.com',
        } as Record<string, unknown>,
      });
      const userInfo = provider.extractUserInfo(authResult);

      expect(userInfo.groups).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getLogoutUrl
  // -----------------------------------------------------------------------

  describe('getLogoutUrl', () => {
    it('returns Entra logout URL without redirect', () => {
      const url = provider.getLogoutUrl();
      expect(url).toBe(
        `https://login.microsoftonline.com/${validConfig.tenantId}/oauth2/v2.0/logout`,
      );
    });

    it('returns Entra logout URL with post-logout redirect', () => {
      const url = provider.getLogoutUrl('https://app.example.com');
      expect(url).toBe(
        `https://login.microsoftonline.com/${validConfig.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=https%3A%2F%2Fapp.example.com`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkHealth
  // -----------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns true when metadata endpoint is reachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }),
      );

      const healthy = await provider.checkHealth();

      expect(healthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        `https://login.microsoftonline.com/${validConfig.tenantId}/v2.0/.well-known/openid-configuration`,
        expect.objectContaining({ method: 'GET' }),
      );

      vi.unstubAllGlobals();
    });

    it('returns false when metadata endpoint is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new Error('Network error')),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);

      vi.unstubAllGlobals();
    });

    it('returns false when metadata endpoint returns non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }),
      );

      const healthy = await provider.checkHealth();
      expect(healthy).toBe(false);

      vi.unstubAllGlobals();
    });
  });

  // -----------------------------------------------------------------------
  // acquireTokenSilent
  // -----------------------------------------------------------------------

  describe('acquireTokenSilent', () => {
    it('throws when no cached account is found', async () => {
      mockGetTokenCache.mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValueOnce([]),
      });

      provider.initialise();
      await expect(
        provider.acquireTokenSilent('unknown-home-id'),
      ).rejects.toThrow('No cached account found');
    });

    it('returns tokens on successful silent refresh', async () => {
      const account = {
        homeAccountId: 'home-abc',
        environment: 'login.microsoftonline.com',
        tenantId: validConfig.tenantId,
        username: 'alice@contoso.com',
        localAccountId: 'local-123',
      };
      mockGetTokenCache.mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValueOnce([account]),
      });
      const authResult = fakeAuthResult();
      mockAcquireTokenSilent.mockResolvedValueOnce(authResult);

      provider.initialise();
      const result = await provider.acquireTokenSilent('home-abc');

      expect(result).toBe(authResult);
    });

    it('throws when silent acquisition returns null', async () => {
      const account = {
        homeAccountId: 'home-abc',
        environment: 'login.microsoftonline.com',
        tenantId: validConfig.tenantId,
        username: 'alice@contoso.com',
        localAccountId: 'local-123',
      };
      mockGetTokenCache.mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValueOnce([account]),
      });
      mockAcquireTokenSilent.mockResolvedValueOnce(null);

      provider.initialise();
      await expect(
        provider.acquireTokenSilent('home-abc'),
      ).rejects.toThrow('Silent token acquisition returned null');
    });

    it('throws when provider is not initialised', async () => {
      await expect(
        provider.acquireTokenSilent('home-abc'),
      ).rejects.toThrow('not been initialised');
    });
  });

  // -----------------------------------------------------------------------
  // acquireTokenByCode — additional cases
  // -----------------------------------------------------------------------

  describe('acquireTokenByCode — additional', () => {
    it('throws when provider is not initialised', async () => {
      await expect(
        provider.acquireTokenByCode('code', '/callback'),
      ).rejects.toThrow('not been initialised');
    });

    it('accepts custom scopes', async () => {
      const authResult = fakeAuthResult();
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      provider.initialise();
      await provider.acquireTokenByCode('code-abc', '/callback', ['openid', 'User.Read']);

      expect(mockAcquireTokenByCode).toHaveBeenCalledWith({
        code: 'code-abc',
        redirectUri: '/callback',
        scopes: ['openid', 'User.Read'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // extractUserInfo — additional edge cases
  // -----------------------------------------------------------------------

  describe('extractUserInfo — additional', () => {
    it('falls back to account username when claims have no preferred_username', () => {
      const authResult = fakeAuthResult({
        account: {
          homeAccountId: 'home-abc',
          environment: 'login.microsoftonline.com',
          tenantId: validConfig.tenantId,
          username: 'fallback-user@contoso.com',
          localAccountId: 'local-123',
        },
        idTokenClaims: {
          oid: 'oid-456',
        } as Record<string, unknown>,
      });
      const userInfo = provider.extractUserInfo(authResult);

      expect(userInfo.username).toBe('fallback-user@contoso.com');
    });

    it('returns empty strings when no identifying claims exist', () => {
      const authResult = fakeAuthResult({
        uniqueId: '',
        account: null as unknown as typeof authResult.account,
        idTokenClaims: undefined as unknown as Record<string, unknown>,
      });
      const userInfo = provider.extractUserInfo(authResult);

      expect(userInfo.id).toBe('');
      expect(userInfo.username).toBe('');
      expect(userInfo.email).toBeUndefined();
      expect(userInfo.groups).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // fetchGroupsFromGraph
  // -----------------------------------------------------------------------

  describe('fetchGroupsFromGraph', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns group IDs from Graph API response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [
              { id: 'group-1', '@odata.type': '#microsoft.graph.group' },
              { id: 'group-2', '@odata.type': '#microsoft.graph.group' },
            ],
          }),
        }),
      );

      const groups = await provider.fetchGroupsFromGraph('access-token');
      expect(groups).toEqual(['group-1', 'group-2']);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('graph.microsoft.com/v1.0/me/memberOf'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-token' },
        }),
      );
    });

    it('follows pagination via @odata.nextLink', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [{ id: 'group-1', '@odata.type': '#microsoft.graph.group' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=page2',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [{ id: 'group-2' }],
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const groups = await provider.fetchGroupsFromGraph('access-token');
      expect(groups).toEqual(['group-1', 'group-2']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('filters out non-group entries (e.g. directoryRole)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [
              { id: 'group-1', '@odata.type': '#microsoft.graph.group' },
              { id: 'role-1', '@odata.type': '#microsoft.graph.directoryRole' },
              { id: 'group-2' }, // undefined @odata.type => included
            ],
          }),
        }),
      );

      const groups = await provider.fetchGroupsFromGraph('access-token');
      expect(groups).toEqual(['group-1', 'group-2']);
    });

    it('throws when Graph API returns non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }),
      );

      await expect(
        provider.fetchGroupsFromGraph('access-token'),
      ).rejects.toThrow('Graph API /me/memberOf failed: 403 Forbidden');
    });

    it('returns empty array when Graph API returns no groups', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [],
          }),
        }),
      );

      const groups = await provider.fetchGroupsFromGraph('access-token');
      expect(groups).toEqual([]);
    });
  });
});
