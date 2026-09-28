/**
 * PBH-B Task 2 — the at-rest re-key engine.
 *
 * dry-run / apply, classification, single transaction, verify-after-write.
 * Never mutates crypto.ts's module-global installation salt — the salt is
 * read once, read-only, from `dashboard_settings.encryption_salt` and
 * passed explicitly to `createAtRestCipher`, so this engine is immune to
 * whatever the process's module-global salt happens to be set to (RK-6).
 */
import type Database from 'better-sqlite3';
import { createAtRestCipher, isEncryptedShape, LEGACY_DEFAULT_SALT } from '../plugins/crypto.js';
import { AT_REST_STORES, type AtRestStore, type AtRestValueRef } from './stores.js';

export type RekeyMode = 'dry-run' | 'apply';

export type RekeyFailureClass = 'malformed' | 'default-salt' | 'wrong-key-or-tampered';

export interface RekeyFailure {
  readonly store: string;
  readonly rowKey: string;
  readonly field: string;
  readonly class: RekeyFailureClass;
}

export interface RekeyStoreReport {
  readonly store: string;
  /** Candidate values found (before decrypt classification). */
  readonly count: number;
  readonly skipped: number;
  /** plugin-configs only. */
  readonly viaManifest?: number;
  /** plugin-configs only. */
  readonly viaShape?: number;
}

export type RekeyRefusedReason = 'no-salt' | 'decrypt-failures' | 'verify-failed' | 'before-write-failed';

export interface RekeyReport {
  readonly ok: boolean;
  readonly mode: RekeyMode;
  readonly wrote: boolean;
  readonly stores: readonly RekeyStoreReport[];
  readonly failures: readonly RekeyFailure[];
  readonly refusedReason?: RekeyRefusedReason;
}

export interface RekeyOptions {
  readonly oldKey: string;
  readonly newKey: string;
  readonly mode: RekeyMode;
  readonly pluginsDir: string;
  /** Task 3's backup hook runs here, inside the refuse-on-failure gate but before any write. */
  readonly onBeforeWrite?: () => void | Promise<void>;
}

interface PendingWrite {
  readonly store: AtRestStore;
  readonly ref: AtRestValueRef;
  readonly plaintext: string;
}

function readInstallationSalt(db: Database.Database): string | undefined {
  const row = db
    .prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`)
    .get() as { value: string } | undefined;
  return row?.value;
}

export async function rekeyAtRest(db: Database.Database, options: RekeyOptions): Promise<RekeyReport> {
  const salt = readInstallationSalt(db);
  if (salt === undefined) {
    return { ok: false, mode: options.mode, wrote: false, stores: [], failures: [], refusedReason: 'no-salt' };
  }

  const oldCipher = createAtRestCipher({ key: options.oldKey, salt });
  const newCipher = createAtRestCipher({ key: options.newKey, salt });
  // For default-salt classification: the value was encrypted before this
  // installation's real salt existed (F-3 CLI path, or a pre-CRIT-1 row).
  const legacyOldCipher = createAtRestCipher({ key: options.oldKey, salt: LEGACY_DEFAULT_SALT });

  const storeReports: RekeyStoreReport[] = [];
  const failures: RekeyFailure[] = [];
  const pending: PendingWrite[] = [];

  for (const store of AT_REST_STORES) {
    const listed = store.list(db, { pluginsDir: options.pluginsDir });
    storeReports.push({
      store: store.name,
      count: listed.refs.length,
      skipped: listed.skipped,
      ...(listed.viaManifest !== undefined ? { viaManifest: listed.viaManifest } : {}),
      ...(listed.viaShape !== undefined ? { viaShape: listed.viaShape } : {}),
    });

    for (const ref of listed.refs) {
      if (!isEncryptedShape(ref.ciphertext)) {
        failures.push({ store: store.name, rowKey: ref.rowKey, field: ref.field, class: 'malformed' });
        continue;
      }
      try {
        const plaintext = oldCipher.decrypt(ref.ciphertext);
        pending.push({ store, ref, plaintext });
      } catch {
        try {
          legacyOldCipher.decrypt(ref.ciphertext);
          failures.push({ store: store.name, rowKey: ref.rowKey, field: ref.field, class: 'default-salt' });
        } catch {
          failures.push({ store: store.name, rowKey: ref.rowKey, field: ref.field, class: 'wrong-key-or-tampered' });
        }
      }
    }
  }

  if (failures.length > 0) {
    return { ok: false, mode: options.mode, wrote: false, stores: storeReports, failures, refusedReason: 'decrypt-failures' };
  }

  if (options.mode === 'dry-run') {
    return { ok: true, mode: 'dry-run', wrote: false, stores: storeReports, failures: [] };
  }

  if (options.onBeforeWrite !== undefined) {
    try {
      await options.onBeforeWrite();
    } catch {
      return { ok: false, mode: 'apply', wrote: false, stores: storeReports, failures: [], refusedReason: 'before-write-failed' };
    }
  }

  const applyTxn = db.transaction(() => {
    for (const { store, ref, plaintext } of pending) {
      const newCiphertext = newCipher.encrypt(plaintext);
      store.write(db, ref, newCiphertext);

      // Verify-after-write: re-read through the SAME lister so a trigger
      // that silently reverts the column is caught, then confirm the new
      // key decrypts to the original plaintext and the old key no longer
      // works. Any exception here aborts and rolls back the WHOLE
      // transaction (better-sqlite3 semantics), including earlier stores.
      const relisted = store.list(db, { pluginsDir: options.pluginsDir });
      const after = relisted.refs.find((r) => r.rowKey === ref.rowKey && r.field === ref.field);
      if (after === undefined) {
        throw new Error(`at-rest re-key verify: ${store.name} row ${ref.rowKey}/${ref.field} disappeared after write`);
      }
      const verifiedPlaintext = newCipher.decrypt(after.ciphertext);
      if (verifiedPlaintext !== plaintext) {
        throw new Error(`at-rest re-key verify: ${store.name} row ${ref.rowKey}/${ref.field} new-key mismatch`);
      }
      let oldStillDecrypts = true;
      try {
        oldCipher.decrypt(after.ciphertext);
      } catch {
        oldStillDecrypts = false;
      }
      if (oldStillDecrypts) {
        throw new Error(`at-rest re-key verify: ${store.name} row ${ref.rowKey}/${ref.field} old key unexpectedly still decrypts`);
      }
    }
  });

  try {
    applyTxn();
  } catch {
    return { ok: false, mode: 'apply', wrote: false, stores: storeReports, failures: [], refusedReason: 'verify-failed' };
  }

  return { ok: true, mode: 'apply', wrote: true, stores: storeReports, failures: [] };
}
