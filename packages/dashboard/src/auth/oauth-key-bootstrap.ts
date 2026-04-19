/**
 * OAuth signing key bootstrap — Phase 31.1 Plan 02 Task 1 (D-26).
 *
 * On first-boot, if `oauth_signing_keys` has no active rows, generate an
 * RSA-2048 keypair, encrypt the PEM-encoded private key with
 * `plugins/crypto.ts#encryptSecret`, and insert a single active row.
 *
 * Idempotent: if an active key already exists (`retired_at IS NULL`),
 * the function returns early without side effects.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { encryptSecret } from '../plugins/crypto.js';
import type { StorageAdapter } from '../db/adapter.js';

/**
 * Ensures there is at least one active RS256 signing key in the DB.
 * Safe to call multiple times — second invocation is a no-op.
 */
export async function ensureInitialSigningKey(
  storage: StorageAdapter,
  encryptionKey: string,
): Promise<void> {
  const active = await storage.oauthSigningKeys.listActiveKeys();
  if (active.length > 0) return;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const kid = `k_${randomBytes(8).toString('hex')}`;
  const encryptedPrivate = encryptSecret(privateKey, encryptionKey);

  await storage.oauthSigningKeys.insertKey({
    kid,
    publicKeyPem: publicKey,
    encryptedPrivateKeyPem: encryptedPrivate,
  });
}
