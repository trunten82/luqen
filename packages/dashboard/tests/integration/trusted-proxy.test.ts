/**
 * HARD-21 end to end: every per-address limit and every recorded address uses the real client
 * address. X-Forwarded-For is read only through trusted proxies (loopback, link-local and
 * unique-local ranges by default, otherwise the configured list), so a client that rotates the
 * header keeps its bucket and clients behind a trusted proxy keep separate buckets.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and signs in through POST /login
 * from chosen socket addresses (the sign-in route allows ten attempts per address in 15 minutes).
 * Fixture addresses: loopback, RFC 5737 documentation ranges, and the IPv4 link-local range as the
 * stand-in for a proxy on the same network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

let h: McpOauthHarness;
let configured: McpOauthHarness;

beforeAll(async () => {
  h = await startMcpOauthHarness('trusted-proxy');
  configured = await startMcpOauthHarness('trusted-proxy-configured', { config: { trustedProxies: ['198.51.100.0/24'] } });
  // A stored user puts the server in team mode, where a failed password sign-in is audited.
  await h.seed.users.createUser('fabrikam-px-user', 'Fabrikam-Proxy-42!', 'user');
  await configured.seed.users.createUser('fabrikam-px-user', 'Fabrikam-Proxy-42!', 'user');
}, 120_000);

afterAll(async () => {
  // Reverse order: each harness restores the environment it found.
  if (configured !== undefined) await configured.close();
  if (h !== undefined) await h.close();
});

const csrfOf = (html: string): string =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

/** A sign-in page fetched from `remoteAddress`: its session cookie and page token. */
async function signInPage(server: McpOauthHarness, remoteAddress: string): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const page = await server.app.inject({ method: 'GET', url: '/login', remoteAddress });
  return { cookie: page.cookies.find((c) => c.name === 'session')?.value ?? '', csrf: csrfOf(page.body) };
}

/** One failed password sign-in as `username`; the answer's status. */
async function failedSignIn(
  server: McpOauthHarness, page: { readonly cookie: string; readonly csrf: string },
  remoteAddress: string, username: string, forwardedFor?: string,
): Promise<number> {
  const res = await server.app.inject({
    method: 'POST', url: '/login', remoteAddress, cookies: { session: page.cookie },
    headers: { 'x-csrf-token': page.csrf, ...(forwardedFor !== undefined ? { 'x-forwarded-for': forwardedFor } : {}) },
    payload: { username, password: 'not-the-password' },
  });
  return res.statusCode;
}

/** The address the login.failure audit row of `actor` recorded. */
async function recordedAddress(server: McpOauthHarness, actor: string): Promise<string | null> {
  const query = server.seed.getRawDatabase().prepare("SELECT ip_address FROM audit_log WHERE action = 'login.failure' AND actor = ?");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = query.get(actor) as { ip_address: string | null } | undefined;
    if (row !== undefined) return row.ip_address;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

describe('HARD-21 per-address limits key on the real client address', () => {
  it('HARD-21 the sign in limit holds for a direct client that rotates its forwarded address', async () => {
    const socket = '203.0.113.7';
    const page = await signInPage(h, socket);
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      statuses.push(await failedSignIn(h, page, socket, 'fabrikam-px1', `198.51.100.${attempt}`));
    }
    const trail = `statuses=${statuses.join(',')}`;

    expect(statuses.slice(0, 10), trail).toEqual(new Array(10).fill(200));
    expect(statuses[10], trail).toBe(429);
  }, 60_000);

  it('HARD-21 the sign in limit holds behind a trusted proxy when the forwarded address rotates', async () => {
    const socket = '127.0.0.1';
    const page = await signInPage(h, socket);
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      statuses.push(await failedSignIn(h, page, socket, 'fabrikam-px2', `198.51.100.${attempt}, 203.0.113.8`));
    }
    const trail = `statuses=${statuses.join(',')}`;

    expect(statuses.slice(0, 10), trail).toEqual(new Array(10).fill(200));
    expect(statuses[10], trail).toBe(429);
  }, 60_000);

  it('HARD-21 clients behind a trusted proxy keep separate sign in limits', async () => {
    const proxy = '169.254.0.10';
    const page = await signInPage(h, proxy);
    const first: number[] = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      first.push(await failedSignIn(h, page, proxy, 'fabrikam-px3a', '203.0.113.11'));
    }
    const second = await failedSignIn(h, page, proxy, 'fabrikam-px3b', '203.0.113.12');
    const trail = `first=${first.join(',')} second=${second}`;

    expect(first.slice(0, 10), trail).toEqual(new Array(10).fill(200));
    expect(first[10], trail).toBe(429);
    expect(second, trail).toBe(200);
  }, 60_000);

  it('HARD-21 a configured trusted proxy yields the real client address', async () => {
    const proxy = '198.51.100.7';
    const page = await signInPage(configured, proxy);
    const singleStatus = await failedSignIn(configured, page, proxy, 'fabrikam-px4a', '203.0.113.98, 203.0.113.13');
    const chainStatus = await failedSignIn(configured, page, proxy, 'fabrikam-px4b', '203.0.113.97, 203.0.113.14, 198.51.100.40');
    const single = await recordedAddress(configured, 'fabrikam-px4a');
    const chain = await recordedAddress(configured, 'fabrikam-px4b');
    const trail = `answers=${singleStatus},${chainStatus} single=${String(single)} chain=${String(chain)}`;

    expect(single, trail).toBe('203.0.113.13');
    expect(chain, trail).toBe('203.0.113.14');
  }, 60_000);
});
