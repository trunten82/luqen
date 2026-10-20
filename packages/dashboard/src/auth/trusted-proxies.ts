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
 * A list is also refused when its entries TOGETHER trust every IPv4 address or every IPv6 address.
 * That is decided on the addresses the entries cover, never on how an entry is spelled: an IPv4
 * address is matched against an IPv6 range as its IPv4-mapped form (::ffff:a.b.c.d), so an IPv6
 * range that holds the mapped block counts for IPv4, and two IPv4 halves count as the whole. The
 * named ranges are counted as the addresses they hold: a family is refused when what the explicit
 * entries leave untrusted is no more than the named entries of the list could hold (their size is
 * computed from the blocks proxy-addr documents for them, one block of each size, not from written
 * ranges). With no named entry that is exactly "the entries together trust every address".
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
const V6_SIZE = 1n << 128n;
/** Where IPv4 address 0.0.0.0 sits inside the IPv6 space: the base of the IPv4-mapped block. */
const MAPPED_BASE = 0xffffn << 32n;
const MAPPED_END = MAPPED_BASE + V4_SIZE - 1n;

/** How many addresses each named range holds, from the sizes of the blocks proxy-addr gives it. */
const NAMED_SIZE_V4: Readonly<Record<string, bigint>> = {
  loopback: 1n << 24n, // one /8 block
  linklocal: 1n << 16n, // one /16 block
  uniquelocal: (1n << 24n) + (1n << 20n) + (1n << 16n), // one /8, one /12 and one /16 block
};
const NAMED_SIZE_V6: Readonly<Record<string, bigint>> = {
  loopback: 1n, // one address
  linklocal: 1n << 118n, // one /10 block
  uniquelocal: 1n << 121n, // one /7 block
};

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

/**
 * The families whose every address the checked entries could trust. An IPv4 entry also trusts its
 * IPv4-mapped addresses in the IPv6 family, and the part of an IPv6 entry inside the mapped block
 * also trusts the matching IPv4 addresses.
 */
function coveredFamilies(entries: readonly string[]): Array<'IPv4' | 'IPv6'> {
  const v4: Interval[] = [];
  const v6: Interval[] = [];
  const named = new Set<string>();
  for (const entry of entries) {
    if (NAMED_RANGES.has(entry)) {
      named.add(entry);
      continue;
    }
    const { family, interval } = entryInterval(entry);
    if (family === 4) {
      v4.push(interval);
      v6.push([MAPPED_BASE + interval[0], MAPPED_BASE + interval[1]]);
    } else {
      v6.push(interval);
      const from = interval[0] > MAPPED_BASE ? interval[0] : MAPPED_BASE;
      const to = interval[1] < MAPPED_END ? interval[1] : MAPPED_END;
      if (from <= to) v4.push([from - MAPPED_BASE, to - MAPPED_BASE]);
    }
  }
  const sum = (sizes: Readonly<Record<string, bigint>>): bigint =>
    [...named].reduce((acc, name) => acc + (sizes[name] ?? 0n), 0n);
  const named4 = sum(NAMED_SIZE_V4);
  const named6 = sum(NAMED_SIZE_V6) + named4;
  const covered: Array<'IPv4' | 'IPv6'> = [];
  if (V4_SIZE - unionSize(v4) <= named4) covered.push('IPv4');
  if (V6_SIZE - unionSize(v6) <= named6) covered.push('IPv6');
  return covered;
}

/** Throws, naming the entries, for a list that together trusts every address of an IP family. */
function refuseCoveringList(entries: readonly string[], configured: readonly string[]): void {
  const covered = coveredFamilies(entries);
  if (covered.length === 0) return;
  const every = covered.map((family) => `every ${family} address`).join(' and ');
  throw new Error(
    `Invalid trustedProxies list "${configured.join(', ')}": together these entries could trust ${every}. ${GUIDANCE}`,
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
