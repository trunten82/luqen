/**
 * Shared fixtures for the discovery SSRF tests (DISCOVERY-SSRF-1).
 *
 * - `startServer` runs a real HTTP server on 127.0.0.1 and counts every hit.
 * - `installFetchSpy` wraps global fetch: requests to the listed live test
 *   origins go through for real; EVERY other request is recorded and answered
 *   with a synthetic 404 so a regressed guard is observed without the test
 *   ever touching a real LAN / loopback service.
 * - `FAKE_PUBLIC_RESOLVER` maps the names the unit tests use to a public
 *   address (and `rebind.test` to loopback), so no test depends on real DNS.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi, type MockInstance } from 'vitest';
import type { HostResolver, NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
  readonly origin: string;
  readonly hits: string[];
  close(): Promise<void>;
}

export async function startServer(handler: Handler): Promise<TestServer> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url ?? '/');
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const PUBLIC_TEST_ADDRESS = '93.184.216.34';

export const FAKE_PUBLIC_RESOLVER: HostResolver = async (hostname) => {
  if (hostname === 'rebind.test') return ['127.0.0.1'];
  if (hostname === 'metadata.test') return ['169.254.169.254'];
  if (hostname === 'lan.test') return ['192.168.3.50'];
  return [PUBLIC_TEST_ADDRESS];
};

/** Guard policy for unit tests whose fetch is mocked: every name resolves public. */
export const PUBLIC_TEST_POLICY: NetworkGuardPolicy = { resolve: FAKE_PUBLIC_RESOLVER };

export interface FetchSpy {
  readonly requested: string[];
  readonly spy: MockInstance;
}

export function installFetchSpy(liveOrigins: readonly string[]): FetchSpy {
  const realFetch = globalThis.fetch;
  const requested: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (liveOrigins.includes(new URL(url).origin)) return realFetch(input, init);
    return new Response('not reachable in tests', { status: 404 });
  });
  return { requested, spy };
}

export function redirectTo(location: string): Handler {
  return (_req, res) => {
    res.statusCode = 302;
    res.setHeader('location', location);
    res.end();
  };
}

export function html(body: string): string {
  return `<!doctype html><html><body>${body}</body></html>`;
}
