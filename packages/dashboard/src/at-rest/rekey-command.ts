/**
 * PBH-B Task 3 — the `rekey-at-rest` operational command.
 *
 * Wraps `rekeyAtRest` (rekey.ts) with everything an operator needs to run it
 * safely against a live installation: env-name-only key input, an exclusive-
 * lock "is the dashboard running" guard (DEC-2, measured), an atomic 0600
 * backup before any write, byte-exact rollback, and leak-free output.
 *
 * Exit codes (also documented in --help and the runbook):
 *   0  ok
 *   1  usage or argument error (before any DB access)
 *   2  decrypt failures / refused (no-salt, malformed, wrong-key-or-tampered)
 *   3  database in use (another connection holds it)
 *   4  apply failed after passing the pre-pass and rolled back; zero writes
 *
 * Output hygiene: every line printed is built from a fixed set of message
 * templates, store names, counts, failure classes, rowKeys, and the backup
 * path. No key value, no plaintext, and no raw error message from the
 * crypto or JSON layers is ever interpolated into output (T-pbh-01).
 */
import {
  existsSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
  closeSync,
  openSync,
  fsyncSync,
  readSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig, serverPluginsDir } from '../config.js';
import { rekeyAtRest, type RekeyReport, type RekeyRefusedReason } from './rekey.js';

export const REKEY_EXIT = {
  OK: 0,
  USAGE_ERROR: 1,
  DECRYPT_FAILURES: 2,
  DATABASE_IN_USE: 3,
  APPLY_FAILED_ROLLED_BACK: 4,
} as const;

export type RekeyExitCode = (typeof REKEY_EXIT)[keyof typeof REKEY_EXIT];

export type LineWriter = (line: string) => void;

export interface RekeyCommandOptions {
  readonly configPath?: string;
  readonly dbPath?: string;
  readonly pluginsDir?: string;
  readonly oldKeyEnv?: string;
  readonly newKeyEnv?: string;
  readonly apply?: boolean;
  /** Path to a backup file created by a prior --apply. Selects the rollback flow. */
  readonly rollback?: string;
}

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const MIN_KEY_LENGTH = 32;
const SQLITE_HEADER = 'SQLite format 3';

function isSqliteBusy(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'SQLITE_BUSY'
  );
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Opens a throwaway connection, tests whether an EXCLUSIVE lock is obtainable, then closes. Never holds the lock. */
function probeLock(dbPath: string): 'free' | 'busy' {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 0');
    db.pragma('locking_mode = EXCLUSIVE');
    try {
      db.exec('BEGIN EXCLUSIVE');
      db.exec('COMMIT');
      return 'free';
    } catch (err) {
      if (isSqliteBusy(err)) return 'busy';
      throw err;
    }
  } finally {
    db.close();
  }
}

type LockResult = { readonly db: Database.Database } | { readonly busy: true };

/**
 * Opens a connection and acquires an EXCLUSIVE lock that is retained until
 * the caller closes it (locking_mode=EXCLUSIVE keeps the lock across the
 * COMMIT — MEASURED, DEC-2). Used for the whole apply/rollback duration so
 * no other connection (the dashboard included) can open the DB meanwhile.
 */
function acquireExclusiveLock(dbPath: string): LockResult {
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 0');
  db.pragma('locking_mode = EXCLUSIVE');
  try {
    db.exec('BEGIN EXCLUSIVE');
    db.exec('COMMIT');
    return { db };
  } catch (err) {
    db.close();
    if (isSqliteBusy(err)) return { busy: true };
    throw err;
  }
}

function readSqliteHeader(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(16);
      const bytesRead = readSync(fd, buf, 0, 16, 0);
      if (bytesRead < SQLITE_HEADER.length) return false;
      return buf.toString('utf8', 0, SQLITE_HEADER.length) === SQLITE_HEADER;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function backupPathFor(dbPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${dbPath}.pre-rekey-${ts}.bak`;
}

/**
 * Task 3's `onBeforeWrite` hook: checkpoint the WAL into the main file (so
 * WAL-resident rows are captured — OPS-6), then copy the main DB file to a
 * 0600 backup beside it via temp-file -> fsync -> rename (T-pbh-06).
 */
function atomicBackup(db: Database.Database, dbPath: string): string {
  db.pragma('wal_checkpoint(TRUNCATE)');

  const finalPath = backupPathFor(dbPath);
  const tmpPath = `${finalPath}.tmp`;
  copyFileSync(dbPath, tmpPath);
  chmodSync(tmpPath, 0o600);
  fsyncPath(tmpPath);
  renameSync(tmpPath, finalPath);
  fsyncPath(dirname(finalPath));
  return finalPath;
}

function mapRefusalToExitCode(reason: RekeyRefusedReason | undefined): RekeyExitCode {
  switch (reason) {
    case 'decrypt-failures':
    case 'no-salt':
      return REKEY_EXIT.DECRYPT_FAILURES;
    case 'verify-failed':
    case 'before-write-failed':
      return REKEY_EXIT.APPLY_FAILED_ROLLED_BACK;
    default:
      return REKEY_EXIT.DECRYPT_FAILURES;
  }
}

function printReport(report: RekeyReport, out: LineWriter): void {
  out(`mode: ${report.mode}`);
  out(`ok: ${String(report.ok)}`);
  out(`wrote: ${String(report.wrote)}`);
  for (const s of report.stores) {
    const manifestPart = s.viaManifest !== undefined ? ` viaManifest=${s.viaManifest} viaShape=${s.viaShape ?? 0}` : '';
    out(`store ${s.store}: count=${s.count} skipped=${s.skipped}${manifestPart}`);
  }
  if (report.failures.length > 0) {
    out(`failures: ${report.failures.length}`);
    for (const f of report.failures) {
      out(`  ${f.store} ${f.rowKey}.${f.field}: ${f.class}`);
    }
  }
  if (report.refusedReason !== undefined) {
    out(`refused: ${report.refusedReason}`);
  }
}

function resolveDbPathAndPluginsDir(options: RekeyCommandOptions): { dbPath: string; pluginsDir: string } {
  const config = loadConfig(options.configPath ?? 'dashboard.config.json');
  const dbPath = resolve(options.dbPath ?? config.dbPath);
  const pluginsDir = options.pluginsDir ?? serverPluginsDir(config);
  return { dbPath, pluginsDir };
}

async function runRollback(backupPath: string, dbPath: string, out: LineWriter): Promise<RekeyExitCode> {
  if (!existsSync(backupPath)) {
    out('Rollback refused: the backup path does not exist.');
    return REKEY_EXIT.USAGE_ERROR;
  }
  if (!readSqliteHeader(backupPath)) {
    out('Rollback refused: the backup file does not have a valid SQLite header.');
    return REKEY_EXIT.USAGE_ERROR;
  }

  const lockResult = acquireExclusiveLock(dbPath);
  if ('busy' in lockResult) {
    out('Rollback refused: database in use. Stop the dashboard (and any other tool with the database open) first.');
    return REKEY_EXIT.DATABASE_IN_USE;
  }

  try {
    lockResult.db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    lockResult.db.close();
  }

  const tmpPath = `${dbPath}.rollback.tmp`;
  copyFileSync(backupPath, tmpPath);
  fsyncPath(tmpPath);
  renameSync(tmpPath, dbPath);
  fsyncPath(dirname(dbPath));

  // A stale -wal/-shm would otherwise be replayed onto the restored bytes
  // the next time something opens the DB (T-pbh-07).
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }

  out('Rollback complete: the database has been restored from the backup.');
  out('The backup file was NOT deleted. Delete it once you have verified the rollback.');
  return REKEY_EXIT.OK;
}

interface ResolvedKeys {
  readonly oldKey: string;
  readonly newKey: string;
}

function validateArgs(options: RekeyCommandOptions, env: NodeJS.ProcessEnv, out: LineWriter): ResolvedKeys | RekeyExitCode {
  if (options.oldKeyEnv === undefined || options.newKeyEnv === undefined) {
    out('Usage error: --old-key-env and --new-key-env are required. Each takes an environment variable NAME, never a key value.');
    return REKEY_EXIT.USAGE_ERROR;
  }

  if (!ENV_NAME_RE.test(options.oldKeyEnv)) {
    out(
      'Usage error: --old-key-env must be an environment variable NAME matching ^[A-Z_][A-Z0-9_]*$ (e.g. OLD_DASHBOARD_KEY). ' +
        'The value you passed is not echoed here, since it may be a pasted key rather than a name.',
    );
    return REKEY_EXIT.USAGE_ERROR;
  }
  if (!ENV_NAME_RE.test(options.newKeyEnv)) {
    out(
      'Usage error: --new-key-env must be an environment variable NAME matching ^[A-Z_][A-Z0-9_]*$ (e.g. NEW_DASHBOARD_KEY). ' +
        'The value you passed is not echoed here, since it may be a pasted key rather than a name.',
    );
    return REKEY_EXIT.USAGE_ERROR;
  }

  const oldKey = env[options.oldKeyEnv];
  const newKey = env[options.newKeyEnv];

  if (oldKey === undefined || oldKey.length < MIN_KEY_LENGTH) {
    out(`Usage error: environment variable ${options.oldKeyEnv} is unset, empty, or shorter than ${MIN_KEY_LENGTH} characters.`);
    return REKEY_EXIT.USAGE_ERROR;
  }
  if (newKey === undefined || newKey.length < MIN_KEY_LENGTH) {
    out(`Usage error: environment variable ${options.newKeyEnv} is unset, empty, or shorter than ${MIN_KEY_LENGTH} characters.`);
    return REKEY_EXIT.USAGE_ERROR;
  }
  if (oldKey === newKey) {
    out('Usage error: the old and new keys are identical. Refusing a no-op rotation.');
    return REKEY_EXIT.USAGE_ERROR;
  }

  return { oldKey, newKey };
}

async function runDryRunOrApply(
  options: RekeyCommandOptions,
  keys: ResolvedKeys,
  out: LineWriter,
): Promise<RekeyExitCode> {
  const { dbPath, pluginsDir } = resolveDbPathAndPluginsDir(options);

  if (!existsSync(dbPath)) {
    out('Usage error: could not find the database file. Check --db-path (or --config) points to an existing SQLite database.');
    return REKEY_EXIT.USAGE_ERROR;
  }

  if (options.apply === true) {
    const lockResult = acquireExclusiveLock(dbPath);
    if ('busy' in lockResult) {
      out('Apply refused: database in use. Stop the dashboard (and any other tool with the database open) first.');
      return REKEY_EXIT.DATABASE_IN_USE;
    }
    const { db } = lockResult;
    let backupWritten: string | undefined;
    try {
      const report = await rekeyAtRest(db, {
        oldKey: keys.oldKey,
        newKey: keys.newKey,
        mode: 'apply',
        pluginsDir,
        onBeforeWrite: () => {
          backupWritten = atomicBackup(db, dbPath);
        },
      });
      printReport(report, out);
      if (!report.ok) {
        return mapRefusalToExitCode(report.refusedReason);
      }
      if (backupWritten !== undefined) {
        out(`Backup written to: ${backupWritten}`);
      }
      out('Next steps: 1) set DASHBOARD_ENCRYPTION_KEY to the new value, 2) restart the dashboard, 3) delete the backup after the verification window.');
      return REKEY_EXIT.OK;
    } finally {
      db.close();
    }
  }

  // Dry-run (default): probe on a throwaway connection first, so this never
  // holds a lock the way --apply does (DEC-3 — dry-run is allowed while the
  // dashboard runs).
  const lockState = probeLock(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = await rekeyAtRest(db, {
      oldKey: keys.oldKey,
      newKey: keys.newKey,
      mode: 'dry-run',
      pluginsDir,
    });
    printReport(report, out);
    if (lockState === 'busy') {
      out('database in use — --apply would refuse');
    }
    return report.ok ? REKEY_EXIT.OK : mapRefusalToExitCode(report.refusedReason);
  } finally {
    db.close();
  }
}

export async function runRekeyCommand(
  options: RekeyCommandOptions,
  env: NodeJS.ProcessEnv,
  out: LineWriter,
): Promise<RekeyExitCode> {
  if (options.rollback !== undefined) {
    if (options.apply === true) {
      out('Usage error: --rollback cannot be combined with --apply.');
      return REKEY_EXIT.USAGE_ERROR;
    }
    const { dbPath } = resolveDbPathAndPluginsDir(options);
    return runRollback(options.rollback, dbPath, out);
  }

  const validated = validateArgs(options, env, out);
  if (typeof validated === 'number') {
    return validated;
  }

  return runDryRunOrApply(options, validated, out);
}
