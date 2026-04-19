/**
 * Phase 31.1 Plan 02 Task 1 — PKCE S256 helper (oauth-pkce.ts).
 *
 * Covers D-31/D-32 PKCE S256 required + length constraints (RFC 7636 §4.1).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyS256Challenge } from '../../src/auth/oauth-pkce.js';

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('verifyS256Challenge — Test 4 (positive/negative S256 match)', () => {
  it('returns true when sha256(verifier) base64url-encoded === challenge', () => {
    const verifier = 'a'.repeat(50); // 50 chars, well within 43..128
    const challenge = s256(verifier);
    expect(verifyS256Challenge(verifier, challenge)).toBe(true);
  });

  it('returns false when the computed challenge does not match', () => {
    const verifier = 'a'.repeat(50);
    const wrongChallenge = s256('b'.repeat(50));
    expect(verifyS256Challenge(verifier, wrongChallenge)).toBe(false);
  });
});

describe('verifyS256Challenge — Test 5 (length bounds per RFC 7636 §4.1)', () => {
  it('rejects verifier shorter than 43 characters', () => {
    const shortVerifier = 'a'.repeat(42);
    const challenge = s256(shortVerifier);
    expect(verifyS256Challenge(shortVerifier, challenge)).toBe(false);
  });

  it('rejects verifier longer than 128 characters', () => {
    const longVerifier = 'a'.repeat(129);
    const challenge = s256(longVerifier);
    expect(verifyS256Challenge(longVerifier, challenge)).toBe(false);
  });

  it('accepts verifier exactly 43 characters long', () => {
    const boundary = 'a'.repeat(43);
    expect(verifyS256Challenge(boundary, s256(boundary))).toBe(true);
  });

  it('accepts verifier exactly 128 characters long', () => {
    const boundary = 'a'.repeat(128);
    expect(verifyS256Challenge(boundary, s256(boundary))).toBe(true);
  });
});
