/**
 * Pure IP / hostname classification for the SSRF guard (DISCOVERY-SSRF-1).
 *
 * "Private" here means "must never be the target of a server-side request
 * that a scanned site can steer": loopback, RFC 1918, link-local (incl. the
 * 169.254.169.254 cloud-metadata address), CGNAT, "this network", unique-local
 * and link-local IPv6, multicast/reserved space, and every IPv6 form that
 * embeds one of those IPv4 addresses (IPv4-mapped, IPv4-compatible, NAT64,
 * 6to4). No I/O — DNS resolution lives in ssrf-guard.ts.
 */

import { isIPv6 } from 'node:net';

type Ipv4 = readonly [number, number, number, number];

const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal'] as const;

/**
 * Parses every IPv4 literal form `inet_aton` (and therefore WHATWG URL
 * normalisation) accepts: dotted quad, short forms (127.1), and per-part
 * decimal / octal (leading 0) / hex (0x) numbers, including a single 32-bit
 * number (2130706433, 0x7f000001). Returns null for anything that is not an
 * IPv4 literal.
 */
export function parseIpv4Literal(input: string): Ipv4 | null {
  const text = input.trim();
  if (text === '') return null;
  const parts = text.endsWith('.') ? text.slice(0, -1).split('.') : text.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const numbers = parts.map(parseIpv4Part);
  if (numbers.some((n) => n === null)) return null;
  return combineIpv4Parts(numbers as number[]);
}

function parseIpv4Part(part: string): number | null {
  if (part === '') return null;
  if (/^0x[0-9a-f]*$/i.test(part)) return part.length === 2 ? 0 : parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return parseInt(part.slice(1), 8);
  if (/^(0|[1-9][0-9]*)$/.test(part)) return Number(part);
  return null;
}

function combineIpv4Parts(numbers: readonly number[]): Ipv4 | null {
  const leading = numbers.slice(0, -1);
  const last = numbers[numbers.length - 1];
  if (leading.some((n) => n > 255)) return null;
  const lastBytes = 4 - leading.length;
  if (last >= 2 ** (8 * lastBytes)) return null;
  const tail: number[] = [];
  for (let i = lastBytes - 1; i >= 0; i--) tail.push(Math.floor(last / 2 ** (8 * i)) % 256);
  const all = [...leading, ...tail];
  return [all[0], all[1], all[2], all[3]];
}

export function isPrivateIpv4(ip: Ipv4): boolean {
  const [a, b, c] = ip;
  return (
    a === 0 ||                                   // 0.0.0.0/8 "this network"
    a === 10 ||                                  // RFC 1918
    a === 127 ||                                 // loopback
    (a === 100 && b >= 64 && b <= 127) ||        // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) ||                  // link-local incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) ||         // RFC 1918
    (a === 192 && b === 168) ||                  // RFC 1918
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) ||     // benchmarking
    (a === 198 && b === 51 && c === 100) ||      // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||       // TEST-NET-3
    a >= 224                                     // multicast + reserved + broadcast
  );
}

/** Expands an IPv6 literal (optionally with an embedded dotted IPv4 tail) to 8 hextets. */
export function expandIpv6(input: string): readonly number[] | null {
  const text = input.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!isIPv6(text)) return null;
  const [head, tail] = text.includes('::') ? text.split('::') : [text, undefined];
  const toHextets = (segment: string): number[] | null => {
    if (segment === '') return [];
    const out: number[] = [];
    for (const piece of segment.split(':')) {
      if (piece.includes('.')) {
        const v4 = parseIpv4Literal(piece);
        if (!v4) return null;
        out.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
      } else {
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const headHextets = toHextets(head);
  const tailHextets = tail === undefined ? [] : toHextets(tail);
  if (!headHextets || !tailHextets) return null;
  const fill = 8 - headHextets.length - tailHextets.length;
  if (fill < 0 || (tail === undefined && fill !== 0)) return null;
  return [...headHextets, ...new Array<number>(fill).fill(0), ...tailHextets];
}

function ipv4FromHextets(high: number, low: number): Ipv4 {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

export function isPrivateIpv6(h: readonly number[]): boolean {
  const allZeroPrefix = (n: number): boolean => h.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(8)) return true;                                   // :: unspecified
  if (allZeroPrefix(7) && h[7] === 1) return true;                     // ::1 loopback
  if (allZeroPrefix(5) && h[5] === 0xffff) return isPrivateIpv4(ipv4FromHextets(h[6], h[7])); // ::ffff:a.b.c.d mapped
  if (allZeroPrefix(6)) return isPrivateIpv4(ipv4FromHextets(h[6], h[7]));                    // ::a.b.c.d compatible
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIpv4(ipv4FromHextets(h[6], h[7]));                 // 64:ff9b::/96 NAT64
  }
  if (h[0] === 0x2002) return isPrivateIpv4(ipv4FromHextets(h[1], h[2])); // 2002::/16 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true;                         // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return true;                         // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true;                         // fec0::/10 deprecated site-local
  if ((h[0] & 0xff00) === 0xff00) return true;                         // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;                 // 2001:db8::/32 documentation
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  return false;
}

/** True when `address` is an IPv4 or IPv6 literal in a blocked range. Non-literals return false. */
export function isPrivateIpAddress(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, '');
  if (isIPv6(text.split('%')[0])) {
    const hextets = expandIpv6(text);
    return hextets === null ? true : isPrivateIpv6(hextets);
  }
  const v4 = parseIpv4Literal(text);
  return v4 !== null && isPrivateIpv4(v4);
}

/** True when `hostname` is an IP literal (any form) — i.e. needs no DNS resolution. */
export function isIpLiteral(hostname: string): boolean {
  const text = hostname.trim().replace(/^\[|\]$/g, '');
  return isIPv6(text.split('%')[0]) || parseIpv4Literal(text) !== null;
}

/**
 * String-only check (no DNS): reserved names (localhost, *.localhost, *.local,
 * *.internal) and private IP literals in any encoding. A hostname that passes
 * here can still RESOLVE to a private address — {@link assertPublicUrl} in
 * ssrf-guard.ts adds the DNS check.
 */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost') return true;
  if (BLOCKED_NAME_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  return isPrivateIpAddress(h);
}
