/**
 * `fetch` with the SSRF guard applied to the initial URL AND every redirect
 * hop (DISCOVERY-SSRF-1). Redirects are handled manually (`redirect:
 * 'manual'`): each `Location` is resolved against the current URL and
 * re-validated before it is requested, and the chain is capped.
 *
 * Caller-supplied headers (e.g. a scan's Authorization / Cookie) are dropped
 * on a hop that changes origin — the manual loop must not forward credentials
 * further than the platform's own redirect handling would.
 */

import { assertPublicUrl, SsrfBlockedError, type NetworkGuardPolicy } from './ssrf-guard.js';

export const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function redirectTarget(response: Response, currentUrl: string): string | null {
  if (!REDIRECT_STATUSES.has(response.status)) return null;
  const location = response.headers?.get('location');
  if (!location) return null;
  try {
    return new URL(location, currentUrl).href;
  } catch {
    throw new SsrfBlockedError(location, 'unparseable redirect Location');
  }
}

function initForHop(init: RequestInit, originalOrigin: string, hopUrl: string): RequestInit {
  const sameOrigin = new URL(hopUrl).origin === originalOrigin;
  const { headers, ...rest } = init;
  return sameOrigin && headers !== undefined
    ? { ...rest, headers, redirect: 'manual' }
    : { ...rest, redirect: 'manual' };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore — the body of a redirect response is never read.
  }
}

export async function guardedFetch(
  url: string,
  init: RequestInit = {},
  policy: NetworkGuardPolicy = {},
): Promise<Response> {
  const originalOrigin = new URL(url).origin;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    await assertPublicUrl(current, policy);
    const response = await fetch(current, initForHop(init, originalOrigin, current));
    const next = redirectTarget(response, current);
    if (next === null) return response;
    await discardBody(response);
    current = next;
  }
  throw new SsrfBlockedError(url, `more than ${MAX_REDIRECT_HOPS} redirects`);
}
