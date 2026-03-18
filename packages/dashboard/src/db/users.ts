import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

export interface DashboardUser {
  readonly id: string;
  readonly username: string;
  readonly role: 'admin' | 'developer' | 'editor' | 'user' | 'viewer' | 'executive';
  readonly active: boolean;
  readonly createdAt: string;
}

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

export class UserDb {
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

    const created = this.getUserById(id);
    if (created === null) {
      throw new Error(`Failed to retrieve user after creation: ${id}`);
    }
    return created;
  }

  getUserByUsername(username: string): DashboardUser | null {
    const stmt = this.db.prepare(
      'SELECT id, username, role, active, created_at FROM dashboard_users WHERE username = ?',
    );
    const row = stmt.get(username) as UserRow | undefined;
    return row !== undefined ? rowToUser(row) : null;
  }

  getUserById(id: string): DashboardUser | null {
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

  listUsers(): DashboardUser[] {
    const stmt = this.db.prepare(
      'SELECT id, username, role, active, created_at FROM dashboard_users ORDER BY created_at ASC',
    );
    const rows = stmt.all() as UserRow[];
    return rows.map(rowToUser);
  }

  updateUserRole(id: string, role: string): void {
    const stmt = this.db.prepare('UPDATE dashboard_users SET role = ? WHERE id = ?');
    stmt.run(role, id);
  }

  deactivateUser(id: string): void {
    const stmt = this.db.prepare('UPDATE dashboard_users SET active = 0 WHERE id = ?');
    stmt.run(id);
  }

  activateUser(id: string): void {
    const stmt = this.db.prepare('UPDATE dashboard_users SET active = 1 WHERE id = ?');
    stmt.run(id);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const stmt = this.db.prepare('UPDATE dashboard_users SET password_hash = ? WHERE id = ?');
    stmt.run(passwordHash, id);
  }

  deleteUser(id: string): boolean {
    const result = this.db.prepare('DELETE FROM dashboard_users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  countUsers(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM dashboard_users');
    const row = stmt.get() as { count: number };
    return row.count;
  }
}
