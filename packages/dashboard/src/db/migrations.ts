import type Database from 'better-sqlite3';

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly id: string;
  readonly name: string;
  readonly applied_at: string;
}

const CREATE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export class MigrationRunner {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  run(migrations: readonly Migration[]): void {
    this.db.exec(CREATE_SCHEMA_MIGRATIONS_SQL);

    const appliedIds = new Set(
      (this.db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>)
        .map((row) => row.id),
    );

    const insert = this.db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (@id, @name, @applied_at)',
    );

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      this.db.transaction(() => {
        this.db.exec(migration.sql);
        insert.run({
          id: migration.id,
          name: migration.name,
          applied_at: new Date().toISOString(),
        });
      })();
    }
  }

  getApplied(): AppliedMigration[] {
    const rows = this.db
      .prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: string; name: string; applied_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      applied_at: row.applied_at,
    }));
  }
}
