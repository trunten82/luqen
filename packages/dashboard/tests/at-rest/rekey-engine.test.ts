/**
 * PBH-B Task 2 — rekeyAtRest engine: dry-run / apply / refuse / verify-after-write.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rekeyAtRest } from '../../src/at-rest/rekey.js';
import { AT_REST_STORES } from '../../src/at-rest/stores.js';
import { encryptSecret, setEncryptionSalt, LEGACY_DEFAULT_SALT, createAtRestCipher } from '../../src/plugins/crypto.js';
import { seedAtRestFixture } from './seed.js';
import type Database from 'better-sqlite3';

/** Snapshot every at-rest column value (table.column -> Map<rowKey, value>), for byte-identical comparisons. */
function snapshotAtRest(db: Database.Database, pluginsDir: string): Record<string, Record<string, string>> {
  const snapshot: Record<string, Record<string, string>> = {};
  for (const store of AT_REST_STORES) {
    const listed = store.list(db, { pluginsDir });
    const byRow: Record<string, string> = {};
    for (const ref of listed.refs) {
      byRow[`${ref.rowKey}:${ref.field}`] = ref.ciphertext;
    }
    snapshot[store.name] = byRow;
  }
  return snapshot;
}

describe('rekeyAtRest engine (PBH-B)', () => {
  it('RK-1: dry-run reports per-store counts matching the seed, zero failures, DB byte-identical', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;

    const before = snapshotAtRest(seeded.db, seeded.pluginsDir);
    const report = await rekeyAtRest(seeded.db, {
      oldKey: seeded.key,
      newKey,
      mode: 'dry-run',
      pluginsDir: seeded.pluginsDir,
    });
    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);

    expect(report.ok).toBe(true);
    expect(report.wrote).toBe(false);
    expect(report.failures).toEqual([]);

    const byStore = Object.fromEntries(report.stores.map((s) => [s.store, s]));
    expect(byStore['oauth-signing-keys'].count).toBe(2);
    expect(byStore['service-connections'].count).toBe(1);
    expect(byStore['service-connections'].skipped).toBe(1);
    expect(byStore['git-credentials'].count).toBe(1);
    expect(byStore['plugin-configs'].count).toBe(3);
    expect(byStore['plugin-configs'].viaManifest).toBe(2);
    expect(byStore['plugin-configs'].viaShape).toBe(1);

    expect(after).toEqual(before);
  }, 20_000);

  it('RK-2: apply re-keys every value; new key decrypts to seeded plaintext, old key throws; unrelated data unchanged', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;

    const report = await rekeyAtRest(seeded.db, {
      oldKey: seeded.key,
      newKey,
      mode: 'apply',
      pluginsDir: seeded.pluginsDir,
    });

    expect(report.ok).toBe(true);
    expect(report.wrote).toBe(true);
    expect(report.failures).toEqual([]);

    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    const newCipher = createAtRestCipher({ key: newKey, salt: readSalt(seeded.db) });
    const oldCipher = createAtRestCipher({ key: seeded.key, salt: readSalt(seeded.db) });

    const oauthRows = after['oauth-signing-keys'];
    const oauthCipherOrder = [seeded.plaintexts.oauthActive, seeded.plaintexts.oauthRetired];
    const oauthValues = Object.values(oauthRows);
    expect(oauthValues).toHaveLength(2);
    for (const value of oauthValues) {
      expect(oauthCipherOrder).toContain(newCipher.decrypt(value));
      expect(() => oldCipher.decrypt(value)).toThrow();
    }

    const svcKey = `${seeded.rowKeys.serviceConnectionId}:client_secret_encrypted`;
    expect(newCipher.decrypt(after['service-connections'][svcKey])).toBe(seeded.plaintexts.serviceConnectionSecret);
    expect(() => oldCipher.decrypt(after['service-connections'][svcKey])).toThrow();

    const gitKey = `${seeded.rowKeys.gitCredentialId}:encrypted_token`;
    expect(newCipher.decrypt(after['git-credentials'][gitKey])).toBe(seeded.plaintexts.gitCredentialToken);
    expect(() => oldCipher.decrypt(after['git-credentials'][gitKey])).toThrow();

    const pluginGlobalKey = `${seeded.rowKeys.pluginGlobalId}:apiKey`;
    expect(newCipher.decrypt(after['plugin-configs'][pluginGlobalKey])).toBe(seeded.plaintexts.pluginSecretGlobal);
    const pluginOrgKey = `${seeded.rowKeys.pluginOrgId}:apiKey`;
    expect(newCipher.decrypt(after['plugin-configs'][pluginOrgKey])).toBe(seeded.plaintexts.pluginSecretOrg);
    const pluginShapeKey = `${seeded.rowKeys.pluginNoManifestId}:apiKey`;
    expect(newCipher.decrypt(after['plugin-configs'][pluginShapeKey])).toBe(seeded.plaintexts.pluginNoManifestSecret);

    // Non-secret plugin field, public_key_pem, row counts unchanged.
    const globalRow = seeded.db
      .prepare(`SELECT config FROM plugins WHERE id = ?`)
      .get(seeded.rowKeys.pluginGlobalId) as { config: string };
    const parsedGlobal = JSON.parse(globalRow.config) as Record<string, unknown>;
    expect(parsedGlobal.webhookName).toBe('global-hook');

    const pluginCount = (seeded.db.prepare(`SELECT COUNT(*) as n FROM plugins`).get() as { n: number }).n;
    expect(pluginCount).toBe(3);
    const oauthCount = (seeded.db.prepare(`SELECT COUNT(*) as n FROM oauth_signing_keys`).get() as { n: number }).n;
    expect(oauthCount).toBe(2);
  }, 20_000);

  it('RK-3 (break-test, owner-requested): wrong old key -> refused, wrong-key-or-tampered, zero writes', async () => {
    const seeded = await seedAtRestFixture();
    const before = snapshotAtRest(seeded.db, seeded.pluginsDir);

    const report = await rekeyAtRest(seeded.db, {
      oldKey: `${seeded.key}-totally-wrong`,
      newKey: `${seeded.key}-new`,
      mode: 'apply',
      pluginsDir: seeded.pluginsDir,
    });

    expect(report.ok).toBe(false);
    expect(report.wrote).toBe(false);
    expect(report.refusedReason).toBe('decrypt-failures');
    expect(report.failures.length).toBeGreaterThan(0);
    for (const f of report.failures) {
      expect(f.class).toBe('wrong-key-or-tampered');
    }

    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(after).toEqual(before);
  }, 20_000);

  it('RK-4 (break-test): failure part-way through rolls back ALL stores, including an earlier successful write', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;
    const before = snapshotAtRest(seeded.db, seeded.pluginsDir);

    let observerCount = 0;
    seeded.db.function('at_rest_test_observer', () => {
      observerCount++;
      return null;
    });
    seeded.db.exec(`
      CREATE TRIGGER at_rest_test_oauth_observer AFTER UPDATE ON oauth_signing_keys
      BEGIN
        SELECT at_rest_test_observer();
      END;
    `);
    seeded.db.exec(`
      CREATE TRIGGER at_rest_test_git_abort AFTER UPDATE ON developer_credentials
      BEGIN
        SELECT RAISE(ABORT, 'at-rest-test-abort');
      END;
    `);

    let caught: unknown;
    let report: Awaited<ReturnType<typeof rekeyAtRest>> | undefined;
    try {
      report = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'apply', pluginsDir: seeded.pluginsDir });
    } catch (err) {
      caught = err;
    }

    seeded.db.exec(`DROP TRIGGER at_rest_test_oauth_observer;`);
    seeded.db.exec(`DROP TRIGGER at_rest_test_git_abort;`);

    expect(caught, 'rekeyAtRest should catch the abort internally and return a refused report, not throw').toBeUndefined();
    expect(report?.ok).toBe(false);
    expect(report?.wrote).toBe(false);
    expect(observerCount, 'the oauth write must have happened before the abort, proving the rollback was exercised').toBeGreaterThanOrEqual(1);

    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(after).toEqual(before);
  }, 20_000);

  it('RK-5 (break-test): a trigger that reverts a written value fails in-transaction verify -> rollback, zero writes', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;
    const before = snapshotAtRest(seeded.db, seeded.pluginsDir);

    seeded.db.exec(`
      CREATE TRIGGER at_rest_test_revert AFTER UPDATE ON service_connections
      WHEN NEW.client_secret_encrypted != OLD.client_secret_encrypted
      BEGIN
        UPDATE service_connections SET client_secret_encrypted = OLD.client_secret_encrypted WHERE service_id = NEW.service_id;
      END;
    `);

    const report = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'apply', pluginsDir: seeded.pluginsDir });

    seeded.db.exec(`DROP TRIGGER at_rest_test_revert;`);

    expect(report.ok).toBe(false);
    expect(report.wrote).toBe(false);
    expect(report.refusedReason).toBe('verify-failed');

    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(after).toEqual(before);
  }, 20_000);

  it('RK-6: salt is read from the DB, never the module global; missing salt row refuses', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;

    // Deliberately wrong module-global salt — the engine must ignore it.
    setEncryptionSalt('a-completely-wrong-module-global-salt');
    const dryRun = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'dry-run', pluginsDir: seeded.pluginsDir });
    expect(dryRun.ok).toBe(true);

    setEncryptionSalt('still-wrong');
    const apply = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'apply', pluginsDir: seeded.pluginsDir });
    expect(apply.ok).toBe(true);
    expect(apply.wrote).toBe(true);

    const realSalt = readSalt(seeded.db);
    const newCipher = createAtRestCipher({ key: newKey, salt: realSalt });
    const gitKey = `${seeded.rowKeys.gitCredentialId}:encrypted_token`;
    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(newCipher.decrypt(after['git-credentials'][gitKey])).toBe(seeded.plaintexts.gitCredentialToken);

    // No-salt refusal, on a fresh seed.
    const seeded2 = await seedAtRestFixture();
    seeded2.db.prepare(`DELETE FROM dashboard_settings WHERE key = 'encryption_salt'`).run();
    const before2 = snapshotAtRest(seeded2.db, seeded2.pluginsDir);
    const refused = await rekeyAtRest(seeded2.db, { oldKey: seeded2.key, newKey: `${seeded2.key}-new`, mode: 'apply', pluginsDir: seeded2.pluginsDir });
    expect(refused.ok).toBe(false);
    expect(refused.wrote).toBe(false);
    expect(refused.refusedReason).toBe('no-salt');
    const after2 = snapshotAtRest(seeded2.db, seeded2.pluginsDir);
    expect(after2).toEqual(before2);
  }, 20_000);

  it('RK-7 (classification): default-salt vs malformed, both refuse the apply', async () => {
    const seeded = await seedAtRestFixture();

    // default-salt: a value encrypted under the SAME key but the LEGACY salt
    // (F-3: e.g. a CLI-configured secret whose runtime never called
    // setEncryptionSalt() with the real per-installation salt).
    const legacyCipher = createAtRestCipher({ key: seeded.key, salt: LEGACY_DEFAULT_SALT });
    const defaultSaltId = randomUUID();
    const now = new Date().toISOString();
    seeded.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, org_id)
         VALUES (@id, @packageName, 'notification', '1.0.0', @config, 'inactive', @installedAt, 'org-2')`,
      )
      .run({
        id: defaultSaltId,
        packageName: '@luqen/plugin-at-rest-seed-fixture',
        config: JSON.stringify({ apiKey: legacyCipher.encrypt('default-salt-plaintext'), webhookName: 'x' }),
        installedAt: now,
      });

    // malformed: a manifest-declared secret field holding a non-ciphertext string.
    seeded.db
      .prepare(`UPDATE plugins SET config = @config WHERE id = @id`)
      .run({
        config: JSON.stringify({ apiKey: 'not-a-ciphertext-at-all', webhookName: 'global-hook' }),
        id: seeded.rowKeys.pluginGlobalId,
      });

    const before = snapshotAtRest(seeded.db, seeded.pluginsDir);
    const report = await rekeyAtRest(seeded.db, {
      oldKey: seeded.key,
      newKey: `${seeded.key}-new`,
      mode: 'apply',
      pluginsDir: seeded.pluginsDir,
    });

    expect(report.ok).toBe(false);
    expect(report.wrote).toBe(false);

    const defaultSaltFailure = report.failures.find((f) => f.rowKey === defaultSaltId);
    expect(defaultSaltFailure?.class).toBe('default-salt');

    const malformedFailure = report.failures.find((f) => f.rowKey === seeded.rowKeys.pluginGlobalId);
    expect(malformedFailure?.class).toBe('malformed');

    const after = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(after).toEqual(before);
  }, 20_000);

  it('RK-8 (safe re-run): applying twice with the same old/new key refuses the second time, zero further writes', async () => {
    const seeded = await seedAtRestFixture();
    const newKey = `${seeded.key}-new`;

    const first = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'apply', pluginsDir: seeded.pluginsDir });
    expect(first.ok).toBe(true);
    expect(first.wrote).toBe(true);

    const afterFirst = snapshotAtRest(seeded.db, seeded.pluginsDir);
    const second = await rekeyAtRest(seeded.db, { oldKey: seeded.key, newKey, mode: 'apply', pluginsDir: seeded.pluginsDir });
    expect(second.ok).toBe(false);
    expect(second.wrote).toBe(false);
    expect(second.refusedReason).toBe('decrypt-failures');

    const afterSecond = snapshotAtRest(seeded.db, seeded.pluginsDir);
    expect(afterSecond).toEqual(afterFirst);
  }, 20_000);
});

function readSalt(db: Database.Database): string {
  const row = db.prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`).get() as { value: string };
  return row.value;
}
