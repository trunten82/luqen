/**
 * PBH-A Task 1 — unsubscribe-secret-source.test.ts
 *
 * Characterisation + controls (H1, plan finding F-1): unsubscribe tokens are
 * HMAC-signed by UNSUBSCRIBE_SECRET (falling back to unprefixed
 * SESSION_SECRET) and are deliberately NOT tied to either dashboard key
 * (DASHBOARD_SESSION_SECRET / DASHBOARD_ENCRYPTION_KEY). Both rotations must
 * leave unsubscribe tokens unaffected. These are pinning tests, not TDD reds
 * — unsubscribe-token.ts is untouched by this plan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintUnsubscribeToken, verifyUnsubscribeToken, CHANNEL_EMAIL_REPORTS } from '../../src/notifications/unsubscribe-token.js';

const ENV_KEYS = [
  'UNSUBSCRIBE_SECRET',
  'SESSION_SECRET',
  'DASHBOARD_SESSION_SECRET',
  'DASHBOARD_ENCRYPTION_KEY',
] as const;

const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = snapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('unsubscribe token secret source (characterisation, PBH-A / F-1)', () => {
  it('UNS-1: neither UNSUBSCRIBE_SECRET nor SESSION_SECRET set, only DASHBOARD_* set -> mint throws', () => {
    delete process.env['UNSUBSCRIBE_SECRET'];
    delete process.env['SESSION_SECRET'];
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'b'.repeat(32);

    expect(() =>
      mintUnsubscribeToken({ recipient: 'alice@example.com', channel: CHANNEL_EMAIL_REPORTS, orgId: 'org-1' }),
    ).toThrow(/UNSUBSCRIBE_SECRET/);
  });

  it('UNS-2: with SESSION_SECRET set, the token is identical and still verifies across a DASHBOARD_SESSION_SECRET + DASHBOARD_ENCRYPTION_KEY change', () => {
    process.env['SESSION_SECRET'] = 'fixed-unsubscribe-signing-secret-x';
    delete process.env['UNSUBSCRIBE_SECRET'];
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'b'.repeat(32);

    const payload = { recipient: 'bob@example.com', channel: CHANNEL_EMAIL_REPORTS, orgId: 'org-2' };
    const before = mintUnsubscribeToken(payload);

    // Both dashboard keys rotate — neither DASHBOARD_SESSION_SECRET nor
    // DASHBOARD_ENCRYPTION_KEY is read by resolveSecret().
    process.env['DASHBOARD_SESSION_SECRET'] = 'c'.repeat(32);
    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'd'.repeat(32);

    const after = mintUnsubscribeToken(payload);
    expect(after).toBe(before);
    expect(verifyUnsubscribeToken(after)).toEqual(payload);
  });
});
