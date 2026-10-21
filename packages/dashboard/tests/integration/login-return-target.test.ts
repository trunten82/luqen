/**
 * HARD-21 end to end: every way into the dashboard that takes a return target sends the browser only to
 * a page of the dashboard. A sign-in by password or by API key, a signed-in visit to the sign-in page, a
 * sign-in sent from a sign-in page that is no longer current, and a sign-in sent with no page token all
 * answer a Location that a browser resolves to the dashboard's own origin, whatever returnTo holds; a
 * path of the dashboard keeps its query and fragment.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). POST /login allows ten attempts per
 * address per fifteen minutes, so each part of a test uses its own socket address and none takes more
 * than nine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Return-42!';
const USER = 'fabrikam-rt-a';
const DASHBOARD = 'https://dashboard.example.com';

/** Each return target with the Location a sign-in must answer for it. */
const ROUTE_TABLE: ReadonlyArray<readonly [string, string]> = [
  ['/reports?x=1#h', '/reports?x=1#h'],
  ['/%09/evil.example/x', '/%09/evil.example/x'],
  ['/\t/evil.example/x', '/'],
  ['/\n/evil.example/x', '/'],
  ['/\\evil.example/x', '/'],
  ['//evil.example/x', '/'],
  ['https://evil.example/x', '/'],
  ['/..//evil.example/x', '/'],
];
const KEPT = new Set(ROUTE_TABLE.filter(([row, want]) => row === want).map(([row]) => row));

let h: McpOauthHarness;
let userId: string;
let apiKey: string;

beforeAll(async () => {
  h = await startMcpOauthHarness('login-return-target');
  userId = (await h.seed.users.createUser(USER, PASSWORD, 'user')).id;
  apiKey = generateApiKey();
  storeApiKey(h.seed.getRawDatabase(), apiKey, 'rt-admin', 'admin');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

const csrfOf = (html: string): string => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
const cookieOf = (res: LightMyRequestResponse, fallback = ''): string => res.cookies.find((c) => c.name === 'session')?.value ?? fallback;

/** A sign-in page fetched with `cookie` (none for a new browser): the cookie to send next and its page token. */
async function page(remoteAddress: string, url: string, cookie?: string): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const res = await h.app.inject({ method: 'GET', url, remoteAddress, ...(cookie !== undefined ? { cookies: { session: cookie } } : {}) });
  return { cookie: cookieOf(res, cookie ?? ''), csrf: csrfOf(res.body) };
}

/** POST /login with an optional cookie and an optional page token. */
async function post(
  remoteAddress: string, fields: Record<string, string>, cookie: string | undefined, token: string | undefined,
): Promise<LightMyRequestResponse> {
  return await h.app.inject({
    method: 'POST', url: '/login', remoteAddress,
    ...(cookie !== undefined ? { cookies: { session: cookie } } : {}),
    ...(token !== undefined ? { headers: { 'x-csrf-token': token } } : {}),
    payload: fields,
  });
}

/** A fresh browser signed in with the password; its cookie. */
async function signedIn(remoteAddress: string): Promise<string> {
  const p = await page(remoteAddress, '/login');
  const res = await post(remoteAddress, { username: USER, password: PASSWORD }, p.cookie, p.csrf);
  expect(res.statusCode, `sign-in=${res.statusCode}`).toBe(302);
  return cookieOf(res, p.cookie);
}

function loginSuccessRows(): number {
  const query = h.seed.getRawDatabase().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login.success' AND actor_id = ?");
  return (query.get(userId) as { n: number }).n;
}

/** The answer is a redirect to `want`, and a browser following it stays on the dashboard. */
function expectLocation(res: LightMyRequestResponse, want: string, trail: string): void {
  const location = String(res.headers.location);
  const detail = `${trail}: ${res.statusCode} ${JSON.stringify(location)}`;
  expect(res.statusCode, detail).toBe(302);
  expect(location, detail).toBe(want);
  expect(new URL(location, `${DASHBOARD}/login`).origin, detail).toBe(DASHBOARD);
}

describe('HARD-21 a sign in returns only to a page of the dashboard', () => {
  it('HARD-21 a sign in returns only to a page of the dashboard', async () => {
    for (const [label, remote, fields] of [
      ['password', '127.0.0.51', { username: USER, password: PASSWORD }],
      ['api key', '127.0.0.52', { apiKey }],
    ] as const) {
      for (const [row, want] of ROUTE_TABLE) {
        const p = await page(remote, '/login');
        const res = await post(remote, { ...fields, returnTo: row }, p.cookie, p.csrf);
        expectLocation(res, want, `${label} ${JSON.stringify(row)}`);
      }
    }
  }, 60_000);

  it('HARD-21 a signed in visit to the sign in page returns only to a page of the dashboard', async () => {
    const cookie = await signedIn('127.0.0.53');
    for (const [row, want] of ROUTE_TABLE) {
      const res = await h.app.inject({
        method: 'GET', url: `/login?returnTo=${encodeURIComponent(row)}`, remoteAddress: '127.0.0.53', cookies: { session: cookie },
      });
      expectLocation(res, want, `signed-in GET ${JSON.stringify(row)}`);
    }
  }, 60_000);

  it('HARD-21 a sign in from an expired sign in page returns only to a page of the dashboard', async () => {
    // Browser S fetched a page token T0, then signed in: T0 no longer belongs to its session.
    const s = await page('127.0.0.54', '/login');
    const t0 = s.csrf;
    const signIn = await post('127.0.0.54', { username: USER, password: PASSWORD }, s.cookie, t0);
    expect(signIn.statusCode, `sign-in=${signIn.statusCode}`).toBe(302);
    const sCookie = cookieOf(signIn, s.cookie);
    for (const [row, want] of ROUTE_TABLE) {
      const res = await post('127.0.0.54', { username: USER, password: PASSWORD, returnTo: row }, sCookie, t0);
      expectLocation(res, want, `signed-in stale ${JSON.stringify(row)}`);
    }
    // Browser U is signed out and sends T0 with its own cookie.
    for (const [row] of ROUTE_TABLE) {
      const u = await page('127.0.0.55', '/login');
      const res = await post('127.0.0.55', { username: USER, password: PASSWORD, returnTo: row }, u.cookie, t0);
      const want = KEPT.has(row) ? `/login?stale=1&returnTo=${encodeURIComponent(row)}` : '/login?stale=1';
      expectLocation(res, want, `signed-out stale ${JSON.stringify(row)}`);
    }
  }, 60_000);

  it('HARD-21 a sign in sent without a page token returns only to a page of the dashboard', async () => {
    const cookie = await signedIn('127.0.0.56');
    const before = loginSuccessRows();
    for (const [row, want] of ROUTE_TABLE) {
      const res = await post('127.0.0.56', { username: USER, password: PASSWORD, returnTo: row }, cookie, undefined);
      expectLocation(res, want, `no token ${JSON.stringify(row)}`);
    }
    expect(loginSuccessRows()).toBe(before);
  }, 60_000);
});
