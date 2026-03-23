import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';
import { AuthService } from '../../src/auth/auth-service.js';
import type { AuthMode, LoginMethod } from '../../src/auth/auth-service.js';
import type { PluginManager } from '../../src/plugins/manager.js';
import type { PluginInstance, AuthPlugin, PluginManifest } from '../../src/plugins/types.js';
import type { FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStorage(): SqliteStorageAdapter {
  const storage = new SqliteStorageAdapter(':memory:');
  void storage.migrate();
  return storage;
}

function mockPluginManager(
  authPlugins: PluginInstance[] = [],
  pluginConfigs: Array<{ id: string; config: Record<string, unknown> }> = [],
): PluginManager {
  return {
    getActivePluginsByType: vi.fn((type: string) =>
      type === 'auth' ? authPlugins : [],
    ),
    getActivePluginConfigs: vi.fn((type: string) =>
      type === 'auth' ? pluginConfigs : [],
    ),
  } as unknown as PluginManager;
}

function fakeAuthPlugin(overrides: Partial<AuthPlugin> = {}): AuthPlugin {
  const manifest: PluginManifest = {
    name: '@luqen/plugin-okta',
    displayName: 'Okta SSO',
    type: 'auth',
    version: '1.0.0',
    description: 'Okta auth plugin',
    configSchema: [],
  };

  return {
    manifest,
    activate: vi.fn(),
    deactivate: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    authenticate: vi.fn().mockResolvedValue({ authenticated: false }),
    getLoginUrl: vi.fn().mockResolvedValue('https://okta.example.com/login'),
    handleCallback: vi.fn().mockResolvedValue({ authenticated: false }),
    ...overrides,
  };
}

function fakeRequest(headers: Record<string, string> = {}, session: Record<string, unknown> = {}): FastifyRequest {
  return {
    headers,
    session: {
      get: vi.fn((key: string) => session[key]),
      set: vi.fn(),
      delete: vi.fn(),
      ...session,
    },
  } as unknown as FastifyRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let storage: SqliteStorageAdapter;

  beforeEach(() => {
    storage = createStorage();
  });

  afterEach(() => {
    void storage.disconnect();
  });

  // -------------------------------------------------------------------------
  // Constructor & getBootId
  // -------------------------------------------------------------------------

  describe('constructor and getBootId', () => {
    it('generates a boot ID on first construction', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const bootId = service.getBootId();
      expect(bootId).toBeDefined();
      expect(typeof bootId).toBe('string');
      expect(bootId.length).toBeGreaterThan(0);
    });

    it('reuses boot ID from database on subsequent constructions', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service1 = new AuthService(db, pm, storage);
      const bootId1 = service1.getBootId();

      const service2 = new AuthService(db, pm, storage);
      const bootId2 = service2.getBootId();

      expect(bootId1).toBe(bootId2);
    });
  });

  // -------------------------------------------------------------------------
  // getAuthMode
  // -------------------------------------------------------------------------

  describe('getAuthMode', () => {
    it('returns solo when no users and no auth plugins', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      expect(service.getAuthMode()).toBe('solo');
    });

    it('returns team when users exist but no auth plugins', async () => {
      const db = storage.getRawDatabase();
      await storage.users.createUser('alice', 'password123', 'admin');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      expect(service.getAuthMode()).toBe('team');
    });

    it('returns enterprise when auth plugin is active', () => {
      const db = storage.getRawDatabase();
      const plugin = fakeAuthPlugin();
      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      expect(service.getAuthMode()).toBe('enterprise');
    });

    it('returns enterprise regardless of user count when auth plugins present', async () => {
      const db = storage.getRawDatabase();
      await storage.users.createUser('alice', 'password123', 'admin');
      const plugin = fakeAuthPlugin();
      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      expect(service.getAuthMode()).toBe('enterprise');
    });
  });

  // -------------------------------------------------------------------------
  // getLoginMethods
  // -------------------------------------------------------------------------

  describe('getLoginMethods', () => {
    it('returns api-key only in solo mode', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const methods = service.getLoginMethods();

      expect(methods).toHaveLength(1);
      expect(methods[0].type).toBe('api-key');
      expect(methods[0].label).toBe('API Key');
    });

    it('returns password + api-key in team mode', async () => {
      const db = storage.getRawDatabase();
      await storage.users.createUser('alice', 'password123', 'admin');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const methods = service.getLoginMethods();

      expect(methods).toHaveLength(2);
      const types = methods.map((m) => m.type);
      expect(types).toContain('password');
      expect(types).toContain('api-key');
    });

    it('returns sso + password + api-key in enterprise mode', () => {
      const db = storage.getRawDatabase();
      const plugin = fakeAuthPlugin();
      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      const methods = service.getLoginMethods();

      expect(methods.length).toBeGreaterThanOrEqual(3);
      const types = methods.map((m) => m.type);
      expect(types).toContain('sso');
      expect(types).toContain('password');
      expect(types).toContain('api-key');

      const ssoMethod = methods.find((m) => m.type === 'sso');
      expect(ssoMethod?.label).toBe('Okta SSO');
    });

    it('includes multiple SSO methods for multiple auth plugins', () => {
      const db = storage.getRawDatabase();
      const plugin1 = fakeAuthPlugin();
      const plugin2 = fakeAuthPlugin({
        manifest: {
          name: '@luqen/plugin-azure',
          displayName: 'Azure AD',
          type: 'auth',
          version: '1.0.0',
          description: 'Azure AD auth plugin',
          configSchema: [],
        },
      });
      const pm = mockPluginManager([plugin1, plugin2]);
      const service = new AuthService(db, pm, storage);

      const methods = service.getLoginMethods();
      const ssoMethods = methods.filter((m) => m.type === 'sso');
      expect(ssoMethods).toHaveLength(2);
      expect(ssoMethods[0].label).toBe('Okta SSO');
      expect(ssoMethods[1].label).toBe('Azure AD');
    });
  });

  // -------------------------------------------------------------------------
  // authenticateRequest
  // -------------------------------------------------------------------------

  describe('authenticateRequest', () => {
    it('validates API key from Authorization header', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest({ authorization: `Bearer ${key}` });

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('api-key');
      expect(result.user?.role).toBe('admin');
      expect(result.user?.id).toBe('api-key');
    });

    it('validates API key from X-API-Key header', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest({ 'x-api-key': key });

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('api-key');
    });

    it('prefers Bearer token over X-API-Key header', async () => {
      const db = storage.getRawDatabase();
      const validKey = generateApiKey();
      storeApiKey(db, validKey, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      // Bearer header has valid key, x-api-key has invalid
      const request = fakeRequest({
        authorization: `Bearer ${validKey}`,
        'x-api-key': 'invalid-key',
      });

      const result = await service.authenticateRequest(request);
      expect(result.authenticated).toBe(true);
    });

    it('falls back to X-API-Key when no Bearer header', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      // Authorization header present but not Bearer format
      const request = fakeRequest({
        authorization: 'Basic somevalue',
        'x-api-key': key,
      });

      const result = await service.authenticateRequest(request);
      expect(result.authenticated).toBe(true);
    });

    it('returns unauthenticated when no valid credentials', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest();

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated for invalid API key', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest({ authorization: 'Bearer invalid-key' });

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated for empty Bearer token', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest({ authorization: 'Bearer ' });

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
    });

    it('reads user from session in team mode', async () => {
      const db = storage.getRawDatabase();
      const user = await storage.users.createUser('alice', 'password123', 'admin');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const sessionData: Record<string, unknown> = {
        userId: user.id,
        username: 'alice',
        role: 'admin',
        authMethod: 'password',
        bootId: service.getBootId(),
      };

      const request = fakeRequest({}, sessionData);

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('alice');
      expect(result.user?.id).toBe(user.id);
    });

    it('defaults role to user when session has no role', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const sessionData: Record<string, unknown> = {
        userId: 'user-1',
        username: 'bob',
        bootId: service.getBootId(),
      };

      const request = fakeRequest({}, sessionData);
      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(true);
      expect(result.user?.role).toBe('user');
    });

    it('rejects session with stale bootId and calls regenerate', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const regenerateFn = vi.fn();
      const sessionData: Record<string, unknown> = {
        userId: 'user-1',
        username: 'alice',
        role: 'admin',
        bootId: 'stale-boot-id-from-previous-db',
      };

      const request = {
        headers: {},
        session: {
          get: vi.fn((key: string) => sessionData[key]),
          set: vi.fn(),
          delete: vi.fn(),
          regenerate: regenerateFn,
          ...sessionData,
        },
      } as unknown as FastifyRequest;

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
      expect(regenerateFn).toHaveBeenCalled();
    });

    it('handles stale bootId without regenerate method', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const sessionData: Record<string, unknown> = {
        userId: 'user-1',
        username: 'alice',
        role: 'admin',
        bootId: 'stale-boot-id',
      };

      // Session without regenerate method
      const request = {
        headers: {},
        session: {
          get: vi.fn((key: string) => sessionData[key]),
          set: vi.fn(),
          ...sessionData,
        },
      } as unknown as FastifyRequest;

      const result = await service.authenticateRequest(request);
      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated when session has userId but no username', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const sessionData: Record<string, unknown> = {
        userId: 'user-1',
        bootId: service.getBootId(),
      };

      const request = fakeRequest({}, sessionData);
      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated when session is undefined', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const request = {
        headers: {},
        session: undefined,
      } as unknown as FastifyRequest;

      const result = await service.authenticateRequest(request);
      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated when session has no get function', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const request = {
        headers: {},
        session: { someProp: 'value' },
      } as unknown as FastifyRequest;

      const result = await service.authenticateRequest(request);
      expect(result.authenticated).toBe(false);
    });

    it('checks API key before session', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      // Both valid API key and valid session
      const sessionData: Record<string, unknown> = {
        userId: 'user-1',
        username: 'alice',
        role: 'admin',
        bootId: service.getBootId(),
      };

      const request = fakeRequest({ authorization: `Bearer ${key}` }, sessionData);
      const result = await service.authenticateRequest(request);

      // Should authenticate as api-key user, not session user
      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('api-key');
    });
  });

  // -------------------------------------------------------------------------
  // validateApiKey
  // -------------------------------------------------------------------------

  describe('validateApiKey', () => {
    it('returns true for valid API key', () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();
      storeApiKey(db, key, 'test');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      expect(service.validateApiKey(key)).toBe(true);
    });

    it('returns false for invalid API key', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      expect(service.validateApiKey('nonexistent-key')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loginWithPassword
  // -------------------------------------------------------------------------

  describe('loginWithPassword', () => {
    it('returns authenticated for valid credentials', async () => {
      const db = storage.getRawDatabase();
      await storage.users.createUser('alice', 'password123', 'admin');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('alice', 'password123');

      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('alice');
      expect(result.user?.role).toBe('admin');
    });

    it('returns unauthenticated for wrong password', async () => {
      const db = storage.getRawDatabase();
      await storage.users.createUser('alice', 'password123', 'admin');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('alice', 'wrong-password');

      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Invalid username or password');
    });

    it('returns unauthenticated for inactive user', async () => {
      const db = storage.getRawDatabase();
      const user = await storage.users.createUser('alice', 'password123', 'admin');
      await storage.users.deactivateUser(user.id);

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('alice', 'password123');

      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Invalid username or password');
    });

    it('returns unauthenticated for nonexistent user', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('nobody', 'password123');

      expect(result.authenticated).toBe(false);
    });

    it('returns user id and role in result', async () => {
      const db = storage.getRawDatabase();
      const user = await storage.users.createUser('editor', 'pass456', 'editor');

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('editor', 'pass456');

      expect(result.authenticated).toBe(true);
      expect(result.user?.id).toBe(user.id);
      expect(result.user?.role).toBe('editor');
    });
  });

  // -------------------------------------------------------------------------
  // getAuthPlugins
  // -------------------------------------------------------------------------

  describe('getAuthPlugins', () => {
    it('returns empty array when no auth plugins are active', () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      expect(service.getAuthPlugins()).toEqual([]);
    });

    it('returns auth plugins that have authenticate method', () => {
      const db = storage.getRawDatabase();
      const plugin = fakeAuthPlugin();
      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      const plugins = service.getAuthPlugins();

      expect(plugins).toHaveLength(1);
      expect(typeof plugins[0].authenticate).toBe('function');
    });

    it('filters out non-auth plugins missing authenticate method', () => {
      const db = storage.getRawDatabase();
      const notAuthPlugin: PluginInstance = {
        manifest: {
          name: '@luqen/plugin-slack',
          displayName: 'Slack',
          type: 'notification',
          version: '1.0.0',
          description: 'Slack notification plugin',
          configSchema: [],
        },
        activate: vi.fn(),
        deactivate: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
      };

      const pm = mockPluginManager([notAuthPlugin]);
      const service = new AuthService(db, pm, storage);

      const plugins = service.getAuthPlugins();

      expect(plugins).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // handleSsoCallback
  // -------------------------------------------------------------------------

  describe('handleSsoCallback', () => {
    it('delegates to auth plugin handleCallback', async () => {
      const db = storage.getRawDatabase();
      const expectedResult = {
        authenticated: true,
        user: { id: 'sso-1', username: 'ssouser', email: 'sso@example.com', role: 'user' },
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(expectedResult),
      });

      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('some-plugin-id', request);

      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('ssouser');
    });

    it('returns unauthenticated when plugin not found', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('missing-plugin', request);

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when plugin has no handleCallback', async () => {
      const db = storage.getRawDatabase();
      const plugin = fakeAuthPlugin({
        handleCallback: undefined,
      });
      const pm = mockPluginManager([plugin]);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('some-plugin-id', request);

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('does not support callbacks');
    });

    it('performs group-to-team sync in additive mode', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha', 'group-b': 'Team Beta' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true, syncMode: 'additive' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toEqual(['Team Alpha']);
    });

    it('performs group-to-team sync in mirror mode removing old memberships', async () => {
      const db = storage.getRawDatabase();

      // Create a team that the user was previously in but shouldn't be now
      await storage.teams.createTeam({
        name: 'Team Beta',
        description: 'Old team',
        orgId: 'system',
      });

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha', 'group-b': 'Team Beta' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true, syncMode: 'mirror' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'], // Only in group-a, not group-b
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toEqual(['Team Alpha']);
    });

    it('skips group sync when no group mapping configured', async () => {
      const db = storage.getRawDatabase();

      const pluginConfigs = [
        { id: 'plugin-1', config: {} },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      // No teams property since sync was skipped
      expect(result.teams).toBeUndefined();
    });

    it('skips group sync when groupMapping is empty string', async () => {
      const db = storage.getRawDatabase();

      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping: '' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toBeUndefined();
    });

    it('skips group sync when groupMapping is "{}"', async () => {
      const db = storage.getRawDatabase();

      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping: '{}' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toBeUndefined();
    });

    it('skips group sync when groupMapping is invalid JSON', async () => {
      const db = storage.getRawDatabase();

      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping: 'not-valid-json{' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toBeUndefined();
    });

    it('skips group sync when no plugin configs exist', async () => {
      const db = storage.getRawDatabase();

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      // No pluginConfigs
      const pm = mockPluginManager([plugin], []);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toBeUndefined();
    });

    it('does not auto-create teams when autoCreateTeams is false', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: false } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      // Team doesn't exist and autoCreateTeams is false, so teams list should be the target names
      // but team was not created/added
      expect(result.teams).toEqual(['Team Alpha']);
    });

    it('does not sync when callback result has no groups', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        // No groups property
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toBeUndefined();
    });

    it('does not sync when callback result is unauthenticated', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: false,
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(false);
    });

    it('adds user to existing team without creating new one', async () => {
      const db = storage.getRawDatabase();

      // Pre-create the team
      await storage.teams.createTeam({
        name: 'Team Alpha',
        description: 'Existing team',
        orgId: 'system',
      });

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toEqual(['Team Alpha']);
    });

    it('continues login even when team sync throws', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      // Mock teams to throw
      const originalGetTeamByName = storage.teams.getTeamByName.bind(storage.teams);
      storage.teams.getTeamByName = vi.fn().mockRejectedValue(new Error('DB error'));

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      // Should still return authenticated even though sync failed
      expect(result.authenticated).toBe(true);
      expect(result.user?.username).toBe('ssouser');

      storage.teams.getTeamByName = originalGetTeamByName;
    });

    it('handles groups with no matching mapping entries', async () => {
      const db = storage.getRawDatabase();

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-z'], // Not in mapping
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toEqual([]);
    });

    it('uses default additive syncMode when syncMode is not mirror', async () => {
      const db = storage.getRawDatabase();

      // Pre-create a team that user was previously in
      await storage.teams.createTeam({
        name: 'Team Beta',
        description: 'Old team',
        orgId: 'system',
      });

      const groupMapping = JSON.stringify({ 'group-a': 'Team Alpha', 'group-b': 'Team Beta' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true, syncMode: 'additive' } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['group-a'], // Only in group-a, not group-b
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      // In additive mode, we only add—team Beta membership is NOT removed
      expect(result.teams).toEqual(['Team Alpha']);
    });

    it('parsed groupMapping with empty keys returns empty teams', async () => {
      const db = storage.getRawDatabase();

      // Valid JSON but with keys that don't match any groups
      const groupMapping = JSON.stringify({ 'special-group': 'Special Team' });
      const pluginConfigs = [
        { id: 'plugin-1', config: { groupMapping, autoCreateTeams: true } },
      ];

      const callbackResult = {
        authenticated: true,
        user: { id: 'sso-user-1', username: 'ssouser', role: 'user' },
        groups: ['different-group'],
      };
      const plugin = fakeAuthPlugin({
        handleCallback: vi.fn().mockResolvedValue(callbackResult),
      });

      const pm = mockPluginManager([plugin], pluginConfigs);
      const service = new AuthService(db, pm, storage);

      const request = fakeRequest();
      const result = await service.handleSsoCallback('plugin-1', request);

      expect(result.authenticated).toBe(true);
      expect(result.teams).toEqual([]);
    });
  });
});
