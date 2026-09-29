/**
 * DNS-rebinding closure for the Node fetch path (SSRF-DNS-PIN-1).
 *
 * The rebinding simulation needs two servers on the SAME port whose addresses
 * the guard classifies differently: a "public" site on 127.0.0.2 and a victim
 * on 127.0.0.1. The policy's `isBlockedAddress` seam marks every address
 * except 127.0.0.2 as private, and the injected resolver answers 127.0.0.2 on
 * the FIRST lookup of a name and 127.0.0.1 on every later one — exactly what a
 * ~0 s TTL rebinding server does between the guard's check and the fetch's own
 * resolution. With the pin, the connection must go to the first (validated)
 * answer and the victim must never see a request.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTlsServer, type Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardedFetch } from '../../src/net/guarded-fetch.js';
import { createPinnedDispatcher, pinnedLookup } from '../../src/net/pinned-dispatcher.js';
import { resolvePublicTarget, SsrfBlockedError, type NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';

const PUBLIC_IP = '127.0.0.2';
const VICTIM_IP = '127.0.0.1';

interface Hit { readonly host: string | undefined; readonly url: string }

interface Listening {
  readonly server: Server;
  readonly hits: Hit[];
}

async function listen(address: string, port: number, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Listening> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    hits.push({ host: req.headers.host, url: req.url ?? '/' });
    handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => resolve());
  });
  return { server, hits };
}

async function close(server: Server | HttpsServer): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Public site on 127.0.0.2 and victim on 127.0.0.1, sharing one port. */
async function startPair(site: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; site: Listening; victim: Listening }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicSite = await listen(PUBLIC_IP, 0, site);
    const { port } = publicSite.server.address() as AddressInfo;
    try {
      const victim = await listen(VICTIM_IP, port, (_req, res) => { res.end('INTERNAL SECRET'); });
      return { port, site: publicSite, victim };
    } catch {
      await close(publicSite.server); // port taken on 127.0.0.1 — try another
    }
  }
  throw new Error('could not bind a public/victim server pair on one port');
}

/** First lookup of each name answers public; every later lookup rebinds to the victim. */
function rebindingResolver(): { resolve: (host: string) => Promise<readonly string[]>; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  return {
    calls,
    resolve: async (host: string) => {
      const n = (calls.get(host) ?? 0) + 1;
      calls.set(host, n);
      return n === 1 ? [PUBLIC_IP] : [VICTIM_IP];
    },
  };
}

function rebindingPolicy(resolve: (host: string) => Promise<readonly string[]>): NetworkGuardPolicy {
  return { resolve, isBlockedAddress: (address) => address !== PUBLIC_IP };
}

let pair: Awaited<ReturnType<typeof startPair>> | undefined;

afterEach(async () => {
  if (pair) {
    await close(pair.site.server);
    await close(pair.victim.server);
    pair = undefined;
  }
});

describe('guardedFetch DNS pinning (SSRF-DNS-PIN-1)', () => {
  it('[rebinding] connects to the address the guard validated, never to a later rebound answer', async () => {
    pair = await startPair((_req, res) => { res.end('public page'); });
    const dns = rebindingResolver();

    const response = await guardedFetch(`http://rebind.test:${pair.port}/page`, {}, rebindingPolicy(dns.resolve));

    expect(await response.text()).toBe('public page');
    expect(pair.victim.hits).toEqual([]);
    expect(pair.site.hits).toEqual([{ host: `rebind.test:${pair.port}`, url: '/page' }]);
    expect(dns.calls.get('rebind.test')).toBe(1);
  });

  it('[rebinding] re-resolves and re-pins every redirect hop', async () => {
    let port = 0;
    pair = await startPair((req, res) => {
      if (req.headers.host?.startsWith('first.test') === true) {
        res.statusCode = 302;
        res.setHeader('location', `http://second.test:${port}/final`);
        res.end();
        return;
      }
      res.end(`final from ${req.headers.host ?? '?'}`);
    });
    port = pair.port;
    const dns = rebindingResolver();

    const response = await guardedFetch(`http://first.test:${port}/go`, {}, rebindingPolicy(dns.resolve));

    expect(await response.text()).toBe(`final from second.test:${port}`);
    expect(pair.victim.hits).toEqual([]);
    expect(pair.site.hits.map((hit) => hit.host)).toEqual([`first.test:${port}`, `second.test:${port}`]);
    // One resolution per hop, each done by the guard — none by the connection.
    expect(Object.fromEntries(dns.calls)).toEqual({ 'first.test': 1, 'second.test': 1 });
  });

  it('refuses the hop when its own fresh resolution is private (the pin never widens the guard)', async () => {
    pair = await startPair((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://inner.test:${pair?.port ?? 0}/`);
      res.end();
    });
    const resolve = async (host: string): Promise<readonly string[]> => (host === 'inner.test' ? [VICTIM_IP] : [PUBLIC_IP]);

    await expect(guardedFetch(`http://outer.test:${pair.port}/`, {}, rebindingPolicy(resolve))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(pair.victim.hits).toEqual([]);
  });
});

describe('resolvePublicTarget', () => {
  it('returns the validated addresses for a name', async () => {
    const target = await resolvePublicTarget('https://site.test/x', { resolve: async () => ['93.184.216.34', '2606:2800:220:1::1'] });
    expect(target).toEqual({ hostname: 'site.test', addresses: ['93.184.216.34', '2606:2800:220:1::1'] });
  });

  it('refuses when ANY returned address is private', async () => {
    await expect(resolvePublicTarget('https://mixed.test/', { resolve: async () => ['93.184.216.34', '10.1.2.3'] }))
      .rejects.toThrow(/10\.1\.2\.3/);
  });

  it('returns null (nothing to pin) for an IP literal, an opt-out, and a trusted origin', async () => {
    expect(await resolvePublicTarget('http://93.184.216.34/')).toBeNull();
    expect(await resolvePublicTarget('http://127.0.0.1:4000/', { allowPrivate: true })).toBeNull();
    expect(await resolvePublicTarget('http://127.0.0.1:5555/', { trustedOrigins: ['http://127.0.0.1:5555'] })).toBeNull();
  });
});

describe('pinnedLookup', () => {
  const target = { hostname: 'site.test', addresses: ['93.184.216.34', '2606:2800:220:1::1'] } as const;

  function run(hostname: string, options: { all?: boolean; family?: number }): Promise<unknown[]> {
    return new Promise((resolve) => {
      pinnedLookup(target)(hostname, options, (...args: unknown[]) => resolve(args));
    });
  }

  it('answers `all` lookups with exactly the pinned addresses', async () => {
    expect(await run('site.test', { all: true })).toEqual([null, [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]]);
  });

  it('answers a single lookup with the first pinned address of the requested family', async () => {
    expect(await run('site.test', {})).toEqual([null, '93.184.216.34', 4]);
    expect(await run('site.test', { family: 6 })).toEqual([null, '2606:2800:220:1::1', 6]);
  });

  it('fails closed for any other hostname, or a family with no pinned address', async () => {
    const [otherErr] = await run('other.test', { all: true });
    expect(otherErr).toBeInstanceOf(Error);
    const v4only = { hostname: 'v4.test', addresses: ['93.184.216.34'] };
    const [familyErr] = await new Promise<unknown[]>((resolve) => {
      pinnedLookup(v4only)('v4.test', { family: 6 }, (...args: unknown[]) => resolve(args));
    });
    expect(familyErr).toBeInstanceOf(Error);
  });
});

describe('pinned HTTPS keeps the original hostname for SNI and certificate checks', () => {
  let dir: string;
  let cert: Buffer;
  let key: Buffer;
  let wrongCert: Buffer;
  let wrongKey: Buffer;

  function selfSigned(name: string): { cert: Buffer; key: Buffer } {
    const keyPath = join(dir, `${name}.key`);
    const certPath = join(dir, `${name}.crt`);
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', keyPath, '-out', certPath,
      '-subj', `/CN=${name}`, '-addext', `subjectAltName=DNS:${name}`,
    ], { stdio: 'ignore' });
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'luqen-pin-tls-'));
    ({ cert, key } = selfSigned('pinned.test'));
    ({ cert: wrongCert, key: wrongKey } = selfSigned('other.test'));
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  async function tlsServer(serverCert: Buffer, serverKey: Buffer): Promise<{ server: HttpsServer; port: number; servernames: Array<string | false> }> {
    const servernames: Array<string | false> = [];
    const server = createTlsServer({ cert: serverCert, key: serverKey }, (req, res) => {
      servernames.push((req.socket as TLSSocket).servername);
      res.end(`tls ok ${req.headers.host ?? '?'}`);
    });
    await new Promise<void>((resolve) => server.listen(0, VICTIM_IP, () => resolve()));
    return { server, port: (server.address() as AddressInfo).port, servernames };
  }

  it('presents the original servername and verifies the certificate against the original hostname', async () => {
    const tls = await tlsServer(cert, key);
    const dispatcher = createPinnedDispatcher({ hostname: 'pinned.test', addresses: [VICTIM_IP] }, { ca: cert });
    try {
      const response = await fetch(`https://pinned.test:${tls.port}/`, { dispatcher } as RequestInit);
      expect(await response.text()).toBe(`tls ok pinned.test:${tls.port}`);
      expect(tls.servernames).toEqual(['pinned.test']);
    } finally {
      await dispatcher.close();
      await close(tls.server);
    }
  });

  it('control: a certificate for a different name is still rejected over the pinned connection', async () => {
    const tls = await tlsServer(wrongCert, wrongKey);
    const dispatcher = createPinnedDispatcher({ hostname: 'pinned.test', addresses: [VICTIM_IP] }, { ca: wrongCert });
    try {
      const failure = await fetch(`https://pinned.test:${tls.port}/`, { dispatcher } as RequestInit).then(
        () => null,
        (err: unknown) => err as { cause?: { code?: string } },
      );
      expect(failure?.cause?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    } finally {
      await dispatcher.close();
      await close(tls.server);
    }
  });
});
