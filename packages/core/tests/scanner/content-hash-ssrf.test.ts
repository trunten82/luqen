import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { computeContentHashes } from '../../src/scanner/content-hash.js';
import { installFetchSpy, redirectTo, startServer, type TestServer } from '../discovery/ssrf-fixtures.js';

let site: TestServer;
let victim: TestServer;

beforeEach(async () => {
  victim = await startServer((_req, res) => { res.end('internal'); });
  site = await startServer((req, res) => {
    if (req.url === '/hop') { redirectTo(`${victim.origin}/secret`)(req, res); return; }
    res.end('page body');
  });
  installFetchSpy([site.origin, victim.origin]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await site.close();
  await victim.close();
});

describe('computeContentHashes (DISCOVERY-SSRF-1)', () => {
  it('[hash][redirect] refuses a discovered page that redirects to a loopback port — the page stays unhashed', async () => {
    const hashes = await computeContentHashes([`${site.origin}/ok`, `${site.origin}/hop`], 2, undefined, {
      trustedOrigins: [site.origin],
    });
    expect(hashes.has(`${site.origin}/ok`)).toBe(true);
    expect(hashes.has(`${site.origin}/hop`)).toBe(false);
    expect(victim.hits).toEqual([]);
  });

  it('opt-out keeps loopback hashing working', async () => {
    const hashes = await computeContentHashes([`${site.origin}/ok`], 1, undefined, { allowPrivate: true });
    expect(hashes.size).toBe(1);
  });
});
