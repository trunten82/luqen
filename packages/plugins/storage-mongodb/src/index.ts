import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '../../../dashboard/src/plugins/types.js';
import { createMongoConnection, type MongoConnection, type MongoConnectionOptions } from './connection.js';
import { createIndexes } from './indexes.js';
import {
  MongoScanRepository, MongoUserRepository, MongoOrgRepository,
  MongoScheduleRepository, MongoAssignmentRepository, MongoRepoRepository,
  MongoRoleRepository, MongoTeamRepository, MongoEmailRepository,
  MongoAuditRepository, MongoPluginRepository, MongoApiKeyRepository,
  MongoPageHashRepository, MongoManualTestRepository,
} from './repositories/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadManifest(): PluginManifest {
  const manifestPath = resolve(__dirname, '..', 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
}

export default function createPlugin() {
  const manifest = loadManifest();

  let conn: MongoConnection | null = null;

  return {
    manifest,

    async activate(config: Readonly<Record<string, unknown>>): Promise<void> {
      const options: MongoConnectionOptions = {
        connectionUri: String(config['connectionUri'] ?? 'mongodb://localhost:27017'),
        database: String(config['database'] ?? 'luqen'),
        ...(config['authSource'] ? { authSource: String(config['authSource']) } : {}),
        ...(config['replicaSet'] ? { replicaSet: String(config['replicaSet']) } : {}),
        ...(config['tls'] !== undefined ? { tls: Boolean(config['tls']) } : {}),
      };

      conn = await createMongoConnection(options);
      await createIndexes(conn.db);
    },

    async deactivate(): Promise<void> {
      if (conn) {
        await conn.client.close();
        conn = null;
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!conn) return false;
      try {
        await conn.db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },

    /** Returns the StorageAdapter-compatible repositories. */
    getAdapter() {
      if (!conn) throw new Error('MongoDB plugin not activated');
      const db = conn.db;
      return {
        name: 'mongodb' as const,
        async connect() { /* already connected */ },
        async disconnect() { if (conn) await conn.client.close(); },
        async migrate() { await createIndexes(db); },
        async healthCheck() { try { await db.command({ ping: 1 }); return true; } catch { return false; } },
        scans: new MongoScanRepository(db),
        users: new MongoUserRepository(db),
        organizations: new MongoOrgRepository(db),
        schedules: new MongoScheduleRepository(db),
        assignments: new MongoAssignmentRepository(db),
        repos: new MongoRepoRepository(db),
        roles: new MongoRoleRepository(db),
        teams: new MongoTeamRepository(db),
        email: new MongoEmailRepository(db),
        audit: new MongoAuditRepository(db),
        plugins: new MongoPluginRepository(db),
        apiKeys: new MongoApiKeyRepository(db),
        pageHashes: new MongoPageHashRepository(db),
        manualTests: new MongoManualTestRepository(db),
      };
    },
  };
}
