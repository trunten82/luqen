import type Database from 'better-sqlite3';
import type { PluginRepository } from '../../interfaces/plugin-repository.js';
import type { PluginRecord } from '../../types.js';
import type { PluginType, PluginStatus } from '../../../plugins/types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

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

function rowToRecord(row: PluginRow): PluginRecord {
  const config = JSON.parse(row.config) as Record<string, unknown>;
  return {
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
}

// ---------------------------------------------------------------------------
// SqlitePluginRepository
// ---------------------------------------------------------------------------

export class SqlitePluginRepository implements PluginRepository {
  constructor(private readonly db: Database.Database) {}

  async listPlugins(): Promise<PluginRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM plugins ORDER BY installed_at DESC')
      .all() as PluginRow[];
    return rows.map(rowToRecord);
  }

  async getPlugin(id: string): Promise<PluginRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM plugins WHERE id = ?')
      .get(id) as PluginRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  async getPluginByPackageName(packageName: string): Promise<PluginRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM plugins WHERE package_name = ?')
      .get(packageName) as PluginRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  async listByTypeAndStatus(type: string, status: string): Promise<PluginRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM plugins WHERE type = @type AND status = @status ORDER BY installed_at DESC')
      .all({ type, status }) as PluginRow[];
    return rows.map(rowToRecord);
  }

  async listByStatus(status: string): Promise<PluginRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM plugins WHERE status = @status ORDER BY installed_at DESC')
      .all({ status }) as PluginRow[];
    return rows.map(rowToRecord);
  }

  async getByPackageNameAndStatus(packageName: string, status: string): Promise<PluginRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM plugins WHERE package_name = @packageName AND status = @status')
      .get({ packageName, status }) as PluginRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  async createPlugin(data: {
    readonly id: string;
    readonly packageName: string;
    readonly type: string;
    readonly version: string;
    readonly config?: Record<string, unknown>;
    readonly status?: string;
  }): Promise<PluginRecord> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @packageName, @type, @version, @config, @status, @installedAt)`,
      )
      .run({
        id: data.id,
        packageName: data.packageName,
        type: data.type,
        version: data.version,
        config: JSON.stringify(data.config ?? {}),
        status: data.status ?? 'inactive',
        installedAt: now,
      });

    const created = await this.getPlugin(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve plugin after creation: ${data.id}`);
    }
    return created;
  }

  async updatePlugin(id: string, data: Partial<{
    status: string;
    config: Record<string, unknown>;
    version: string;
    activatedAt: string | null;
    error: string | null;
  }>): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (data.status !== undefined) {
      setClauses.push('status = @status');
      params['status'] = data.status;
    }
    if (data.config !== undefined) {
      setClauses.push('config = @config');
      params['config'] = JSON.stringify(data.config);
    }
    if (data.version !== undefined) {
      setClauses.push('version = @version');
      params['version'] = data.version;
    }
    if (data.activatedAt !== undefined) {
      setClauses.push('activated_at = @activatedAt');
      params['activatedAt'] = data.activatedAt;
    }
    if (data.error !== undefined) {
      setClauses.push('error = @error');
      params['error'] = data.error;
    }

    if (setClauses.length === 0) return;

    this.db.prepare(
      `UPDATE plugins SET ${setClauses.join(', ')} WHERE id = @id`,
    ).run(params);
  }

  async deletePlugin(id: string): Promise<void> {
    this.db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
  }
}
