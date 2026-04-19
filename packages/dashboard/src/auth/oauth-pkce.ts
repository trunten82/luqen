/**
 * PKCE S256 verifier — Phase 31.1 Plan 02 Task 1 (D-31 / D-32 / RFC 7636 §4.1).
 *
 * Dashboard-wide: Plan 02 authorization endpoint accepts ONLY S256 code
 * challenges. The verifier below is the single chokepoint; the token
 * endpoint compares the presented code_verifier against the stored
 * code_challenge using this helper before minting.
 *
 * Length bounds (RFC 7636 §4.1): code_verifier is 43..128 chars of
 * [A-Z a-z 0-9 - . _ ~]. We only enforce length here; upstream
 * validation can impose character-class checks if/when needed.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Returns true iff `codeVerifier` (43..128 chars) S256-hashes to exactly
 * `storedChallenge` (URL-safe base64-encoded SHA-256 digest).
 */
export function verifyS256Challenge(
  codeVerifier: string,
  storedChallenge: string,
): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  // Constant-time compare to avoid timing-side-channel on the stored challenge.
  if (computed.length !== storedChallenge.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(storedChallenge));
  } catch {
    return false;
  }
}
