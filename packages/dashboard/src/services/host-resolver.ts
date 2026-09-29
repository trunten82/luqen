/**
 * System DNS resolver for the dashboard's start-URL SSRF check
 * (START-URL-DNS-1). Kept in its own dashboard module so route-level tests
 * can replace it with `vi.mock` and stay hermetic (no real DNS), which they
 * cannot do for @luqen/core's built default resolver.
 */

import { lookup } from 'node:dns/promises';
import type { HostResolver } from '@luqen/core';

/** Resolves `hostname` to every address it currently maps to (A and AAAA). */
export const systemHostResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};
