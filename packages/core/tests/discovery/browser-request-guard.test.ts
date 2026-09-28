/**
 * DISCOVERY-SSRF-1 — the request-interception handler the default browser
 * launcher installs on every browser-discovery page. Redirect hops,
 * subresources, frames and fetch/XHR all surface as intercepted requests.
 */

import { describe, it, expect } from 'vitest';
import { handleInterceptedRequest, isBrowserRequestAllowed } from '../../src/discovery/browser-crawler.js';
import { FAKE_PUBLIC_RESOLVER } from './ssrf-fixtures.js';

const guard = { resolve: FAKE_PUBLIC_RESOLVER };

function fakeRequest(url: string) {
  const outcome: { action?: 'continue' | 'abort'; code?: string } = {};
  return {
    outcome,
    request: {
      url: () => url,
      isInterceptResolutionHandled: () => false,
      async continue() { outcome.action = 'continue'; },
      async abort(code?: string) { outcome.action = 'abort'; outcome.code = code; },
    },
  };
}

describe('browser-discovery request guard', () => {
  it.each([
    'http://127.0.0.1:4000/',
    'http://192.168.100.50/img.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://rebind.test/',
    'file:///etc/passwd',
    'ws://127.0.0.1:4000/socket',
  ])('[browser] aborts %s', async (url) => {
    const { request, outcome } = fakeRequest(url);
    await handleInterceptedRequest(request, guard);
    expect(outcome).toEqual({ action: 'abort', code: 'blockedbyclient' });
  });

  it.each(['https://example.com/page', 'data:image/png;base64,AAAA', 'about:blank'])('continues %s', async (url) => {
    const { request, outcome } = fakeRequest(url);
    await handleInterceptedRequest(request, guard);
    expect(outcome.action).toBe('continue');
  });

  it('respects the operator opt-out', async () => {
    expect(await isBrowserRequestAllowed('http://127.0.0.1:4000/', { allowPrivate: true })).toBe(true);
  });

  it('does nothing when another handler already resolved the request', async () => {
    const { request, outcome } = fakeRequest('http://127.0.0.1:4000/');
    await handleInterceptedRequest({ ...request, isInterceptResolutionHandled: () => true }, guard);
    expect(outcome.action).toBeUndefined();
  });
});
