/**
 * OAuth signing-key rotation + nightly housekeeping — Phase 31.1 Plan 04 Task 1.
 *
 * Two exported helpers:
 *
 *   1. `performKeyRotation(storage, encryptionKey)`:
 *        - Generates a fresh RSA 2048 keypair (same shape as
 *          oauth-key-bootstrap.ts).
 *        - Inserts it into `oauth_signing_keys` as the new active key.
 *        - Retires the previously-active key (D-25 overlap window starts now).
 *        - Returns { newKid, retiredKid }.
 *
 *   2. `runKeyHousekeeping(storage, encryptionKey, now)`:
 *        - Calls `oauthRefresh.cleanupExpired()` (tolerates 0 rows).
 *        - Removes retired keys past the D-25 cutoff (30 days + 1 hour —
 *          the absolute refresh-token lifetime plus the access-token ceiling).
 *        - Auto-rotates if the current active key is older than
 *          `OAUTH_KEY_MAX_AGE_DAYS` env var (default 90 — D-25 "rotation
 *          cadence quarterly" from 31.1-CONTEXT.md Specific Ideas).
 *        - On successful auto-rotation, writes an `agent_audit_log` row
 *          with tool_name='oauth.key_rotated', outcome='success' so operators
 *          can see when automated rotation fired.
 *
 * Note: the running `DashboardSigner` caches its private key at construction
 * time. After a rotation, in-flight tokens (signed with the OLD kid) remain
 * valid — every JWKS consumer can still fetch the old public key until
 * `markRemoved` runs for it. New tokens continue to be minted by the CURRENT
 * signer instance until the server restarts (or the signer is explicitly
 * rebuilt). Plan 04 ships the rotation primitive; full signer hot-swap on
 * rotate is a future enhancement.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { encryptSecret } from '../plugins/crypto.js';
import type { StorageAdapter } from '../db/adapter.js';

export interface PerformRotationResult {
  readonly newKid: string;
  readonly retiredKid: string | null;
}

/**
 * Generate a fresh RSA 2048 keypair, insert it, retire the previously-active
 * key, and return both kids. Safe to call repeatedly (each call produces a new
 * key and retires whichever key WAS active at call time).
 */
export async function performKeyRotation(
  storage: StorageAdapter,
  encryptionKey: string,
): Promise<PerformRotationResult> {
  const active = await storage.oauthSigningKeys.listActiveKeys();
  // listActiveKeys orders DESC (newest first). If the defensive two-active
  // situation happens, we retire the newest of the prior set — the oldest
  // active key continues to sign (a subsequent rotation will pick it up).
  const current = active[0];

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const newKid = `k_${randomBytes(8).toString('hex')}`;
  const encryptedPrivate = encryptSecret(privateKey, encryptionKey);

  await storage.oauthSigningKeys.insertKey({
    kid: newKid,
    publicKeyPem: publicKey,
    encryptedPrivateKeyPem: encryptedPrivate,
  });

  let retiredKid: string | null = null;
  if (current !== undefined) {
    await storage.oauthSigningKeys.retireKey(current.kid);
    retiredKid = current.kid;
  }

  return { newKid, retiredKid };
}

const DEFAULT_MAX_AGE_DAYS = 90;
/**
 * D-25 overlap window: access_token TTL (1h) + refresh_token absolute
 * lifetime (30d) = 30d + 1h. A key retired this long ago cannot possibly
 * still be signing any valid token, so it's safe to remove from JWKS.
 */
const REFRESH_ABSOLUTE_GRACE_MS = 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nightly sweep — cleanup expired refresh tokens, mark keys past the overlap
 * window as removed, and auto-rotate if the current key is too old.
 */
export async function runKeyHousekeeping(
  storage: StorageAdapter,
  encryptionKey: string,
  now: Date = new Date(),
): Promise<void> {
  // 1. Cleanup expired refresh tokens (returns count ≥ 0; no-op on 0).
  await storage.oauthRefresh.cleanupExpired();

  // 2. Remove fully-retired keys past the 30d+1h grace window.
  const cutoff = new Date(now.getTime() - REFRESH_ABSOLUTE_GRACE_MS).toISOString();
  const removable = await storage.oauthSigningKeys.listRemovable(cutoff);
  for (const key of removable) {
    await storage.oauthSigningKeys.markRemoved(key.kid);
  }

  // 3. Auto-rotate if the current active key is older than OAUTH_KEY_MAX_AGE_DAYS.
  const envRaw = process.env['OAUTH_KEY_MAX_AGE_DAYS'];
  const envParsed = envRaw !== undefined ? Number.parseInt(envRaw, 10) : NaN;
  const maxAgeDays = Number.isFinite(envParsed) && envParsed > 0 ? envParsed : DEFAULT_MAX_AGE_DAYS;
  const active = await storage.oauthSigningKeys.listActiveKeys();
  const current = active[0];
  if (current !== undefined) {
    const ageMs = now.getTime() - Date.parse(current.createdAt);
    if (ageMs > maxAgeDays * DAY_MS) {
      const rotationStartedAt = Date.now();
      const result = await performKeyRotation(storage, encryptionKey);
      await storage.agentAudit.append({
        userId: 'system',
        orgId: 'system',
        toolName: 'oauth.key_rotated',
        argsJson: JSON.stringify({
          newKid: result.newKid,
          retiredKid: result.retiredKid,
        }),
        outcome: 'success',
        latencyMs: Date.now() - rotationStartedAt,
      });
    }
  }
}
