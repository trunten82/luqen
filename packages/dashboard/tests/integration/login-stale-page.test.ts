/**
 * HARD-21 end to end: a sign-in sent from a sign-in page that is no longer current is answered with a
 * page, never raw JSON and never a sign-in. A page token belongs to the session it was issued for and
 * the session changes at every sign-in, so a second tab, a page kept open across a sign-in or a client
 * with no session at all sends a token the server refuses. Signed out, the answer is a redirect to a
 * fresh sign-in page with a notice; already signed in, it is a redirect to the page asked for, and the
 * signed-in session is kept.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). Stored users sign in with one
 * password; each test uses its own socket address so the sign-in limit of ten attempts per address
 * never matters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { getLocaleData, loadTranslations } from '../../src/i18n/index.js';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Stale-42!';

let h: McpOauthHarness;
let noticeText: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  loadTranslations();
  noticeText = getLocaleData('en')['auth.signInPageExpired'] ?? '';
  h = await startMcpOauthHarness('login-stale-page');
  userA = (await h.seed.users.createUser('fabrikam-lg-a', PASSWORD, 'user')).id;
  userB = (await h.seed.users.createUser('fabrikam-lg-b', PASSWORD, 'user')).id;
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

const csrfOf = (html: string): string => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
const cookieOf = (res: LightMyRequestResponse, fallback = ''): string => res.cookies.find((c) => c.name === 'session')?.value ?? fallback;

/** A sign-in page fetched with `cookie` (none for a new browser): the cookie to send next and its page token. */
async function page(remoteAddress: string, url: string, cookie?: string): Promise<{ readonly res: LightMyRequestResponse; readonly cookie: string; readonly csrf: string }> {
  const res = await h.app.inject({ method: 'GET', url, remoteAddress, ...(cookie !== undefined ? { cookies: { session: cookie } } : {}) });
  return { res, cookie: cookieOf(res, cookie ?? ''), csrf: csrfOf(res.body) };
}

/** POST /login with an optional cookie and token. */
async function signInAttempt(
  remoteAddress: string, username: string, returnTo: string, cookie: string | undefined, token: string,
): Promise<LightMyRequestResponse> {
  return await h.app.inject({
    method: 'POST', url: '/login', remoteAddress,
    ...(cookie !== undefined ? { cookies: { session: cookie } } : {}),
    headers: { 'x-csrf-token': token },
    payload: { username, password: PASSWORD, returnTo },
  });
}

/** The user name a signed-in page names in its header, or '' when `cookie` is not signed in. */
async function signedInAs(cookie: string): Promise<string> {
  const res = await h.app.inject({ method: 'GET', url: '/account', cookies: { session: cookie } });
  return /app-header__user">([^<]*)</.exec(res.body)?.[1] ?? '';
}

/** The login.success audit rows written for `userId`. */
function loginSuccessRows(userId: string): number {
  const query = h.seed.getRawDatabase().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login.success' AND actor_id = ?");
  return (query.get(userId) as { n: number }).n;
}

describe('HARD-21 a sign in from a page that is no longer current', () => {
  it('HARD-21 a sign in from an expired sign in page answers a fresh sign in page', async () => {
    const remote = '127.0.0.41';
    // Browser X opened the sign-in page; browser Y has a session of its own.
    const x = await page(remote, '/login?returnTo=%2Faccount');
    const y = await page(remote, '/login');

    const wrongSession = await signInAttempt(remote, 'fabrikam-lg-a', '/account', y.cookie, x.csrf);
    const noSession = await signInAttempt(remote, 'fabrikam-lg-a', '/account', undefined, x.csrf);

    for (const [name, res] of [['wrong-session', wrongSession], ['no-session', noSession]] as const) {
      const trail = `${name}=${res.statusCode} ${String(res.headers.location)} ${String(res.headers['content-type'])}`;
      expect(res.statusCode, trail).toBe(302);
      expect(String(res.headers.location), trail).toMatch(/^\/login\?stale=1/);
      expect(String(res.headers.location), trail).toContain('returnTo=%2Faccount');
      expect(String(res.headers['content-type'] ?? ''), trail).not.toContain('application/json');
      expect(res.body, trail).not.toContain('FST_CSRF');
    }
    expect(loginSuccessRows(userA)).toBe(0);
    expect(await signedInAs(cookieOf(wrongSession, y.cookie))).toBe('');
    expect(await signedInAs(cookieOf(noSession))).toBe('');

    // The fresh page carries the notice and a page token that signs in.
    const fresh = await page(remote, String(wrongSession.headers.location), cookieOf(wrongSession, y.cookie));
    expect(fresh.res.statusCode).toBe(200);
    expect(String(fresh.res.headers['content-type'])).toContain('text/html');
    expect(noticeText.length).toBeGreaterThan(0);
    expect(fresh.res.body).toContain(noticeText);
    expect(fresh.csrf.length).toBeGreaterThan(0);
    const done = await signInAttempt(remote, 'fabrikam-lg-a', '/account', fresh.cookie, fresh.csrf);
    expect(done.statusCode, `done=${done.statusCode}`).toBe(302);
    expect(String(done.headers.location)).toBe('/account');
    expect(await signedInAs(cookieOf(done))).toBe('fabrikam-lg-a');
  }, 60_000);

  it('HARD-21 a sign in from a second tab after the first signed in keeps the first sign in', async () => {
    const remote = '127.0.0.42';
    // One browser, two tabs: the second page load sees the same session and gets its own token.
    const tab1 = await page(remote, '/login');
    const tab2 = await page(remote, '/login', tab1.cookie);

    const first = await signInAttempt(remote, 'fabrikam-lg-a', '/account', tab1.cookie, tab1.csrf);
    expect(first.statusCode, `first=${first.statusCode}`).toBe(302);
    const afterFirst = cookieOf(first, tab1.cookie);
    const second = await signInAttempt(remote, 'fabrikam-lg-b', '/account', afterFirst, tab2.csrf);

    const trail = `second=${second.statusCode} ${String(second.headers.location)} ${String(second.headers['content-type'])}`;
    expect(second.statusCode, trail).toBe(302);
    expect(String(second.headers.location), trail).toBe('/account');
    expect(String(second.headers['content-type'] ?? ''), trail).not.toContain('application/json');
    expect(await signedInAs(cookieOf(second, afterFirst))).toBe('fabrikam-lg-a');
    expect(loginSuccessRows(userB)).toBe(0);
  }, 60_000);
});
