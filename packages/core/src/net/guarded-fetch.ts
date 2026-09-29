/**
 * `fetch` with the SSRF guard applied to the initial URL AND every redirect
 * hop (DISCOVERY-SSRF-1). Redirects are handled manually (`redirect:
 * 'manual'`): each `Location` is resolved against the current URL and
 * re-validated before it is requested, and the chain is capped.
 *
 * Caller-supplied headers (e.g. a scan's Authorization / Cookie) are dropped
 * on a hop that changes origin — the manual loop must not forward credentials
 * further than the platform's own redirect handling would.
 *
 * DNS pinning (SSRF-DNS-PIN-1): each hop resolves its hostname ONCE, in the
 * guard, and the request is sent through a dispatcher whose lookup answers
 * only those validated addresses — so a rebinding DNS server cannot hand the
 * connection a different (private) address than the one that was checked.
 * Every redirect hop is resolved, validated and pinned afresh.
 */

import type { Dispatcher } from 'undici';
import { createPinnedDispatcher } from './pinned-dispatcher.js';
import { resolvePublicTarget, SsrfBlockedError, type NetworkGuardPolicy } from './ssrf-guard.js';

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

/** Closes a per-hop dispatcher once its in-flight request finishes; never throws. */
function release(dispatcher: Dispatcher | undefined): Promise<void> {
  return dispatcher === undefined ? Promise.resolve() : dispatcher.close().catch(() => undefined);
}

/** One validated, pinned request. Nothing to pin (IP literal / opt-out) sends it as-is. */
async function fetchHop(current: string, init: RequestInit, policy: NetworkGuardPolicy): Promise<{ response: Response; dispatcher?: Dispatcher }> {
  const target = await resolvePublicTarget(current, policy);
  if (target === null) return { response: await fetch(current, init) };
  const dispatcher = createPinnedDispatcher(target);
  try {
    // `dispatcher` is the platform fetch's (undici) extension to RequestInit.
    const response = await fetch(current, { ...init, dispatcher } as RequestInit);
    return { response, dispatcher };
  } catch (err) {
    await release(dispatcher);
    throw err;
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
    const { response, dispatcher } = await fetchHop(current, initForHop(init, originalOrigin, current), policy);
    let next: string | null;
    try {
      next = redirectTarget(response, current);
    } catch (err) {
      await discardBody(response);
      await release(dispatcher);
      throw err;
    }
    if (next === null) {
      // Graceful close: waits for the caller to finish reading the body.
      void release(dispatcher);
      return response;
    }
    await discardBody(response);
    await release(dispatcher);
    current = next;
  }
  throw new SsrfBlockedError(url, `more than ${MAX_REDIRECT_HOPS} redirects`);
}
