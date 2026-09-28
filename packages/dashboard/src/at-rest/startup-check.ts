/**
 * PBH-D — the decrypt-dependent /health signal.
 *
 * Runs ONCE at startup (DEC-4): decrypts every stored at-rest value under
 * the configured key + the installation salt, using ONE scrypt derive
 * (createAtRestCipher), and caches the result. GET /health then exposes only
 * `checks.atRestEncryption.status` — never counts, store names, keys or
 * paths (T-pbh-09) — from the precomputed result, never re-running the check
 * per request (T-pbh-08).
 *
 * Iterates the SAME `AT_REST_STORES` registry as the re-key engine
 * (rekey.ts) — there is no second enumeration of "what is encrypted at
 * rest" anywhere in the codebase.
 *
 * The check's proposition is narrow and deliberate: "the at-rest data
 * present at startup decrypts under the installation salt + the configured
 * key". It does NOT claim that plugins started successfully (see F-2 — a
 * plugin manager boot-ordering finding this task only measures, never
 * fixes).
 */
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { createAtRestCipher, isEncryptedShape } from '../plugins/crypto.js';
import { AT_REST_STORES } from './stores.js';
import { sharesSessionSecret, type DashboardConfig } from '../config.js';

export type AtRestCheckStatus = 'ok' | 'failed' | 'empty';

export interface AtRestCheckStoreResult {
  readonly store: string;
  readonly checked: number;
  readonly failed: number;
}

export interface AtRestCheckResult {
  readonly status: AtRestCheckStatus;
  readonly stores: readonly AtRestCheckStoreResult[];
  readonly reason?: 'no-salt';
}

export interface AtRestCheckOptions {
  readonly encryptionKey: string;
  readonly pluginsDir: string;
}

function readInstallationSalt(db: Database.Database): string | undefined {
  const row = db
    .prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`)
    .get() as { value: string } | undefined;
  return row?.value;
}

/**
 * Decrypts every stored at-rest value once. Never calls `setEncryptionSalt`
 * — the salt is read explicitly, read-only, and passed to
 * `createAtRestCipher`, mirroring the re-key engine's own salt handling
 * (RK-6's invariant applies here too: this check must be immune to whatever
 * the process's module-global salt happens to be).
 */
export function checkAtRestDecryption(db: Database.Database, options: AtRestCheckOptions): AtRestCheckResult {
  const listings = AT_REST_STORES.map((store) => ({
    store,
    refs: store.list(db, { pluginsDir: options.pluginsDir }).refs,
  }));
  const totalRefs = listings.reduce((sum, l) => sum + l.refs.length, 0);

  if (totalRefs === 0) {
    return {
      status: 'empty',
      stores: listings.map((l) => ({ store: l.store.name, checked: 0, failed: 0 })),
    };
  }

  const salt = readInstallationSalt(db);
  if (salt === undefined) {
    return {
      status: 'failed',
      stores: listings.map((l) => ({ store: l.store.name, checked: 0, failed: l.refs.length })),
      reason: 'no-salt',
    };
  }

  const cipher = createAtRestCipher({ key: options.encryptionKey, salt });
  const storeResults: AtRestCheckStoreResult[] = [];
  let anyFailed = false;

  for (const { store, refs } of listings) {
    let failed = 0;
    for (const ref of refs) {
      if (!isEncryptedShape(ref.ciphertext)) {
        failed++;
        continue;
      }
      try {
        cipher.decrypt(ref.ciphertext);
      } catch {
        failed++;
      }
    }
    if (failed > 0) anyFailed = true;
    storeResults.push({ store: store.name, checked: refs.length, failed });
  }

  return { status: anyFailed ? 'failed' : 'ok', stores: storeResults };
}

/**
 * Logs the startup result: ERROR (never suppressed — production log level is
 * 'warn') on failure, naming stores and counts only — no ciphertext,
 * plaintext, key or path. INFO (suppressed in production) otherwise.
 */
export function logAtRestCheck(log: FastifyBaseLogger, result: AtRestCheckResult): void {
  if (result.status === 'failed') {
    log.error(
      { stores: result.stores, reason: result.reason },
      'At-rest decryption check FAILED — one or more stored values could not be decrypted under ' +
        'the configured DASHBOARD_ENCRYPTION_KEY and the installation salt. Plugin secrets, service ' +
        'connections, git credentials, or OAuth signing keys may be unreadable. See the rotation ' +
        'runbook in docs/guides/security-administration.md.',
    );
    return;
  }
  log.info({ status: result.status, stores: result.stores }, 'At-rest decryption check passed at startup');
}

/**
 * WARN (never suppressed) when the at-rest key still defaults to (or is
 * pinned equal to) the session secret: one leaked secret then compromises
 * both sessions and every stored at-rest value, and rotating the session
 * secret alone would reproduce the 2026-09-28 incident. Silent otherwise.
 */
export function logAtRestKeyPosture(log: FastifyBaseLogger, config: DashboardConfig): void {
  if (!sharesSessionSecret(config)) return;
  log.warn(
    'DASHBOARD_ENCRYPTION_KEY is unset or equal to DASHBOARD_SESSION_SECRET: one secret protects ' +
      'both sessions and encrypted data. Pin DASHBOARD_ENCRYPTION_KEY before rotating ' +
      'DASHBOARD_SESSION_SECRET — see the rotation runbook in docs/guides/security-administration.md.',
  );
}
