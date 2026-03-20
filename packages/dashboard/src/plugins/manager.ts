import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);

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
}

type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

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
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
  return record;
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

  private execFileFn: ExecFileFn = execFileAsync;
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

  /** @internal Replace the exec function (for testing without real npm). */
  _setExecFile(fn: ExecFileFn): void {
    this.execFileFn = fn;
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
  // Install
  // -----------------------------------------------------------------------

  async install(packageName: string): Promise<PluginRecord> {
    const registryEntry = this.registryEntries.find((e) => e.packageName === packageName);
    if (!registryEntry) {
      throw new Error(`Package "${packageName}" not found in registry`);
    }

    await this.execFileFn('npm', [
      'install',
      '--save-exact',
      '--prefix',
      this.pluginsDir,
      packageName,
    ]);

    const manifest = this.readManifest(packageName);

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id,
        package_name: packageName,
        type: manifest.type,
        version: manifest.version,
        config: '{}',
        status: 'inactive',
        installed_at: now,
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

    const manifest = this.readManifest(row.package_name);
    const config = JSON.parse(row.config) as Record<string, unknown>;
    const decrypted = decryptConfig(config, manifest.configSchema, this.encryptionKey);

    try {
      const pluginPath = this.resolvePluginPath(row.package_name);
      const instance = await this.loaderFn(pluginPath);
      await instance.activate(decrypted);

      this.activeInstances.set(id, instance);
      this.healthFailures.set(id, 0);

      const now = new Date().toISOString();
      this.db
        .prepare(
          'UPDATE plugins SET status = @status, activated_at = @activated_at, error = NULL WHERE id = @id',
        )
        .run({ id, status: 'active', activated_at: now });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.db
        .prepare('UPDATE plugins SET status = @status, error = @error WHERE id = @id')
        .run({ id, status: 'error', error: message });
    }

    return this.getPluginOrThrow(id);
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

    this.db.prepare('DELETE FROM plugins WHERE id = @id').run({ id });

    const pkgDir = this.resolvePackageDir(row.package_name);
    if (existsSync(pkgDir)) {
      rmSync(pkgDir, { recursive: true, force: true });
    }
  }

  // -----------------------------------------------------------------------
  // List / Get
  // -----------------------------------------------------------------------

  list(): PluginRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM plugins ORDER BY installed_at DESC')
      .all() as PluginRow[];

    return rows.map((row) => {
      const config = JSON.parse(row.config) as Record<string, unknown>;
      const manifest = this.tryReadManifest(row.package_name);
      const masked = manifest
        ? maskSecrets(config, manifest.configSchema)
        : config;
      return rowToRecord(row, masked);
    });
  }

  getPlugin(id: string): PluginRecord | null {
    const row = this.getRow(id);
    if (!row) {
      return null;
    }
    const config = JSON.parse(row.config) as Record<string, unknown>;
    return rowToRecord(row, config);
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
      try {
        await this.activate(row.id);
      } catch {
        this.db
          .prepare('UPDATE plugins SET status = @status, error = @error WHERE id = @id')
          .run({ id: row.id, status: 'error', error: 'Failed to activate on startup' });
      }
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

  private resolvePackageDir(packageName: string): string {
    return join(this.pluginsDir, 'node_modules', ...packageName.split('/'));
  }

  private resolvePluginPath(packageName: string): string {
    return resolve(this.pluginsDir, 'node_modules', ...packageName.split('/'));
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
