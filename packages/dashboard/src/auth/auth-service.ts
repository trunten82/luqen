import type Database from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import type { PluginManager } from '../plugins/manager.js';
import type { AuthPlugin, AuthResult, PluginInstance } from '../plugins/types.js';
import type { StorageAdapter } from '../db/index.js';
import { setEncryptionSalt } from '../plugins/crypto.js';

import { apiKeyOpensDashboardSession, validateApiKey } from './api-key.js';

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

/** Why a signed-in session is refused (the session.ended audit row's details). */
export type SessionRefusal = 'inactive_user' | 'unknown_user' | 'key_refused';

/** What a sign-in hands to {@link AuthService.beginSession}. */
export interface SessionStart {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
  readonly authMethod: 'password' | 'oauth' | 'sso' | 'api-key';
  /** The api_keys row id (never the secret) of a /login API-key session. */
  readonly apiKeyId?: string;
}

interface SessionUserResult {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly apiKeyId?: string;
}

type SessionPrincipal =
  | { readonly ok: true; readonly user: SessionUserResult }
  | { readonly ok: false; readonly refusal: SessionRefusal };

/** Parsed group-sync configuration from the auth plugin. */
interface GroupSyncConfig {
  readonly groupMapping: Readonly<Record<string, string>>;
  readonly autoCreateTeams: boolean;
  readonly syncMode: 'additive' | 'mirror';
}

export class AuthService {
  private readonly db: Database.Database;
  private readonly storage: StorageAdapter;
  private readonly pluginManager: PluginManager;


  private bootId: string;

  constructor(db: Database.Database, pluginManager: PluginManager, storage: StorageAdapter) {
    this.db = db;
    this.storage = storage;
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

    // Per-installation encryption salt for plugin config secrets (CRIT-1 fix)
    const saltRow = this.db.prepare('SELECT value FROM dashboard_settings WHERE key = ?').get('encryption_salt') as { value: string } | undefined;
    if (saltRow != null) {
      setEncryptionSalt(saltRow.value);
    } else {
      const salt = randomBytes(32).toString('hex');
      this.db.prepare('INSERT INTO dashboard_settings (key, value) VALUES (?, ?)').run('encryption_salt', salt);
      setEncryptionSalt(salt);
    }
  }

  getBootId(): string {
    return this.bootId;
  }

  /** The one writer of a signed-in session: every sign-in route calls it. */
  async beginSession(session: { set(key: string, value: unknown): void }, input: SessionStart): Promise<void> {
    session.set('userId', input.userId);
    session.set('username', input.username);
    session.set('role', input.role);
    session.set('authMethod', input.authMethod);
    if (input.apiKeyId !== undefined) session.set('apiKeyId', input.apiKeyId);
    session.set('bootId', this.bootId);
  }

  // -----------------------------------------------------------------------
  // Auth mode detection
  // -----------------------------------------------------------------------

  getAuthMode(): AuthMode {
    const authPlugins = this.getAuthPlugins();
    if (authPlugins.length > 0) {
      return 'enterprise';
    }

    // NOTE: countUsers is async in StorageAdapter but AuthMode detection
    // is called synchronously in several places. We use the raw DB here.
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM dashboard_users').get() as { cnt: number } | undefined;
    const userCount = row?.cnt ?? 0;
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

  /** The API-key token a request presents (Bearer header, else X-API-Key), if any. */
  private apiKeyTokenFrom(request: FastifyRequest): string | undefined {
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers['x-api-key'] as string | undefined;
    return authHeader !== undefined && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xApiKey;
  }

  /**
   * Will this request authenticate by API key (rather than the session cookie)?
   * True only when the presented key actually validates — a bogus header does
   * not count, because authenticateRequest then falls through to the cookie.
   */
  authenticatedByKeyHeader(request: FastifyRequest): boolean {
    return request.user?.id === 'api-key' && request.user.role === 'admin';
  }

  hasValidApiCredential(request: FastifyRequest): boolean {
    const token = this.apiKeyTokenFrom(request);
    return token !== undefined && token !== '' && validateApiKey(this.db, token).valid;
  }

  async authenticateRequest(request: FastifyRequest): Promise<AuthResult> {
    // 1. Check Authorization: Bearer header OR X-API-Key header -> try API key
    const apiKeyToken = this.apiKeyTokenFrom(request);

    if (apiKeyToken !== undefined && apiKeyToken !== '') {
      const result = validateApiKey(this.db, apiKeyToken);
      if (result.valid) {
        const isOrgScoped = result.orgId !== undefined && result.orgId !== 'system';
        return {
          authenticated: true,
          user: {
            id: 'api-key',
            username: 'api-key',
            role: result.role ?? 'admin',
            ...(isOrgScoped ? { currentOrgId: result.orgId, orgScopedApiKey: true } : {}),
            ...(result.keyId !== undefined ? { apiKeyId: result.keyId } : {}),
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
      const sessionBootId = session.get('bootId') as string | undefined;

      if (userId !== undefined && username !== undefined) {
        // Verify session belongs to this database instance
        if (sessionBootId === this.getBootId()) {
          const principal = await this.sessionPrincipal(session, userId, username);
          if (principal.ok) {
            return { authenticated: true, user: principal.user };
          }
          await this.endSession(request, userId, username, principal.refusal);
          return { authenticated: false };
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

  /**
   * The principal a signed-in session answers for, read from storage on EVERY request. The values
   * the session was given at sign-in are a claim; the stored rows decide:
   *
   *   1. user id 'api-key' (a /login API-key session) -> the key row the session names must
   *      still pass the dashboard-session predicate the sign-in applied (active, unexpired,
   *      organization 'system', role admin), read without writing; a session naming no key, or a
   *      key that fails it, is refused ('key_refused')
   *   2. a stored dashboard user with the session's user id -> that row decides: an inactive
   *      row is refused ('inactive_user'); otherwise the stored id, username and role answer.
   *      The session's role and username are never read for authorization.
   *   3. no stored user, signed in through an external identity service (authMethod 'oauth',
   *      the compliance-service sign-in, or 'sso', an auth plugin) -> the values given at
   *      sign-in, unchanged
   *   4. anything else -> refused ('unknown_user')
   *
   * One stored read per request (a primary-key lookup of the user or of the key) and no cache, so a deactivation,
   * deletion or role change applies on the user's next request. A failed read is not caught:
   * the request ends in an error and is never answered from the session's values.
   */
  private async sessionPrincipal(
    session: { get(key: string): unknown },
    userId: string,
    username: string,
  ): Promise<SessionPrincipal> {
    if (userId === 'api-key') {
      // The key's row id (never the secret): the key this session answers for, and the key its
      // dismissals name.
      const sessionKeyId = session.get('apiKeyId');
      if (typeof sessionKeyId !== 'string' || sessionKeyId === '' || !apiKeyOpensDashboardSession(this.db, sessionKeyId)) {
        return { ok: false, refusal: 'key_refused' };
      }
      return {
        ok: true,
        user: {
          id: userId,
          username,
          // The predicate admits only role-admin keys of the 'system' organization.
          role: 'admin',
          apiKeyId: sessionKeyId,
        },
      };
    }

    const stored = await this.storage.users.getUserById(userId);
    if (stored !== null) {
      if (!stored.active) return { ok: false, refusal: 'inactive_user' };
      return { ok: true, user: { id: stored.id, username: stored.username, role: stored.role } };
    }

    const authMethod = session.get('authMethod');
    if (authMethod === 'oauth' || authMethod === 'sso') {
      return {
        ok: true,
        user: { id: userId, username, role: (session.get('role') as string | undefined) ?? 'user' },
      };
    }
    return { ok: false, refusal: 'unknown_user' };
  }

  /**
   * End a session its stored principal refuses: clear it (so the next request is
   * an anonymous one and the sign-in page is reachable) and record one session.ended audit row
   * carrying the reason code only. A failed audit write is logged; the session still ends.
   */
  private async endSession(
    request: FastifyRequest,
    userId: string,
    username: string,
    refusal: SessionRefusal,
  ): Promise<void> {
    const regenerable = request.session as { regenerate?: (keep?: string[]) => void } | undefined;
    if (typeof regenerable?.regenerate === 'function') {
      regenerable.regenerate();
    }
    try {
      await this.storage.audit.log({
        actor: username,
        actorId: userId,
        action: 'session.ended',
        resourceType: 'session',
        details: refusal,
        ...(typeof request.ip === 'string' ? { ipAddress: request.ip } : {}),
      });
    } catch (err) {
      request.log?.warn({ err, refusal }, 'session.ended audit row not written');
    }
  }

  // -----------------------------------------------------------------------
  // API key validation
  // -----------------------------------------------------------------------

  validateApiKey(key: string): boolean {
    return validateApiKey(this.db, key).valid;
  }

  /**
   * API-KEY-LOGIN-SCOPE-1: may this key open a DASHBOARD SESSION? Only a
   * system-scope admin key may: the session it creates is a global admin with no
   * org. Org-scoped keys (any role) and non-admin keys stay valid as API Bearer
   * tokens but are refused here — accepting them turned an org's read-only key
   * into a global-admin session (fixed 2026-10-08).
   */
  checkApiKeyForDashboardLogin(key: string): {
    readonly status: 'ok' | 'invalid' | 'org-scoped' | 'not-admin';
    /** api_keys row id (never the secret), for the audit log; absent when invalid. */
    readonly keyId?: string;
  } {
    const result = validateApiKey(this.db, key);
    if (!result.valid) return { status: 'invalid' };
    const keyId = result.keyId;
    if (result.orgId !== 'system') return { status: 'org-scoped', keyId };
    if (result.role !== 'admin') return { status: 'not-admin', keyId };
    return { status: 'ok', keyId };
  }

  // -----------------------------------------------------------------------
  // Password login
  // -----------------------------------------------------------------------

  async loginWithPassword(username: string, password: string): Promise<AuthResult> {
    const valid = await await this.storage.users.verifyPassword(username, password);
    if (!valid) {
      return { authenticated: false, error: 'Invalid username or password' };
    }

    const user = await this.storage.users.getUserByUsername(username);
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
      let team = await this.storage.teams.getTeamByName(teamName, defaultOrgId);

      if (team === null && autoCreateTeams) {
        team = await this.storage.teams.createTeam({
          name: teamName,
          description: `Auto-created from Entra ID group sync`,
          orgId: defaultOrgId,
        });
      }

      if (team !== null) {
        await this.storage.teams.addTeamMember(team.id, userId);
        resolvedTeamIds.add(team.id);
      }
    }

    // Mirror mode: remove user from mapped teams they no longer belong to
    if (syncMode === 'mirror') {
      const allMappedTeamNames = new Set(Object.values(groupMapping));

      for (const mappedTeamName of allMappedTeamNames) {
        if (targetTeamNames.has(mappedTeamName)) continue;

        const team = await this.storage.teams.getTeamByName(mappedTeamName, defaultOrgId);
        if (team !== null) {
          await this.storage.teams.removeTeamMember(team.id, userId);
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
