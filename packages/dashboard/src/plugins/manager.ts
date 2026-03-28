import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, rmSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as tar from 'tar';
import type Database from 'better-sqlite3';
import type {
  PluginRecord,
  PluginStatus,
  PluginManifest,
  PluginInstance,
  PluginType,
  RegistryEntry,
} from './types.js';
import { encryptConfig, decryptConfig, maskSecrets } from './crypto.js';
import { getByName, getByPackageName } from './registry.js';
import { computeDirectoryChecksum } from './checksum.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginManagerOptions {
  readonly db: Database.Database;
  readonly pluginsDir: string;
  readonly encryptionKey: string;
  readonly registryEntries: readonly RegistryEntry[];
}

interface PluginRow {
  readonly id: string;
  readonly package_name: string;
  readonly type: string;
  readonly version: string;
  readonly config: string;
  readonly status: string;
  readonly installed_at: string;
  readonly activated_at: string | null;
  readonly error: string | null;
  readonly checksum: string | null;
  readonly org_id: string;
}

type DownloadFn = (url: string, destPath: string) => Promise<void>;

type PluginLoaderFn = (pluginPath: string) => Promise<PluginInstance>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEALTH_FAILURE_THRESHOLD = 3;

function rowToRecord(row: PluginRow, config: Record<string, unknown>): PluginRecord {
  const record: PluginRecord = {
    id: row.id,
    packageName: row.package_name,
    type: row.type as PluginType,
    version: row.version,
    config,
    status: row.status as PluginStatus,
    installedAt: row.installed_at,
    orgId: row.org_id,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
  return record;
}

/** Convert @luqen/plugin-auth-entra → auth-entra */
function packageNameToPluginName(packageName: string): string {
  const parts = packageName.split('/');
  const last = parts[parts.length - 1];
  return last.replace(/^plugin-/, '');
}

/** Default download function: fetch URL → write to file. */
async function defaultDownloadFn(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} from ${url}`);
  }

  if (!response.body) {
    throw new Error('Download failed: empty response body');
  }

  const fileStream = createWriteStream(destPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
}

// ---------------------------------------------------------------------------
// PluginManager
// ---------------------------------------------------------------------------

export class PluginManager {
  private readonly db: Database.Database;
  private readonly pluginsDir: string;
  private readonly encryptionKey: string;
  private readonly registryEntries: readonly RegistryEntry[];
  private readonly activeInstances: Map<string, PluginInstance> = new Map();
  private readonly healthFailures: Map<string, number> = new Map();
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  private downloadFn: DownloadFn = defaultDownloadFn;
  private loaderFn: PluginLoaderFn = async (pluginPath: string) => {
    const mod = await import(pluginPath) as { default?: PluginInstance };
    return mod.default ?? (mod as unknown as PluginInstance);
  };

  constructor(options: PluginManagerOptions) {
    this.db = options.db;
    this.pluginsDir = options.pluginsDir;
    this.encryptionKey = options.encryptionKey;
    this.registryEntries = options.registryEntries;
  }

  // -----------------------------------------------------------------------
  // Test helpers (prefixed with _ to signal internal use)
  // -----------------------------------------------------------------------

  /** @internal Replace the download function (for testing without real HTTP). */
  _setDownloadFn(fn: DownloadFn): void {
    this.downloadFn = fn;
  }

  /** @internal Replace the dynamic import loader (for testing). */
  _setLoader(fn: PluginLoaderFn): void {
    this.loaderFn = fn;
  }

  /** @internal Directly register an active instance (for testing). */
  _setActiveInstance(id: string, instance: PluginInstance): void {
    this.activeInstances.set(id, instance);
  }

  // -----------------------------------------------------------------------
  // Install (tarball download + extract)
  // -----------------------------------------------------------------------

  /**
   * Install a plugin by name (e.g., "auth-entra") or packageName (e.g., "@luqen/plugin-auth-entra").
   * Downloads the tarball from the registry entry's downloadUrl and extracts it.
   */
  async install(nameOrPackage: string): Promise<PluginRecord> {
    // Resolve registry entry by name or packageName
    let registryEntry = getByName(this.registryEntries, nameOrPackage);
    if (!registryEntry) {
      registryEntry = getByPackageName(this.registryEntries, nameOrPackage);
    }
    if (!registryEntry) {
      throw new Error(`Plugin "${nameOrPackage}" not found in catalogue`);
    }

    if (!registryEntry.downloadUrl) {
      throw new Error(`Plugin "${registryEntry.name}" has no download URL in the catalogue`);
    }

    const pluginName = registryEntry.name;
    const destDir = join(this.pluginsDir, 'packages', pluginName);

    // Clean up any previous installation in this directory
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
    }
    mkdirSync(destDir, { recursive: true });

    // Download tarball to temp file
    const tarballPath = join(this.pluginsDir, `${pluginName}.tgz`);
    try {
      await this.downloadFn(registryEntry.downloadUrl, tarballPath);

      // Verify checksum if provided
      if (registryEntry.checksum) {
        const [algo, expected] = registryEntry.checksum.split(':');
        if (algo === 'sha256' && expected) {
          const fileData = readFileSync(tarballPath);
          const actual = createHash('sha256').update(fileData).digest('hex');
          if (actual !== expected) {
            throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
          }
        }
      }

      // Extract tarball (strip 'package/' prefix)
      await tar.extract({
        file: tarballPath,
        cwd: destDir,
        strip: 1,
      });
    } finally {
      // Clean up tarball
      if (existsSync(tarballPath)) {
        rmSync(tarballPath, { force: true });
      }
    }

    const manifest = this.readManifest(registryEntry.packageName);

    // Compute checksum of installed plugin files for integrity verification
    const checksum = computeDirectoryChecksum(destDir);

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at, @checksum)`,
      )
      .run({
        id,
        package_name: registryEntry.packageName,
        type: manifest.type,
        version: manifest.version,
        config: '{}',
        status: 'inactive',
        installed_at: now,
        checksum,
      });

    return this.getPluginOrThrow(id);
  }

  // -----------------------------------------------------------------------
  // Configure
  // -----------------------------------------------------------------------

  async configure(
    id: string,
    config: Record<string, unknown>,
  ): Promise<PluginRecord> {
    const row = this.getRow(id);
    if (!row) {
      throw new Error(`Plugin "${id}" not found`);
    }

    const manifest = this.readManifest(row.package_name);
    const encrypted = encryptConfig(config, manifest.configSchema, this.encryptionKey);

    this.db
      .prepare('UPDATE plugins SET config = @config WHERE id = @id')
      .run({ id, config: JSON.stringify(encrypted) });

    // If plugin is active, try to (re)start with the new config
    if (row.status === 'active') {
      // Deactivate current instance if running
      const instance = this.activeInstances.get(id);
      if (instance) {
        await instance.deactivate();
        this.activeInstances.delete(id);
      }
      await this.tryStartPlugin(id, row.package_name, JSON.stringify(encrypted));
    }

    return this.getPluginOrThrow(id);
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  async activate(id: string): Promise<PluginRecord> {
    const row = this.getRow(id);
    if (!row) {
      throw new Error(`Plugin "${id}" not found`);
    }

    // Verify plugin file integrity before loading
    if (row.checksum !== null) {
      const pkgDir = this.resolvePackageDir(row.package_name);
      if (existsSync(pkgDir)) {
        const currentChecksum = computeDirectoryChecksum(pkgDir);
        if (currentChecksum !== row.checksum) {
          const message = `Plugin "${row.package_name}" checksum mismatch — files may have been tampered with (expected ${row.checksum.slice(0, 12)}..., got ${currentChecksum.slice(0, 12)}...)`;
          this.db
            .prepare('UPDATE plugins SET status = @status, error = @error WHERE id = @id')
            .run({ id, status: 'error', error: message });
          return this.getPluginOrThrow(id);
        }
      }
    }

    // Mark as active in DB first — plugin is "enabled" regardless of whether
    // its code can start right now. Config may be added later.
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE plugins SET status = @status, activated_at = @activated_at, error = NULL WHERE id = @id',
      )
      .run({ id, status: 'active', activated_at: now });

    // Try to load and start the plugin code. If it fails (e.g. missing config),
    // keep status=active but record the error so the admin knows config is needed.
    await this.tryStartPlugin(id, row.package_name, row.config);

    return this.getPluginOrThrow(id);
  }

  /**
   * Attempt to load and start a plugin's code. On failure, records the error
   * but does NOT change the plugin status — it stays active (enabled).
   */
  private async tryStartPlugin(id: string, packageName: string, configJson: string): Promise<void> {
    try {
      const manifest = this.readManifest(packageName);
      const config = JSON.parse(configJson) as Record<string, unknown>;
      const decrypted = decryptConfig(config, manifest.configSchema, this.encryptionKey);

      const pluginPath = this.resolvePluginPath(packageName);
      const instance = await this.loaderFn(pluginPath);
      await instance.activate(decrypted);

      this.activeInstances.set(id, instance);
      this.healthFailures.set(id, 0);

      // Clear any previous error on successful start
      this.db
        .prepare('UPDATE plugins SET error = NULL WHERE id = @id')
        .run({ id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.db
        .prepare('UPDATE plugins SET error = @error WHERE id = @id')
        .run({ id, error: message });
    }
  }

  // -----------------------------------------------------------------------
  // Deactivate
  // -----------------------------------------------------------------------

  async deactivate(id: string): Promise<PluginRecord> {
    const row = this.getRow(id);
    if (!row) {
      throw new Error(`Plugin "${id}" not found`);
    }

    const instance = this.activeInstances.get(id);
    if (instance) {
      await instance.deactivate();
      this.activeInstances.delete(id);
    }

    this.healthFailures.delete(id);

    this.db
      .prepare(
        'UPDATE plugins SET status = @status, activated_at = NULL, error = NULL WHERE id = @id',
      )
      .run({ id, status: 'inactive' });

    return this.getPluginOrThrow(id);
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  async remove(id: string): Promise<void> {
    const row = this.getRow(id);
    if (!row) {
      throw new Error(`Plugin "${id}" not found`);
    }

    if (row.status === 'active') {
      await this.deactivate(id);
    }

    // Deactivate and remove all org-specific copies that share this package
    const orgRows = this.db
      .prepare('SELECT id, status FROM plugins WHERE package_name = @pkg AND id != @id')
      .all({ pkg: row.package_name, id }) as Array<{ id: string; status: string }>;

    for (const orgRow of orgRows) {
      if (orgRow.status === 'active') {
        await this.deactivate(orgRow.id);
      }
    }

    // Delete all rows for this package (global + org-specific)
    this.db.prepare('DELETE FROM plugins WHERE package_name = @pkg').run({ pkg: row.package_name });

    const pkgDir = this.resolvePackageDir(row.package_name);
    if (existsSync(pkgDir)) {
      rmSync(pkgDir, { recursive: true, force: true });
    }
  }

  // -----------------------------------------------------------------------
  // Registry
  // -----------------------------------------------------------------------

  getRegistryEntries(): readonly RegistryEntry[] {
    return this.registryEntries;
  }

  // -----------------------------------------------------------------------
  // List / Get
  // -----------------------------------------------------------------------

  list(orgId?: string): PluginRecord[] {
    const sql = orgId !== undefined
      ? "SELECT * FROM plugins WHERE org_id = @orgId OR org_id = 'system' ORDER BY installed_at DESC"
      : 'SELECT * FROM plugins ORDER BY installed_at DESC';
    const rows = orgId !== undefined
      ? this.db.prepare(sql).all({ orgId }) as PluginRow[]
      : this.db.prepare(sql).all() as PluginRow[];

    return rows.map((row) => {
      const config = JSON.parse(row.config) as Record<string, unknown>;
      const manifest = this.tryReadManifest(row.package_name);
      const masked = manifest
        ? maskSecrets(config, manifest.configSchema)
        : config;
      return rowToRecord(row, masked);
    });
  }

  /**
   * Get the effective plugin config for an org context.
   * Returns org-specific config if it exists, otherwise falls back to global (system) config.
   */
  getPluginConfigForOrg(packageName: string, orgId: string): Record<string, unknown> | null {
    // First try org-specific config
    const orgRow = this.db
      .prepare("SELECT * FROM plugins WHERE package_name = @pkg AND org_id = @orgId AND status = 'active'")
      .get({ pkg: packageName, orgId }) as PluginRow | undefined;

    if (orgRow) {
      const manifest = this.tryReadManifest(orgRow.package_name);
      const raw = JSON.parse(orgRow.config) as Record<string, unknown>;
      return manifest
        ? decryptConfig(raw, manifest.configSchema, this.encryptionKey)
        : raw;
    }

    // Fall back to global (system) config
    const globalRow = this.db
      .prepare("SELECT * FROM plugins WHERE package_name = @pkg AND org_id = 'system' AND status = 'active'")
      .get({ pkg: packageName }) as PluginRow | undefined;

    if (globalRow) {
      const manifest = this.tryReadManifest(globalRow.package_name);
      const raw = JSON.parse(globalRow.config) as Record<string, unknown>;
      return manifest
        ? decryptConfig(raw, manifest.configSchema, this.encryptionKey)
        : raw;
    }

    return null;
  }

  /**
   * Create or update an org-specific plugin configuration.
   * This clones a global plugin entry for a specific org with custom config.
   */
  async configureForOrg(
    packageName: string,
    orgId: string,
    config: Record<string, unknown>,
  ): Promise<PluginRecord> {
    // Check if org-specific entry already exists
    const existing = this.db
      .prepare('SELECT * FROM plugins WHERE package_name = @pkg AND org_id = @orgId')
      .get({ pkg: packageName, orgId }) as PluginRow | undefined;

    const manifest = this.readManifest(packageName);
    const encrypted = encryptConfig(config, manifest.configSchema, this.encryptionKey);

    if (existing) {
      this.db
        .prepare('UPDATE plugins SET config = @config WHERE id = @id')
        .run({ id: existing.id, config: JSON.stringify(encrypted) });
      return this.getPluginOrThrow(existing.id);
    }

    // Create new org-specific entry (clone from global)
    const globalRow = this.db
      .prepare("SELECT * FROM plugins WHERE package_name = @pkg AND org_id = 'system'")
      .get({ pkg: packageName }) as PluginRow | undefined;

    if (!globalRow) {
      throw new Error(`Plugin "${packageName}" not found globally`);
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(`INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum, org_id)
               VALUES (@id, @pkg, @type, @version, @config, @status, @installed_at, @checksum, @orgId)`)
      .run({
        id,
        pkg: packageName,
        type: globalRow.type,
        version: globalRow.version,
        config: JSON.stringify(encrypted),
        status: globalRow.status,
        installed_at: now,
        checksum: globalRow.checksum,
        orgId,
      });

    return this.getPluginOrThrow(id);
  }

  /**
   * Activate a plugin for a specific organization.
   * If an org-specific row exists, updates its status.
   * If not, clones the global row for this org and sets it to active.
   */
  async activateForOrg(pluginId: string, orgId: string): Promise<PluginRecord> {
    const row = this.getRow(pluginId);
    if (!row) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }

    // If this row already belongs to the org, just activate it
    if (row.org_id === orgId) {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE plugins SET status = @status, activated_at = @activated_at, error = NULL WHERE id = @id')
        .run({ id: pluginId, status: 'active', activated_at: now });
      return this.getPluginOrThrow(pluginId);
    }

    // Otherwise, create an org-specific entry (clone from this row)
    const existing = this.db
      .prepare('SELECT * FROM plugins WHERE package_name = @pkg AND org_id = @orgId')
      .get({ pkg: row.package_name, orgId }) as PluginRow | undefined;

    if (existing) {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE plugins SET status = @status, activated_at = @activated_at, error = NULL WHERE id = @id')
        .run({ id: existing.id, status: 'active', activated_at: now });
      return this.getPluginOrThrow(existing.id);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum, org_id, activated_at)
               VALUES (@id, @pkg, @type, @version, @config, @status, @installed_at, @checksum, @orgId, @activated_at)`)
      .run({
        id,
        pkg: row.package_name,
        type: row.type,
        version: row.version,
        config: row.config,
        status: 'active',
        installed_at: now,
        checksum: row.checksum,
        orgId,
        activated_at: now,
      });
    return this.getPluginOrThrow(id);
  }

  /**
   * Deactivate a plugin for a specific organization.
   * Only affects the org-specific row; the global plugin remains unchanged.
   */
  async deactivateForOrg(pluginId: string, orgId: string): Promise<PluginRecord> {
    const row = this.getRow(pluginId);
    if (!row) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }

    if (row.org_id !== orgId) {
      // Find org-specific row by package name
      const orgRow = this.db
        .prepare('SELECT * FROM plugins WHERE package_name = @pkg AND org_id = @orgId')
        .get({ pkg: row.package_name, orgId }) as PluginRow | undefined;

      if (!orgRow) {
        throw new Error(`Plugin "${row.package_name}" is not configured for this organization`);
      }

      this.db
        .prepare('UPDATE plugins SET status = @status, activated_at = NULL, error = NULL WHERE id = @id')
        .run({ id: orgRow.id, status: 'inactive' });
      return this.getPluginOrThrow(orgRow.id);
    }

    this.db
      .prepare('UPDATE plugins SET status = @status, activated_at = NULL, error = NULL WHERE id = @id')
      .run({ id: pluginId, status: 'inactive' });
    return this.getPluginOrThrow(pluginId);
  }

  getPlugin(id: string): PluginRecord | null {
    const row = this.getRow(id);
    if (!row) {
      return null;
    }
    const config = JSON.parse(row.config) as Record<string, unknown>;
    return rowToRecord(row, config);
  }

  /** Public manifest reader — used by admin routes. */
  getManifest(id: string): PluginManifest | null {
    const row = this.getRow(id);
    if (!row) return null;
    return this.tryReadManifest(row.package_name);
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async checkHealth(id: string): Promise<{ ok: boolean; message?: string }> {
    const instance = this.activeInstances.get(id);
    if (!instance) {
      return { ok: false, message: 'Plugin not active' };
    }

    try {
      const ok = await instance.healthCheck();
      if (ok) {
        this.healthFailures.set(id, 0);
        return { ok: true };
      }

      const failures = (this.healthFailures.get(id) ?? 0) + 1;
      this.healthFailures.set(id, failures);

      if (failures >= HEALTH_FAILURE_THRESHOLD) {
        const manifest = instance.manifest;
        if (manifest.autoDeactivateOnFailure) {
          await this.deactivate(id);
          return { ok: false, message: 'Auto-deactivated after repeated failures' };
        }
        this.db
          .prepare('UPDATE plugins SET status = @status WHERE id = @id')
          .run({ id, status: 'unhealthy' });
        return { ok: false, message: 'Marked unhealthy after repeated failures' };
      }

      return { ok: false, message: `Health check failed (${failures}/${HEALTH_FAILURE_THRESHOLD})` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const failures = (this.healthFailures.get(id) ?? 0) + 1;
      this.healthFailures.set(id, failures);

      if (failures >= HEALTH_FAILURE_THRESHOLD) {
        this.db
          .prepare('UPDATE plugins SET status = @status WHERE id = @id')
          .run({ id, status: 'unhealthy' });
      }

      return { ok: false, message };
    }
  }

  // -----------------------------------------------------------------------
  // Startup & background health
  // -----------------------------------------------------------------------

  async initializeOnStartup(): Promise<void> {
    const rows = this.db
      .prepare("SELECT * FROM plugins WHERE status = 'active'")
      .all() as PluginRow[];

    for (const row of rows) {
      // Status stays active — just try to start the plugin code
      await this.tryStartPlugin(row.id, row.package_name, row.config);
    }
  }

  startHealthChecks(intervalMs: number = 30_000): void {
    this.stopHealthChecks();
    this.healthInterval = setInterval(async () => {
      for (const id of this.activeInstances.keys()) {
        await this.checkHealth(id);
      }
    }, intervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // -----------------------------------------------------------------------
  // Get active plugins by type
  // -----------------------------------------------------------------------

  getActivePluginsByType(type: string): PluginInstance[] {
    const rows = this.db
      .prepare("SELECT id FROM plugins WHERE type = @type AND status = 'active'")
      .all({ type }) as Array<{ id: string }>;

    const instances: PluginInstance[] = [];
    for (const row of rows) {
      const instance = this.activeInstances.get(row.id);
      if (instance) {
        instances.push(instance);
      }
    }
    return instances;
  }

  getActivePluginConfigs(
    type: string,
  ): Array<{ readonly id: string; readonly config: Readonly<Record<string, unknown>> }> {
    const rows = this.db
      .prepare("SELECT * FROM plugins WHERE type = @type AND status = 'active'")
      .all({ type }) as PluginRow[];

    const results: Array<{ id: string; config: Record<string, unknown> }> = [];
    for (const row of rows) {
      const manifest = this.tryReadManifest(row.package_name);
      const raw = JSON.parse(row.config) as Record<string, unknown>;
      const config = manifest
        ? decryptConfig(raw, manifest.configSchema, this.encryptionKey)
        : raw;
      results.push({ id: row.id, config });
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Get active instance by package name
  // -----------------------------------------------------------------------

  getActiveInstance(id: string): PluginInstance | null {
    return this.activeInstances.get(id) ?? null;
  }

  getActiveInstanceByPackageName(packageName: string): PluginInstance | null {
    const row = this.db
      .prepare("SELECT id FROM plugins WHERE package_name = @package_name AND status = 'active'")
      .get({ package_name: packageName }) as { id: string } | undefined;

    if (!row) return null;
    return this.activeInstances.get(row.id) ?? null;
  }

  // -----------------------------------------------------------------------
  // Active admin pages (plugin-declared sidebar items)
  // -----------------------------------------------------------------------

  getActiveAdminPages(): Array<{ path: string; title: string; icon: string; permission: string; pluginName: string }> {
    const activePackageNames = new Set<string>();
    const rows = this.db
      .prepare("SELECT package_name FROM plugins WHERE status = 'active'")
      .all() as Array<{ package_name: string }>;
    for (const row of rows) {
      activePackageNames.add(row.package_name);
    }

    const pages: Array<{ path: string; title: string; icon: string; permission: string; pluginName: string }> = [];
    for (const entry of this.registryEntries) {
      if (!activePackageNames.has(entry.packageName)) continue;
      if (!entry.adminPages) continue;
      for (const page of entry.adminPages) {
        pages.push({ ...page, pluginName: entry.name });
      }
    }
    return pages;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getRow(id: string): PluginRow | undefined {
    return this.db
      .prepare('SELECT * FROM plugins WHERE id = @id')
      .get({ id }) as PluginRow | undefined;
  }

  private getPluginOrThrow(id: string): PluginRecord {
    const plugin = this.getPlugin(id);
    if (!plugin) {
      throw new Error(`Plugin "${id}" not found after operation`);
    }
    return plugin;
  }

  /**
   * Resolve the package directory — checks new layout first, falls back to legacy.
   * New: pluginsDir/packages/{name}/
   * Legacy: pluginsDir/node_modules/@scope/plugin-name/
   */
  private resolvePackageDir(packageName: string): string {
    const name = packageNameToPluginName(packageName);
    const newPath = join(this.pluginsDir, 'packages', name);
    if (existsSync(newPath)) return newPath;

    // Legacy layout (npm-installed plugins)
    return join(this.pluginsDir, 'node_modules', ...packageName.split('/'));
  }

  private resolvePluginPath(packageName: string): string {
    const pkgDir = resolve(this.resolvePackageDir(packageName));
    // Try to read package.json for the "main" entry point
    try {
      const pkgJsonPath = join(pkgDir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { main?: string };
      if (pkgJson.main) {
        return join(pkgDir, pkgJson.main);
      }
    } catch { /* fall through to default */ }
    // Default: look for dist/index.js or index.js
    const distIndex = join(pkgDir, 'dist', 'index.js');
    if (existsSync(distIndex)) return distIndex;
    return join(pkgDir, 'index.js');
  }

  private readManifest(packageName: string): PluginManifest {
    const manifestPath = join(this.resolvePackageDir(packageName), 'manifest.json');
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as PluginManifest;
  }

  private tryReadManifest(packageName: string): PluginManifest | null {
    try {
      return this.readManifest(packageName);
    } catch {
      return null;
    }
  }

}
