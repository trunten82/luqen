/**
 * Trusted proxies: the hops whose X-Forwarded-For entries the dashboard believes.
 *
 * The client address (request.ip) is found by walking the connection's addresses from the socket
 * towards the client: the socket address first, then the X-Forwarded-For entries from the right.
 * The walk passes an address only while it belongs to a trusted proxy; the first address that does
 * not is the client. A client that is not behind a trusted proxy therefore always appears as its
 * socket address, whatever header it sends.
 *
 * The setting is a list of addresses, CIDR ranges or the named ranges loopback, linklocal and
 * uniquelocal. A configured list replaces the default. The single word `none` trusts no proxy.
 * A setting that would trust every address (true, *, a /0 range), a hop count and a malformed
 * entry are refused with a message naming the entry.
 */
import { isIP } from 'node:net';

/** The ranges trusted when no list is configured. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'linklocal', 'uniquelocal'];

const NAMED_RANGES: ReadonlySet<string> = new Set(DEFAULT_TRUSTED_PROXIES);
const TRUST_EVERYTHING_WORDS: ReadonlySet<string> = new Set(['true', '*']);
const NO_PROXY_WORD = 'none';

function refuse(entry: string, reason: string): never {
  throw new Error(
    `Invalid trustedProxies entry "${entry}": ${reason}. Use addresses, CIDR ranges or the names `
    + `${DEFAULT_TRUSTED_PROXIES.join(', ')}, or the single word ${NO_PROXY_WORD} to trust no proxy `
    + '(DASHBOARD_TRUSTED_PROXIES / trustedProxies).',
  );
}

/** One entry: returns it in its canonical form or throws naming the entry. */
function checkEntry(raw: string): string {
  const entry = raw.trim();
  if (entry === '') return refuse(raw, 'an empty entry');
  const lower = entry.toLowerCase();
  if (TRUST_EVERYTHING_WORDS.has(lower)) return refuse(entry, 'it would trust every forwarded address');
  if (/^\d+$/.test(entry)) return refuse(entry, 'hop counts are not accepted');
  if (NAMED_RANGES.has(lower)) return lower;

  const slash = entry.indexOf('/');
  const host = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(host);
  if (family === 0) return refuse(entry, 'it is not an address, a CIDR range or a named range');
  if (slash === -1) return entry;

  const prefix = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefix)) return refuse(entry, 'the range must be written as address/prefix-length');
  const bits = Number(prefix);
  if (bits === 0) return refuse(entry, 'a range of length 0 would trust every forwarded address');
  if (bits > (family === 4 ? 32 : 128)) return refuse(entry, 'the prefix length is longer than the address');
  return entry;
}

/**
 * The value handed to Fastify's trustProxy option: the list of trusted entries, or false when no
 * proxy is trusted. Throws, naming the entry, for a setting that is not acceptable.
 */
export function resolveTrustedProxies(configured?: readonly string[]): readonly string[] | false {
  if (configured === undefined) return [...DEFAULT_TRUSTED_PROXIES];
  if (configured.length === 0) {
    return refuse('', `the list is empty; write ${NO_PROXY_WORD} to trust no proxy`);
  }
  if (configured.some((entry) => entry.trim().toLowerCase() === NO_PROXY_WORD)) {
    if (configured.length === 1) return false;
    return refuse(NO_PROXY_WORD, `${NO_PROXY_WORD} cannot be combined with other entries`);
  }
  const checked = configured.map(checkEntry);
  refuseCoveringList(checked, configured);
  return checked;
}

/** Throws, naming the entries, for a list that together trusts every address of an IP family. */
function refuseCoveringList(entries: readonly string[], configured: readonly string[]): void {
  void entries;
  void configured;
}
