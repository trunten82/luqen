/**
 * PBH-B Task 3 — `rekey-at-rest` command: env-name keys, exclusive-lock
 * guard, atomic backup, byte-exact rollback, leak-free output.
 *
 * Every test that expects the "database is free" path closes `seeded.db`
 * (or any other harness connection) BEFORE invoking the command, and
 * re-opens a fresh connection afterward for assertions. MEASURED in the
 * scratchpad for this task: an idle-but-open better-sqlite3 connection —
 * even one that only ever ran a single SELECT and never started an explicit
 * transaction — makes a `BEGIN EXCLUSIVE` probe from another connection
 * return SQLITE_BUSY until that connection closes. This is exactly DEC-2's
 * "detects ANY holder" property, re-confirmed here rather than assumed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runRekeyCommand, REKEY_EXIT } from '../../src/at-rest/rekey-command.js';
import { AT_REST_STORES } from '../../src/at-rest/stores.js';
import { seedAtRestFixture, type SeededAtRest } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WAL_FIXTURE = resolvePath(__dirname, 'fixtures', 'wal-write-and-die.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectOut(): { readonly lines: string[]; readonly write: (line: string) => void; readonly text: () => string } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line), text: () => lines.join('\n') };
}

/** Snapshot every at-rest column value through a FRESH, closed-after-use connection. */
function snapshotAtRestFromPath(dbPath: string, pluginsDir: string): Record<string, Record<string, string>> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
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
  } finally {
    db.close();
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function backupFilesBeside(dbPath: string): string[] {
  const dir = dirname(dbPath);
  const base = `${dbPath.split('/').pop()}`;
  return readdirSync(dir).filter((f) => f.startsWith(`${base}.pre-rekey-`) && f.endsWith('.bak'));
}

const NEW_KEY_SUFFIX = '-new-key-with-enough-characters-to-pass-min32';

async function freshSeed(): Promise<SeededAtRest> {
  return seedAtRestFixture();
}

const openConnections: Database.Database[] = [];
afterEach(() => {
  for (const db of openConnections.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
});

// ---------------------------------------------------------------------------
// OPS-1..OPS-2: happy paths
// ---------------------------------------------------------------------------

describe('runRekeyCommand (PBH-B Task 3)', () => {
  it('OPS-1: dry-run via env NAMES -> exit 0; per-store counts printed; no backup created; DB byte-identical', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    // sha256 is taken AFTER closing the seed's own connection: better-sqlite3
    // checkpoints WAL content into the main file on close, so hashing before
    // that point captures pre-checkpoint bytes that never match a later,
    // logically-identical read (a bug in this test, not the command, caught
    // by running it and seeing which side of the assertion moved).
    const before = sha256File(seeded.dbPath);
    const beforeSnapshot = snapshotAtRestFromPath(seeded.dbPath, seeded.pluginsDir);

    const out = collectOut();
    const env = { OLD: seeded.key, NEW: `${seeded.key}${NEW_KEY_SUFFIX}` };
    const code = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: false },
      env,
      out.write,
    );

    expect(code).toBe(REKEY_EXIT.OK);
    expect(out.text()).toContain('oauth-signing-keys');
    expect(out.text()).toContain('service-connections');
    expect(out.text()).toContain('git-credentials');
    expect(out.text()).toContain('plugin-configs');
    expect(backupFilesBeside(seeded.dbPath)).toHaveLength(0);
    expect(sha256File(seeded.dbPath)).toBe(before);
    expect(snapshotAtRestFromPath(seeded.dbPath, seeded.pluginsDir)).toEqual(beforeSnapshot);
  }, 20_000);

  it('OPS-2: apply -> exit 0; exactly one 0600 backup beside the DB decrypting under OLD; DB decrypts under NEW', async () => {
    const seeded = await freshSeed();
    seeded.db.close();

    const out = collectOut();
    const newKey = `${seeded.key}${NEW_KEY_SUFFIX}`;
    const env = { OLD: seeded.key, NEW: newKey };
    const code = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: true },
      env,
      out.write,
    );

    expect(code).toBe(REKEY_EXIT.OK);
    const backups = backupFilesBeside(seeded.dbPath);
    expect(backups).toHaveLength(1);
    const backupPath = join(dirname(seeded.dbPath), backups[0]);
    const mode = statSync(backupPath).mode & 0o777;
    expect(mode).toBe(0o600);

    // Backup decrypts under the OLD key (via a fresh readonly connection to the backup file).
    const { createAtRestCipher } = await import('../../src/plugins/crypto.js');
    const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    openConnections.push(backupDb);
    const saltRow = backupDb.prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`).get() as { value: string };
    const oldCipher = createAtRestCipher({ key: seeded.key, salt: saltRow.value });
    const backupRow = backupDb
      .prepare(`SELECT encrypted_token FROM developer_credentials WHERE id = ?`)
      .get(seeded.rowKeys.gitCredentialId) as { encrypted_token: string };
    expect(oldCipher.decrypt(backupRow.encrypted_token)).toBe(seeded.plaintexts.gitCredentialToken);

    // Live DB decrypts under the NEW key.
    const after = snapshotAtRestFromPath(seeded.dbPath, seeded.pluginsDir);
    const newCipher = createAtRestCipher({ key: newKey, salt: saltRow.value });
    const gitKey = `${seeded.rowKeys.gitCredentialId}:encrypted_token`;
    expect(newCipher.decrypt(after['git-credentials'][gitKey])).toBe(seeded.plaintexts.gitCredentialToken);
  }, 20_000);

  // -------------------------------------------------------------------------
  // OPS-3: exclusivity guard
  // -------------------------------------------------------------------------

  it('OPS-3: a second connection holding the DB open -> apply exits 3, zero writes, no backup; dry-run exits 0 with an in-use note', async () => {
    const seeded = await freshSeed();
    seeded.db.close();

    const holder = new Database(seeded.dbPath, { fileMustExist: true });
    holder.pragma('journal_mode = WAL');
    holder.prepare('SELECT 1').get();
    openConnections.push(holder);

    const before = sha256File(seeded.dbPath);

    const applyOut = collectOut();
    const applyCode = await runRekeyCommand(
      {
        dbPath: seeded.dbPath,
        pluginsDir: seeded.pluginsDir,
        oldKeyEnv: 'OLD',
        newKeyEnv: 'NEW',
        apply: true,
      },
      { OLD: seeded.key, NEW: `${seeded.key}${NEW_KEY_SUFFIX}` },
      applyOut.write,
    );
    expect(applyCode).toBe(REKEY_EXIT.DATABASE_IN_USE);
    expect(sha256File(seeded.dbPath)).toBe(before);
    expect(backupFilesBeside(seeded.dbPath)).toHaveLength(0);

    const dryOut = collectOut();
    const dryCode = await runRekeyCommand(
      {
        dbPath: seeded.dbPath,
        pluginsDir: seeded.pluginsDir,
        oldKeyEnv: 'OLD',
        newKeyEnv: 'NEW',
        apply: false,
      },
      { OLD: seeded.key, NEW: `${seeded.key}${NEW_KEY_SUFFIX}` },
      dryOut.write,
    );
    expect(dryCode).toBe(REKEY_EXIT.OK);
    expect(dryOut.text()).toContain('database in use — --apply would refuse');
  }, 20_000);

  // -------------------------------------------------------------------------
  // OPS-4/OPS-5: rollback
  // -------------------------------------------------------------------------

  it('OPS-4: --rollback restores byte-exact bytes; no -wal/-shm left; OLD decrypts again, NEW throws', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    const newKey = `${seeded.key}${NEW_KEY_SUFFIX}`;

    const applyOut = collectOut();
    const applyCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: true },
      { OLD: seeded.key, NEW: newKey },
      applyOut.write,
    );
    expect(applyCode).toBe(REKEY_EXIT.OK);
    const backups = backupFilesBeside(seeded.dbPath);
    expect(backups).toHaveLength(1);
    const backupPath = join(dirname(seeded.dbPath), backups[0]);
    const backupHash = sha256File(backupPath);

    const rollbackOut = collectOut();
    const rollbackCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: backupPath },
      {},
      rollbackOut.write,
    );
    expect(rollbackCode).toBe(REKEY_EXIT.OK);
    expect(sha256File(seeded.dbPath)).toBe(backupHash);
    expect(existsSync(`${seeded.dbPath}-wal`)).toBe(false);
    expect(existsSync(`${seeded.dbPath}-shm`)).toBe(false);

    const { createAtRestCipher } = await import('../../src/plugins/crypto.js');
    const after = snapshotAtRestFromPath(seeded.dbPath, seeded.pluginsDir);
    const restored = new Database(seeded.dbPath, { readonly: true, fileMustExist: true });
    openConnections.push(restored);
    const saltRow = restored.prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`).get() as { value: string };
    const oldCipher = createAtRestCipher({ key: seeded.key, salt: saltRow.value });
    const newCipher = createAtRestCipher({ key: newKey, salt: saltRow.value });
    const gitKey = `${seeded.rowKeys.gitCredentialId}:encrypted_token`;
    expect(oldCipher.decrypt(after['git-credentials'][gitKey])).toBe(seeded.plaintexts.gitCredentialToken);
    expect(() => newCipher.decrypt(after['git-credentials'][gitKey])).toThrow();
  }, 20_000);

  it('OPS-5: rollback refuses on a held DB (exit 3), a missing backup (exit 1), and a non-SQLite file (exit 1); DB unchanged in all cases', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    const before = sha256File(seeded.dbPath);

    // Missing backup path.
    const missingOut = collectOut();
    const missingCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: `${seeded.dbPath}.does-not-exist.bak` },
      {},
      missingOut.write,
    );
    expect(missingCode).toBe(REKEY_EXIT.USAGE_ERROR);
    expect(sha256File(seeded.dbPath)).toBe(before);

    // Non-SQLite file (bad header).
    const junkDir = mkdtempSync(join(tmpdir(), 'luqen-rekey-junk-'));
    const junkPath = join(junkDir, 'not-a-db.bak');
    (await import('node:fs')).writeFileSync(junkPath, 'this is not a sqlite file');
    const junkOut = collectOut();
    const junkCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: junkPath },
      {},
      junkOut.write,
    );
    expect(junkCode).toBe(REKEY_EXIT.USAGE_ERROR);
    expect(sha256File(seeded.dbPath)).toBe(before);

    // A real backup, but the DB is held open by another connection.
    const holder = new Database(seeded.dbPath, { fileMustExist: true });
    holder.pragma('journal_mode = WAL');
    holder.prepare('SELECT 1').get();
    openConnections.push(holder);

    // Use the junk file's path as a stand-in "backup" argument is invalid (bad header would
    // fire first); build a real header-valid backup by copying the live DB file directly.
    const realBackupPath = `${seeded.dbPath}.manual-test-backup.bak`;
    (await import('node:fs')).copyFileSync(seeded.dbPath, realBackupPath);

    const heldOut = collectOut();
    const heldCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: realBackupPath },
      {},
      heldOut.write,
    );
    expect(heldCode).toBe(REKEY_EXIT.DATABASE_IN_USE);
    expect(sha256File(seeded.dbPath)).toBe(before);
  }, 20_000);

  // -------------------------------------------------------------------------
  // OPS-6: WAL-resident rows survive backup + rollback
  // -------------------------------------------------------------------------

  it('OPS-6: a WAL-resident row (written by a process that SIGKILLs itself) survives apply -> rollback', async () => {
    const seeded = await freshSeed();
    seeded.db.close();

    const saltDb = new Database(seeded.dbPath, { readonly: true, fileMustExist: true });
    const saltRow = saltDb.prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`).get() as { value: string };
    const hostConfigRow = saltDb
      .prepare(`SELECT git_host_config_id FROM developer_credentials WHERE id = ?`)
      .get(seeded.rowKeys.gitCredentialId) as { git_host_config_id: string };
    // MUST close before the child (and later the command) opens the DB —
    // per OPS-3's own finding, an open-but-idle connection blocks the
    // exclusive-lock probe (SQLITE_BUSY) even though it performed no write.
    saltDb.close();

    const rowId = `wal-child-${randomBytes(6).toString('hex')}`;
    const userId = `wal-child-user-${randomBytes(6).toString('hex')}`;
    const tokenPlaintext = `wal-child-token-${randomBytes(12).toString('hex')}`;

    await new Promise<void>((resolveChild, rejectChild) => {
      const child = spawn(process.execPath, [WAL_FIXTURE], {
        env: {
          ...process.env,
          WAL_FIXTURE_DB_PATH: seeded.dbPath,
          WAL_FIXTURE_KEY: seeded.key,
          WAL_FIXTURE_SALT: saltRow.value,
          WAL_FIXTURE_HOST_CONFIG_ID: hostConfigRow.git_host_config_id,
          WAL_FIXTURE_USER_ID: userId,
          WAL_FIXTURE_ROW_ID: rowId,
          WAL_FIXTURE_TOKEN_PLAINTEXT: tokenPlaintext,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => {
        stdout += String(c);
      });
      child.on('close', () => {
        if (stdout.includes('WRITTEN')) resolveChild();
        else rejectChild(new Error(`WAL fixture did not confirm write; stdout: ${stdout}`));
      });
      child.on('error', rejectChild);
    });

    // Precondition, asserted per the plan: the write really did land only in
    // the WAL file (not checkpointed into the main DB file yet).
    const walPath = `${seeded.dbPath}-wal`;
    expect(existsSync(walPath), 'precondition: -wal file must exist after the child write').toBe(true);
    expect(statSync(walPath).size, 'precondition: -wal file must be non-empty').toBeGreaterThan(0);

    const newKey = `${seeded.key}${NEW_KEY_SUFFIX}`;
    const applyOut = collectOut();
    const applyCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: true },
      { OLD: seeded.key, NEW: newKey },
      applyOut.write,
    );
    expect(applyCode).toBe(REKEY_EXIT.OK);
    const backups = backupFilesBeside(seeded.dbPath);
    expect(backups).toHaveLength(1);
    const backupPath = join(dirname(seeded.dbPath), backups[0]);

    const rollbackOut = collectOut();
    const rollbackCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: backupPath },
      {},
      rollbackOut.write,
    );
    expect(rollbackCode).toBe(REKEY_EXIT.OK);

    const restored = new Database(seeded.dbPath, { readonly: true, fileMustExist: true });
    openConnections.push(restored);
    const row = restored.prepare(`SELECT id FROM developer_credentials WHERE id = ?`).get(rowId);
    expect(row, 'the WAL-resident row written by the child must survive apply -> rollback').toBeDefined();
  }, 30_000);

  // -------------------------------------------------------------------------
  // OPS-7: no leak
  // -------------------------------------------------------------------------

  it('OPS-7: no run leaks a key value or a seeded plaintext, including a value passed where a NAME is expected', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    const newKey = `${seeded.key}${NEW_KEY_SUFFIX}`;
    const env = { OLD: seeded.key, NEW: newKey };
    const combined: string[] = [];

    const dry = collectOut();
    await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: false },
      env,
      dry.write,
    );
    combined.push(dry.text());

    const apply = collectOut();
    await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: true },
      env,
      apply.write,
    );
    combined.push(apply.text());
    const backups = backupFilesBeside(seeded.dbPath);
    const backupPath = join(dirname(seeded.dbPath), backups[0]);

    const wrong = collectOut();
    await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'NEW', apply: true },
      { OLD: `${seeded.key}-totally-wrong-old-key-value`, NEW: newKey },
      wrong.write,
    );
    combined.push(wrong.text());

    const rollback = collectOut();
    await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, rollback: backupPath },
      {},
      rollback.write,
    );
    combined.push(rollback.text());

    // A run where --old-key-env is given a KEY VALUE instead of a NAME.
    const valueAsName = collectOut();
    await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: seeded.key, newKeyEnv: 'NEW', apply: false },
      env,
      valueAsName.write,
    );
    combined.push(valueAsName.text());
    expect(valueAsName.text()).not.toContain(seeded.key);

    const everything = combined.join('\n');
    expect(everything).not.toContain(seeded.key);
    expect(everything).not.toContain(newKey);
    for (const plaintext of Object.values(seeded.plaintexts)) {
      expect(everything).not.toContain(plaintext);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // OPS-8: argument validation
  // -------------------------------------------------------------------------

  it('OPS-8: bad arguments exit 1 before any DB write and never echo a value as if it were a name', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    const before = sha256File(seeded.dbPath);
    const validEnv = { OLD: seeded.key, NEW: `${seeded.key}${NEW_KEY_SUFFIX}` };

    // Env var unset.
    const unset = collectOut();
    const unsetCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'DOES_NOT_EXIST', newKeyEnv: 'NEW', apply: false },
      { NEW: `${seeded.key}${NEW_KEY_SUFFIX}` },
      unset.write,
    );
    expect(unsetCode).toBe(REKEY_EXIT.USAGE_ERROR);
    expect(unset.text()).toContain('DOES_NOT_EXIST');

    // Value shorter than 32 chars.
    const shortCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'SHORT', newKeyEnv: 'NEW', apply: false },
      { SHORT: 'too-short', NEW: `${seeded.key}${NEW_KEY_SUFFIX}` },
      collectOut().write,
    );
    expect(shortCode).toBe(REKEY_EXIT.USAGE_ERROR);

    // old === new.
    const sameOut = collectOut();
    const sameCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'OLD', newKeyEnv: 'SAME_AS_OLD', apply: false },
      { OLD: seeded.key, SAME_AS_OLD: seeded.key },
      sameOut.write,
    );
    expect(sameCode).toBe(REKEY_EXIT.USAGE_ERROR);
    expect(sameOut.text()).not.toContain(seeded.key);

    // Name not matching the env-name shape (a pasted-looking value).
    const badNameOut = collectOut();
    const badNameCode = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'not-a-valid-env-name!!', newKeyEnv: 'NEW', apply: false },
      validEnv,
      badNameOut.write,
    );
    expect(badNameCode).toBe(REKEY_EXIT.USAGE_ERROR);
    expect(badNameOut.text()).not.toContain('not-a-valid-env-name!!');

    expect(sha256File(seeded.dbPath)).toBe(before);
    expect(backupFilesBeside(seeded.dbPath)).toHaveLength(0);
  }, 20_000);

  // -------------------------------------------------------------------------
  // Plan-check addition: command-level wrong-old-key assertion
  // -------------------------------------------------------------------------

  it('plan-check addition: a WRONG OLD KEY run exits 2, reports per-store failures, writes nothing (sha256 unchanged), and leaks nothing', async () => {
    const seeded = await freshSeed();
    seeded.db.close();
    const before = sha256File(seeded.dbPath);

    const out = collectOut();
    const code = await runRekeyCommand(
      { dbPath: seeded.dbPath, pluginsDir: seeded.pluginsDir, oldKeyEnv: 'WRONG_OLD', newKeyEnv: 'NEW', apply: true },
      { WRONG_OLD: `${seeded.key}-totally-wrong-old-key-value-xyz`, NEW: `${seeded.key}${NEW_KEY_SUFFIX}` },
      out.write,
    );

    expect(code).toBe(REKEY_EXIT.DECRYPT_FAILURES);
    expect(out.text()).toContain('refused: decrypt-failures');
    expect(out.text()).toContain('failures:');
    expect(out.text()).toMatch(/wrong-key-or-tampered/);
    expect(sha256File(seeded.dbPath)).toBe(before);
    expect(backupFilesBeside(seeded.dbPath)).toHaveLength(0);
    expect(out.text()).not.toContain(seeded.key);
    for (const plaintext of Object.values(seeded.plaintexts)) {
      expect(out.text()).not.toContain(plaintext);
    }
  }, 20_000);
});
