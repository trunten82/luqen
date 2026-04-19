/**
 * Phase 31.1 Plan 01 Task 3 — StorageAdapter oauth_* wiring.
 *
 * Confirms that the sqlite adapter surfaces all five new oauth_*
 * repository fields with their correct concrete Sqlite* class.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  SqliteOauthClientRepository,
  SqliteOauthCodeRepository,
  SqliteOauthRefreshRepository,
  SqliteOauthConsentRepository,
  SqliteOauthSigningKeyRepository,
} from '../../src/db/sqlite/repositories/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteStorageAdapter — oauth_* wiring', () => {
  it('exposes all 5 oauth_* repos as instances of the correct Sqlite* class', () => {
    expect(storage.oauthClients).toBeInstanceOf(SqliteOauthClientRepository);
    expect(storage.oauthCodes).toBeInstanceOf(SqliteOauthCodeRepository);
    expect(storage.oauthRefresh).toBeInstanceOf(SqliteOauthRefreshRepository);
    expect(storage.oauthConsents).toBeInstanceOf(SqliteOauthConsentRepository);
    expect(storage.oauthSigningKeys).toBeInstanceOf(
      SqliteOauthSigningKeyRepository,
    );
  });
});
