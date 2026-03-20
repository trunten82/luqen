import type Database from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import type { PluginManager } from '../plugins/manager.js';
import type { AuthPlugin, AuthResult, PluginInstance } from '../plugins/types.js';
import { UserDb } from '../db/users.js';
import { validateApiKey } from './api-key.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthMode = 'solo' | 'team' | 'enterprise';

export interface LoginMethod {
  readonly type: 'api-key' | 'password' | 'sso';
  readonly label: string;
  readonly pluginId?: string;
  readonly loginUrl?: string;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isAuthPlugin(instance: PluginInstance): instance is AuthPlugin {
  return typeof (instance as AuthPlugin).authenticate === 'function';
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {
  private readonly db: Database.Database;
  private readonly userDb: UserDb;
  private readonly pluginManager: PluginManager;

  constructor(db: Database.Database, pluginManager: PluginManager) {
    this.db = db;
    this.userDb = new UserDb(db);
    this.pluginManager = pluginManager;
  }

  // -----------------------------------------------------------------------
  // Auth mode detection
  // -----------------------------------------------------------------------

  getAuthMode(): AuthMode {
    const authPlugins = this.getAuthPlugins();
    if (authPlugins.length > 0) {
      return 'enterprise';
    }

    const userCount = this.userDb.countUsers();
    if (userCount > 0) {
      return 'team';
    }

    return 'solo';
  }

  // -----------------------------------------------------------------------
  // Login methods
  // -----------------------------------------------------------------------

  getLoginMethods(): LoginMethod[] {
    const mode = this.getAuthMode();

    const apiKeyMethod: LoginMethod = { type: 'api-key', label: 'API Key' };
    const passwordMethod: LoginMethod = { type: 'password', label: 'Password' };

    if (mode === 'solo') {
      return [apiKeyMethod];
    }

    if (mode === 'team') {
      return [passwordMethod, apiKeyMethod];
    }

    // enterprise: SSO methods from plugins + password + api-key
    const authPlugins = this.getAuthPlugins();
    const ssoMethods: LoginMethod[] = authPlugins.map((plugin) => ({
      type: 'sso' as const,
      label: plugin.manifest.displayName,
      loginUrl: undefined,
    }));

    return [...ssoMethods, passwordMethod, apiKeyMethod];
  }

  // -----------------------------------------------------------------------
  // Request authentication
  // -----------------------------------------------------------------------

  async authenticateRequest(request: FastifyRequest): Promise<AuthResult> {
    // 1. Check Authorization: Bearer header -> try API key
    const authHeader = request.headers.authorization;
    if (authHeader !== undefined && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const valid = validateApiKey(this.db, token);
      if (valid) {
        return {
          authenticated: true,
          user: {
            id: 'api-key',
            username: 'api-key',
            role: 'admin',
          },
        };
      }
    }

    // 2. Check session for stored user info
    const session = request.session as {
      get(key: string): unknown;
    } | undefined;

    if (session !== undefined && typeof session.get === 'function') {
      const userId = session.get('userId') as string | undefined;
      const username = session.get('username') as string | undefined;
      const role = session.get('role') as string | undefined;

      if (userId !== undefined && username !== undefined) {
        return {
          authenticated: true,
          user: {
            id: userId,
            username,
            role: role ?? 'user',
          },
        };
      }
    }

    // 3. No valid credentials
    return { authenticated: false };
  }

  // -----------------------------------------------------------------------
  // API key validation
  // -----------------------------------------------------------------------

  validateApiKey(key: string): boolean {
    return validateApiKey(this.db, key);
  }

  // -----------------------------------------------------------------------
  // Password login
  // -----------------------------------------------------------------------

  async loginWithPassword(username: string, password: string): Promise<AuthResult> {
    const valid = await this.userDb.verifyPassword(username, password);
    if (!valid) {
      return { authenticated: false, error: 'Invalid username or password' };
    }

    const user = this.userDb.getUserByUsername(username);
    if (user === null || !user.active) {
      return { authenticated: false, error: 'User not found or inactive' };
    }

    return {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  // -----------------------------------------------------------------------
  // SSO callback
  // -----------------------------------------------------------------------

  async handleSsoCallback(pluginId: string, request: FastifyRequest): Promise<AuthResult> {
    const authPlugins = this.getAuthPlugins();

    if (authPlugins.length === 0) {
      return { authenticated: false, error: `Auth plugin "${pluginId}" not found` };
    }

    // Find the plugin matching the given pluginId.
    // Since PluginManager returns instances without their DB id, we match
    // the first available plugin for now. A more precise lookup would
    // require the PluginManager to expose instances by id.
    const plugin = authPlugins[0];

    if (plugin.handleCallback === undefined) {
      return { authenticated: false, error: `Auth plugin "${pluginId}" does not support callbacks` };
    }

    return plugin.handleCallback(request);
  }

  // -----------------------------------------------------------------------
  // Auth plugin helpers
  // -----------------------------------------------------------------------

  getAuthPlugins(): AuthPlugin[] {
    const instances = this.pluginManager.getActivePluginsByType('auth');
    return instances.filter(isAuthPlugin);
  }
}
