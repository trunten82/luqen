/**
 * HARD-21 end to end: a session's activity time is recorded only on requests the session guard
 * checks. A cookie whose session the guard refuses cannot be kept alive by requesting public pages
 * (health, the sign-in page, static files), so it ends at the idle limit like any other.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) with a one minute idle limit.
 * Only Date is faked; time moves in 50 second steps, inside one idle window each.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Idle-42!';
const STEP_MS = 50_000;

let h: McpOauthHarness;

beforeAll(async () => {
  const priorLimit = process.env['SESSION_EXPIRY_MINUTES'];
  process.env['SESSION_EXPIRY_MINUTES'] = '1';
  try {
    h = await startMcpOauthHarness('session-idle-activity');
  } finally {
    if (priorLimit === undefined) delete process.env['SESSION_EXPIRY_MINUTES'];
    else process.env['SESSION_EXPIRY_MINUTES'] = priorLimit;
  }
}, 120_000);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (h !== undefined) await h.close();
});

const csrfOf = (html: string): string => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? '';

/** Sign a stored user in through POST /login from `remoteAddress`; the cookie the sign-in returns. */
async function signIn(username: string, remoteAddress: string): Promise<string> {
  const page = await h.app.inject({ method: 'GET', url: '/login', remoteAddress });
  const anonymous = page.cookies.find((c) => c.name === 'session')?.value ?? '';
  const login = await h.app.inject({
    method: 'POST', url: '/login', remoteAddress, cookies: { session: anonymous },
    headers: { 'x-csrf-token': csrfOf(page.body) }, payload: { username, password: PASSWORD },
  });
  expect(login.statusCode, `sign-in=${login.statusCode}`).toBe(302);
  return login.cookies.find((c) => c.name === 'session')?.value ?? '';
}

/** One GET with `cookie`: the answer and the cookie to send next (the one the answer sets, else the one sent). */
async function follow(cookie: string, url: string): Promise<{ readonly res: LightMyRequestResponse; readonly cookie: string }> {
  const res = await h.app.inject({ method: 'GET', url, cookies: { session: cookie } });
  return { res, cookie: res.cookies.find((c) => c.name === 'session')?.value ?? cookie };
}

/** The session.ended audit rows written for `userId`, once they have settled. */
async function sessionEndedCount(userId: string, atLeast: number): Promise<number> {
  const query = h.seed.getRawDatabase().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session.ended' AND actor_id = ?");
  let n = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    n = (query.get(userId) as { n: number }).n;
    if (n >= atLeast) return n;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return n;
}

describe('HARD-21 session activity is recorded where the guard checks', () => {
  it('HARD-21 a refused session cookie is not kept alive through public pages', async () => {
    const user = await h.seed.users.createUser('fabrikam-ia1', PASSWORD, 'user');
    const refusedCookie = await signIn('fabrikam-ia1', '127.0.0.21');
    await h.seed.users.deactivateUser(user.id);
    vi.useFakeTimers({ toFake: ['Date'] });
    const base = Date.now();

    // The refusal: the guard ends the session and writes one row.
    const refusal = await follow(refusedCookie, '/account');
    const firstRows = await sessionEndedCount(user.id, 1);
    // A client that keeps sending the refused cookie to public pages, each answer inside one idle window.
    vi.setSystemTime(base + STEP_MS);
    const firstPublic = await follow(refusedCookie, '/health');
    vi.setSystemTime(base + 2 * STEP_MS);
    const secondPublic = await follow(firstPublic.cookie, '/health');
    // The latest cookie on a member page afterwards.
    const member = await follow(secondPublic.cookie, '/account');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const laterRows = await sessionEndedCount(user.id, 1);
    const trail = `refusal=${refusal.res.statusCode} rows=${firstRows} public1=${firstPublic.res.statusCode} public2=${secondPublic.res.statusCode} ${String(secondPublic.res.headers.location)} member=${member.res.statusCode} rowsAfter=${laterRows}`;

    expect(refusal.res.statusCode, trail).toBe(302);
    expect(firstRows, trail).toBe(1);
    expect(secondPublic.res.statusCode, trail).toBe(302);
    expect(String(secondPublic.res.headers.location), trail).toBe('/login?expired=1');
    expect(laterRows, trail).toBe(1);
  }, 60_000);

  it('HARD-21 a signed in session stays active while its pages are used', async () => {
    await h.seed.users.createUser('fabrikam-ia2', PASSWORD, 'user');
    const signInCookie = await signIn('fabrikam-ia2', '127.0.0.22');
    vi.useFakeTimers({ toFake: ['Date'] });
    const base = Date.now();

    vi.setSystemTime(base + STEP_MS);
    const first = await follow(signInCookie, '/account');
    vi.setSystemTime(base + 2 * STEP_MS);
    const second = await follow(first.cookie, '/account');
    const trail = `first=${first.res.statusCode} second=${second.res.statusCode} ${String(second.res.headers.location)}`;

    expect(first.res.statusCode, trail).toBe(200);
    expect(second.res.statusCode, trail).toBe(200);
  }, 60_000);
});
