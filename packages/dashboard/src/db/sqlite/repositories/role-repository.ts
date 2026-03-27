import type Database from 'better-sqlite3';
import type { RoleRepository } from '../../interfaces/role-repository.js';
import type { Role } from '../../types.js';
import { ALL_PERMISSION_IDS } from '../../../permissions.js';

// ---------------------------------------------------------------------------
// Private row type
// ---------------------------------------------------------------------------

interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_system: number;
  org_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// SqliteRoleRepository
// ---------------------------------------------------------------------------

export class SqliteRoleRepository implements RoleRepository {
  constructor(private readonly db: Database.Database) {}

  async listRoles(orgId?: string): Promise<Role[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push("(org_id = @orgId OR org_id = 'system')");
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM roles ${where} ORDER BY is_system DESC, name ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as RoleRow[];
    return rows.map((row) => this.roleRowToRecord(row));
  }

  async getRole(id: string): Promise<Role | null> {
    const stmt = this.db.prepare('SELECT * FROM roles WHERE id = ?');
    const row = stmt.get(id) as RoleRow | undefined;
    return row !== undefined ? this.roleRowToRecord(row) : null;
  }

  async getRoleByName(name: string): Promise<Role | null> {
    const stmt = this.db.prepare('SELECT * FROM roles WHERE name = ?');
    const row = stmt.get(name) as RoleRow | undefined;
    return row !== undefined ? this.roleRowToRecord(row) : null;
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const stmt = this.db.prepare(
      'SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission',
    );
    const rows = stmt.all(roleId) as Array<{ permission: string }>;
    return rows.map((r) => r.permission);
  }

  async createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Promise<Role> {
    const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const insertRole = this.db.prepare(`
      INSERT INTO roles (id, name, description, is_system, org_id, created_at)
      VALUES (@id, @name, @description, 0, @orgId, @createdAt)
    `);

    const insertPerm = this.db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (@roleId, @permission)',
    );

    this.db.transaction(() => {
      insertRole.run({
        id,
        name: data.name,
        description: data.description,
        orgId: data.orgId,
        createdAt: now,
      });

      for (const permission of data.permissions) {
        insertPerm.run({ roleId: id, permission });
      }
    })();

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

    this.db.transaction(() => {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id };

      if (data.description !== undefined) {
        setClauses.push('description = @description');
        params['description'] = data.description;
      }
      if (data.name !== undefined && !role.isSystem) {
        setClauses.push('name = @name');
        params['name'] = data.name;
      }

      if (setClauses.length > 0) {
        this.db.prepare(
          `UPDATE roles SET ${setClauses.join(', ')} WHERE id = @id`,
        ).run(params);
      }

      if (data.permissions !== undefined) {
        this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
        const insertPerm = this.db.prepare(
          'INSERT INTO role_permissions (role_id, permission) VALUES (@roleId, @permission)',
        );
        for (const permission of data.permissions) {
          insertPerm.run({ roleId: id, permission });
        }
      }
    })();
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }
    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }
    this.db.prepare('DELETE FROM roles WHERE id = ? AND is_system = 0').run(id);
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const userRow = this.db.prepare(
      'SELECT role FROM dashboard_users WHERE id = ?',
    ).get(userId) as { role: string } | undefined;

    if (userRow === undefined) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    const role = await this.getRoleByName(userRow.role);
    if (role === null) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    if (role.name === 'admin') {
      return new Set(ALL_PERMISSION_IDS);
    }

    return new Set(role.permissions);
  }

  async getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>> {
    // 1. Start with global (system) role permissions
    const globalPerms = await this.getUserPermissions(userId);

    // Admin users already get all permissions from getUserPermissions
    if (globalPerms.size === ALL_PERMISSION_IDS.length) {
      return globalPerms;
    }

    // 2. If no org context, return global permissions only
    if (orgId === undefined || orgId === '' || orgId === 'system') {
      return globalPerms;
    }

    // 3. Find all teams the user belongs to in this org, and their role_ids
    const teamRoles = this.db.prepare(`
      SELECT DISTINCT t.role_id
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? AND t.org_id = ? AND t.role_id IS NOT NULL
    `).all(userId, orgId) as Array<{ role_id: string }>;

    if (teamRoles.length === 0) {
      return globalPerms;
    }

    // 4. For each team role, collect permissions. "Highest" = union of all
    //    team roles (since we want max permissions across all teams).
    const result = new Set(globalPerms);

    for (const { role_id } of teamRoles) {
      const perms = this.db.prepare(
        'SELECT permission FROM role_permissions WHERE role_id = ?',
      ).all(role_id) as Array<{ permission: string }>;

      for (const { permission } of perms) {
        result.add(permission);
      }
    }

    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private roleRowToRecord(row: RoleRow): Role {
    const permissions = this.db.prepare(
      'SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission',
    ).all(row.id) as Array<{ permission: string }>;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.is_system === 1,
      orgId: row.org_id,
      createdAt: row.created_at,
      permissions: permissions.map((r) => r.permission),
    };
  }
}
