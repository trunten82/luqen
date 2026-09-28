/**
 * PBH-D — checkAtRestDecryption / logAtRestCheck / logAtRestKeyPosture.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  checkAtRestDecryption,
  logAtRestCheck,
  logAtRestKeyPosture,
} from '../../src/at-rest/startup-check.js';
import { seedAtRestFixture } from './seed.js';
import type { DashboardConfig } from '../../src/config.js';

function fakeLog() {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('checkAtRestDecryption (PBH-D)', () => {
  it('HC-1: ok under the right key with per-store checked counts; failed under a wrong key; empty on a fresh DB; failed (no-salt) when rows exist but the salt row is missing', async () => {
    const seeded = await seedAtRestFixture();

    const ok = checkAtRestDecryption(seeded.db, { encryptionKey: seeded.key, pluginsDir: seeded.pluginsDir });
    expect(ok.status).toBe('ok');
    const byStore = Object.fromEntries(ok.stores.map((s) => [s.store, s]));
    expect(byStore['oauth-signing-keys'].checked).toBe(2);
    expect(byStore['oauth-signing-keys'].failed).toBe(0);
    expect(byStore['service-connections'].checked).toBe(1);
    expect(byStore['git-credentials'].checked).toBe(1);
    expect(byStore['plugin-configs'].checked).toBe(3);

    const wrongKey = checkAtRestDecryption(seeded.db, { encryptionKey: `${seeded.key}-wrong`, pluginsDir: seeded.pluginsDir });
    expect(wrongKey.status).toBe('failed');
    const wrongByStore = Object.fromEntries(wrongKey.stores.map((s) => [s.store, s]));
    expect(wrongByStore['oauth-signing-keys'].failed).toBeGreaterThan(0);

    // Freshly migrated DB, no at-rest rows at all.
    const dir = mkdtempSync(join(tmpdir(), 'luqen-hc1-fresh-'));
    const freshDbPath = join(dir, 'dashboard.db');
    const freshStorage = new SqliteStorageAdapter(freshDbPath);
    await freshStorage.migrate();
    const freshDb = freshStorage.getRawDatabase();
    const empty = checkAtRestDecryption(freshDb, { encryptionKey: 'a'.repeat(32), pluginsDir: join(dir, 'plugins') });
    expect(empty.status).toBe('empty');
    await freshStorage.disconnect();

    // Rows present but the salt row is deliberately deleted.
    seeded.db.prepare(`DELETE FROM dashboard_settings WHERE key = 'encryption_salt'`).run();
    const noSalt = checkAtRestDecryption(seeded.db, { encryptionKey: seeded.key, pluginsDir: seeded.pluginsDir });
    expect(noSalt.status).toBe('failed');
    expect(noSalt.reason).toBe('no-salt');
  }, 20_000);

  it('HC-2: the ERROR log on failure names stores and counts, and contains no ciphertext, plaintext, key or path', async () => {
    const seeded = await seedAtRestFixture();
    const result = checkAtRestDecryption(seeded.db, { encryptionKey: `${seeded.key}-wrong`, pluginsDir: seeded.pluginsDir });
    expect(result.status).toBe('failed');

    const log = fakeLog();
    logAtRestCheck(log as never, result);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [payload] = log.error.mock.calls[0];
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('oauth-signing-keys');
    expect(serialized).toMatch(/"checked":\d+/);
    expect(serialized).toMatch(/"failed":\d+/);

    expect(serialized).not.toContain(seeded.key);
    for (const plaintext of Object.values(seeded.plaintexts)) {
      expect(serialized).not.toContain(plaintext);
    }
    expect(serialized).not.toContain(seeded.pluginsDir);
    expect(serialized).not.toContain(seeded.dbPath);
    // No iv:ciphertext:tag shaped value leaked either.
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{16,}={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]{16,}={0,2}/);
    expect(log.info).not.toHaveBeenCalled();
  }, 20_000);

  it('HC-2b: ok/empty log at INFO, never ERROR', async () => {
    const seeded = await seedAtRestFixture();
    const result = checkAtRestDecryption(seeded.db, { encryptionKey: seeded.key, pluginsDir: seeded.pluginsDir });
    expect(result.status).toBe('ok');

    const log = fakeLog();
    logAtRestCheck(log as never, result);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  }, 20_000);
});

describe('logAtRestKeyPosture (PBH-D, HC-3)', () => {
  it('HC-3: WARNs when the at-rest key shares the session secret; silent (no warn+) when distinct', () => {
    const shared = { sessionSecret: 'a'.repeat(32), encryptionKey: 'a'.repeat(32) } as DashboardConfig;
    const sharedLog = fakeLog();
    logAtRestKeyPosture(sharedLog as never, shared);
    expect(sharedLog.warn).toHaveBeenCalledTimes(1);
    const [warnMessage] = sharedLog.warn.mock.calls[0];
    expect(String(warnMessage)).toContain('DASHBOARD_ENCRYPTION_KEY');

    const distinct = { sessionSecret: 'a'.repeat(32), encryptionKey: 'b'.repeat(32) } as DashboardConfig;
    const distinctLog = fakeLog();
    logAtRestKeyPosture(distinctLog as never, distinct);
    expect(distinctLog.warn).not.toHaveBeenCalled();
    expect(distinctLog.error).not.toHaveBeenCalled();
  });
});
