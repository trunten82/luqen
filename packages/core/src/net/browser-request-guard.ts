/**
 * Browser-side SSRF guard (DISCOVERY-SSRF-1, extended by ENGINE-SSRF-1).
 *
 * Every page a scan engine opens in Chromium — browser discovery, pa11y,
 * behavioral, a11y-tree, reflow, IBM Equal Access and Lighthouse — gets
 * Puppeteer request interception installed BEFORE it navigates, so EVERY
 * request the page makes (the navigation itself, each redirect hop,
 * subresources, frames, fetch/XHR, beacons, dedicated-worker fetches) is
 * re-checked with the same predicate discovery uses and aborted with
 * `blockedbyclient` when it targets a private / loopback address.
 *
 * Policy: non-network schemes (data:, blob:, about:) stay in-process and are
 * allowed; http(s) goes through {@link isPublicUrl}; every other scheme
 * (file:, ftp:, chrome:, ...) is refused.
 *
 * Residual, measured: WebSocket handshakes (ws:/wss:) are NOT surfaced to
 * request interception by Chromium, so this layer cannot refuse them. See the
 * SSRF section of docs/guides/security-administration.md.
 */

import { isPublicUrl, type NetworkGuardPolicy } from './ssrf-guard.js';

const NON_NETWORK_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/**
 * Decides whether a browser page may issue a request to `url`.
 */
export async function isBrowserRequestAllowed(url: string, guard: NetworkGuardPolicy): Promise<boolean> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  if (NON_NETWORK_SCHEMES.has(protocol)) return true;
  return isPublicUrl(url, guard);
}

/** Overrides a continued request may carry (a subset of puppeteer's). */
export interface ContinueOverrides {
  readonly headers?: Record<string, string>;
}

/** Minimal slice of puppeteer's HTTPRequest the interception handler needs. */
export interface InterceptedRequest {
  url(): string;
  isInterceptResolutionHandled(): boolean;
  abort(errorCode?: 'blockedbyclient'): Promise<void>;
  continue(overrides?: ContinueOverrides): Promise<void>;
}

/** Aborts (never throws) any request the guard refuses; continues the rest. */
export async function handleInterceptedRequest(
  request: InterceptedRequest,
  guard: NetworkGuardPolicy,
  overrides?: ContinueOverrides,
): Promise<void> {
  let allowed = false;
  try {
    allowed = await isBrowserRequestAllowed(request.url(), guard);
  } catch {
    allowed = false;
  }
  if (request.isInterceptResolutionHandled()) return;
  try {
    if (!allowed) {
      await request.abort('blockedbyclient');
    } else if (overrides !== undefined) {
      await request.continue(overrides);
    } else {
      await request.continue();
    }
  } catch {
    // Ignore — the page may already be closed; the request never proceeds.
  }
}

/** Request as {@link guardPageRequests} receives it (adds the header read). */
export interface GuardableRequest extends InterceptedRequest {
  headers(): Record<string, string>;
}

/** Minimal slice of puppeteer's Page the guard installs itself on. */
export interface GuardablePage {
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: GuardableRequest) => void): unknown;
}

export interface GuardPageOptions {
  /**
   * Headers applied to the FIRST intercepted request only (the page under
   * test), merged over the browser's own. Mirrors pa11y's own `headers`
   * semantics, which the guard replaces: pa11y's interception handler resolves
   * every request synchronously and would win the race against this guard.
   */
  readonly firstRequestHeaders?: Readonly<Record<string, string>>;
}

function lowerCaseKeys(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * Turns on request interception for `page` and routes every request through
 * {@link handleInterceptedRequest}. Call BEFORE the first navigation.
 */
export async function guardPageRequests(
  page: GuardablePage,
  guard: NetworkGuardPolicy,
  options: GuardPageOptions = {},
): Promise<void> {
  const firstHeaders = options.firstRequestHeaders !== undefined && Object.keys(options.firstRequestHeaders).length > 0
    ? lowerCaseKeys(options.firstRequestHeaders)
    : undefined;
  let firstPending = firstHeaders !== undefined;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    let overrides: ContinueOverrides | undefined;
    if (firstPending && firstHeaders !== undefined) {
      firstPending = false;
      overrides = { headers: { ...request.headers(), ...firstHeaders } };
    }
    void handleInterceptedRequest(request, guard, overrides);
  });
}
