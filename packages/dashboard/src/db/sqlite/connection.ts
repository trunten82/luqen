import Database from 'better-sqlite3';

export interface SqliteConnectionOptions {
  readonly dbPath: string;
  readonly walMode?: boolean;
  readonly foreignKeys?: boolean;
}

export function createSqliteConnection(options: SqliteConnectionOptions): Database.Database {
  const db = new Database(options.dbPath);
  if (options.walMode !== false) {
    db.pragma('journal_mode = WAL');
  }
  if (options.foreignKeys !== false) {
    db.pragma('foreign_keys = ON');
  }
  return db;
}
