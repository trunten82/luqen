/**
 * A bound on how long one hostname lookup may take.
 *
 * The system resolver can wait tens of seconds when the network resolver is slow, and a
 * start-URL check awaits it. {@link withLookupTimeout} wraps any {@link HostResolver} so a
 * lookup that does not answer in time rejects with an `ETIMEOUT` error instead of holding
 * its caller. The start-URL check classifies that code as a transient resolver error.
 */
import type { HostResolver } from '@luqen/core';

/** Default bound for one lookup, in milliseconds. */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

export function withLookupTimeout(
  resolve: HostResolver,
  timeoutMs: number = DNS_LOOKUP_TIMEOUT_MS,
): HostResolver {
  return (hostname) =>
    new Promise<readonly string[]>((settle, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error(`lookup ETIMEOUT after ${timeoutMs}ms`), { code: 'ETIMEOUT' }));
      }, timeoutMs);
      resolve(hostname).then(
        (addresses) => {
          clearTimeout(timer);
          settle(addresses);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
}
