/**
 * SCAN-EGRESS-PROXY-1 — the filtering egress proxy itself, driven with raw
 * sockets (no browser). Same fixture shape as dns-pinning.test.ts: a "public"
 * server on 127.0.0.2 and a victim on 127.0.0.1 sharing one port, with the
 * policy's `isBlockedAddress` seam marking everything but 127.0.0.2 private.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import {
  egressProxyArgs,
  openEgressProxy,
  startEgressProxy,
  EgressProxyUnavailableError,
  type EgressProxy,
  type EgressProxyEvent,
} from '../../src/net/egress-proxy.js';
import type { NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';

const PUBLIC_IP = '127.0.0.2';
const VICTIM_IP = '127.0.0.1';

interface Rec {
  readonly server: Server;
  connections: number;
  readonly requests: Array<{ url: string; host: string | undefined }>;
  readonly upgrades: string[];
  readonly raw: Buffer[];
}

function recorder(): Rec {
  const rec: Rec = {
    server: createServer((req, res) => {
      rec.requests.push({ url: req.url ?? '/', host: req.headers.host });
      res.setHeader('x-upstream', 'yes');
      res.end(`hello from ${req.socket.localAddress}`);
    }),
    connections: 0,
    requests: [],
    upgrades: [],
    raw: [],
  };
  rec.server.on('connection', (socket: Socket) => {
    rec.connections += 1;
  });
  rec.server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    rec.upgrades.push(req.url ?? '/');
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  return rec;
}

async function listen(rec: Rec, address: string, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    rec.server.once('error', reject);
    rec.server.listen(port, address, () => resolve());
  });
  return (rec.server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

interface Pair { readonly port: number; readonly pub: Rec; readonly victim: Rec }

async function startPair(): Promise<Pair> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pub = recorder();
    const port = await listen(pub, PUBLIC_IP);
    const victim = recorder();
    try {
      await listen(victim, VICTIM_IP, port);
      return { port, pub, victim };
    } catch {
      await closeServer(pub.server);
    }
  }
  throw new Error('could not bind pair');
}

let pair: Pair | undefined;
let proxy: EgressProxy | undefined;
const events: EgressProxyEvent[] = [];

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  if (pair) {
    await closeServer(pair.pub.server);
    await closeServer(pair.victim.server);
    pair = undefined;
  }
  events.length = 0;
});

function policy(resolve: (host: string) => Promise<readonly string[]>, extra: Partial<NetworkGuardPolicy> = {}): NetworkGuardPolicy {
  return { resolve, isBlockedAddress: (address) => address !== PUBLIC_IP, ...extra };
}

const toPublic = async (): Promise<readonly string[]> => [PUBLIC_IP];
const toVictim = async (): Promise<readonly string[]> => [VICTIM_IP];

async function start(p: NetworkGuardPolicy, opts: Parameters<typeof startEgressProxy>[1] = {}): Promise<EgressProxy> {
  proxy = await startEgressProxy(p, { onEvent: (e) => events.push(e), ...opts });
  return proxy;
}

/** Sends a raw request head to the proxy; resolves with everything received until close. */
function rawExchange(port: number, head: string, holdMs = 300): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('data', (d) => chunks.push(d));
    socket.on('error', () => undefined);
    socket.on('connect', () => socket.write(head));
    const done = (): void => resolve(Buffer.concat(chunks).toString('latin1'));
    socket.on('close', done);
    setTimeout(() => { socket.destroy(); }, holdMs);
  });
}

/** CONNECT, then (if established) send an HTTP request through the tunnel. */
function connectThenGet(port: number, authority: string, host: string): Promise<string> {
  return rawExchange(port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\nGET /tunnelled HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, 500);
}

function getViaProxy(port: number, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: url, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('egress proxy — CONNECT (https, ws and wss all travel this way)', () => {
  it('refuses a CONNECT to a private IP literal; the victim sees no connection', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    const out = await connectThenGet(p.port, `${VICTIM_IP}:${pair.port}`, VICTIM_IP);
    expect(out).toMatch(/^HTTP\/1\.1 403/);
    expect(pair.victim.connections).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(['refused']);
  });

  it('refuses a CONNECT to a name that resolves private', async () => {
    pair = await startPair();
    const p = await start(policy(toVictim));
    const out = await connectThenGet(p.port, `inside.test:${pair.port}`, 'inside.test');
    expect(out).toMatch(/^HTTP\/1\.1 403/);
    expect(pair.victim.connections).toBe(0);
  });

  it('refuses localhost and IPv6 loopback authorities', async () => {
    pair = await startPair();
    const p = await start({});
    expect(await connectThenGet(p.port, `localhost:${pair.port}`, 'localhost')).toMatch(/^HTTP\/1\.1 403/);
    expect(await connectThenGet(p.port, `[::1]:${pair.port}`, '[::1]')).toMatch(/^HTTP\/1\.1 403/);
    expect(pair.victim.connections).toBe(0);
  });

  it('tunnels a CONNECT to a public name, pinned to the address the guard validated', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    const out = await connectThenGet(p.port, `site.test:${pair.port}`, `site.test:${pair.port}`);
    expect(out).toMatch(/^HTTP\/1\.1 200 Connection Established/);
    expect(out).toContain(`hello from ${PUBLIC_IP}`);
    expect(pair.pub.requests).toEqual([{ url: '/tunnelled', host: `site.test:${pair.port}` }]);
    expect(pair.victim.connections).toBe(0);
  });

  it('[rebinding] resolves once per CONNECT and never connects to a later rebound answer', async () => {
    pair = await startPair();
    let calls = 0;
    const p = await start(policy(async () => (++calls === 1 ? [PUBLIC_IP] : [VICTIM_IP])));
    const out = await connectThenGet(p.port, `rebind.test:${pair.port}`, 'rebind.test');
    expect(out).toContain(`hello from ${PUBLIC_IP}`);
    expect(calls).toBe(1);
    expect(pair.victim.connections).toBe(0);
  });

  it('refuses a malformed authority', async () => {
    const p = await start({});
    expect(await rawExchange(p.port, 'CONNECT not-an-authority HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
    expect(await rawExchange(p.port, 'CONNECT user@site.test:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
  });

  it('a trusted origin is honoured for CONNECT to that exact host:port only', async () => {
    pair = await startPair();
    const trusted = `http://${VICTIM_IP}:${pair.port}`;
    const p = await start({ trustedOrigins: [trusted] });
    expect(await connectThenGet(p.port, `${VICTIM_IP}:${pair.port}`, VICTIM_IP)).toMatch(/^HTTP\/1\.1 200/);
    expect(await connectThenGet(p.port, `${VICTIM_IP}:${pair.port + 1 > 65535 ? 1 : pair.port + 1}`, VICTIM_IP)).toMatch(/^HTTP\/1\.1 403/);
  });

  it('[control] allowPrivate lets the same CONNECT reach the victim', async () => {
    pair = await startPair();
    const p = await start({ allowPrivate: true });
    const out = await connectThenGet(p.port, `${VICTIM_IP}:${pair.port}`, VICTIM_IP);
    expect(out).toMatch(/^HTTP\/1\.1 200/);
    expect(pair.victim.requests.map((r) => r.url)).toEqual(['/tunnelled']);
  });
});

describe('egress proxy — plain http: absolute-form requests', () => {
  it('refuses a private target with 403 and never contacts it', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    const res = await getViaProxy(p.port, `http://${VICTIM_IP}:${pair.port}/secret`);
    expect(res.status).toBe(403);
    expect(res.headers['x-luqen-egress']).toBe('refused');
    expect(pair.victim.connections).toBe(0);
  });

  it('forwards a public request pinned to the validated address, Host header preserved, one resolution', async () => {
    pair = await startPair();
    let calls = 0;
    const p = await start(policy(async () => (++calls === 1 ? [PUBLIC_IP] : [VICTIM_IP])));
    const res = await getViaProxy(p.port, `http://rebind.test:${pair.port}/page?q=1`, { host: `rebind.test:${pair.port}` });
    expect(res.status).toBe(200);
    expect(res.body).toBe(`hello from ${PUBLIC_IP}`);
    expect(res.headers['x-upstream']).toBe('yes');
    expect(pair.pub.requests).toEqual([{ url: '/page?q=1', host: `rebind.test:${pair.port}` }]);
    expect(calls).toBe(1);
    expect(pair.victim.connections).toBe(0);
  });

  it('refuses origin-form and non-http absolute targets with 400', async () => {
    const p = await start({ allowPrivate: true });
    expect((await getViaProxy(p.port, '/relative')).status).toBe(400);
    expect(await rawExchange(p.port, 'GET ftp://site.test/x HTTP/1.1\r\nHost: site.test\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
  });

  it('answers 502 (not a hang) when the validated upstream refuses the connection', async () => {
    const p = await start({ allowPrivate: true });
    const closed = recorder();
    const port = await listen(closed, VICTIM_IP);
    await closeServer(closed.server);
    const res = await getViaProxy(p.port, `http://${VICTIM_IP}:${port}/`);
    expect(res.status).toBe(502);
    expect(events.map((e) => e.kind)).toEqual(['upstream-error']);
  });
});

describe('egress proxy — plain ws:// sent as an absolute-form Upgrade (non-CONNECT clients)', () => {
  const upgradeHead = (url: string, host: string): string =>
    `GET ${url} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;

  it('refuses an Upgrade to a private target; the victim sees nothing', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    const out = await rawExchange(p.port, upgradeHead(`http://${VICTIM_IP}:${pair.port}/ws`, `${VICTIM_IP}:${pair.port}`));
    expect(out).toMatch(/^HTTP\/1\.1 403/);
    expect(pair.victim.connections).toBe(0);
  });

  it('relays an Upgrade to a public target, pinned', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    const out = await rawExchange(p.port, upgradeHead(`http://site.test:${pair.port}/ws`, `site.test:${pair.port}`));
    expect(out).toMatch(/^HTTP\/1\.1 101/);
    expect(pair.pub.upgrades).toEqual(['/ws']);
    expect(pair.victim.connections).toBe(0);
  });
});

describe('egress proxy — resource hygiene', () => {
  it('listens on 127.0.0.1 only, on an ephemeral port', async () => {
    const p = await start({});
    expect(p.url).toBe(`http://127.0.0.1:${p.port}`);
    expect(p.port).toBeGreaterThan(0);
    expect(egressProxyArgs(p)).toEqual([`--proxy-server=http://127.0.0.1:${p.port}`, '--proxy-bypass-list=<-loopback>']);
  });

  it('close() destroys open tunnels on both sides and stops listening', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic));
    let upstreamClosed = false;
    pair.pub.server.on('connection', (socket: Socket) => socket.on('close', () => { upstreamClosed = true; }));
    const client = netConnect({ host: '127.0.0.1', port: p.port });
    const established = new Promise<void>((resolve) => client.once('data', () => resolve()));
    client.on('error', () => undefined);
    client.write(`CONNECT site.test:${pair.port} HTTP/1.1\r\n\r\n`);
    await established;
    expect(p.activeConnections()).toBe(2);
    const clientClosed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    await p.close();
    await clientClosed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(p.listening).toBe(false);
    expect(p.activeConnections()).toBe(0);
    expect(upstreamClosed).toBe(true);
    await p.close(); // idempotent
  });

  it('an idle tunnel is torn down after idleTimeoutMs', async () => {
    pair = await startPair();
    const p = await start(policy(toPublic), { idleTimeoutMs: 150 });
    const client = netConnect({ host: '127.0.0.1', port: p.port });
    client.on('error', () => undefined);
    client.resume(); // consume the 200 so the remote close surfaces
    const closed = new Promise<number>((resolve) => { const t0 = Date.now(); client.once('close', () => resolve(Date.now() - t0)); });
    client.write(`CONNECT site.test:${pair.port} HTTP/1.1\r\n\r\n`);
    expect(await closed).toBeLessThan(2_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(p.activeConnections()).toBe(0);
  });

  it('bounds concurrent client connections (maxConnections)', async () => {
    const p = await start({}, { maxConnections: 2 });
    const open = (): Promise<Socket> => new Promise((resolve) => {
      const s = netConnect({ host: '127.0.0.1', port: p.port }, () => resolve(s));
      s.on('error', () => undefined);
    });
    const a = await open();
    const b = await open();
    const c = await open();
    const cClosed = await new Promise<boolean>((resolve) => {
      c.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 1_000);
    });
    expect(cClosed).toBe(true);
    for (const s of [a, b, c]) s.destroy();
  });
});

describe('openEgressProxy — fail closed', () => {
  it('wraps a start failure in EgressProxyUnavailableError', async () => {
    await expect(openEgressProxy({}, async () => { throw new Error('EADDRNOTAVAIL'); }))
      .rejects.toBeInstanceOf(EgressProxyUnavailableError);
  });

  it('refuses a proxy that is not listening, and closes it', async () => {
    let closed = false;
    const dead: EgressProxy = {
      port: 12345,
      url: 'http://127.0.0.1:12345',
      listening: false,
      activeConnections: () => 0,
      close: async () => { closed = true; },
    };
    await expect(openEgressProxy({}, async () => dead)).rejects.toThrow(/not listening/);
    expect(closed).toBe(true);
  });

  it('returns a live proxy', async () => {
    proxy = await openEgressProxy({});
    expect(proxy.listening).toBe(true);
  });
});
