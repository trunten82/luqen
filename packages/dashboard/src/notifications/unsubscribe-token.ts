import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phase 71 — Stateless per-recipient unsubscribe tokens.
 *
 * Token format: `<base64url(recipient)>.<base64url(channel)>.<base64url(orgId)>.<hmac-hex>`
 *
 * The HMAC is computed over `${recipient}:${channel}:${orgId}` with
 * UNSUBSCRIBE_SECRET (falling back to SESSION_SECRET). The same inputs
 * always produce the same token — the unsubscribe URL is therefore safe
 * to re-render in every email without growing a dedicated mint table.
 *
 * Verification is constant-time (`timingSafeEqual`) and rejects any token
 * whose claimed (recipient, channel, orgId) does not match the HMAC.
 */

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function resolveSecret(secret?: string): string {
  if (secret !== undefined && secret.length > 0) return secret;
  const envSecret = process.env['UNSUBSCRIBE_SECRET']
    ?? process.env['SESSION_SECRET'];
  if (envSecret === undefined || envSecret.length === 0) {
    throw new Error(
      'UNSUBSCRIBE_SECRET (or SESSION_SECRET) must be set to mint or verify unsubscribe tokens',
    );
  }
  return envSecret;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export interface UnsubscribeTokenPayload {
  readonly recipient: string;
  readonly channel: string;
  readonly orgId: string;
}

interface TokenBody {
  readonly r: string;
  readonly c: string;
  readonly o: string;
  readonly s: string;
}

export function mintUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
  options: { readonly secret?: string } = {},
): string {
  const secret = resolveSecret(options.secret);
  const recipient = payload.recipient.trim().toLowerCase();
  const canonical = `${recipient}:${payload.channel}:${payload.orgId}`;
  const sig = signPayload(canonical, secret);
  const body: TokenBody = {
    r: recipient,
    c: payload.channel,
    o: payload.orgId,
    s: sig,
  };
  // Single base64url blob — avoids `.` in the URL so fastify's :token
  // param matches cleanly without wildcard routing.
  return b64urlEncode(JSON.stringify(body));
}

export function verifyUnsubscribeToken(
  token: string,
  options: { readonly secret?: string } = {},
): UnsubscribeTokenPayload | null {
  let body: TokenBody;
  try {
    const json = b64urlDecode(token);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== 'object'
      || parsed === null
      || typeof (parsed as TokenBody).r !== 'string'
      || typeof (parsed as TokenBody).c !== 'string'
      || typeof (parsed as TokenBody).o !== 'string'
      || typeof (parsed as TokenBody).s !== 'string'
    ) {
      return null;
    }
    body = parsed as TokenBody;
  } catch {
    return null;
  }
  if (body.r === '' || body.c === '' || body.o === '') return null;
  if (!/^[0-9a-f]{64}$/i.test(body.s)) return null;

  const secret = resolveSecret(options.secret);
  const canonical = `${body.r}:${body.c}:${body.o}`;
  const expectedSig = signPayload(canonical, secret);

  const a = Buffer.from(expectedSig, 'hex');
  const b = Buffer.from(body.s, 'hex');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { recipient: body.r, channel: body.c, orgId: body.o };
}

/** Channel identifier used for scheduled email reports. */
export const CHANNEL_EMAIL_REPORTS = 'email-reports';

export function buildUnsubscribeUrl(
  baseUrl: string,
  payload: UnsubscribeTokenPayload,
  options: { readonly secret?: string } = {},
): string {
  const token = mintUnsubscribeToken(payload, options);
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/u/${encodeURIComponent(token)}`;
}
