/**
 * PBH-B Task 2 — the single registry of at-rest encrypted stores.
 *
 * Both the re-key engine (rekey.ts) and the startup check
 * (startup-check.ts, PBH-D) iterate this SAME registry — there is no
 * second enumeration of "what is encrypted at rest" anywhere in the
 * codebase. Adding a new encrypted column means adding a store here;
 * `stores-completeness.test.ts` (REG-1) fails otherwise.
 *
 * Processing order (documented, stable): oauth-signing-keys,
 * service-connections, git-credentials, plugin-configs.
 */
import type Database from 'better-sqlite3';
import { isEncryptedShape } from '../plugins/crypto.js';
import { tryReadPluginManifest } from '../plugins/manifest-path.js';

export interface AtRestValueRef {
  /** Store name, e.g. 'oauth-signing-keys'. */
  readonly store: string;
  /** Row identifier — never a value. kid / service_id / credential id / plugin id. */
  readonly rowKey: string;
  /** Column name, or (for plugin-configs) the JSON field name inside `config`. */
  readonly field: string;
  readonly ciphertext: string;
}

export interface AtRestListResult {
  readonly refs: readonly AtRestValueRef[];
  /** Values intentionally not re-keyed (e.g. service_connections '' = no secret). */
  readonly skipped: number;
  /** plugin-configs only: secret fields resolved via the plugin's manifest. */
  readonly viaManifest?: number;
  /** plugin-configs only: values resolved via isEncryptedShape (no manifest). */
  readonly viaShape?: number;
}

export interface AtRestListContext {
  readonly pluginsDir: string;
}

export interface AtRestStore {
  readonly name: string;
  readonly table: string;
  readonly column: string;
  readonly list: (db: Database.Database, ctx: AtRestListContext) => AtRestListResult;
  readonly write: (db: Database.Database, ref: AtRestValueRef, newCiphertext: string) => void;
}

// ---------------------------------------------------------------------------
// oauth-signing-keys
// ---------------------------------------------------------------------------

interface OauthSigningKeyRow {
  readonly kid: string;
  readonly encrypted_private_key_pem: string;
}

const oauthSigningKeysStore: AtRestStore = {
  name: 'oauth-signing-keys',
  table: 'oauth_signing_keys',
  column: 'encrypted_private_key_pem',
  list(db) {
    // ALL rows, including retired and removed (R7/R8/R9/R10 consumer
    // inventory) — a retired key can still be published to JWKS/history.
    const rows = db
      .prepare(`SELECT kid, encrypted_private_key_pem FROM oauth_signing_keys`)
      .all() as OauthSigningKeyRow[];
    const refs = rows.map((row) => ({
      store: 'oauth-signing-keys',
      rowKey: row.kid,
      field: 'encrypted_private_key_pem',
      ciphertext: row.encrypted_private_key_pem,
    }));
    return { refs, skipped: 0 };
  },
  write(db, ref, newCiphertext) {
    db.prepare(`UPDATE oauth_signing_keys SET encrypted_private_key_pem = @value WHERE kid = @kid`).run({
      value: newCiphertext,
      kid: ref.rowKey,
    });
  },
};

// ---------------------------------------------------------------------------
// service-connections
// ---------------------------------------------------------------------------

interface ServiceConnectionRow {
  readonly service_id: string;
  readonly client_secret_encrypted: string;
}

const serviceConnectionsStore: AtRestStore = {
  name: 'service-connections',
  table: 'service_connections',
  column: 'client_secret_encrypted',
  list(db) {
    const rows = db
      .prepare(`SELECT service_id, client_secret_encrypted FROM service_connections`)
      .all() as ServiceConnectionRow[];
    const refs: AtRestValueRef[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (row.client_secret_encrypted === '') {
        skipped++;
        continue;
      }
      refs.push({
        store: 'service-connections',
        rowKey: row.service_id,
        field: 'client_secret_encrypted',
        ciphertext: row.client_secret_encrypted,
      });
    }
    return { refs, skipped };
  },
  write(db, ref, newCiphertext) {
    db.prepare(`UPDATE service_connections SET client_secret_encrypted = @value WHERE service_id = @serviceId`).run({
      value: newCiphertext,
      serviceId: ref.rowKey,
    });
  },
};

// ---------------------------------------------------------------------------
// git-credentials
// ---------------------------------------------------------------------------

interface DeveloperCredentialRow {
  readonly id: string;
  readonly encrypted_token: string;
}

const gitCredentialsStore: AtRestStore = {
  name: 'git-credentials',
  table: 'developer_credentials',
  column: 'encrypted_token',
  list(db) {
    const rows = db
      .prepare(`SELECT id, encrypted_token FROM developer_credentials`)
      .all() as DeveloperCredentialRow[];
    const refs = rows.map((row) => ({
      store: 'git-credentials',
      rowKey: row.id,
      field: 'encrypted_token',
      ciphertext: row.encrypted_token,
    }));
    return { refs, skipped: 0 };
  },
  write(db, ref, newCiphertext) {
    db.prepare(`UPDATE developer_credentials SET encrypted_token = @value WHERE id = @id`).run({
      value: newCiphertext,
      id: ref.rowKey,
    });
  },
};

// ---------------------------------------------------------------------------
// plugin-configs
// ---------------------------------------------------------------------------

interface PluginRow {
  readonly id: string;
  readonly package_name: string;
  readonly config: string;
}

const pluginConfigsStore: AtRestStore = {
  name: 'plugin-configs',
  table: 'plugins',
  column: 'config',
  list(db, ctx) {
    const rows = db.prepare(`SELECT id, package_name, config FROM plugins`).all() as PluginRow[];
    const refs: AtRestValueRef[] = [];
    let viaManifest = 0;
    let viaShape = 0;

    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.config) as Record<string, unknown>;
      } catch {
        // Malformed JSON is reported by the engine's decrypt pre-pass, not
        // here — but there is nothing to enumerate for this row.
        continue;
      }
      if (parsed === null || typeof parsed !== 'object') continue;

      const manifest = tryReadPluginManifest(ctx.pluginsDir, row.package_name);
      if (manifest !== null) {
        // Matches runtime decryptConfig exactly: only manifest-declared
        // type:'secret' string fields are treated as ciphertext.
        const secretKeys = new Set(
          manifest.configSchema.filter((f) => f.type === 'secret').map((f) => f.key),
        );
        for (const [field, value] of Object.entries(parsed)) {
          if (secretKeys.has(field) && typeof value === 'string' && value !== '') {
            refs.push({ store: 'plugin-configs', rowKey: row.id, field, ciphertext: value });
            viaManifest++;
          }
        }
      } else {
        // No manifest resolvable (F-3: e.g. CLI-configured plugin whose
        // package is not installed at this pluginsDir) — fall back to
        // shape detection on every string field.
        for (const [field, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && isEncryptedShape(value)) {
            refs.push({ store: 'plugin-configs', rowKey: row.id, field, ciphertext: value });
            viaShape++;
          }
        }
      }
    }

    return { refs, skipped: 0, viaManifest, viaShape };
  },
  write(db, ref, newCiphertext) {
    const row = db.prepare(`SELECT config FROM plugins WHERE id = @id`).get({ id: ref.rowKey }) as
      | { config: string }
      | undefined;
    if (row === undefined) {
      throw new Error(`at-rest plugin-configs write: plugin row disappeared for id ${ref.rowKey}`);
    }
    const parsed = JSON.parse(row.config) as Record<string, unknown>;
    parsed[ref.field] = newCiphertext;
    db.prepare(`UPDATE plugins SET config = @config WHERE id = @id`).run({
      config: JSON.stringify(parsed),
      id: ref.rowKey,
    });
  },
};

/**
 * The single registry of at-rest stores, in documented processing order.
 * Frozen so callers cannot mutate it at runtime.
 */
export const AT_REST_STORES: readonly AtRestStore[] = Object.freeze([
  oauthSigningKeysStore,
  serviceConnectionsStore,
  gitCredentialsStore,
  pluginConfigsStore,
]);
