/**
 * Real-browser tracer for WAF-BROWSER-2: a bot-protection challenge that
 * Node `fetch` can never pass, discovered end-to-end through
 * `discoverUrls` -> the real fetch crawl (flags the challenge) -> the shared
 * resolver + launcher -> a REAL headless Chromium -> the rendered-DOM BFS.
 *
 * Browser tier — run via `npx vitest run --config vitest.browser.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { discoverUrls } from '../../src/discovery/discover.js';
import { probeChromium } from '../../src/browser/resolve.js';

const TEST_TIMEOUT = 60_000;

// Record which Chromium binary this run actually launched — pasted into the
// plan's SUMMARY as evidence.
const probe = await probeChromium();
// eslint-disable-next-line no-console
console.log('[browser-discovery tracer] resolved chromium:', probe);

function pageHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

/** Under 1000 bytes, contains the Incapsula signature `isWafChallenge` matches on. */
function challengeBody(setsCookie: boolean, port: number): string {
  const script = setsCookie
    ? "document.cookie='luqen_fixture_pass=1; path=/'; setTimeout(function(){ location.reload(); }, 150);"
    : 'setTimeout(function(){ location.reload(); }, 150);';
  return pageHtml(`_Incapsula_Resource<script>${script}</script>`);
}

let server: Server;
let baseUrl: string;
let port: number;
// DISCOVERY-SSRF-1: a second loopback server the "public" fixture tries to
// reach through the browser (subresource, iframe, fetch, redirect). Every
// request that arrives is recorded; the guard must keep this list empty.
let victim: Server;
let victimOrigin: string;
const victimHits: string[] = [];

beforeAll(async () => {
  victim = createServer((req, res) => { victimHits.push(req.url ?? '/'); res.end('internal'); });
  await new Promise<void>((resolve) => victim.listen(0, '127.0.0.1', resolve));
  victimOrigin = `http://127.0.0.1:${(victim.address() as AddressInfo).port}`;

  server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const cookieHeader = req.headers.cookie ?? '';
    const hasPass = cookieHeader.includes('luqen_fixture_pass=1');

    if (pathname === '/robots.txt' || pathname === '/sitemap.xml') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    if (pathname === '/section/r') {
      res.statusCode = 302;
      res.setHeader('location', `${victimOrigin}/redirected`);
      res.end();
      return;
    }

    if (pathname.startsWith('/never/')) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(challengeBody(false, port));
      return;
    }

    if (pathname.startsWith('/section/')) {
      if (!hasPass) {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(challengeBody(true, port));
        return;
      }
      const realPages: Record<string, string> = {
        '/section/': pageHtml(
          '<a href="/section/a">a</a>' +
          '<a href="/section/b">b</a>' +
          '<a href="/other/x">other</a>' +
          `<a href="http://localhost:${port}/section/z">z</a>` +
          '<a href="/section/file.pdf">pdf</a>' +
          '<a href="/section/a#top">a-hash</a>' +
          '<a href="/section/r">redirects-to-victim</a>' +
          '<script>var el=document.createElement("a"); el.href="/section/js-only"; el.textContent="js"; document.body.appendChild(el);</script>',
        ),
        '/section/a': pageHtml(
          '<a href="/section/c">c</a>' +
          `<img src="${victimOrigin}/pixel.png" alt="">` +
          `<iframe src="${victimOrigin}/frame"></iframe>`,
        ),
        '/section/b': pageHtml(`no further links<script>fetch('${victimOrigin}/xhr').catch(function(){});</script>`),
        '/section/c': pageHtml('leaf'),
        '/section/js-only': pageHtml('leaf js-only'),
      };
      const body = realPages[pathname];
      if (body === undefined) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  port = address.port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => victim.close(() => resolve()));
});

describe('WAF-BROWSER-2 browser discovery tracer', () => {
  it(
    'E1: a cookie challenge site is discovered through the real browser',
    async () => {
      const result = await discoverUrls(
        `${baseUrl}/section/`,
        { maxPages: 20, crawlDepth: 2, alsoCrawl: true, guard: { trustedOrigins: [baseUrl] } },
        true,
      );
      expect(result.discoveryFallback).toBe('browser');
      expect(result.wafWarning).toBeUndefined();
      const urls = new Set(result.urls.map((u) => u.url));
      expect(urls).toEqual(
        new Set([
          `${baseUrl}/section/`,
          `${baseUrl}/section/a`,
          `${baseUrl}/section/b`,
          `${baseUrl}/section/js-only`,
          `${baseUrl}/section/c`,
          `${baseUrl}/section/r`,
        ]),
      );
      // DISCOVERY-SSRF-1: nothing the fixture pointed at the victim got through
      // — not the redirect hop, the <img>, the <iframe>, nor the fetch().
      expect(victimHits).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'E2: a challenge the browser cannot pass keeps the waf warning',
    async () => {
      const result = await discoverUrls(
        `${baseUrl}/never/`,
        { maxPages: 20, crawlDepth: 2, alsoCrawl: true, guard: { trustedOrigins: [baseUrl] } },
        true,
      );
      expect(result.wafWarning).toBeTruthy();
      expect('discoveryFallback' in result).toBe(false);
      expect(result.urls.map((u) => u.url)).toEqual([`${baseUrl}/never/`]);
    },
    TEST_TIMEOUT,
  );
});
