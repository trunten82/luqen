/**
 * Filtering egress forward proxy for every scan / discovery Chromium
 * (SCAN-EGRESS-PROXY-1).
 *
 * Chromium launched with `--proxy-server=http://127.0.0.1:<port>` and
 * `--proxy-bypass-list=<-loopback>` never opens a connection of its own: every
 * http: request arrives here in absolute form, and every https:, ws: and wss:
 * connection arrives as a CONNECT tunnel (Chromium tunnels WebSockets through
 * CONNECT, including plain ws:). That closes the two residuals request
 * interception left open:
 *
 *  - WebSocket handshakes, which interception never surfaces, are CONNECTs
 *    here and get the same address check as everything else;
 *  - DNS rebinding, because Chromium no longer resolves the target at all.
 *    This proxy resolves each target ONCE with {@link resolvePublicTarget},
 *    refuses any private / loopback / link-local / metadata / CGNAT answer,
 *    and connects to exactly the addresses it validated (pinnedLookup).
 *
 * TLS stays end to end: a CONNECT tunnel is a raw byte pipe, so SNI and the
 * certificate check are Chromium's own against the original hostname.
 *
 * One proxy per launched browser, bound to 127.0.0.1 on an ephemeral port,
 * enforcing that browser's guard policy; it is closed with the browser. It is
 * the SECOND layer: page-level request interception stays in place.
 */

import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { pinnedLookup, type PinnedLookup } from './pinned-dispatcher.js';
import { resolvePublicTarget, SsrfBlockedError, type NetworkGuardPolicy } from './ssrf-guard.js';

/** The only address the proxy ever listens on. */
export const EGRESS_PROXY_HOST = '127.0.0.1';
/** Concurrent client connections one proxy accepts (one browser's worth). */
export const EGRESS_PROXY_MAX_CONNECTIONS = 256;
/** Upper bound on reaching the upstream (DNS + TCP connect). */
export const EGRESS_PROXY_CONNECT_TIMEOUT_MS = 15_000;
/** A tunnel or request idle this long is torn down on both sides. */
export const EGRESS_PROXY_IDLE_TIMEOUT_MS = 120_000;

export interface EgressProxyOptions {
  readonly maxConnections?: number;
  readonly connectTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  /** Observability seam: every refusal and upstream failure. */
  readonly onEvent?: (event: EgressProxyEvent) => void;
}

export interface EgressProxyEvent {
  readonly kind: 'refused' | 'upstream-error';
  readonly method: string;
  readonly target: string;
  readonly reason: string;
}

export interface EgressProxy {
  /** The ephemeral port on 127.0.0.1. */
  readonly port: number;
  /** `http://127.0.0.1:<port>` — the value for `--proxy-server`. */
  readonly url: string;
  /** True while the server accepts connections. */
  readonly listening: boolean;
  /** Open sockets on both sides (clients + upstreams). */
  activeConnections(): number;
  /** Stops listening and destroys every open socket. Idempotent. */
  close(): Promise<void>;
}

/** Raised when the proxy cannot be started or is not listening: the browser must not launch. */
export class EgressProxyUnavailableError extends Error {
  constructor(reason: string) {
    super(`Scan egress proxy unavailable — refusing to launch Chromium without it: ${reason}`);
    this.name = 'EgressProxyUnavailableError';
  }
}

/** Chromium flags that force every connection through `proxy`. */
export function egressProxyArgs(proxy: Pick<EgressProxy, 'port'>): string[] {
  return [
    `--proxy-server=http://${EGRESS_PROXY_HOST}:${proxy.port}`,
    // Chromium bypasses proxies for loopback by default; `<-loopback>` removes
    // that implicit rule so 127.0.0.1 / localhost / [::1] go through the check.
    '--proxy-bypass-list=<-loopback>',
  ];
}

export type EgressProxyStarter = (policy: NetworkGuardPolicy) => Promise<EgressProxy>;

/**
 * Starts a proxy for `policy` and proves it is listening before returning.
 * Every failure becomes {@link EgressProxyUnavailableError} — callers launch
 * Chromium only with the proxy this returns (FAIL CLOSED).
 */
export async function openEgressProxy(
  policy: NetworkGuardPolicy,
  start: EgressProxyStarter = startEgressProxy,
): Promise<EgressProxy> {
  let proxy: EgressProxy;
  try {
    proxy = await start(policy);
  } catch (err) {
    throw new EgressProxyUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (!proxy.listening || !Number.isInteger(proxy.port) || proxy.port <= 0) {
    await proxy.close().catch(() => undefined);
    throw new EgressProxyUnavailableError('proxy is not listening');
  }
  return proxy;
}

// ---------------------------------------------------------------------------
// Target decisions
// ---------------------------------------------------------------------------

interface ConnectTarget {
  readonly host: string;
  readonly port: number;
  readonly lookup?: PinnedLookup;
}

const HOP_BY_HOP = new Set([
  'connection', 'proxy-connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function stripHopByHop(headers: IncomingHttpHeaders, keepUpgrade = false): Record<string, string | string[]> {
  const listed = String(headers.connection ?? '').split(',').map((token) => token.trim().toLowerCase());
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (keepUpgrade && (lower === 'upgrade' || lower === 'connection')) {
      out[name] = value;
      continue;
    }
    if (HOP_BY_HOP.has(lower) || listed.includes(lower)) continue;
    out[name] = value;
  }
  return out;
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' || protocol === 'wss:' ? 443 : 80;
}

/** host:port of an origin/URL (bracketed IPv6 kept), or null when unparseable. */
function authorityOf(value: string): string | null {
  try {
    const u = new URL(value);
    return `${u.hostname}:${u.port === '' ? defaultPort(u.protocol) : Number(u.port)}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolves `url` once through the guard and returns where to connect: the
 * validated addresses pinned for a name, the literal for an IP literal or an
 * opted-out target. Throws {@link SsrfBlockedError} on refusal.
 */
async function decide(url: string, policy: NetworkGuardPolicy): Promise<ConnectTarget> {
  const parsed = new URL(url);
  const port = parsed.port === '' ? defaultPort(parsed.protocol) : Number(parsed.port);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const pin = await resolvePublicTarget(url, policy);
  return pin === null ? { host: hostname, port } : { host: pin.hostname, port, lookup: pinnedLookup(pin) };
}

/** Parses a CONNECT authority (`host:port`, `[v6]:port`) strictly. */
function parseAuthority(authority: string): { url: string; authority: string } | null {
  if (!/^(\[[0-9a-fA-F:.]+\]|[^\s/@\[\]:?#]+):(\d{1,5})$/.test(authority)) return null;
  const port = Number(authority.slice(authority.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535) return null;
  // https:// only so the guard's protocol check passes; the scheme inside the
  // tunnel (TLS, ws, wss) is irrelevant to where the bytes go.
  const url = `https://${authority}/`;
  const normalized = authorityOf(url);
  return normalized === null ? null : { url, authority: normalized };
}

/** A CONNECT to the exact host:port of a trusted origin reaches that same server. */
function connectPolicy(policy: NetworkGuardPolicy, authority: string): NetworkGuardPolicy {
  const trusted = policy.trustedOrigins?.some((origin) => authorityOf(origin) === authority) === true;
  return trusted ? { ...policy, allowPrivate: true } : policy;
}

function reasonOf(err: unknown): string {
  if (err instanceof SsrfBlockedError) return err.reason;
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

interface Ctx {
  readonly policy: NetworkGuardPolicy;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly sockets: Set<Duplex>;
  /** Set by close(): any socket that appears afterwards is destroyed on sight. */
  readonly state: { closed: boolean };
  readonly onEvent?: (event: EgressProxyEvent) => void;
}

function track(ctx: Ctx, socket: Duplex): void {
  if (ctx.state.closed) {
    socket.destroy();
    return;
  }
  ctx.sockets.add(socket);
  socket.once('close', () => ctx.sockets.delete(socket));
}

/** Opens the upstream TCP socket with a connect deadline; resolves once connected. */
function openUpstream(ctx: Ctx, target: ConnectTarget): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const upstream = netConnect({ host: target.host, port: target.port, ...(target.lookup ? { lookup: target.lookup } : {}) });
    track(ctx, upstream);
    upstream.setTimeout(ctx.connectTimeoutMs, () => {
      upstream.destroy(new Error(`connect timeout after ${ctx.connectTimeoutMs} ms`));
    });
    const onClose = (): void => reject(new Error('upstream closed before connecting'));
    upstream.once('error', reject);
    upstream.once('close', onClose);
    upstream.once('connect', () => {
      upstream.removeListener('error', reject);
      upstream.removeListener('close', onClose);
      upstream.setTimeout(ctx.idleTimeoutMs, () => upstream.destroy());
      resolve(upstream);
    });
  });
}

/** Pipes two sockets together; either side closing or erroring tears down both. */
function splice(client: Duplex, upstream: Socket): void {
  const teardown = (): void => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', teardown);
  upstream.on('error', teardown);
  client.on('close', teardown);
  upstream.on('close', teardown);
  client.pipe(upstream);
  upstream.pipe(client);
}

function refuseRaw(socket: Duplex, status: string, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\nX-Luqen-Egress: refused\r\n\r\n${reason}\n`);
  socket.destroy();
}

async function handleConnect(ctx: Ctx, req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
  track(ctx, client);
  client.on('error', () => client.destroy());
  const parsed = parseAuthority(req.url ?? '');
  if (parsed === null) {
    ctx.onEvent?.({ kind: 'refused', method: 'CONNECT', target: String(req.url), reason: 'malformed authority' });
    refuseRaw(client, '400 Bad Request', 'malformed CONNECT authority');
    return;
  }
  let upstream: Socket;
  try {
    const target = await decide(parsed.url, connectPolicy(ctx.policy, parsed.authority));
    if (client.destroyed) return;
    upstream = await openUpstream(ctx, target);
  } catch (err) {
    const refused = err instanceof SsrfBlockedError;
    ctx.onEvent?.({ kind: refused ? 'refused' : 'upstream-error', method: 'CONNECT', target: parsed.authority, reason: reasonOf(err) });
    refuseRaw(client, refused ? '403 Forbidden' : '502 Bad Gateway', refused ? 'egress refused' : 'upstream unreachable');
    return;
  }
  if (client.destroyed) {
    upstream.destroy();
    return;
  }
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length > 0) upstream.write(head);
  (client as Socket).setTimeout(ctx.idleTimeoutMs, () => client.destroy());
  splice(client, upstream);
}

/** Validates an absolute-form http: request target; null when it is not one. */
function absoluteHttpUrl(raw: string | undefined): string | null {
  if (raw === undefined || !/^http:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).href;
  } catch {
    return null;
  }
}

function originForm(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

function refuseHttp(res: ServerResponse, status: number, reason: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'content-type': 'text/plain', connection: 'close', 'x-luqen-egress': 'refused' });
  res.end(`${reason}\n`);
}

async function handleRequest(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = absoluteHttpUrl(req.url);
  if (url === null) {
    ctx.onEvent?.({ kind: 'refused', method: req.method ?? '?', target: String(req.url), reason: 'not an absolute http: URL' });
    refuseHttp(res, 400, 'absolute http: URL required');
    return;
  }
  let target: ConnectTarget;
  try {
    target = await decide(url, ctx.policy);
  } catch (err) {
    ctx.onEvent?.({ kind: 'refused', method: req.method ?? '?', target: url, reason: reasonOf(err) });
    refuseHttp(res, 403, 'egress refused');
    return;
  }
  const headers = stripHopByHop(req.headers);
  headers.host = req.headers.host ?? new URL(url).host;
  const upstream = httpRequest({
    host: target.host,
    port: target.port,
    method: req.method,
    path: originForm(url),
    headers,
    setHost: false,
    agent: false,
    ...(target.lookup ? { lookup: target.lookup } : {}),
  });
  upstream.setTimeout(ctx.idleTimeoutMs, () => upstream.destroy(new Error('upstream idle timeout')));
  upstream.on('socket', (socket) => track(ctx, socket));
  upstream.on('response', (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, stripHopByHop(upRes.headers));
    upRes.pipe(res);
    upRes.on('error', () => res.destroy());
  });
  upstream.on('error', (err) => {
    ctx.onEvent?.({ kind: 'upstream-error', method: req.method ?? '?', target: url, reason: reasonOf(err) });
    refuseHttp(res, 502, 'upstream unreachable');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

/** Plain `ws://` sent as an absolute-form Upgrade request (not CONNECT). */
async function handleUpgrade(ctx: Ctx, req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
  track(ctx, client);
  client.on('error', () => client.destroy());
  const url = absoluteHttpUrl(req.url);
  if (url === null) {
    ctx.onEvent?.({ kind: 'refused', method: 'UPGRADE', target: String(req.url), reason: 'not an absolute http: URL' });
    refuseRaw(client, '400 Bad Request', 'absolute http: URL required');
    return;
  }
  let upstream: Socket;
  try {
    upstream = await openUpstream(ctx, await decide(url, ctx.policy));
  } catch (err) {
    const refused = err instanceof SsrfBlockedError;
    ctx.onEvent?.({ kind: refused ? 'refused' : 'upstream-error', method: 'UPGRADE', target: url, reason: reasonOf(err) });
    refuseRaw(client, refused ? '403 Forbidden' : '502 Bad Gateway', refused ? 'egress refused' : 'upstream unreachable');
    return;
  }
  if (client.destroyed) {
    upstream.destroy();
    return;
  }
  const headers = stripHopByHop(req.headers, true);
  headers.host = req.headers.host ?? new URL(url).host;
  const lines = [`${req.method ?? 'GET'} ${originForm(url)} HTTP/1.1`];
  for (const [name, value] of Object.entries(headers)) {
    for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
  }
  upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
  if (head.length > 0) upstream.write(head);
  (client as Socket).setTimeout(ctx.idleTimeoutMs, () => client.destroy());
  splice(client, upstream);
}

/**
 * Starts a filtering forward proxy on 127.0.0.1:<ephemeral> enforcing
 * `policy`. The server is `unref()`d so it never holds a process open.
 */
export async function startEgressProxy(policy: NetworkGuardPolicy, options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const ctx: Ctx = {
    policy,
    connectTimeoutMs: options.connectTimeoutMs ?? EGRESS_PROXY_CONNECT_TIMEOUT_MS,
    idleTimeoutMs: options.idleTimeoutMs ?? EGRESS_PROXY_IDLE_TIMEOUT_MS,
    sockets: new Set(),
    state: { closed: false },
    onEvent: options.onEvent,
  };
  const server: Server = createServer((req, res) => { void handleRequest(ctx, req, res); });
  server.maxConnections = options.maxConnections ?? EGRESS_PROXY_MAX_CONNECTIONS;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.setTimeout(ctx.idleTimeoutMs, (socket) => socket.destroy());
  server.on('connection', (socket: Socket) => track(ctx, socket));
  server.on('connect', (req: IncomingMessage, socket: Duplex, head: Buffer) => { void handleConnect(ctx, req, socket, head); });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => { void handleUpgrade(ctx, req, socket, head); });
  server.on('clientError', (_err, socket: Duplex) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, EGRESS_PROXY_HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.unref();
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | undefined;
  return {
    port,
    url: `http://${EGRESS_PROXY_HOST}:${port}`,
    get listening() {
      return server.listening && closing === undefined;
    },
    activeConnections: () => ctx.sockets.size,
    close() {
      closing ??= new Promise<void>((resolve) => {
        ctx.state.closed = true;
        server.close(() => resolve());
        for (const socket of ctx.sockets) socket.destroy();
        ctx.sockets.clear();
      });
      return closing;
    },
  };
}
