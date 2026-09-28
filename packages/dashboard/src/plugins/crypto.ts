import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import type { ConfigField } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const DEFAULT_SALT = 'luqen-plugin-config-salt';
let _installationSalt: string = DEFAULT_SALT;

/** The historical default salt, exported for at-rest re-key classification (PBH-B). */
export const LEGACY_DEFAULT_SALT = DEFAULT_SALT;

/**
 * Set a per-installation salt for key derivation.
 * Call this at startup with a value persisted in the bootstrap DB.
 */
export function setEncryptionSalt(salt: string): void {
  _installationSalt = salt;
}

function deriveKey(key: string, salt: string): Buffer {
  return scryptSync(key, salt, KEY_LENGTH, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a random IV and an
 * already-derived key. Returns a string in the format `iv:ciphertext:tag`
 * (all base64-encoded). The single AES-GCM implementation shared by
 * `encryptSecret` (module-global salt, derives per call) and
 * `createAtRestCipher` (explicit salt, derives once).
 */
function encryptWithDerivedKey(value: string, derivedKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    encrypted.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a string produced by {@link encryptWithDerivedKey}.
 * Throws if the key is wrong, the format is malformed, or data has been
 * tampered with.
 */
function decryptWithDerivedKey(encrypted: string, derivedKey: Buffer): string {
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:ciphertext:tag');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a random IV.
 * Returns a string in the format `iv:ciphertext:tag` (all base64-encoded).
 */
export function encryptSecret(value: string, key: string): string {
  if (_installationSalt === DEFAULT_SALT) {
    console.warn('[security] encryptSecret called with default salt — call setEncryptionSalt() first');
  }
  return encryptWithDerivedKey(value, deriveKey(key, _installationSalt));
}

/**
 * Decrypt a string produced by `encryptSecret`.
 * Throws if the key is wrong or data has been tampered with.
 */
export function decryptSecret(encrypted: string, key: string): string {
  return decryptWithDerivedKey(encrypted, deriveKey(key, _installationSalt));
}

export interface AtRestCipher {
  readonly encrypt: (value: string) => string;
  readonly decrypt: (encrypted: string) => string;
}

/**
 * PBH-B — derive the scrypt key ONCE (not per value) and return an
 * `{ encrypt, decrypt }` pair producing/consuming the identical
 * `iv:ciphertext:tag` format as `encryptSecret`/`decryptSecret`, so
 * ciphertext is interchangeable between the two. Used by the re-key engine
 * and startup check, which each touch many values under a fixed key+salt —
 * re-deriving per value would multiply the ~244ms scrypt cost by the row
 * count.
 */
export function createAtRestCipher(options: { readonly key: string; readonly salt: string }): AtRestCipher {
  const derivedKey = deriveKey(options.key, options.salt);
  return {
    encrypt: (value: string) => encryptWithDerivedKey(value, derivedKey),
    decrypt: (encrypted: string) => decryptWithDerivedKey(encrypted, derivedKey),
  };
}

/**
 * True when `value` has the shape produced by `encryptSecret` /
 * `createAtRestCipher().encrypt` — three colon-separated base64 parts, an
 * IV that decodes to 12 bytes and a tag that decodes to 16 bytes. Does NOT
 * verify the value decrypts under any particular key. Used by the at-rest
 * store registry's shape-fallback path (PBH-B) for plugin config values
 * whose manifest cannot be resolved.
 */
export function isEncryptedShape(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivPart, , tagPart] = parts;
  try {
    const iv = Buffer.from(ivPart, 'base64');
    const tag = Buffer.from(tagPart, 'base64');
    return iv.length === IV_LENGTH && tag.length === TAG_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Encrypt all fields marked as `type: 'secret'` in the config schema.
 * Returns a new config object — the original is not mutated.
 */
export function encryptConfig(
  config: Readonly<Record<string, unknown>>,
  schema: readonly ConfigField[],
  key: string,
): Record<string, unknown> {
  const secretKeys = new Set(
    schema.filter((f) => f.type === 'secret').map((f) => f.key),
  );

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = secretKeys.has(k) && typeof v === 'string'
      ? encryptSecret(v, key)
      : v;
  }
  return result;
}

/**
 * Decrypt all fields marked as `type: 'secret'` in the config schema.
 * Returns a new config object — the original is not mutated.
 */
export function decryptConfig(
  config: Readonly<Record<string, unknown>>,
  schema: readonly ConfigField[],
  key: string,
): Record<string, unknown> {
  const secretKeys = new Set(
    schema.filter((f) => f.type === 'secret').map((f) => f.key),
  );

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = secretKeys.has(k) && typeof v === 'string'
      ? decryptSecret(v, key)
      : v;
  }
  return result;
}

/**
 * Replace all secret-typed fields with '***'.
 * Returns a new config object — the original is not mutated.
 */
export function maskSecrets(
  config: Readonly<Record<string, unknown>>,
  schema: readonly ConfigField[],
): Record<string, unknown> {
  const secretKeys = new Set(
    schema.filter((f) => f.type === 'secret').map((f) => f.key),
  );

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = secretKeys.has(k) ? '***' : v;
  }
  return result;
}
