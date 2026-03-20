import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../../src/db/migrations.js';
import type { Migration } from '../../src/db/migrations.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

function makeTempDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `test-migrations-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return { db, path };
}

const MIGRATION_A: Migration = {
  id: '001',
  name: 'create-users',
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `,
};

const MIGRATION_B: Migration = {
  id: '002',
  name: 'create-posts',
  sql: `
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL
    );
  `,
};

describe('MigrationRunner', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    db = result.db;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('creates schema_migrations table on first run', () => {
    const runner = new MigrationRunner(db);
    runner.run([]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('runs migrations in order', () => {
    const runner = new MigrationRunner(db);
    runner.run([MIGRATION_A, MIGRATION_B]);

    // Both tables should exist
    const users = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
    const posts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").all();
    expect(users).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });

  it('skips already-applied migrations (idempotent)', () => {
    const runner = new MigrationRunner(db);
    runner.run([MIGRATION_A]);
    runner.run([MIGRATION_A, MIGRATION_B]);

    const applied = runner.getApplied();
    expect(applied).toHaveLength(2);
    expect(applied[0].id).toBe('001');
    expect(applied[1].id).toBe('002');

    // The users table should still exist and not be recreated
    const users = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
    expect(users).toHaveLength(1);
  });

  it('records migration metadata (id, name, applied_at)', () => {
    const runner = new MigrationRunner(db);
    const beforeRun = new Date().toISOString();
    runner.run([MIGRATION_A]);

    const applied = runner.getApplied();
    expect(applied).toHaveLength(1);
    expect(applied[0].id).toBe('001');
    expect(applied[0].name).toBe('create-users');
    expect(applied[0].applied_at).toBeDefined();
    expect(applied[0].applied_at >= beforeRun).toBe(true);
  });

  it('returns list of applied migrations ordered by id', () => {
    const runner = new MigrationRunner(db);
    runner.run([MIGRATION_A, MIGRATION_B]);

    const applied = runner.getApplied();
    expect(applied).toHaveLength(2);
    expect(applied[0].id).toBe('001');
    expect(applied[0].name).toBe('create-users');
    expect(applied[1].id).toBe('002');
    expect(applied[1].name).toBe('create-posts');
  });

  it('returns empty array when no migrations applied', () => {
    const runner = new MigrationRunner(db);
    runner.run([]);

    const applied = runner.getApplied();
    expect(applied).toEqual([]);
  });
});
