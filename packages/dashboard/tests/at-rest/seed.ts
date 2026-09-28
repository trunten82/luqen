/**
 * PBH-B Task 2 — test-only seed helper for the at-rest re-key engine tests.
 *
 * NOT a test file itself (no .test.ts suffix — never picked up by vitest's
 * include glob). Seeds a temp DB through the REAL runtime paths so the
 * engine is exercised against exactly the shapes production writes:
 *   - oauth_signing_keys: ensureInitialSigningKey + performKeyRotation
 *     (2 keys, one retired)
 *   - service_connections: SqliteServiceConnectionsRepository.upsert
 *     (one with a secret, one with '')
 *   - developer_credentials: storage.gitHosts.storeCredential with
 *     encryptSecret(token, key), mirroring routes/git-credentials.ts:125
 *   - plugins.config: PluginManager.configure (global row) +
 *     configureForOrg (org row), a manifest on disk declaring one secret
 *     and one non-secret field; plus one plugin row with NO manifest on
 *     disk, holding a ciphertext directly (the shape-detection path).
 *
 * Never logs or returns anything through console — callers get plaintexts
 * and keys back as return values, for assertions only.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { ensureInitialSigningKey } from '../../src/auth/oauth-key-bootstrap.js';
import { performKeyRotation } from '../../src/auth/oauth-key-rotation.js';
import { SqliteServiceConnectionsRepository } from '../../src/db/sqlite/service-connections-sqlite.js';
import { encryptSecret, decryptSecret } from '../../src/plugins/crypto.js';
import type { PluginManifest } from '../../src/plugins/types.js';
import type Database from 'better-sqlite3';

export interface SeededAtRest {
  readonly db: Database.Database;
  readonly dbPath: string;
  readonly pluginsDir: string;
  readonly storage: SqliteStorageAdapter;
  readonly key: string;
  /** Distinct random plaintexts, seeded through the real encrypt paths. */
  readonly plaintexts: {
    readonly oauthActive: string;
    readonly oauthRetired: string;
    readonly serviceConnectionSecret: string;
    readonly gitCredentialToken: string;
    readonly pluginSecretGlobal: string;
    readonly pluginSecretOrg: string;
    readonly pluginNoManifestSecret: string;
  };
  readonly rowKeys: {
    readonly serviceConnectionId: string;
    readonly gitCredentialId: string;
    readonly pluginGlobalId: string;
    readonly pluginOrgId: string;
    readonly pluginNoManifestId: string;
  };
}

const SECRET_PLUGIN_PACKAGE = '@luqen/plugin-at-rest-seed-fixture';
const NO_MANIFEST_PLUGIN_PACKAGE = '@luqen/plugin-at-rest-no-manifest';

function randomPlaintext(label: string): string {
  return `${label}-${randomBytes(12).toString('hex')}`;
}

export async function seedAtRestFixture(): Promise<SeededAtRest> {
  const key = `at-rest-seed-key-${randomBytes(16).toString('hex')}`;

  const root = mkdtempSync(join(tmpdir(), 'luqen-at-rest-seed-'));
  const dbPath = join(root, 'dashboard.db');
  const pluginsDir = join(root, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const rawDb = storage.getRawDatabase();

  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir,
    encryptionKey: key,
    registryEntries: [],
  });

  // Real salt row creation + module salt set (mirrors server.ts boot order).
  // eslint-disable-next-line no-new
  new AuthService(rawDb, pluginManager, storage);

  // ── oauth_signing_keys: 2 keys, one retired ─────────────────────────────
  await ensureInitialSigningKey(storage, key);
  const beforeRotation = await storage.oauthSigningKeys.listActiveKeys();
  const oauthRetiredKid = beforeRotation[0]?.kid;
  await performKeyRotation(storage, key);
  const afterRotation = await storage.oauthSigningKeys.listActiveKeys();
  const oauthActiveKid = afterRotation[0]?.kid;
  if (oauthActiveKid === undefined || oauthRetiredKid === undefined) {
    throw new Error('at-rest seed: expected 1 active key after bootstrap + rotation');
  }
  const allSigningRows = rawDb
    .prepare(`SELECT kid, encrypted_private_key_pem FROM oauth_signing_keys`)
    .all() as ReadonlyArray<{ kid: string; encrypted_private_key_pem: string }>;
  const activeRow = allSigningRows.find((r) => r.kid === oauthActiveKid);
  const retiredRow = allSigningRows.find((r) => r.kid === oauthRetiredKid);
  if (activeRow === undefined || retiredRow === undefined) {
    throw new Error('at-rest seed: could not locate seeded oauth signing key rows');
  }
  const oauthActivePlaintext = decryptSecret(activeRow.encrypted_private_key_pem, key);
  const oauthRetiredPlaintext = decryptSecret(retiredRow.encrypted_private_key_pem, key);

  // ── service_connections: one with a secret, one with '' ────────────────
  const serviceConnectionSecret = randomPlaintext('svc-secret');
  const serviceConnectionsRepo = new SqliteServiceConnectionsRepository(rawDb, key);
  const withSecret = await serviceConnectionsRepo.upsert({
    serviceId: 'compliance',
    url: 'http://localhost:4000',
    clientId: 'client-1',
    clientSecret: serviceConnectionSecret,
    updatedBy: null,
  });
  await serviceConnectionsRepo.upsert({
    serviceId: 'branding',
    url: 'http://localhost:4100',
    clientId: 'client-2',
    clientSecret: '',
    updatedBy: null,
  });

  // ── developer_credentials: one git credential (mirrors git-credentials.ts:125) ──
  const gitCredentialToken = randomPlaintext('git-token');
  const hostConfig = await storage.gitHosts.createConfig({
    orgId: 'org-1',
    pluginType: 'github',
    hostUrl: 'https://github.com',
    displayName: 'GitHub',
  });
  const encryptedToken = encryptSecret(gitCredentialToken, key);
  const credential = await storage.gitHosts.storeCredential({
    userId: 'user-1',
    gitHostConfigId: hostConfig.id,
    encryptedToken,
    tokenHint: '••••' + gitCredentialToken.slice(-4),
    validatedUsername: 'seed-user',
  });

  // ── plugins.config: manifest-declared secret field (global + org row) ──
  const manifest: PluginManifest = {
    name: 'at-rest-seed-fixture',
    displayName: 'At-Rest Seed Fixture',
    type: 'notification',
    version: '1.0.0',
    description: 'Test fixture manifest for at-rest re-key tests.',
    configSchema: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'webhookName', label: 'Webhook Name', type: 'string' },
    ],
  };
  const manifestDir = join(pluginsDir, 'packages', 'at-rest-seed-fixture');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifest));

  const pluginGlobalId = randomUUID();
  const now = new Date().toISOString();
  rawDb
    .prepare(
      `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
       VALUES (@id, @packageName, @type, @version, @config, @status, @installedAt)`,
    )
    .run({
      id: pluginGlobalId,
      packageName: SECRET_PLUGIN_PACKAGE,
      type: manifest.type,
      version: manifest.version,
      config: '{}',
      status: 'inactive',
      installedAt: now,
    });

  const pluginSecretGlobal = randomPlaintext('plugin-secret-global');
  await pluginManager.configure(pluginGlobalId, { apiKey: pluginSecretGlobal, webhookName: 'global-hook' });

  const pluginSecretOrg = randomPlaintext('plugin-secret-org');
  const orgRecord = await pluginManager.configureForOrg(SECRET_PLUGIN_PACKAGE, 'org-1', {
    apiKey: pluginSecretOrg,
    webhookName: 'org-hook',
  });
  const pluginOrgId = orgRecord.id;

  // ── plugins.config: NO manifest on disk — shape-detection path ─────────
  const pluginNoManifestSecret = randomPlaintext('plugin-secret-shape');
  const pluginNoManifestId = randomUUID();
  const shapeCiphertext = encryptSecret(pluginNoManifestSecret, key);
  rawDb
    .prepare(
      `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
       VALUES (@id, @packageName, @type, @version, @config, @status, @installedAt)`,
    )
    .run({
      id: pluginNoManifestId,
      packageName: NO_MANIFEST_PLUGIN_PACKAGE,
      type: 'notification',
      version: '1.0.0',
      config: JSON.stringify({ apiKey: shapeCiphertext, note: 'plain-string-not-a-secret' }),
      status: 'inactive',
      installedAt: now,
    });

  return {
    db: rawDb,
    dbPath,
    pluginsDir,
    storage,
    key,
    plaintexts: {
      oauthActive: oauthActivePlaintext,
      oauthRetired: oauthRetiredPlaintext,
      serviceConnectionSecret,
      gitCredentialToken,
      pluginSecretGlobal,
      pluginSecretOrg,
      pluginNoManifestSecret,
    },
    rowKeys: {
      serviceConnectionId: withSecret.serviceId,
      gitCredentialId: credential.id,
      pluginGlobalId,
      pluginOrgId,
      pluginNoManifestId,
    },
  };
}
