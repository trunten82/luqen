/**
 * DISCOVERY-SSRF-1 — a public site must not be able to steer discovery into
 * requesting loopback / private addresses. Real HTTP: the "public" site is a
 * loopback fixture admitted ONLY by exact origin (`trustedOrigins`), while a
 * second loopback "victim" server on another port counts every request that
 * reaches it. Every other request is intercepted by the fetch spy, so a
 * regressed guard is observed without contacting any real LAN host.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchRobots } from '../../src/discovery/robots.js';
import { parseSitemap } from '../../src/discovery/sitemap.js';
import { discoverUrls } from '../../src/discovery/discover.js';
import { crawlSite } from '../../src/discovery/crawler.js';
import { browserCrawlSite, type DiscoveryBrowser } from '../../src/discovery/browser-crawler.js';
import type { NetworkGuardPolicy } from '../../src/net/ssrf-guard.js';
import {
  FAKE_PUBLIC_RESOLVER,
  html,
  installFetchSpy,
  redirectTo,
  startServer,
  type FetchSpy,
  type Handler,
  type TestServer,
} from './ssrf-fixtures.js';

const LAN_HOST = '192.168.100.50';
const LOOPBACK_4000 = '127.0.0.1:4000';

let victim: TestServer;
let site: TestServer;
let routes: Record<string, Handler>;
let fetchSpy: FetchSpy;

function policy(): NetworkGuardPolicy {
  return { trustedOrigins: [site.origin], resolve: FAKE_PUBLIC_RESOLVER };
}

function forbiddenRequests(): string[] {
  return fetchSpy.requested.filter((url) => {
    const { host } = new URL(url);
    return host === LAN_HOST || host === LOOPBACK_4000 || host === 'rebind.test' || host === new URL(victim.origin).host;
  });
}

beforeEach(async () => {
  victim = await startServer((_req, res) => { res.end('internal secret'); });
  routes = {};
  site = await startServer((req, res) => {
    const handler = routes[(req.url ?? '/').split('?')[0]];
    if (handler) { handler(req, res); return; }
    res.statusCode = 404;
    res.end('not found');
  });
  fetchSpy = installFetchSpy([site.origin, victim.origin]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await site.close();
  await victim.close();
});

function xml(body: string): Handler {
  return (_req, res) => { res.setHeader('content-type', 'application/xml'); res.end(body); };
}

function page(body: string): Handler {
  return (_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html(body)); };
}

describe('robots.txt fetch (DISCOVERY-SSRF-1)', () => {
  it('[robots] never requests robots.txt on a host that resolves to loopback', async () => {
    const result = await fetchRobots('http://rebind.test/', policy());
    expect(result.sitemapUrls).toEqual([]);
    expect(forbiddenRequests()).toEqual([]);
  });

  it('[robots][redirect] refuses a robots.txt redirect to a loopback port at the hop', async () => {
    routes['/robots.txt'] = redirectTo(`${victim.origin}/robots.txt`);
    const result = await fetchRobots(`${site.origin}/`, policy());
    expect(result.sitemapUrls).toEqual([]);
    expect(victim.hits).toEqual([]);
  });
});

describe('sitemap fetches (DISCOVERY-SSRF-1)', () => {
  it('[sitemap] refuses Sitemap: directives pointing at loopback and RFC1918 hosts', async () => {
    routes['/robots.txt'] = (_req, res) => {
      res.end([
        'User-agent: *',
        `Sitemap: ${victim.origin}/sitemap.xml`,
        `Sitemap: http://${LOOPBACK_4000}/sitemap.xml`,
        `Sitemap: http://${LAN_HOST}/sitemap.xml`,
      ].join('\n'));
    };
    routes['/'] = page('home');
    const result = await discoverUrls(`${site.origin}/`, {
      maxPages: 10, crawlDepth: 1, alsoCrawl: false, guard: policy(),
    });
    expect(result.map((u) => u.url)).toEqual([`${site.origin}/`]);
    expect(victim.hits).toEqual([]);
    expect(forbiddenRequests()).toEqual([]);
  });

  it('[sitemap] refuses sitemap-index children pointing at loopback and RFC1918 hosts', async () => {
    routes['/sitemap.xml'] = xml(`<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${victim.origin}/child.xml</loc></sitemap>
        <sitemap><loc>http://${LOOPBACK_4000}/child.xml</loc></sitemap>
        <sitemap><loc>http://${LAN_HOST}/child.xml</loc></sitemap>
        <sitemap><loc>${site.origin}/child-ok.xml</loc></sitemap>
      </sitemapindex>`);
    routes['/child-ok.xml'] = xml(`<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${site.origin}/page-a</loc></url>
      </urlset>`);
    const urls = await parseSitemap(`${site.origin}/sitemap.xml`, policy());
    expect(urls).toEqual([`${site.origin}/page-a`]);
    expect(victim.hits).toEqual([]);
    expect(forbiddenRequests()).toEqual([]);
  });

  it('[sitemap][redirect] refuses a sitemap redirect to a loopback port at the hop', async () => {
    routes['/sitemap.xml'] = redirectTo(`${victim.origin}/sitemap.xml`);
    const urls = await parseSitemap(`${site.origin}/sitemap.xml`, policy());
    expect(urls).toEqual([]);
    expect(victim.hits).toEqual([]);
  });

  it('never requests or returns urlset <loc> entries that point at private hosts', async () => {
    routes['/sitemap.xml'] = xml(`<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${site.origin}/page-a</loc></url>
        <url><loc>${victim.origin}/admin</loc></url>
        <url><loc>http://${LAN_HOST}/admin</loc></url>
      </urlset>`);
    routes['/'] = page('home');
    routes['/page-a'] = page('a');
    const result = await discoverUrls(`${site.origin}/`, {
      maxPages: 10, crawlDepth: 1, alsoCrawl: false, guard: policy(),
    });
    expect(result.map((u) => u.url)).toEqual([`${site.origin}/page-a`]);
    expect(victim.hits).toEqual([]);
    expect(forbiddenRequests()).toEqual([]);
  });
});

describe('crawler fetches (DISCOVERY-SSRF-1)', () => {
  it('[crawler][redirect] refuses a same-origin link that redirects to a loopback port', async () => {
    routes['/'] = page('<a href="/hop">hop</a>');
    routes['/hop'] = redirectTo(`${victim.origin}/secret`);
    const result = await discoverUrls(`${site.origin}/`, {
      maxPages: 10, crawlDepth: 2, alsoCrawl: true, guard: policy(),
    });
    expect(result.map((u) => u.url)).toContain(`${site.origin}/hop`);
    expect(victim.hits).toEqual([]);
  });

  it('[crawler] never fetches a start page whose host resolves to loopback', async () => {
    const urls = await crawlSite('http://rebind.test/', {
      maxPages: 10, maxDepth: 2, isAllowed: () => true, guard: policy(),
    });
    expect(urls).toEqual(['http://rebind.test/']);
    expect(forbiddenRequests()).toEqual([]);
  });

  it('[discover] makes no request of any kind to a start host that resolves to loopback', async () => {
    await discoverUrls('http://rebind.test/', {
      maxPages: 10, crawlDepth: 2, alsoCrawl: true, guard: policy(),
    });
    expect(forbiddenRequests()).toEqual([]);
  });

  it('opt-out (allowPrivate) keeps loopback discovery working for local UAT', async () => {
    routes['/'] = page('<a href="/next">next</a>');
    routes['/next'] = page('next');
    const result = await discoverUrls(`${site.origin}/`, {
      maxPages: 10, crawlDepth: 2, alsoCrawl: true, guard: { allowPrivate: true },
    });
    expect(result.map((u) => u.url)).toEqual([`${site.origin}/`, `${site.origin}/next`]);
  });

  it('[discover] default policy (no opt-out) refuses a loopback start URL outright', async () => {
    routes['/'] = page('<a href="/next">next</a>');
    await discoverUrls(`${site.origin}/`, { maxPages: 10, crawlDepth: 2, alsoCrawl: true });
    expect(site.hits).toEqual([]);
  });
});

describe('browser-discovery fallback (DISCOVERY-SSRF-1)', () => {
  it('[browser] never navigates to a start URL whose host resolves to loopback', async () => {
    const gotoCalls: string[] = [];
    const launch = async (): Promise<DiscoveryBrowser> => ({
      async newPage() {
        return {
          async setExtraHTTPHeaders() {},
          async goto(url: string) { gotoCalls.push(url); return null; },
          async content() { return html('<a href="/a">a</a>'); },
          async waitForNavigation() { return null; },
          async readLinks() { return ['http://rebind.test/a']; },
          async close() {},
        };
      },
      async close() {},
    });
    const result = await browserCrawlSite('http://rebind.test/', {
      maxPages: 10, maxDepth: 2, isAllowed: () => true, guard: policy(),
    }, { launch });
    expect(gotoCalls).toEqual([]);
    expect(result.urls).toEqual(['http://rebind.test/']);
  });
});
