import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginType = 'auth' | 'notification' | 'storage' | 'scanner';
type PluginStatus = 'inactive' | 'active' | 'error' | 'install-failed' | 'unhealthy';

interface PluginRecord {
  readonly id: string;
  readonly packageName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly status: PluginStatus;
  readonly installedAt: string;
  readonly activatedAt?: string;
  readonly error?: string;
}

interface PluginRepository {
  listPlugins(): Promise<PluginRecord[]>;
  getPlugin(id: string): Promise<PluginRecord | null>;
  getPluginByPackageName(packageName: string): Promise<PluginRecord | null>;
  listByTypeAndStatus(type: string, status: string): Promise<PluginRecord[]>;
  listByStatus(status: string): Promise<PluginRecord[]>;
  getByPackageNameAndStatus(packageName: string, status: string): Promise<PluginRecord | null>;
  createPlugin(data: {
    readonly id: string;
    readonly packageName: string;
    readonly type: string;
    readonly version: string;
    readonly config?: Record<string, unknown>;
    readonly status?: string;
  }): Promise<PluginRecord>;
  updatePlugin(id: string, data: Partial<{
    status: string;
    config: Record<string, unknown>;
    version: string;
    activatedAt: string | null;
    error: string | null;
  }>): Promise<void>;
  deletePlugin(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface PluginRow {
  id: string;
  package_name: string;
  type: string;
  version: string;
  config: Record<string, unknown> | string;
  status: string;
  installed_at: string | Date;
  activated_at: string | Date | null;
  error: string | null;
}

function toIso(val: string | Date | null | undefined): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToRecord(row: PluginRow): PluginRecord {
  const config = typeof row.config === 'string'
    ? JSON.parse(row.config) as Record<string, unknown>
    : row.config;

  return {
    id: row.id,
    packageName: row.package_name,
    type: row.type as PluginType,
    version: row.version,
    config,
    status: row.status as PluginStatus,
    installedAt: toIso(row.installed_at)!,
    ...(row.activated_at ? { activatedAt: toIso(row.activated_at) } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// PgPluginRepository
// ---------------------------------------------------------------------------

export class PgPluginRepository implements PluginRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listPlugins(): Promise<PluginRecord[]> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins ORDER BY installed_at DESC',
    );
    return result.rows.map(rowToRecord);
  }

  async getPlugin(id: string): Promise<PluginRecord | null> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
  }

  async getPluginByPackageName(packageName: string): Promise<PluginRecord | null> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins WHERE package_name = $1',
      [packageName],
    );
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
  }

  async listByTypeAndStatus(type: string, status: string): Promise<PluginRecord[]> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins WHERE type = $1 AND status = $2 ORDER BY installed_at DESC',
      [type, status],
    );
    return result.rows.map(rowToRecord);
  }

  async listByStatus(status: string): Promise<PluginRecord[]> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins WHERE status = $1 ORDER BY installed_at DESC',
      [status],
    );
    return result.rows.map(rowToRecord);
  }

  async getByPackageNameAndStatus(packageName: string, status: string): Promise<PluginRecord | null> {
    const result = await this.pool.query<PluginRow>(
      'SELECT * FROM plugins WHERE package_name = $1 AND status = $2',
      [packageName, status],
    );
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
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

    await this.pool.query(
      `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        data.id,
        data.packageName,
        data.type,
        data.version,
        JSON.stringify(data.config ?? {}),
        data.status ?? 'inactive',
        now,
      ],
    );

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
    const params: unknown[] = [];
    let idx = 1;

    if (data.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(data.status);
    }
    if (data.config !== undefined) {
      setClauses.push(`config = $${idx++}`);
      params.push(JSON.stringify(data.config));
    }
    if (data.version !== undefined) {
      setClauses.push(`version = $${idx++}`);
      params.push(data.version);
    }
    if (data.activatedAt !== undefined) {
      setClauses.push(`activated_at = $${idx++}`);
      params.push(data.activatedAt);
    }
    if (data.error !== undefined) {
      setClauses.push(`error = $${idx++}`);
      params.push(data.error);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    await this.pool.query(
      `UPDATE plugins SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  async deletePlugin(id: string): Promise<void> {
    await this.pool.query('DELETE FROM plugins WHERE id = $1', [id]);
  }
}
