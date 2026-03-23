import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// ---------------------------------------------------------------------------
// Mock node:fs to avoid reading actual manifest from disk
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(
    JSON.stringify({
      name: 'auth-entra',
      displayName: 'Azure Entra ID',
      type: 'auth',
      version: '1.1.0',
      description: 'Single sign-on via Azure Entra ID (formerly Azure AD) with IdP group-to-team sync',
      configSchema: [
        { key: 'tenantId', label: 'Tenant ID', type: 'string', required: true },
        { key: 'clientId', label: 'Application (Client) ID', type: 'string', required: true },
        { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
        { key: 'redirectUri', label: 'Redirect URI', type: 'string', default: '/auth/callback/auth-entra' },
        { key: 'groupClaimName', label: 'Group Claim Name', type: 'string', default: 'groups' },
      ],
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import createPlugin from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validConfig = {
  tenantId: 'test-tenant',
  clientId: 'test-client',
  clientSecret: 'test-secret',
} as const;

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

function fakeAuthResult(overrides: Record<string, unknown> = {}) {
  return {
    authority: 'https://login.microsoftonline.com/test-tenant',
    uniqueId: 'unique-123',
    tenantId: 'test-tenant',
    scopes: ['openid', 'profile', 'email'],
    account: {
      homeAccountId: 'home-abc',
      environment: 'login.microsoftonline.com',
      tenantId: 'test-tenant',
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPlugin (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // manifest
  // -----------------------------------------------------------------------

  describe('manifest', () => {
    it('returns a plugin with the correct manifest', () => {
      const plugin = createPlugin();
      expect(plugin.manifest.name).toBe('auth-entra');
      expect(plugin.manifest.type).toBe('auth');
      expect(plugin.manifest.displayName).toBe('Azure Entra ID');
      expect(plugin.manifest.version).toBe('1.1.0');
    });
  });

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------

  describe('activate', () => {
    it('throws on missing tenantId', async () => {
      const plugin = createPlugin();
      await expect(
        plugin.activate({ clientId: 'c', clientSecret: 's' }),
      ).rejects.toThrow('Missing required config: tenantId');
    });

    it('throws on missing clientId', async () => {
      const plugin = createPlugin();
      await expect(
        plugin.activate({ tenantId: 't', clientSecret: 's' }),
      ).rejects.toThrow('Missing required config: clientId');
    });

    it('throws on missing clientSecret', async () => {
      const plugin = createPlugin();
      await expect(
        plugin.activate({ tenantId: 't', clientId: 'c' }),
      ).rejects.toThrow('Missing required config: clientSecret');
    });

    it('succeeds with valid config', async () => {
      const plugin = createPlugin();
      await expect(plugin.activate(validConfig)).resolves.toBeUndefined();
    });

    it('uses custom redirectUri from config', async () => {
      const plugin = createPlugin();
      await plugin.activate({ ...validConfig, redirectUri: '/custom/callback' });

      mockGetAuthCodeUrl.mockResolvedValueOnce('https://login.microsoftonline.com/auth');
      const url = await plugin.getLoginUrl();

      expect(mockGetAuthCodeUrl).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUri: '/custom/callback' }),
      );
      expect(typeof url).toBe('string');
    });

    it('uses custom groupClaimName from config', async () => {
      const plugin = createPlugin();
      await plugin.activate({ ...validConfig, groupClaimName: 'roles' });

      // getUserInfo should use the custom claim name
      const token = makeJwt({
        oid: 'user-1',
        preferred_username: 'user@test.com',
        roles: ['admin', 'editor'],
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.groups).toEqual(['admin', 'editor']);
    });

    it('defaults groupClaimName to "groups" when not provided', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const token = makeJwt({
        oid: 'user-1',
        preferred_username: 'user@test.com',
        groups: ['team-a'],
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.groups).toEqual(['team-a']);
    });
  });

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------

  describe('deactivate', () => {
    it('succeeds even when not activated', async () => {
      const plugin = createPlugin();
      await expect(plugin.deactivate()).resolves.toBeUndefined();
    });

    it('cleans up provider after activation', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);
      await plugin.deactivate();

      // After deactivation, methods requiring provider should throw
      await expect(plugin.getLoginUrl()).rejects.toThrow('not been activated');
    });
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  describe('healthCheck', () => {
    it('returns false when not activated', async () => {
      const plugin = createPlugin();
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(false);
    });

    it('returns true when provider health check succeeds', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }),
      );

      const plugin = createPlugin();
      await plugin.activate(validConfig);
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(true);
    });

    it('returns false when provider health check fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new Error('Network error')),
      );

      const plugin = createPlugin();
      await plugin.activate(validConfig);
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // authenticate
  // -----------------------------------------------------------------------

  describe('authenticate', () => {
    it('returns not-authenticated when no authorization header', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.authenticate({
        headers: {},
        query: {},
      });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('No bearer token');
    });

    it('returns not-authenticated when authorization header is not Bearer', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.authenticate({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
        query: {},
      });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('No bearer token');
    });

    it('returns not-authenticated when authorization header is an array', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.authenticate({
        headers: { authorization: ['Bearer token1', 'Bearer token2'] as unknown as string },
        query: {},
      });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('No bearer token');
    });

    it('returns authenticated user from valid JWT bearer token', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const token = makeJwt({
        oid: 'user-oid-123',
        preferred_username: 'alice@contoso.com',
        email: 'alice@contoso.com',
      });

      const result = await plugin.authenticate({
        headers: { authorization: `Bearer ${token}` },
        query: {},
      });

      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual({
        id: 'user-oid-123',
        username: 'alice@contoso.com',
        email: 'alice@contoso.com',
      });
      expect(result.token).toBe(token);
    });

    it('returns not-authenticated on invalid JWT in bearer token', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.authenticate({
        headers: { authorization: 'Bearer not-a-valid-jwt' },
        query: {},
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid JWT format');
    });

    it('returns error message from non-Error thrown object', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      // A token with invalid base64url in payload to trigger a parse error
      const token = makeJwt({ oid: 'test' });
      // Corrupt the payload section
      const parts = token.split('.');
      parts[1] = '!!!invalid-base64!!!';
      const badToken = parts.join('.');

      const result = await plugin.authenticate({
        headers: { authorization: `Bearer ${badToken}` },
        query: {},
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // getLoginUrl
  // -----------------------------------------------------------------------

  describe('getLoginUrl', () => {
    it('throws when not activated', async () => {
      const plugin = createPlugin();
      await expect(plugin.getLoginUrl()).rejects.toThrow('not been activated');
    });

    it('returns URL from MSAL provider', async () => {
      mockGetAuthCodeUrl.mockResolvedValueOnce('https://login.microsoftonline.com/auth?code=xyz');

      const plugin = createPlugin();
      await plugin.activate(validConfig);
      const url = await plugin.getLoginUrl();

      expect(url).toBe('https://login.microsoftonline.com/auth?code=xyz');
    });
  });

  // -----------------------------------------------------------------------
  // handleCallback
  // -----------------------------------------------------------------------

  describe('handleCallback', () => {
    it('throws when not activated', async () => {
      const plugin = createPlugin();
      await expect(
        plugin.handleCallback({ headers: {}, query: { code: 'abc' } }),
      ).rejects.toThrow('not been activated');
    });

    it('returns error when code is missing', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: {},
      });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Missing authorization code');
    });

    it('returns authenticated user on successful code exchange', async () => {
      const authResult = fakeAuthResult();
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'auth-code-123' },
      });

      expect(result.authenticated).toBe(true);
      expect(result.user).toEqual({
        id: 'oid-456',
        username: 'alice@contoso.com',
        email: 'alice@contoso.com',
      });
      expect(result.token).toBe('fake-access-token');
      expect(result.groups).toEqual(['group-a', 'group-b']);
    });

    it('returns groups from ID token claims', async () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          oid: 'oid-123',
          preferred_username: 'bob@contoso.com',
          groups: ['admins', 'developers'],
        },
      });
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'code-abc' },
      });

      expect(result.groups).toEqual(['admins', 'developers']);
    });

    it('fetches groups from Graph API when overage indicator (_claim_names) is present', async () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          oid: 'oid-123',
          preferred_username: 'bob@contoso.com',
          _claim_names: { groups: 'src1' },
          _claim_sources: { src1: { endpoint: 'https://graph.microsoft.com/...' } },
        },
      });
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      // Mock the Graph API call
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValueOnce({
            value: [
              { id: 'graph-group-1', '@odata.type': '#microsoft.graph.group' },
              { id: 'graph-group-2', '@odata.type': '#microsoft.graph.group' },
            ],
          }),
        }),
      );

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'code-overage' },
      });

      expect(result.groups).toEqual(['graph-group-1', 'graph-group-2']);
    });

    it('proceeds without groups when Graph API call fails on overage', async () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          oid: 'oid-123',
          preferred_username: 'bob@contoso.com',
          _claim_names: { groups: 'src1' },
        },
      });
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      // Mock the Graph API call to fail
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }),
      );

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'code-overage' },
      });

      expect(result.authenticated).toBe(true);
      expect(result.groups).toBeUndefined();
    });

    it('returns no groups when claims have neither groups nor _claim_names', async () => {
      const authResult = fakeAuthResult({
        idTokenClaims: {
          oid: 'oid-123',
          preferred_username: 'bob@contoso.com',
        },
      });
      mockAcquireTokenByCode.mockResolvedValueOnce(authResult);

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'code-no-groups' },
      });

      expect(result.authenticated).toBe(true);
      expect(result.groups).toBeUndefined();
    });

    it('returns error when token exchange fails', async () => {
      mockAcquireTokenByCode.mockRejectedValueOnce(new Error('Token exchange failed'));

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'bad-code' },
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Token exchange failed');
    });

    it('returns generic error message for non-Error thrown object', async () => {
      mockAcquireTokenByCode.mockRejectedValueOnce('string-error');

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const result = await plugin.handleCallback({
        headers: {},
        query: { code: 'bad-code' },
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Callback handling failed');
    });
  });

  // -----------------------------------------------------------------------
  // getUserInfo
  // -----------------------------------------------------------------------

  describe('getUserInfo', () => {
    it('decodes JWT claims correctly', async () => {
      const plugin = createPlugin();
      const token = makeJwt({
        oid: 'user-oid-123',
        preferred_username: 'test@example.com',
        email: 'test@example.com',
        groups: ['admins'],
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.id).toBe('user-oid-123');
      expect(userInfo.username).toBe('test@example.com');
      expect(userInfo.email).toBe('test@example.com');
      expect(userInfo.groups).toEqual(['admins']);
    });

    it('throws on invalid JWT format (not 3 parts)', async () => {
      const plugin = createPlugin();
      await expect(plugin.getUserInfo('not-a-jwt')).rejects.toThrow('Invalid JWT format');
    });

    it('throws on JWT with only 2 parts', async () => {
      const plugin = createPlugin();
      await expect(plugin.getUserInfo('part1.part2')).rejects.toThrow('Invalid JWT format');
    });

    it('falls back to sub claim when oid is missing', async () => {
      const plugin = createPlugin();
      const token = makeJwt({
        sub: 'sub-abc',
        preferred_username: 'user@test.com',
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.id).toBe('sub-abc');
    });

    it('returns empty id when both oid and sub are missing', async () => {
      const plugin = createPlugin();
      const token = makeJwt({
        preferred_username: 'user@test.com',
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.id).toBe('');
    });

    it('returns empty username when preferred_username is missing', async () => {
      const plugin = createPlugin();
      const token = makeJwt({ oid: 'user-1' });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.username).toBe('');
    });

    it('returns undefined email when not in claims', async () => {
      const plugin = createPlugin();
      const token = makeJwt({ oid: 'user-1', preferred_username: 'user' });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.email).toBeUndefined();
    });

    it('returns undefined groups when claim is not an array', async () => {
      const plugin = createPlugin();
      const token = makeJwt({
        oid: 'user-1',
        preferred_username: 'user',
        groups: 'not-an-array',
      });

      const userInfo = await plugin.getUserInfo(token);
      expect(userInfo.groups).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getLogoutUrl
  // -----------------------------------------------------------------------

  describe('getLogoutUrl', () => {
    it('throws when not activated', async () => {
      const plugin = createPlugin();
      await expect(plugin.getLogoutUrl()).rejects.toThrow('not been activated');
    });

    it('returns Entra logout URL with post-logout redirect', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const url = await plugin.getLogoutUrl('https://app.test');
      expect(url).toContain('login.microsoftonline.com/test-tenant');
      expect(url).toContain('logout');
      expect(url).toContain('post_logout_redirect_uri=https%3A%2F%2Fapp.test');
    });

    it('returns Entra logout URL without redirect when returnTo is undefined', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const url = await plugin.getLogoutUrl();
      expect(url).toBe(
        'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/logout',
      );
    });
  });

  // -----------------------------------------------------------------------
  // refreshToken
  // -----------------------------------------------------------------------

  describe('refreshToken', () => {
    it('throws when not activated', async () => {
      const plugin = createPlugin();
      const token = makeJwt({ oid: 'user-1' });
      await expect(plugin.refreshToken(token)).rejects.toThrow('not been activated');
    });

    it('throws on invalid JWT format', async () => {
      const plugin = createPlugin();
      await plugin.activate(validConfig);
      await expect(plugin.refreshToken('not-a-jwt')).rejects.toThrow('Invalid JWT format');
    });

    it('returns new access token on successful silent refresh', async () => {
      const account = {
        homeAccountId: 'oid-user-1',
        environment: 'login.microsoftonline.com',
        tenantId: 'test-tenant',
        username: 'alice@contoso.com',
        localAccountId: 'local-123',
      };
      mockGetTokenCache.mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValueOnce([account]),
      });
      mockAcquireTokenSilent.mockResolvedValueOnce({
        accessToken: 'new-access-token',
      });

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const token = makeJwt({ oid: 'oid-user-1' });
      const newToken = await plugin.refreshToken(token);

      expect(newToken).toBe('new-access-token');
    });

    it('uses empty string as homeAccountId when oid is missing', async () => {
      const account = {
        homeAccountId: '',
        environment: 'login.microsoftonline.com',
        tenantId: 'test-tenant',
        username: 'alice@contoso.com',
        localAccountId: 'local-123',
      };
      mockGetTokenCache.mockReturnValue({
        getAllAccounts: vi.fn().mockResolvedValueOnce([account]),
      });
      mockAcquireTokenSilent.mockResolvedValueOnce({
        accessToken: 'refreshed-token',
      });

      const plugin = createPlugin();
      await plugin.activate(validConfig);

      const token = makeJwt({ sub: 'sub-only' }); // no oid
      const newToken = await plugin.refreshToken(token);

      expect(newToken).toBe('refreshed-token');
    });
  });
});
