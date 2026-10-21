/**
 * HARD-21 end to end: a session signed in through the compliance service keeps its sign-in values
 * only while its identity has no stored dashboard user and had none at sign-in. Once a stored user
 * has answered for it (or existed at sign-in), deleting that user ends the session.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). The compliance sign-in is the
 * only mocked piece: getToken answers for the usernames registered below, with a token whose
 * subject and role the test chooses.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const EXTERNAL_PASSWORD = 'External-Fabrikam-42!';

const external = vi.hoisted(() => ({
  claims: new Map<string, { readonly sub: string; readonly role: string; readonly username: string }>(),
  password: 'External-Fabrikam-42!',
}));

vi.mock('../../src/compliance-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/compliance-client.js')>();
  return {
    ...original,
    getToken: vi.fn(async (_baseUrl: string, username: string, password: string) => {
      const claim = external.claims.get(username);
      if (claim !== undefined && password === external.password) {
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
        return { access_token: `${header}.${payload}.sig`, token_type: 'Bearer', expires_in: 3600 };
      }
      throw new Error('Authentication failed: invalid credentials');
    }),
  };
});

let h: McpOauthHarness;

beforeAll(async () => {
  h = await startMcpOauthHarness('session-external-stored-user');
  // A stored user puts the server in team mode, where the compliance sign-in is attempted first.
  await h.seed.users.createUser('northwind-ex-filler', EXTERNAL_PASSWORD, 'user');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

const csrfOf = (html: string): string => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? '';

/** Sign in through POST /login from `remoteAddress`; the cookie the sign-in response returns. */
async function signInExternal(username: string, remoteAddress: string): Promise<string> {
  const page = await h.app.inject({ method: 'GET', url: '/login', remoteAddress });
  const anonymous = page.cookies.find((c) => c.name === 'session')?.value ?? '';
  const login = await h.app.inject({
    method: 'POST', url: '/login', remoteAddress, cookies: { session: anonymous },
    headers: { 'x-csrf-token': csrfOf(page.body) }, payload: { username, password: EXTERNAL_PASSWORD },
  });
  expect(login.statusCode, `sign-in=${login.statusCode}`).toBe(302);
  return login.cookies.find((c) => c.name === 'session')?.value ?? '';
}

async function get(cookie: string, url: string): Promise<LightMyRequestResponse> {
  return await h.app.inject({ method: 'GET', url, cookies: { session: cookie } });
}

/** One request that follows the session: the answer and the cookie to send next. */
async function follow(cookie: string, url: string): Promise<{ readonly res: LightMyRequestResponse; readonly cookie: string }> {
  const res = await get(cookie, url);
  return { res, cookie: res.cookies.find((c) => c.name === 'session')?.value ?? cookie };
}

describe('HARD-21 an external session follows its stored user', () => {
  it('HARD-21 a compliance sign in session follows its stored user until that user is deleted', async () => {
    const stored = await h.seed.users.createUser('fabrikam-ex1', EXTERNAL_PASSWORD, 'user');
    external.claims.set('ext-ex1', { sub: stored.id, role: 'admin', username: 'fabrikam-ex1' });
    let cookie = await signInExternal('ext-ex1', '127.0.0.11');

    const asUser = await follow(cookie, '/admin/dashboard-users');
    cookie = asUser.cookie;
    await h.seed.users.updateUserRole(stored.id, 'viewer');
    const asViewer = await follow(cookie, '/admin/dashboard-users');
    cookie = asViewer.cookie;
    expect(await h.seed.users.deleteUser(stored.id)).toBe(true);
    const page = await get(cookie, '/account');
    const api = await get(cookie, '/api/v1/entitlement');
    const trail = `user=${asUser.res.statusCode} viewer=${asViewer.res.statusCode} page=${page.statusCode} ${String(page.headers.location)} api=${api.statusCode}`;

    expect(asUser.res.statusCode, trail).toBe(403);
    expect(asViewer.res.statusCode, trail).toBe(403);
    expect(page.statusCode, trail).toBe(302);
    expect(String(page.headers.location), trail).toMatch(/^\/login/);
    expect(api.statusCode, trail).toBe(401);
  }, 60_000);

  it('HARD-21 the sign in cookie of an external session ends once its stored user is deleted', async () => {
    const stored = await h.seed.users.createUser('fabrikam-ex2', EXTERNAL_PASSWORD, 'user');
    external.claims.set('ext-ex2', { sub: stored.id, role: 'admin', username: 'fabrikam-ex2' });
    const signInCookie = await signInExternal('ext-ex2', '127.0.0.12');

    expect(await h.seed.users.deleteUser(stored.id)).toBe(true);
    const page = await get(signInCookie, '/admin/dashboard-users');
    const trail = `page=${page.statusCode} ${String(page.headers.location)}`;

    expect(page.statusCode, trail).toBe(302);
    expect(String(page.headers.location), trail).toMatch(/^\/login/);
  }, 60_000);

  it('HARD-21 a compliance sign in session for an identity without a dashboard user keeps its sign in values', async () => {
    external.claims.set('ext-ex3', { sub: randomUUID(), role: 'admin', username: 'contoso-ex3' });
    const cookie = await signInExternal('ext-ex3', '127.0.0.13');

    const first = await follow(cookie, '/admin/dashboard-users');
    const second = await follow(first.cookie, '/admin/dashboard-users');
    const trail = `first=${first.res.statusCode} second=${second.res.statusCode}`;

    expect(first.res.statusCode, trail).toBe(200);
    expect(second.res.statusCode, trail).toBe(200);
  }, 60_000);

  it('HARD-21 a second sign in in the same browser starts a new session', async () => {
    const stored = await h.seed.users.createUser('fabrikam-ex4', EXTERNAL_PASSWORD, 'user');
    external.claims.set('ext-ex4a', { sub: stored.id, role: 'admin', username: 'fabrikam-ex4' });
    external.claims.set('ext-ex4b', { sub: randomUUID(), role: 'admin', username: 'contoso-ex4' });
    const remoteAddress = '127.0.0.14';
    // The first identity has a stored user, so the session carries the stored-user marker.
    const firstCookie = await signInExternal('ext-ex4a', remoteAddress);
    const marked = await follow(firstCookie, '/account');
    expect(marked.res.statusCode, `marked=${marked.res.statusCode}`).toBe(200);

    // Without signing out, the same browser signs in as an identity with no stored user.
    const login = await h.app.inject({
      method: 'POST', url: '/login', remoteAddress, cookies: { session: marked.cookie },
      headers: { 'x-csrf-token': csrfOf(marked.res.body) }, payload: { username: 'ext-ex4b', password: EXTERNAL_PASSWORD },
    });
    const secondCookie = login.cookies.find((c) => c.name === 'session')?.value ?? marked.cookie;
    const page = await get(secondCookie, '/admin/dashboard-users');
    const trail = `login=${login.statusCode} page=${page.statusCode} ${String(page.headers.location)}`;

    expect(login.statusCode, trail).toBe(302);
    expect(page.statusCode, trail).toBe(200);
  }, 60_000);
});
