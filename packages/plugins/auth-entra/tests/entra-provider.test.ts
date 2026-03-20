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
  });
});

// ---------------------------------------------------------------------------
// Plugin factory (index.ts) tests
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(
    JSON.stringify({
      name: 'auth-entra',
      displayName: 'Azure Entra ID',
      type: 'auth',
      version: '1.0.0',
      description: 'Single sign-on via Azure Entra ID (formerly Azure AD)',
      configSchema: [
        { key: 'tenantId', label: 'Tenant ID', type: 'string', required: true },
        { key: 'clientId', label: 'Application (Client) ID', type: 'string', required: true },
        { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
        { key: 'redirectUri', label: 'Redirect URI', type: 'string', default: '/auth/callback/auth-entra' },
      ],
    }),
  ),
}));

describe('createPlugin (index.ts)', () => {
  // Dynamic import after mock
  let createPlugin: () => ReturnType<typeof import('../src/index.js')['default']>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/index.js');
    createPlugin = mod.default as unknown as typeof createPlugin;
  });

  it('returns a plugin with the correct manifest', () => {
    const plugin = createPlugin();
    expect(plugin.manifest.name).toBe('auth-entra');
    expect(plugin.manifest.type).toBe('auth');
    expect(plugin.manifest.displayName).toBe('Azure Entra ID');
  });

  it('activate throws on missing tenantId', async () => {
    const plugin = createPlugin();
    await expect(
      plugin.activate({ clientId: 'c', clientSecret: 's' }),
    ).rejects.toThrow('Missing required config: tenantId');
  });

  it('activate throws on missing clientId', async () => {
    const plugin = createPlugin();
    await expect(
      plugin.activate({ tenantId: 't', clientSecret: 's' }),
    ).rejects.toThrow('Missing required config: clientId');
  });

  it('activate throws on missing clientSecret', async () => {
    const plugin = createPlugin();
    await expect(
      plugin.activate({ tenantId: 't', clientId: 'c' }),
    ).rejects.toThrow('Missing required config: clientSecret');
  });

  it('activate succeeds with valid config', async () => {
    const plugin = createPlugin();
    await expect(
      plugin.activate({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      }),
    ).resolves.toBeUndefined();
  });

  it('deactivate succeeds even when not activated', async () => {
    const plugin = createPlugin();
    await expect(plugin.deactivate()).resolves.toBeUndefined();
  });

  it('getLoginUrl throws when not activated', async () => {
    const plugin = createPlugin();
    await expect(plugin.getLoginUrl()).rejects.toThrow('not been activated');
  });

  it('getLogoutUrl returns Entra logout URL after activation', async () => {
    const plugin = createPlugin();
    await plugin.activate({
      tenantId: 'my-tenant',
      clientId: 'my-client',
      clientSecret: 'my-secret',
    });

    const url = await plugin.getLogoutUrl('https://app.test');
    expect(url).toContain('login.microsoftonline.com/my-tenant');
    expect(url).toContain('logout');
    expect(url).toContain('post_logout_redirect_uri');
  });

  it('authenticate returns not-authenticated when no bearer token', async () => {
    const plugin = createPlugin();
    await plugin.activate({
      tenantId: 'my-tenant',
      clientId: 'my-client',
      clientSecret: 'my-secret',
    });

    const result = await plugin.authenticate({
      headers: {},
      query: {},
    });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('No bearer token');
  });

  it('getUserInfo decodes JWT claims', async () => {
    const plugin = createPlugin();
    // Build a fake JWT
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        oid: 'user-oid-123',
        preferred_username: 'test@example.com',
        email: 'test@example.com',
        groups: ['admins'],
      }),
    ).toString('base64url');
    const signature = 'fake-signature';
    const token = `${header}.${payload}.${signature}`;

    const userInfo = await plugin.getUserInfo(token);
    expect(userInfo.id).toBe('user-oid-123');
    expect(userInfo.username).toBe('test@example.com');
    expect(userInfo.email).toBe('test@example.com');
    expect(userInfo.groups).toEqual(['admins']);
  });

  it('getUserInfo throws on invalid JWT format', async () => {
    const plugin = createPlugin();
    await expect(plugin.getUserInfo('not-a-jwt')).rejects.toThrow('Invalid JWT format');
  });
});
