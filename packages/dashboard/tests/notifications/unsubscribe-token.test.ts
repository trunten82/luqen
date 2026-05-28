/**
 * Phase 71 — Unsubscribe token mint + verify.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  CHANNEL_EMAIL_REPORTS,
} from '../../src/notifications/unsubscribe-token.js';

beforeAll(() => {
  process.env['UNSUBSCRIBE_SECRET'] = 'test-unsubscribe-secret';
});

describe('mintUnsubscribeToken', () => {
  it('produces a stable token for the same inputs', () => {
    const a = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const b = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    expect(a).toBe(b);
  });

  it('normalises recipient (case + whitespace)', () => {
    const a = mintUnsubscribeToken({
      recipient: '  Alice@Example.com ',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const b = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    expect(a).toBe(b);
  });

  it('produces different tokens for different orgs', () => {
    const a = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const b = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-2',
    });
    expect(a).not.toBe(b);
  });
});

describe('verifyUnsubscribeToken', () => {
  it('round-trips a freshly minted token', () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const payload = verifyUnsubscribeToken(token);
    expect(payload).toEqual({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
  });

  it('rejects a tampered signature', () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const tampered = `${token.slice(0, -8)}AAAAAAAA`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects a tampered recipient', () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    // Decode payload, swap recipient, re-encode WITHOUT recomputing the sig.
    const json = Buffer.from(
      token.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const body = JSON.parse(json);
    body.r = 'eve@example.com';
    const tampered = Buffer.from(JSON.stringify(body), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('not-json-but-b64url-aGVsbG8')).toBeNull();
  });

  it('rejects when secret differs', () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    expect(verifyUnsubscribeToken(token, { secret: 'different' })).toBeNull();
  });
});

describe('buildUnsubscribeUrl', () => {
  it('appends /u/<token> and trims trailing slash on base', () => {
    const url = buildUnsubscribeUrl('https://dashboard.example.com/', {
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    expect(url.startsWith('https://dashboard.example.com/u/')).toBe(true);
  });

  it('produces a URL whose token verifies back to the same payload', () => {
    const url = buildUnsubscribeUrl('https://dashboard.example.com', {
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const token = decodeURIComponent(url.split('/u/')[1]);
    expect(verifyUnsubscribeToken(token)).toEqual({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
  });
});
