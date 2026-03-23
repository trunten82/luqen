import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '../../../dashboard/src/plugins/types.js';
import { createPool, type PostgresConnectionOptions } from './connection.js';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from './migrations.js';
import {
  PgScanRepository, PgUserRepository, PgOrgRepository,
  PgScheduleRepository, PgAssignmentRepository, PgRepoRepository,
  PgRoleRepository, PgTeamRepository, PgEmailRepository,
  PgAuditRepository, PgPluginRepository, PgApiKeyRepository,
  PgPageHashRepository, PgManualTestRepository,
} from './repositories/index.js';
import type pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadManifest(): PluginManifest {
  const manifestPath = resolve(__dirname, '..', 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
}

export default function createPlugin() {
  const manifest = loadManifest();

  let pool: pg.Pool | null = null;

  return {
    manifest,

    async activate(config: Readonly<Record<string, unknown>>): Promise<void> {
      const options: PostgresConnectionOptions = {
        host: String(config['host'] ?? 'localhost'),
        port: Number(config['port'] ?? 5432),
        database: String(config['database'] ?? 'luqen'),
        username: String(config['username'] ?? ''),
        password: String(config['password'] ?? ''),
        ssl: Boolean(config['ssl'] ?? false),
        poolSize: Number(config['poolSize'] ?? 10),
      };

      pool = createPool(options);

      // Verify connection
      const client = await pool.connect();
      client.release();

      // Run migrations
      const runner = new MigrationRunner(pool);
      await runner.run(DASHBOARD_MIGRATIONS);
    },

    async deactivate(): Promise<void> {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!pool) return false;
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        return true;
      } catch {
        return false;
      }
    },

    /** Returns the StorageAdapter-compatible repositories. */
    getAdapter() {
      if (!pool) throw new Error('PostgreSQL plugin not activated');
      return {
        name: 'postgres' as const,
        async connect() { /* pool already connected */ },
        async disconnect() { if (pool) await pool.end(); },
        async migrate() { const r = new MigrationRunner(pool!); await r.run(DASHBOARD_MIGRATIONS); },
        async healthCheck() { try { await pool!.query('SELECT 1'); return true; } catch { return false; } },
        scans: new PgScanRepository(pool),
        users: new PgUserRepository(pool),
        organizations: new PgOrgRepository(pool),
        schedules: new PgScheduleRepository(pool),
        assignments: new PgAssignmentRepository(pool),
        repos: new PgRepoRepository(pool),
        roles: new PgRoleRepository(pool),
        teams: new PgTeamRepository(pool),
        email: new PgEmailRepository(pool),
        audit: new PgAuditRepository(pool),
        plugins: new PgPluginRepository(pool),
        apiKeys: new PgApiKeyRepository(pool),
        pageHashes: new PgPageHashRepository(pool),
        manualTests: new PgManualTestRepository(pool),
      };
    },
  };
}
