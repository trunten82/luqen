/**
 * SSRF guard for every server-side request whose target a scanned site can
 * steer (DISCOVERY-SSRF-1): robots.txt, `Sitemap:` directives, sitemap-index
 * children, crawled pages, content hashing, every redirect hop, and every
 * request the browser-discovery fallback makes.
 *
 * The check is: http/https only -> reserved name / private IP literal (any
 * encoding) -> DNS resolution, rejecting when ANY resolved address is
 * private. Resolution failure is a refusal (fail closed).
 *
 * DNS rebinding (SSRF-DNS-PIN-1): {@link resolvePublicTarget} returns the
 * addresses it validated, and `guardedFetch` pins the connection to exactly
 * those (pinned-dispatcher.ts), so the fetch never resolves the name a second
 * time. Browser engines are pinned by the egress proxy (egress-proxy.ts),
 * which resolves through this module and connects to the validated address.
 */

import { lookup } from 'node:dns/promises';
import { isIpLiteral, isPrivateHostname, isPrivateIpAddress } from './ip-classify.js';

export { isPrivateHostname, isPrivateIpAddress, parseIpv4Literal } from './ip-classify.js';

/** Resolves a hostname to every address it currently maps to. */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export interface NetworkGuardPolicy {
  /**
   * Explicit operator opt-out: skip every private-address check. Wired from the
   * dashboard's `allowPrivateScanTargets` (local UAT against loopback fixtures)
   * and set by the CLI when the operator deliberately targets a private host.
   */
  readonly allowPrivate?: boolean;
  /**
   * Exact origins (scheme://host:port) exempt from the address checks. Narrower
   * than `allowPrivate`: a different port on the same host is still refused.
   */
  readonly trustedOrigins?: readonly string[];
  /** DNS seam; defaults to `dns.lookup(host, { all: true })`. */
  readonly resolve?: HostResolver;
  /**
   * Address-classification seam; defaults to {@link isPrivateIpAddress}. Same
   * trust level as `resolve` (tests use both to simulate DNS rebinding with
   * two loopback servers); never wired from operator configuration.
   */
  readonly isBlockedAddress?: (address: string) => boolean;
}

/** A hostname and the addresses the guard validated for it — the pin. */
export interface PinnedTarget {
  readonly hostname: string;
  readonly addresses: readonly string[];
}

export class SsrfBlockedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`Refused request to ${url}: ${reason}`);
    this.name = 'SsrfBlockedError';
    this.url = url;
    this.reason = reason;
  }
}

export const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

function parseTarget(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new SsrfBlockedError(url, 'unparseable URL');
  }
}

async function resolveAll(hostname: string, resolver: HostResolver, url: string): Promise<readonly string[]> {
  let addresses: readonly string[];
  try {
    addresses = await resolver(hostname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(url, `DNS resolution failed (${message})`);
  }
  if (addresses.length === 0) throw new SsrfBlockedError(url, 'DNS resolution returned no addresses');
  return addresses;
}

/**
 * Validates `url` like {@link assertPublicUrl} and returns the hostname with
 * EVERY address it resolved to — all of them checked — so the caller can pin
 * the connection to exactly those. Returns `null` when there is nothing to pin:
 * an IP-literal host (no DNS), or a policy opt-out (`allowPrivate`, a trusted
 * origin). Throws {@link SsrfBlockedError} on any refusal.
 */
export async function resolvePublicTarget(url: string, policy: NetworkGuardPolicy = {}): Promise<PinnedTarget | null> {
  const target = parseTarget(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new SsrfBlockedError(url, `protocol ${target.protocol} is not allowed`);
  }
  if (policy.allowPrivate === true) return null;
  if (policy.trustedOrigins?.includes(target.origin) === true) return null;

  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHostname(hostname)) {
    throw new SsrfBlockedError(url, `host ${target.hostname} is private or reserved`);
  }
  if (isIpLiteral(hostname)) return null;

  const addresses = await resolveAll(hostname, policy.resolve ?? defaultResolver, url);
  const isBlocked = policy.isBlockedAddress ?? isPrivateIpAddress;
  const privateAddress = addresses.find((address) => isBlocked(address));
  if (privateAddress !== undefined) {
    throw new SsrfBlockedError(url, `host ${target.hostname} resolves to private address ${privateAddress}`);
  }
  return { hostname, addresses: [...addresses] };
}

/**
 * Throws {@link SsrfBlockedError} unless `url` is an http(s) URL whose host is
 * neither a reserved name, a private IP literal, nor a name resolving to any
 * private address — or the policy explicitly exempts it.
 */
export async function assertPublicUrl(url: string, policy: NetworkGuardPolicy = {}): Promise<void> {
  await resolvePublicTarget(url, policy);
}

/** Non-throwing form of {@link assertPublicUrl}. */
export async function isPublicUrl(url: string, policy: NetworkGuardPolicy = {}): Promise<boolean> {
  try {
    await assertPublicUrl(url, policy);
    return true;
  } catch (err) {
    if (err instanceof SsrfBlockedError) return false;
    throw err;
  }
}

/**
 * Policy for LOCAL operator tooling (the `luqen` CLI and the stdio MCP
 * server): when the operator deliberately points the tool at a private /
 * loopback start URL (e.g. `luqen scan http://localhost:3000`), that target is
 * their own choice, so discovery may stay on private addresses. A PUBLIC start
 * URL gets the strict guard, so a public site still cannot steer discovery
 * into the operator's network. String-only check — no DNS for the decision.
 */
export function operatorPolicyFor(startUrl: string): NetworkGuardPolicy {
  try {
    return isPrivateHostname(new URL(startUrl).hostname.replace(/^\[|\]$/g, '')) ? { allowPrivate: true } : {};
  } catch {
    return {};
  }
}
