/**
 * Connection-time address pinning for the Node fetch path (SSRF-DNS-PIN-1).
 *
 * `guardedFetch` validates a URL by resolving its hostname; without a pin,
 * `fetch` would resolve the name AGAIN when it connects, and a DNS-rebinding
 * server with a ~0 s TTL could answer public to the check and private to the
 * connection. The dispatcher built here replaces the socket's DNS lookup with
 * one that answers ONLY the addresses the guard already validated, so there is
 * no second resolution to win.
 *
 * Only the lookup changes: the URL, the Host header and the TLS servername
 * (SNI) all keep the original hostname, so HTTPS certificates are still
 * verified against the name the caller asked for.
 *
 * `undici` is used only for its `Agent`; the request itself still goes through
 * the global `fetch` (Node 22's built-in undici), which accepts any object
 * implementing the Dispatcher interface via the `dispatcher` init option.
 */

import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import { Agent } from 'undici';
import type { PinnedTarget } from './ssrf-guard.js';

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type PinnedLookup = (
  hostname: string,
  options: { readonly all?: boolean; readonly family?: number | string },
  callback: LookupCallback,
) => void;

function lookupError(message: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message);
  err.code = 'ENOTFOUND';
  return err;
}

function wantedFamily(family: number | string | undefined): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

/**
 * A `net`/`tls` `lookup` that answers `target.hostname` with the pinned
 * addresses and nothing else. It never touches DNS, and it fails closed for any
 * other hostname or for a family with no pinned address.
 */
export function pinnedLookup(target: PinnedTarget): PinnedLookup {
  const pinned: readonly LookupAddress[] = target.addresses.map((address) => ({ address, family: isIP(address) }));
  return (hostname, options, callback) => {
    if (hostname.replace(/^\[|\]$/g, '').toLowerCase() !== target.hostname.toLowerCase()) {
      callback(lookupError(`pinned lookup for ${target.hostname} refused ${hostname}`), []);
      return;
    }
    const family = wantedFamily(options.family);
    const candidates = pinned.filter((entry) => family === 0 || entry.family === family);
    if (candidates.length === 0) {
      callback(lookupError(`no pinned IPv${family} address for ${hostname}`), []);
      return;
    }
    if (options.all === true) {
      callback(null, candidates.map((entry) => ({ ...entry })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

/**
 * An undici Agent whose every connection resolves `target.hostname` through
 * {@link pinnedLookup}. `tls` is for tests (a private CA); production passes
 * nothing, so the platform's default trust store applies.
 */
export function createPinnedDispatcher(target: PinnedTarget, tls: Pick<ConnectionOptions, 'ca'> = {}): Agent {
  return new Agent({ connect: { ...tls, lookup: pinnedLookup(target) } });
}
