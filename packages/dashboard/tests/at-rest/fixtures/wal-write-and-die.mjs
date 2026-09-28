#!/usr/bin/env node
/**
 * PBH-B Task 3 — OPS-6 fixture.
 *
 * Writes one developer_credentials row (encrypted under the given key+salt,
 * mirroring routes/git-credentials.ts:125's format), then SIGKILLs itself so
 * the write lands only in the WAL file, never through a normal close/
 * checkpoint. This proves the rekey command's backup step must checkpoint
 * before copying, or WAL-resident rows are silently lost from the backup.
 *
 * All inputs arrive via environment variables, never argv, so the key and
 * plaintext never appear in `ps` output or a captured child command line.
 */
import Database from 'better-sqlite3';
import { randomBytes, createCipheriv, scryptSync } from 'node:crypto';
import { writeSync } from 'node:fs';

const dbPath = process.env.WAL_FIXTURE_DB_PATH;
const key = process.env.WAL_FIXTURE_KEY;
const salt = process.env.WAL_FIXTURE_SALT;
const hostConfigId = process.env.WAL_FIXTURE_HOST_CONFIG_ID;
const userId = process.env.WAL_FIXTURE_USER_ID;
const rowId = process.env.WAL_FIXTURE_ROW_ID;
const tokenPlaintext = process.env.WAL_FIXTURE_TOKEN_PLAINTEXT;

if (
  dbPath === undefined || key === undefined || salt === undefined ||
  hostConfigId === undefined || userId === undefined || rowId === undefined ||
  tokenPlaintext === undefined
) {
  writeSync(2, 'wal-write-and-die: missing required env vars\n');
  process.exit(1);
}

// Same AES-256-GCM iv:ciphertext:tag format as src/plugins/crypto.ts's
// encryptWithDerivedKey — duplicated here (not imported) because this
// fixture runs as plain node, outside the TS build.
function encrypt(plaintext, encKey, encSalt) {
  const derivedKey = scryptSync(encKey, encSalt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const encryptedToken = encrypt(tokenPlaintext, key, salt);
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO developer_credentials (id, user_id, git_host_config_id, encrypted_token, token_hint, validated_username, created_at)
   VALUES (@id, @userId, @hostConfigId, @encryptedToken, @tokenHint, @validatedUsername, @createdAt)`,
).run({
  id: rowId,
  userId,
  hostConfigId,
  encryptedToken,
  tokenHint: `••••${tokenPlaintext.slice(-4)}`,
  validatedUsername: 'wal-fixture-user',
  createdAt: now,
});

// Synchronous write so the parent sees this before the SIGKILL races it.
writeSync(1, 'WRITTEN\n');

process.kill(process.pid, 'SIGKILL');
