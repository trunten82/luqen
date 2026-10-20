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
 *
 * A list is also refused when its entries TOGETHER trust more public address space than one /8 of
 * public IPv4 addresses (2^24 addresses) or one /16 of global IPv6 addresses (2^112 addresses, counted
 * inside 2000::/3). Behind a proxy that is trusted, the X-Forwarded-For value is believed, so a list
 * that trusts most of the internet lets those clients choose the address the sign-in limit, the rate
 * buckets and the audit trail record. Exactly one /8 or one /16 is accepted, and a provider's published
 * ranges (a large CDN's list is about 1.5 million IPv4 addresses and 14 x 2^96 IPv6 addresses) are far
 * below it. An operator whose provider is larger lists its ranges narrowly.
 *
 * The count is made on the addresses the entries cover, never on how an entry is spelled: an IPv6 range
 * that holds the IPv4-mapped block (::ffff:a.b.c.d) also trusts the matching IPv4 addresses, and
 * overlapping entries count once. The addresses that do not count are the this-network, private-use,
 * shared, loopback, link-local and multicast-and-reserved IPv4 blocks and everything outside 2000::/3
 * in IPv6; the named ranges hold only such addresses, so they add nothing. Any list that trusts a whole
 * family covers far more than the limit and is refused. The refusals of single entries (a hop count, a
 * malformed address, a range of length 0, true, *) stay.
 */
import { isIP } from 'node:net';

/** The ranges trusted when no list is configured. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'linklocal', 'uniquelocal'];

const NAMED_RANGES: ReadonlySet<string> = new Set(DEFAULT_TRUSTED_PROXIES);
const TRUST_EVERYTHING_WORDS: ReadonlySet<string> = new Set(['true', '*']);
const NO_PROXY_WORD = 'none';

const GUIDANCE =
  `Use addresses, CIDR ranges or the names ${DEFAULT_TRUSTED_PROXIES.join(', ')}, or the single word `
  + `${NO_PROXY_WORD} to trust no proxy (DASHBOARD_TRUSTED_PROXIES / trustedProxies).`;

function refuse(entry: string, reason: string): never {
  throw new Error(`Invalid trustedProxies entry "${entry}": ${reason}. ${GUIDANCE}`);
}

// ── Address coverage ────────────────────────────────────────────────────────────────────────

/** An inclusive range of addresses, as numbers. */
type Interval = readonly [bigint, bigint];

const V4_SIZE = 1n << 32n;
/** Where IPv4 address 0.0.0.0 sits inside the IPv6 space: the base of the IPv4-mapped block. */
const MAPPED_BASE = 0xffffn << 32n;
const MAPPED_END = MAPPED_BASE + V4_SIZE - 1n;

/** Public IPv4 addresses a list may trust together: one /8. */
const PUBLIC_V4_LIMIT = 1n << 24n;
/** Global IPv6 addresses a list may trust together: one /16. */
const GLOBAL_V6_LIMIT = 1n << 112n;
/** The global unicast block of IPv6, 2000::/3: where every public IPv6 address is. */
const GLOBAL_V6: Interval = [0x2000n << 112n, (0x4000n << 112n) - 1n];

/**
 * The IPv4 blocks that are not public addresses, as [first octet, second octet, prefix length]:
 * this-network, private-use, shared, loopback, link-local, private-use, private-use, and the
 * multicast and reserved space.
 */
const NON_PUBLIC_V4_BLOCKS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 8],
  [10, 0, 8],
  [100, 64, 10],
  [127, 0, 8],
  [169, 254, 16],
  [172, 16, 12],
  [192, 168, 16],
  [224, 0, 3],
];

function blockInterval([first, second, prefix]: readonly [number, number, number]): Interval {
  const base = (BigInt(first) << 24n) + (BigInt(second) << 16n);
  return [base, base + (1n << BigInt(32 - prefix)) - 1n];
}

/** The public IPv4 addresses as intervals: the whole space minus the non-public blocks. */
function publicV4Intervals(): Interval[] {
  const blocks = NON_PUBLIC_V4_BLOCKS.map(blockInterval).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const gaps: Interval[] = [];
  let next = 0n;
  for (const [from, to] of blocks) {
    if (from > next) gaps.push([next, from - 1n]);
    next = to + 1n;
  }
  if (next < V4_SIZE) gaps.push([next, V4_SIZE - 1n]);
  return gaps;
}

function parseIpv4(text: string): bigint {
  return text.split('.').reduce((acc, octet) => (acc << 8n) + BigInt(octet), 0n);
}

function parseIpv6(text: string): bigint {
  const zone = text.indexOf('%');
  let body = zone === -1 ? text : text.slice(0, zone);
  const lastColon = body.lastIndexOf(':');
  const tail = body.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    body = `${body.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = body.split('::');
  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const rest = halves.length === 2 && halves[1] !== '' ? (halves[1] as string).split(':') : [];
  const groups = halves.length === 2
    ? [...head, ...new Array<string>(8 - head.length - rest.length).fill('0'), ...rest]
    : head;
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(`0x${group}`), 0n);
}

/** The addresses one explicit entry (an address or a CIDR range) covers, in its own family. */
function entryInterval(entry: string): { readonly family: 4 | 6; readonly interval: Interval } {
  const slash = entry.indexOf('/');
  const host = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(host) === 4 ? 4 : 6;
  const width = family === 4 ? 32n : 128n;
  const prefix = slash === -1 ? width : BigInt(entry.slice(slash + 1));
  const hostBits = width - prefix;
  const address = family === 4 ? parseIpv4(host) : parseIpv6(host);
  const base = (address >> hostBits) << hostBits;
  return { family, interval: [base, base + (1n << hostBits) - 1n] };
}

/** How many distinct addresses the intervals cover together. */
function unionSize(intervals: readonly Interval[]): bigint {
  const sorted = [...intervals].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let total = 0n;
  let end = -1n;
  for (const [from, to] of sorted) {
    const start = from > end ? from : end + 1n;
    if (to >= start) total += to - start + 1n;
    if (to > end) end = to;
  }
  return total;
}

/** The parts of `intervals` that lie inside any of `within`. */
function clipTo(intervals: readonly Interval[], within: readonly Interval[]): Interval[] {
  const clipped: Interval[] = [];
  for (const [from, to] of intervals) {
    for (const [lo, hi] of within) {
      const start = from > lo ? from : lo;
      const end = to < hi ? to : hi;
      if (start <= end) clipped.push([start, end]);
    }
  }
  return clipped;
}

/**
 * The address space of each family that the explicit entries trust: public IPv4 addresses and global
 * IPv6 addresses. The part of an IPv6 entry inside the IPv4-mapped block also trusts the matching
 * IPv4 addresses; the named ranges hold none of either.
 */
function publicCoverage(entries: readonly string[]): { readonly v4: bigint; readonly v6: bigint } {
  const v4: Interval[] = [];
  const v6: Interval[] = [];
  for (const entry of entries) {
    if (NAMED_RANGES.has(entry)) continue;
    const { family, interval } = entryInterval(entry);
    if (family === 4) {
      v4.push(interval);
    } else {
      v6.push(interval);
      const from = interval[0] > MAPPED_BASE ? interval[0] : MAPPED_BASE;
      const to = interval[1] < MAPPED_END ? interval[1] : MAPPED_END;
      if (from <= to) v4.push([from - MAPPED_BASE, to - MAPPED_BASE]);
    }
  }
  return {
    v4: unionSize(clipTo(v4, publicV4Intervals())),
    v6: unionSize(clipTo(v6, [GLOBAL_V6])),
  };
}

/** Throws, naming the entries, for a list that together trusts more public address space than the limits allow. */
function refuseWideList(entries: readonly string[], configured: readonly string[]): void {
  const { v4, v6 } = publicCoverage(entries);
  const wide: string[] = [];
  if (v4 > PUBLIC_V4_LIMIT) wide.push('more than one /8 of public IPv4 addresses');
  if (v6 > GLOBAL_V6_LIMIT) wide.push('more than one /16 of global IPv6 addresses');
  if (wide.length === 0) return;
  throw new Error(
    `Invalid trustedProxies list "${configured.join(', ')}": together these entries trust ${wide.join(' and ')}. ${GUIDANCE}`,
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
  refuseWideList(checked, configured);
  return checked;
}
