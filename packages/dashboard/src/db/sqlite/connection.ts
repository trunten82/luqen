import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export interface SqliteConnectionOptions {
  readonly dbPath: string;
  readonly walMode?: boolean;
  readonly foreignKeys?: boolean;
  /** SQLite busy timeout in milliseconds. Default: 5000 (5 seconds). */
  readonly busyTimeout?: number;
}

export function createSqliteConnection(options: SqliteConnectionOptions): Database.Database {
  // Always resolve to absolute path so every process hits the same file
  // regardless of its current working directory.
  const absolutePath = resolve(options.dbPath);
  const db = new Database(absolutePath);
  if (options.walMode !== false) {
    db.pragma('journal_mode = WAL');
  }
  if (options.foreignKeys !== false) {
    db.pragma('foreign_keys = ON');
  }
  // Set busy timeout so concurrent writers (e.g. CLI + running service)
  // retry instead of failing immediately with SQLITE_BUSY.
  const timeout = options.busyTimeout ?? 5000;
  db.pragma(`busy_timeout = ${timeout}`);
  return db;
}
