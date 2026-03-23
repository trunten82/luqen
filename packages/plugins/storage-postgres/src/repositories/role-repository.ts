import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Role {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly orgId: string;
  readonly createdAt: string;
  readonly permissions: readonly string[];
}

interface RoleRepository {
  listRoles(orgId?: string): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  getRoleByName(name: string): Promise<Role | null>;
  getRolePermissions(roleId: string): Promise<string[]>;
  createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Promise<Role>;
  updateRole(id: string, data: {
    readonly name?: string;
    readonly description?: string;
    readonly permissions?: readonly string[];
  }): Promise<void>;
  deleteRole(id: string): Promise<void>;
  getUserPermissions(userId: string): Promise<Set<string>>;
}

// ---------------------------------------------------------------------------
// All permission IDs (mirrored from dashboard)
// ---------------------------------------------------------------------------

const ALL_PERMISSION_IDS = [
  'scans.create', 'scans.schedule',
  'reports.view', 'reports.view_technical', 'reports.export', 'reports.delete', 'reports.compare',
  'issues.assign', 'issues.fix',
  'manual_testing',
  'repos.manage',
  'trends.view',
  'admin.users', 'admin.roles', 'admin.system',
  'users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles',
  'audit.view',
];

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  org_id: string;
  created_at: string | Date;
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}

// ---------------------------------------------------------------------------
// PgRoleRepository
// ---------------------------------------------------------------------------

export class PgRoleRepository implements RoleRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listRoles(orgId?: string): Promise<Role[]> {
    let result: pg.QueryResult<RoleRow>;
    if (orgId !== undefined) {
      result = await this.pool.query<RoleRow>(
        "SELECT * FROM roles WHERE org_id = $1 OR org_id = 'system' ORDER BY is_system DESC, name ASC",
        [orgId],
      );
    } else {
      result = await this.pool.query<RoleRow>(
        'SELECT * FROM roles ORDER BY is_system DESC, name ASC',
      );
    }

    const roles: Role[] = [];
    for (const row of result.rows) {
      roles.push(await this.roleRowToRecord(row));
    }
    return roles;
  }

  async getRole(id: string): Promise<Role | null> {
    const result = await this.pool.query<RoleRow>(
      'SELECT * FROM roles WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.roleRowToRecord(result.rows[0]);
  }

  async getRoleByName(name: string): Promise<Role | null> {
    const result = await this.pool.query<RoleRow>(
      'SELECT * FROM roles WHERE name = $1',
      [name],
    );
    if (result.rows.length === 0) return null;
    return this.roleRowToRecord(result.rows[0]);
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const result = await this.pool.query<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role_id = $1 ORDER BY permission',
      [roleId],
    );
    return result.rows.map((r) => r.permission);
  }

  async createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Promise<Role> {
    const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO roles (id, name, description, is_system, org_id, created_at)
         VALUES ($1, $2, $3, false, $4, $5)`,
        [id, data.name, data.description, data.orgId, now],
      );

      for (const permission of data.permissions) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT (role_id, permission) DO NOTHING',
          [id, permission],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const created = await this.getRole(id);
    if (created === null) {
      throw new Error(`Failed to retrieve role after creation: ${id}`);
    }
    return created;
  }

  async updateRole(id: string, data: {
    readonly name?: string;
    readonly description?: string;
    readonly permissions?: readonly string[];
  }): Promise<void> {
    const role = await this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (data.description !== undefined) {
        setClauses.push(`description = $${idx++}`);
        params.push(data.description);
      }
      if (data.name !== undefined && !role.isSystem) {
        setClauses.push(`name = $${idx++}`);
        params.push(data.name);
      }

      if (setClauses.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE roles SET ${setClauses.join(', ')} WHERE id = $${idx}`,
          params,
        );
      }

      if (data.permissions !== undefined) {
        await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
        for (const permission of data.permissions) {
          await client.query(
            'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
            [id, permission],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }
    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }
    await this.pool.query('DELETE FROM roles WHERE id = $1 AND is_system = false', [id]);
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const userResult = await this.pool.query<{ role: string }>(
      'SELECT role FROM dashboard_users WHERE id = $1',
      [userId],
    );

    if (userResult.rows.length === 0) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    const role = await this.getRoleByName(userResult.rows[0].role);
    if (role === null) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    if (role.name === 'admin') {
      return new Set(ALL_PERMISSION_IDS);
    }

    return new Set(role.permissions);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async roleRowToRecord(row: RoleRow): Promise<Role> {
    const permResult = await this.pool.query<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role_id = $1 ORDER BY permission',
      [row.id],
    );

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.is_system,
      orgId: row.org_id,
      createdAt: toIso(row.created_at),
      permissions: permResult.rows.map((r) => r.permission),
    };
  }
}
