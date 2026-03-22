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

function mockPluginManager(authPlugins: PluginInstance[] = []): PluginManager {
  return {
    getActivePluginsByType: vi.fn((type: string) =>
      type === 'auth' ? authPlugins : [],
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
    });

    it('returns unauthenticated when no valid credentials', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest();

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

    it('returns unauthenticated for invalid API key', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);
      const request = fakeRequest({ authorization: 'Bearer invalid-key' });

      const result = await service.authenticateRequest(request);

      expect(result.authenticated).toBe(false);
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
    });

    it('returns unauthenticated for inactive user', async () => {
      const db = storage.getRawDatabase();
      const user = await storage.users.createUser('alice', 'password123', 'admin');
      await storage.users.deactivateUser(user.id);

      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('alice', 'password123');

      expect(result.authenticated).toBe(false);
    });

    it('returns unauthenticated for nonexistent user', async () => {
      const db = storage.getRawDatabase();
      const pm = mockPluginManager([]);
      const service = new AuthService(db, pm, storage);

      const result = await service.loginWithPassword('nobody', 'password123');

      expect(result.authenticated).toBe(false);
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

      // We need the plugin to be returned when looking up by pluginId
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
      expect(result.error).toBeDefined();
    });
  });
});
