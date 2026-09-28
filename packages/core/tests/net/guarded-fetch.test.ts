import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { guardedFetch, MAX_REDIRECT_HOPS } from '../../src/net/guarded-fetch.js';
import { SsrfBlockedError, type NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';
import { installFetchSpy, redirectTo, startServer, type FetchSpy, type Handler, type TestServer } from '../discovery/ssrf-fixtures.js';

let site: TestServer;
let victim: TestServer;
let routes: Record<string, Handler>;
let fetchSpy: FetchSpy;
const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];

function policy(): NetworkGuardPolicy {
  return { trustedOrigins: [site.origin] };
}

beforeEach(async () => {
  seenHeaders.length = 0;
  victim = await startServer((req, res) => { seenHeaders.push(req.headers); res.end('internal'); });
  routes = {};
  site = await startServer((req, res) => {
    const handler = routes[(req.url ?? '/').split('?')[0]];
    if (handler) { handler(req, res); return; }
    res.end('ok');
  });
  fetchSpy = installFetchSpy([site.origin, victim.origin]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await site.close();
  await victim.close();
});

describe('guardedFetch (DISCOVERY-SSRF-1)', () => {
  it('[redirect] refuses a redirect to a loopback port at the hop — the target is never requested', async () => {
    routes['/go'] = redirectTo(`${victim.origin}/admin`);
    await expect(guardedFetch(`${site.origin}/go`, {}, policy())).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(victim.hits).toEqual([]);
  });

  it('[redirect] refuses a redirect to an RFC1918 host at the hop', async () => {
    routes['/go'] = redirectTo('http://192.168.3.50/');
    await expect(guardedFetch(`${site.origin}/go`, {}, policy())).rejects.toThrow(/192\.168\.3\.50/);
    expect(fetchSpy.requested.filter((u) => u.includes('192.168.3.50'))).toEqual([]);
  });

  it('[redirect] refuses a redirect to the cloud metadata address', async () => {
    routes['/go'] = redirectTo('http://169.254.169.254/latest/meta-data/');
    await expect(guardedFetch(`${site.origin}/go`, {}, policy())).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchSpy.requested.filter((u) => u.includes('169.254'))).toEqual([]);
  });

  it('follows a relative same-origin redirect', async () => {
    routes['/go'] = redirectTo('/final');
    routes['/final'] = (_req, res) => { res.end('final body'); };
    const response = await guardedFetch(`${site.origin}/go`, {}, policy());
    expect(await response.text()).toBe('final body');
    expect(site.hits).toEqual(['/go', '/final']);
  });

  it(`caps the chain at ${MAX_REDIRECT_HOPS} redirects`, async () => {
    routes['/loop'] = redirectTo('/loop');
    await expect(guardedFetch(`${site.origin}/loop`, {}, policy())).rejects.toThrow(/more than 5 redirects/);
    expect(site.hits).toHaveLength(MAX_REDIRECT_HOPS + 1);
  });

  it('drops caller headers on a cross-origin hop (opt-out path, so the hop is allowed)', async () => {
    routes['/go'] = redirectTo(`${victim.origin}/next`);
    const response = await guardedFetch(`${site.origin}/go`, { headers: { authorization: 'Bearer t' } }, { allowPrivate: true });
    expect(await response.text()).toBe('internal');
    expect(seenHeaders[0]?.authorization).toBeUndefined();
  });

  it('refuses the initial URL before any request when it is private', async () => {
    await expect(guardedFetch('http://127.0.0.1:4000/', {}, {})).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchSpy.requested).toEqual([]);
  });
});
