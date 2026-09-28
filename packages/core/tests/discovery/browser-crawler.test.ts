import { describe, it, expect, vi } from 'vitest';
import {
  browserCrawlSite,
  BROWSER_DISCOVERY_PAGE_TIMEOUT_MS,
  type DiscoveryBrowser,
  type DiscoveryPage,
} from '../../src/discovery/browser-crawler.js';
import { PUBLIC_TEST_POLICY } from './ssrf-fixtures.js';

const START = 'https://example.com/dev/en-us/';

interface PageScript {
  readonly links?: readonly string[];
  readonly challengeFirst?: boolean;
  readonly gotoError?: Error;
  readonly readError?: Error;
}

interface Recorder {
  launches: number;
  pagesOpened: number;
  pagesClosed: number;
  browserCloses: number;
  gotoCalls: Array<{ url: string; options: unknown }>;
  headersSet: Array<Record<string, string>>;
  waitForNavigationCalls: Array<{ options: unknown }>;
}

function makeFakeLauncher(
  scripts: Record<string, PageScript>,
  recorder: Recorder,
): () => Promise<DiscoveryBrowser> {
  return async (): Promise<DiscoveryBrowser> => {
    recorder.launches++;
    const browser: DiscoveryBrowser = {
      async newPage(): Promise<DiscoveryPage> {
        recorder.pagesOpened++;
        let currentUrl = '';
        let settled = false;
        const page: DiscoveryPage = {
          async setExtraHTTPHeaders(headers) {
            recorder.headersSet.push(headers);
          },
          async goto(url, options) {
            currentUrl = url;
            recorder.gotoCalls.push({ url, options });
            const script = scripts[url];
            if (script?.gotoError) throw script.gotoError;
            return undefined;
          },
          async content() {
            const script = scripts[currentUrl];
            if (script?.challengeFirst && !settled) {
              return '<html>_Incapsula_Resource</html>';
            }
            return '<html>ok</html>';
          },
          async waitForNavigation(options) {
            recorder.waitForNavigationCalls.push({ options });
            settled = true;
          },
          async readLinks() {
            const script = scripts[currentUrl];
            if (script?.readError) throw script.readError;
            if (script?.challengeFirst && !settled) return [];
            return [...(script?.links ?? [])];
          },
          async close() {
            recorder.pagesClosed++;
          },
        };
        return page;
      },
      async close() {
        recorder.browserCloses++;
      },
    };
    return browser;
  };
}

function makeRecorder(): Recorder {
  return {
    launches: 0,
    pagesOpened: 0,
    pagesClosed: 0,
    browserCloses: 0,
    gotoCalls: [],
    headersSet: [],
    waitForNavigationCalls: [],
  };
}

const baseOptions = { guard: PUBLIC_TEST_POLICY, maxPages: 100, maxDepth: 3, isAllowed: () => true };

describe('browserCrawlSite', () => {
  it('B1: discovers in-scope links from the rendered start page', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}a`, `${START}b`] } },
      recorder,
    );
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls[0]).toBe(START);
    expect(result.urls).toContain(`${START}a`);
    expect(result.urls).toContain(`${START}b`);
  });

  it('B2: links outside the start origin or path prefix are never visited or returned', async () => {
    const recorder = makeRecorder();
    const links = [
      'https://example.com/dev/fr-fr/x',
      'https://other.test/dev/en-us/',
      'https://example.com@127.0.0.1/dev/en-us/',
      'https://example.com:8443/dev/en-us/',
    ];
    const launch = makeFakeLauncher({ [START]: { links } }, recorder);
    const result = await browserCrawlSite(START, baseOptions, { launch });
    for (const link of links) {
      expect(result.urls).not.toContain(link);
    }
    expect(result.urls.some((u) => u.includes('127.0.0.1'))).toBe(false);
    expect(result.urls.some((u) => u.includes('8443'))).toBe(false);
    expect(recorder.gotoCalls.map((c) => c.url)).not.toContain('https://other.test/dev/en-us/');
  });

  it('B3: non html links are dropped and hashes are stripped', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}file.pdf`, `${START}a#top`] } },
      recorder,
    );
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls.filter((u) => u === `${START}a`).length).toBe(1);
    expect(result.urls).not.toContain(`${START}file.pdf`);
    expect(result.urls.some((u) => u.includes('#'))).toBe(false);
  });

  it('B4: robots disallowed links are dropped', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}public`, `${START}admin`] } },
      recorder,
    );
    const result = await browserCrawlSite(
      START,
      { ...baseOptions, isAllowed: (url) => !url.includes('/admin') },
      { launch },
    );
    expect(result.urls).toContain(`${START}public`);
    expect(result.urls).not.toContain(`${START}admin`);
  });

  it('B5: follows links to the configured depth only (maxDepth 1)', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}a`] }, [`${START}a`]: { links: [`${START}a2`] } },
      recorder,
    );
    const result = await browserCrawlSite(START, { ...baseOptions, maxDepth: 1 }, { launch });
    expect(recorder.gotoCalls.map((c) => c.url)).toEqual([START]);
    expect(result.urls).toContain(`${START}a`);
  });

  it('B5: follows links to the configured depth only (maxDepth 2)', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}a`] }, [`${START}a`]: { links: [`${START}a2`] } },
      recorder,
    );
    const result = await browserCrawlSite(START, { ...baseOptions, maxDepth: 2 }, { launch });
    expect(recorder.gotoCalls.map((c) => c.url)).toEqual([START, `${START}a`]);
    expect(result.urls).toContain(`${START}a2`);
  });

  it('B6: stops at maxPages and loads no further pages once full', async () => {
    const recorder = makeRecorder();
    const links = Array.from({ length: 10 }, (_, i) => `${START}p${i}`);
    const launch = makeFakeLauncher({ [START]: { links } }, recorder);
    const result = await browserCrawlSite(START, { ...baseOptions, maxPages: 5 }, { launch });
    expect(result.urls.length).toBe(5);
    expect(recorder.gotoCalls.length).toBe(1);
  });

  it('B7: a challenge page gets one navigation to settle before links are read', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { challengeFirst: true, links: [`${START}a`] } },
      recorder,
    );
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls).toContain(`${START}a`);
    expect(recorder.waitForNavigationCalls.length).toBe(1);
    const call = recorder.waitForNavigationCalls[0].options as { waitUntil: string; timeout: number };
    expect(call.waitUntil).toBe('domcontentloaded');
    expect(call.timeout).toBe(BROWSER_DISCOVERY_PAGE_TIMEOUT_MS);
  });

  it('B8: every page and the browser are closed on success', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}a`, `${START}b`] } },
      recorder,
    );
    await browserCrawlSite(START, baseOptions, { launch });
    expect(recorder.pagesOpened).toBe(recorder.pagesClosed);
    expect(recorder.pagesOpened).toBeGreaterThan(0);
    expect(recorder.browserCloses).toBe(1);
  });

  it('B9: the browser is closed when opening a page fails', async () => {
    const recorder = makeRecorder();
    const launch = async (): Promise<DiscoveryBrowser> => {
      recorder.launches++;
      return {
        newPage: vi.fn().mockRejectedValue(new Error('no page')),
        async close() {
          recorder.browserCloses++;
        },
      };
    };
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls).toEqual([START]);
    expect(result.error).toBeTruthy();
    expect(recorder.browserCloses).toBe(1);
  });

  it('B10: a launch failure resolves with only the start URL and never throws', async () => {
    class FakeNotFound extends Error {}
    const launch = vi.fn().mockRejectedValue(new FakeNotFound('no chromium anywhere'));
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls).toEqual([START]);
    expect(result.error).toContain('no chromium anywhere');
  });

  it('B11: a page that times out is skipped and the crawl continues', async () => {
    const recorder = makeRecorder();
    const timeoutError = new Error('Navigation timeout');
    const launch = makeFakeLauncher(
      {
        [START]: { links: [`${START}a`, `${START}b`] },
        [`${START}a`]: { gotoError: timeoutError },
        [`${START}b`]: { links: [`${START}c`] },
      },
      recorder,
    );
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls).toContain(`${START}c`);
    for (const call of recorder.gotoCalls) {
      expect((call.options as { timeout: number }).timeout).toBe(BROWSER_DISCOVERY_PAGE_TIMEOUT_MS);
    }
  });

  it('B12: the total budget stops the crawl and still closes the browser', async () => {
    const recorder = makeRecorder();
    const links = [`${START}a`, `${START}b`];
    const launch = makeFakeLauncher(
      { [START]: { links }, [`${START}a`]: { links: [] }, [`${START}b`]: { links: [] } },
      recorder,
    );
    let calls = 0;
    const now = (): number => {
      calls++;
      // First call establishes startedAt; every call after the start page
      // has loaded reports we're past the budget.
      return calls <= 2 ? 0 : 100_000_000;
    };
    const result = await browserCrawlSite(START, { ...baseOptions, budgetMs: 1000 }, { launch, now });
    expect(recorder.gotoCalls.length).toBe(1);
    expect(recorder.browserCloses).toBe(1);
    expect(result.urls).toContain(`${START}a`);
    expect(result.urls).toContain(`${START}b`);
  });

  it('B13: extra http headers are applied to every page only when provided', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher(
      { [START]: { links: [`${START}a`] }, [`${START}a`]: { links: [] } },
      recorder,
    );
    await browserCrawlSite(START, baseOptions, { launch });
    expect(recorder.headersSet.length).toBe(0);

    const recorder2 = makeRecorder();
    const launch2 = makeFakeLauncher(
      { [START]: { links: [`${START}a`] }, [`${START}a`]: { links: [] } },
      recorder2,
    );
    await browserCrawlSite(START, { ...baseOptions, headers: { 'X-Test': '1' } }, { launch: launch2 });
    expect(recorder2.headersSet.length).toBe(recorder2.pagesOpened);
    for (const h of recorder2.headersSet) expect(h).toEqual({ 'X-Test': '1' });
  });

  it('B14: the start URL is returned even when it yields no links', async () => {
    const recorder = makeRecorder();
    const launch = makeFakeLauncher({ [START]: { links: [] } }, recorder);
    const result = await browserCrawlSite(START, baseOptions, { launch });
    expect(result.urls).toEqual([START]);
  });
});
