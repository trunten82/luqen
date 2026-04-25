import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { UserRepository } from '../../interfaces/user-repository.js';
import type { DashboardUser } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  active: number;
  created_at: string;
}

const BCRYPT_ROUNDS = 10;

function rowToUser(row: UserRow): DashboardUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role as DashboardUser['role'],
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteUserRepository
// ---------------------------------------------------------------------------

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Database.Database) {}

  async createUser(username: string, password: string, role: string): Promise<DashboardUser> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const stmt = this.db.prepare(`
      INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
      VALUES (@id, @username, @passwordHash, @role, 1, @createdAt)
    `);

    stmt.run({ id, username, passwordHash, role, createdAt });

    const created = await this.getUserById(id);
    if (created === null) {
      throw new Error(`Failed to retrieve user after creation: ${id}`);
    }
    return created;
  }

  async getUserByUsername(username: string): Promise<DashboardUser | null> {
    const stmt = this.db.prepare(
      'SELECT id, username, role, active, created_at FROM dashboard_users WHERE username = ?',
    );
    const row = stmt.get(username) as UserRow | undefined;
    return row !== undefined ? rowToUser(row) : null;
  }

  async getUserById(id: string): Promise<DashboardUser | null> {
    const stmt = this.db.prepare(
      'SELECT id, username, role, active, created_at FROM dashboard_users WHERE id = ?',
    );
    const row = stmt.get(id) as UserRow | undefined;
    return row !== undefined ? rowToUser(row) : null;
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const stmt = this.db.prepare(
      'SELECT password_hash, active FROM dashboard_users WHERE username = ?',
    );
    const row = stmt.get(username) as Pick<UserRow, 'password_hash' | 'active'> | undefined;

    if (row === undefined || row.active !== 1) {
      return false;
    }

    return bcrypt.compare(password, row.password_hash);
  }

  async listUsers(): Promise<DashboardUser[]> {
    const stmt = this.db.prepare(
      'SELECT id, username, role, active, created_at FROM dashboard_users ORDER BY created_at ASC',
    );
    const rows = stmt.all() as UserRow[];
    return rows.map(rowToUser);
  }

  async listUsersForOrg(orgId: string): Promise<DashboardUser[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT du.* FROM dashboard_users du
      WHERE du.active = 1
        AND du.id IN (
          SELECT tm.user_id FROM team_members tm
          JOIN teams t ON t.id = tm.team_id
          WHERE t.org_id = ?
        )
      ORDER BY du.username
    `).all(orgId) as UserRow[];
    return rows.map(rowToUser);
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    this.db.prepare('UPDATE dashboard_users SET role = ? WHERE id = ?').run(role, id);
  }

  async deactivateUser(id: string): Promise<void> {
    this.db.prepare('UPDATE dashboard_users SET active = 0 WHERE id = ?').run(id);
  }

  async activateUser(id: string): Promise<void> {
    this.db.prepare('UPDATE dashboard_users SET active = 1 WHERE id = ?').run(id);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    this.db.prepare('UPDATE dashboard_users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM dashboard_users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async countUsers(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM dashboard_users');
    const row = stmt.get() as { count: number };
    return row.count;
  }
}
