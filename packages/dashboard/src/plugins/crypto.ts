import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import type { ConfigField } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const FIXED_SALT = 'luqen-plugin-config-salt';

function deriveKey(key: string): Buffer {
  return scryptSync(key, FIXED_SALT, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a random IV.
 * Returns a string in the format `iv:ciphertext:tag` (all base64-encoded).
 */
export function encryptSecret(value: string, key: string): string {
  const derivedKey = deriveKey(key);
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
 * Decrypt a string produced by `encryptSecret`.
 * Throws if the key is wrong or data has been tampered with.
 */
export function decryptSecret(encrypted: string, key: string): string {
  const derivedKey = deriveKey(key);
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
