import type Database from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { PluginManager } from '../plugins/manager.js';
import type { AuthPlugin, AuthResult, PluginInstance } from '../plugins/types.js';
import { UserDb } from '../db/users.js';
import { ScanDb } from '../db/scans.js';
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

/** Parsed group-sync configuration from the auth plugin. */
interface GroupSyncConfig {
  readonly groupMapping: Readonly<Record<string, string>>;
  readonly autoCreateTeams: boolean;
  readonly syncMode: 'additive' | 'mirror';
}

export class AuthService {
  private readonly db: Database.Database;
  private readonly userDb: UserDb;
  private readonly pluginManager: PluginManager;
  private scanDb: ScanDb | null = null;

  private bootId: string;

  constructor(db: Database.Database, pluginManager: PluginManager) {
    this.db = db;
    this.userDb = new UserDb(db);
    this.pluginManager = pluginManager;

    // Boot ID: unique per DB instance — invalidates sessions from previous DBs.
    // Create settings table if missing (safe static SQL, no user input)
    this.db.pragma('journal_mode'); // ensure DB is open
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='dashboard_settings'"
    ).all();
    if (tables.length === 0) {
      this.db.prepare(
        'CREATE TABLE dashboard_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
      ).run();
    }
    const row = this.db.prepare('SELECT value FROM dashboard_settings WHERE key = ?').get('boot_id') as { value: string } | undefined;
    if (row != null) {
      this.bootId = row.value;
    } else {
      this.bootId = randomUUID();
      this.db.prepare('INSERT INTO dashboard_settings (key, value) VALUES (?, ?)').run('boot_id', this.bootId);
    }
  }

  getBootId(): string {
    return this.bootId;
  }

  /**
   * Provide the ScanDb instance used for team operations.
   * Must be called before team sync can work (typically during server setup).
   */
  setScanDb(scanDb: ScanDb): void {
    this.scanDb = scanDb;
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
    // 1. Check Authorization: Bearer header OR X-API-Key header -> try API key
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers['x-api-key'] as string | undefined;
    const apiKeyToken = authHeader !== undefined && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xApiKey;

    if (apiKeyToken !== undefined && apiKeyToken !== '') {
      const valid = validateApiKey(this.db, apiKeyToken);
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
      const sessionBootId = session.get('bootId') as string | undefined;

      if (userId !== undefined && username !== undefined) {
        // Verify session belongs to this database instance
        if (sessionBootId === this.getBootId()) {
          return {
            authenticated: true,
            user: { id: userId, username, role: role ?? 'user' },
          };
        }

        // Stale session from a previous DB — clear it to prevent redirect loops.
        // session.regenerate() wipes all data from the encrypted cookie.
        const regenerable = request.session as { regenerate?: (keep?: string[]) => void };
        if (typeof regenerable.regenerate === 'function') {
          regenerable.regenerate();
        }
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

    const result = await plugin.handleCallback(request);

    // Perform IdP group-to-team sync when the auth result contains groups
    if (result.authenticated && result.groups && result.user) {
      try {
        const syncConfig = this.getGroupSyncConfig();
        if (syncConfig !== null) {
          const teamNames = await this.syncUserTeams(
            result.user.id,
            result.groups as string[],
            syncConfig,
          );
          // Return a new result with the resolved team names for session storage
          return { ...result, teams: teamNames };
        }
      } catch {
        // Team sync failure should not block login — log but proceed
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // IdP group → team sync
  // -----------------------------------------------------------------------

  /**
   * Read group-sync configuration from the first active auth plugin.
   * Returns null when no mapping is configured.
   */
  private getGroupSyncConfig(): GroupSyncConfig | null {
    const configs = this.pluginManager.getActivePluginConfigs('auth');
    if (configs.length === 0) return null;

    const { config } = configs[0];
    const rawMapping = config['groupMapping'] as string | undefined;
    if (rawMapping === undefined || rawMapping === '' || rawMapping === '{}') {
      return null;
    }

    let groupMapping: Record<string, string>;
    try {
      groupMapping = JSON.parse(rawMapping) as Record<string, string>;
    } catch {
      return null;
    }

    if (Object.keys(groupMapping).length === 0) return null;

    const autoCreateTeams = config['autoCreateTeams'] !== false;
    const syncMode =
      config['syncMode'] === 'mirror' ? 'mirror' as const : 'additive' as const;

    return { groupMapping, autoCreateTeams, syncMode };
  }

  /**
   * Synchronise a user's team memberships based on their IdP groups.
   *
   * Returns the list of dashboard team names the user now belongs to.
   */
  private async syncUserTeams(
    userId: string,
    idpGroups: readonly string[],
    syncConfig: GroupSyncConfig,
  ): Promise<string[]> {
    if (this.scanDb === null) return [];

    const { groupMapping, autoCreateTeams, syncMode } = syncConfig;

    // Resolve which dashboard teams the user should belong to
    const targetTeamNames = new Set<string>();
    for (const groupId of idpGroups) {
      const teamName = groupMapping[groupId];
      if (teamName !== undefined) {
        targetTeamNames.add(teamName);
      }
    }

    const resolvedTeamIds = new Set<string>();
    const defaultOrgId = 'system';

    // Ensure each target team exists and add the user
    for (const teamName of targetTeamNames) {
      let team = this.scanDb.getTeamByName(teamName, defaultOrgId);

      if (team === null && autoCreateTeams) {
        team = this.scanDb.createTeam({
          name: teamName,
          description: `Auto-created from Entra ID group sync`,
          orgId: defaultOrgId,
        });
      }

      if (team !== null) {
        this.scanDb.addTeamMember(team.id, userId);
        resolvedTeamIds.add(team.id);
      }
    }

    // Mirror mode: remove user from mapped teams they no longer belong to
    if (syncMode === 'mirror') {
      const allMappedTeamNames = new Set(Object.values(groupMapping));

      for (const mappedTeamName of allMappedTeamNames) {
        if (targetTeamNames.has(mappedTeamName)) continue;

        const team = this.scanDb.getTeamByName(mappedTeamName, defaultOrgId);
        if (team !== null) {
          this.scanDb.removeTeamMember(team.id, userId);
        }
      }
    }

    return [...targetTeamNames];
  }

  // -----------------------------------------------------------------------
  // Auth plugin helpers
  // -----------------------------------------------------------------------

  getAuthPlugins(): AuthPlugin[] {
    const instances = this.pluginManager.getActivePluginsByType('auth');
    return instances.filter(isAuthPlugin);
  }
}
