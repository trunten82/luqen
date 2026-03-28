import type { FastifyRequest } from 'fastify';
import type { GitHostPlugin } from '../git-hosts/types.js';

// ---------------------------------------------------------------------------
// Core enums & primitives
// ---------------------------------------------------------------------------

export type PluginType = 'auth' | 'notification' | 'storage' | 'scanner' | 'git-host';

export type PluginStatus =
  | 'inactive'
  | 'active'
  | 'error'
  | 'install-failed'
  | 'unhealthy';

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'secret' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly options?: readonly string[];
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Plugin manifest & record
// ---------------------------------------------------------------------------

export interface PluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly description: string;
  readonly icon?: string;
  readonly configSchema: readonly ConfigField[];
  readonly autoDeactivateOnFailure?: boolean;
}

export interface PluginRecord {
  readonly id: string;
  readonly packageName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly status: PluginStatus;
  readonly installedAt: string;
  readonly activatedAt?: string;
  readonly error?: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// Plugin instance (base)
// ---------------------------------------------------------------------------

export interface PluginInstance {
  readonly manifest: PluginManifest;
  activate(config: Readonly<Record<string, unknown>>): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Auth plugin
// ---------------------------------------------------------------------------

export interface AuthResult {
  readonly authenticated: boolean;
  readonly user?: {
    readonly id: string;
    readonly username: string;
    readonly email?: string;
    readonly role?: string;
  };
  readonly token?: string;
  readonly error?: string;
  readonly groups?: readonly string[];
  /** Dashboard team names resolved after IdP group sync. */
  readonly teams?: readonly string[];
}

export interface UserInfo {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly groups?: readonly string[];
}

export interface AuthPlugin extends PluginInstance {
  authenticate(request: FastifyRequest): Promise<AuthResult>;
  getLoginUrl?(): Promise<string>;
  handleCallback?(request: FastifyRequest): Promise<AuthResult>;
  getUserInfo?(token: string): Promise<UserInfo>;
  getLogoutUrl?(returnTo?: string): Promise<string>;
  refreshToken?(token: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Notification plugin
// ---------------------------------------------------------------------------

export interface LuqenEvent {
  readonly type:
    | 'scan.complete'
    | 'scan.failed'
    | 'violation.found'
    | 'regulation.changed';
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface NotificationPlugin extends PluginInstance {
  send(event: LuqenEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Storage plugin
// ---------------------------------------------------------------------------

export interface StoragePlugin extends PluginInstance {
  save(key: string, data: Uint8Array): Promise<void>;
  load(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Scanner plugin
// ---------------------------------------------------------------------------

export interface WcagRule {
  readonly code: string;
  readonly description: string;
  readonly level: 'A' | 'AA' | 'AAA';
}

export interface ScannerIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

export interface PageResult {
  readonly url: string;
  readonly html: string;
  readonly issues: readonly ScannerIssue[];
}

export interface ScannerPlugin extends PluginInstance {
  readonly rules: readonly WcagRule[];
  evaluate(page: PageResult): Promise<readonly ScannerIssue[]>;
}

// ---------------------------------------------------------------------------
// Git host plugin
// ---------------------------------------------------------------------------

export interface GitHostPluginInstance extends PluginInstance {
  readonly gitHost: GitHostPlugin;
}

// ---------------------------------------------------------------------------
// Admin pages declared by plugins
// ---------------------------------------------------------------------------

export interface AdminPage {
  readonly path: string;
  readonly title: string;
  readonly icon: string;
  readonly permission: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  readonly name: string;
  readonly displayName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly description: string;
  readonly packageName: string;
  readonly icon?: string;
  readonly adminPages?: readonly AdminPage[];
  /** URL to download the plugin tarball (GitHub release asset). */
  readonly downloadUrl?: string;
  /** SHA-256 checksum for integrity verification (format: "sha256:hex"). */
  readonly checksum?: string;
  /** Minimum dashboard version required to run this plugin. */
  readonly minDashboardVersion?: string;
}

// ---------------------------------------------------------------------------
// Remote catalogue response
// ---------------------------------------------------------------------------

export interface CatalogueResponse {
  readonly version: number;
  readonly updatedAt: string;
  readonly plugins: readonly RegistryEntry[];
}
