/**
 * HARD-21: the per-request key check of a /login API-key session admits exactly what the API-key
 * sign-in admits (active, unexpired, organization 'system', role admin), and reads without writing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { apiKeyOpensDashboardSession, generateApiKey, storeApiKey } from '../../src/auth/api-key.js';
import { AuthService } from '../../src/auth/auth-service.js';
import type { PluginManager } from '../../src/plugins/manager.js';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-api-key-session-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);
});

const pluginManager = {
  getActivePluginsByType: vi.fn(() => []),
  getActivePluginConfigs: vi.fn(() => []),
} as unknown as PluginManager;

describe('HARD-21 the dashboard session key check', () => {
  it('HARD-21 the dashboard session key check admits what the api key sign in admits', () => {
    const db = storage.getRawDatabase();
    const service = new AuthService(db, pluginManager, storage);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const rows: string[] = [];
    let admitted = 0;
    for (const active of [1, 0]) {
      for (const expiresAt of [null, future, past]) {
        for (const orgId of ['system', 'org-fabrikam']) {
          for (const role of ['admin', 'read-only']) {
            const key = generateApiKey();
            const id = storeApiKey(db, key, 'Fabrikam key', role as 'admin' | 'read-only');
            db.prepare('UPDATE api_keys SET active = ?, expires_at = ?, org_id = ?, last_used_at = NULL WHERE id = ?')
              .run(active, expiresAt, orgId, id);

            const byId = apiKeyOpensDashboardSession(db, id);
            const lastUsed = (db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(id) as { last_used_at: string | null }).last_used_at;
            const signIn = service.checkApiKeyForDashboardLogin(key).status === 'ok';
            const label = `active=${active} expires=${expiresAt === null ? 'none' : expiresAt === past ? 'past' : 'future'} org=${orgId} role=${role}`;
            rows.push(`${label} byId=${byId} signIn=${signIn} lastUsedAfterById=${lastUsed}`);
            if (signIn) admitted += 1;

            expect(byId, rows.join('\n')).toBe(signIn);
            expect(lastUsed, rows.join('\n')).toBeNull();
          }
        }
      }
    }
    // The table holds both answers: two rows are admitted (active, system, admin, no expiry or a future one).
    expect(admitted, rows.join('\n')).toBe(2);
    expect(apiKeyOpensDashboardSession(db, 'no-such-key'), rows.join('\n')).toBe(false);
  });
});
