import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardUser {
  readonly id: string;
  readonly username: string;
  readonly role: 'admin' | 'developer' | 'editor' | 'user' | 'viewer' | 'executive';
  readonly active: boolean;
  readonly createdAt: string;
}

interface UserRepository {
  createUser(username: string, password: string, role: string): Promise<DashboardUser>;
  getUserByUsername(username: string): Promise<DashboardUser | null>;
  getUserById(id: string): Promise<DashboardUser | null>;
  verifyPassword(username: string, password: string): Promise<boolean>;
  listUsers(): Promise<DashboardUser[]>;
  updateUserRole(id: string, role: string): Promise<void>;
  deactivateUser(id: string): Promise<void>;
  activateUser(id: string): Promise<void>;
  updatePassword(id: string, newPassword: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
  countUsers(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  active: boolean;
  created_at: string | Date;
}

const BCRYPT_ROUNDS = 10;

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToUser(row: UserRow): DashboardUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role as DashboardUser['role'],
    active: row.active,
    createdAt: toIso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// PgUserRepository
// ---------------------------------------------------------------------------

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createUser(username: string, password: string, role: string): Promise<DashboardUser> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await this.pool.query(
      `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [id, username, passwordHash, role, createdAt],
    );

    const created = await this.getUserById(id);
    if (created === null) {
      throw new Error(`Failed to retrieve user after creation: ${id}`);
    }
    return created;
  }

  async getUserByUsername(username: string): Promise<DashboardUser | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, username, role, active, created_at FROM dashboard_users WHERE username = $1',
      [username],
    );
    return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
  }

  async getUserById(id: string): Promise<DashboardUser | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, username, role, active, created_at FROM dashboard_users WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const result = await this.pool.query<{ password_hash: string; active: boolean }>(
      'SELECT password_hash, active FROM dashboard_users WHERE username = $1',
      [username],
    );

    if (result.rows.length === 0 || !result.rows[0].active) {
      return false;
    }

    return bcrypt.compare(password, result.rows[0].password_hash);
  }

  async listUsers(): Promise<DashboardUser[]> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, username, role, active, created_at FROM dashboard_users ORDER BY created_at ASC',
    );
    return result.rows.map(rowToUser);
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    await this.pool.query('UPDATE dashboard_users SET role = $1 WHERE id = $2', [role, id]);
  }

  async deactivateUser(id: string): Promise<void> {
    await this.pool.query('UPDATE dashboard_users SET active = false WHERE id = $1', [id]);
  }

  async activateUser(id: string): Promise<void> {
    await this.pool.query('UPDATE dashboard_users SET active = true WHERE id = $1', [id]);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.pool.query('UPDATE dashboard_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM dashboard_users WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async countUsers(): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT COUNT(*) as count FROM dashboard_users');
    return parseInt(result.rows[0].count, 10);
  }
}
