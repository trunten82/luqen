/**
 * DEEP-SCAN-BROWSER-REUSE-1 — createScanner runs a deep scan on ONE shared
 * Chromium: every engine (pa11y included) gets the same per-scan shared
 * browser, which launches through launchChromium exactly once, and is closed
 * when the scan ends — also when an engine or the static scan throws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createScanner } from '../../src/index.js';
import type { SharedBrowser } from '../../src/browser/shared-browser.js';
import * as launchModule from '../../src/browser/launch.js';
import * as discoverModule from '../../src/discovery/discover.js';
import * as scannerModule from '../../src/scanner/scanner.js';
import * as behavioralModule from '../../src/behavioral/index.js';
import * as lighthouseModule from '../../src/lighthouse/index.js';
import * as ibmModule from '../../src/ibm/index.js';
import * as reflowModule from '../../src/reflow/index.js';
import * as a11yTreeModule from '../../src/a11y-tree/index.js';

vi.mock('../../src/browser/launch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/launch.js')>();
  return { ...actual, launchChromium: vi.fn() };
});
vi.mock('../../src/discovery/discover.js');
vi.mock('../../src/scanner/scanner.js');
vi.mock('../../src/behavioral/index.js');
vi.mock('../../src/lighthouse/index.js');
vi.mock('../../src/ibm/index.js');
vi.mock('../../src/reflow/index.js');
vi.mock('../../src/a11y-tree/index.js');

const PAGES = ['https://example.com/', 'https://example.com/a', 'https://example.com/b'];

class FakeBrowser extends EventEmitter {
  connected = true;
  closeCalls = 0;
  contexts = 0;
  closedContexts = 0;
  async createBrowserContext() {
    this.contexts += 1;
    return {
      newPage: async () => ({}),
      close: async () => { this.closedContexts += 1; },
    };
  }
  async close() {
    this.closeCalls += 1;
    this.connected = false;
    this.emit('disconnected');
  }
}

let browsers: FakeBrowser[];

const ENGINE_MOCKS = [
  ['behavioral', vi.mocked(behavioralModule.runBehavioralChecks)],
  ['lighthouse', vi.mocked(lighthouseModule.runLighthouseChecks)],
  ['ibm', vi.mocked(ibmModule.runIbmChecks)],
  ['reflow', vi.mocked(reflowModule.runReflowChecks)],
  ['a11y-tree', vi.mocked(a11yTreeModule.runA11yTreeChecks)],
] as const;

/** An engine that behaves like the real ones: lease a page, use it, release it. */
async function leaseAndRelease(_url: string, opts?: { sharedBrowser?: SharedBrowser }) {
  const lease = await opts!.sharedBrowser!.acquire();
  await lease.release();
  return { issues: [], pagesChecked: 1, errors: [] };
}

function deepScanner(extra: Record<string, unknown> = {}) {
  return createScanner({
    runners: ['htmlcs', 'axe'],
    behavioral: true,
    lighthouse: true,
    ibm: true,
    reflow: true,
    a11yTree: true,
    ...extra,
  });
}

function scanOptionsSharedBrowser(): SharedBrowser | undefined {
  return (vi.mocked(scannerModule.scanUrls).mock.calls[0][2] as { sharedBrowser?: SharedBrowser }).sharedBrowser;
}

describe('createScanner() — one shared Chromium per deep scan (DEEP-SCAN-BROWSER-REUSE-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browsers = [];
    vi.mocked(launchModule.launchChromium).mockImplementation(async () => {
      const b = new FakeBrowser();
      browsers.push(b);
      return b as never;
    });
    vi.mocked(discoverModule.discoverUrls).mockResolvedValue({
      urls: PAGES.map((url) => ({ url, discoveryMethod: 'crawl' as const })),
    });
    vi.mocked(scannerModule.scanUrls).mockImplementation(async (urls, _client, options) => {
      // pa11y leases a page per URL, concurrently (scanUrls' concurrency).
      await Promise.all(urls.map(async () => {
        const lease = await options.sharedBrowser!.acquire();
        await lease.release();
      }));
      return {
        pages: urls.map((u) => ({ url: u.url, issues: [], issueCount: 0, discoveryMethod: 'crawl' }) as never),
        errors: [],
      };
    });
    for (const [, mock] of ENGINE_MOCKS) mock.mockImplementation(leaseAndRelease as never);
  });

  it('[one-launch] pa11y + 5 engines x 3 pages cause exactly ONE launchChromium call', async () => {
    await deepScanner().scan(PAGES[0]);
    for (const [, mock] of ENGINE_MOCKS) expect(mock).toHaveBeenCalledTimes(3);
    expect(launchModule.launchChromium).toHaveBeenCalledTimes(1);
    // 3 pa11y leases + 5 engines x 3 pages, each on its OWN context.
    expect(browsers[0].contexts).toBe(18);
    expect(browsers[0].closedContexts).toBe(18);
  });

  it('[one-launch] every engine and pa11y get the SAME shared browser, carrying the scan guard', async () => {
    await deepScanner({ allowPrivateTargets: true }).scan(PAGES[0]);
    const shared = scanOptionsSharedBrowser();
    expect(shared).toBeDefined();
    expect(shared!.guard).toEqual({ allowPrivate: true });
    for (const [, mock] of ENGINE_MOCKS) {
      for (const call of mock.mock.calls) {
        const opts = call[1] as { sharedBrowser?: SharedBrowser; guard?: unknown };
        expect(opts.sharedBrowser).toBe(shared);
        // The page-level guard and the proxy-level guard are the same policy.
        expect(opts.guard).toBe(shared!.guard);
      }
    }
    expect(vi.mocked(launchModule.launchChromium).mock.calls[0][0]).toMatchObject({ guard: { allowPrivate: true } });
  });

  it('[teardown] the shared browser is closed when the scan ends', async () => {
    await deepScanner().scan(PAGES[0]);
    expect(browsers).toHaveLength(1);
    expect(browsers[0].closeCalls).toBe(1);
  });

  it('[teardown] the shared browser is closed when the static scan throws', async () => {
    vi.mocked(scannerModule.scanUrls).mockImplementationOnce(async (_urls, _client, options) => {
      await options.sharedBrowser!.acquire();
      throw new Error('static scan exploded');
    });
    await expect(deepScanner().scan(PAGES[0])).rejects.toThrow('static scan exploded');
    expect(browsers[0].closeCalls).toBe(1);
  });

  it('[crash] an engine that crashes the browser does not break the others; the browser is relaunched', async () => {
    vi.mocked(ibmModule.runIbmChecks).mockImplementation(async (_url, opts) => {
      const lease = await opts!.sharedBrowser!.acquire();
      // Simulate a browser-process crash mid-engine.
      const b = lease.browser as unknown as FakeBrowser;
      b.connected = false;
      b.emit('disconnected');
      throw new Error('Target closed');
    });
    const result = await deepScanner().scan(PAGES[0]);
    // Every page survived with its engines' (empty) results.
    expect(result.pages).toHaveLength(3);
    // reflow + a11y-tree still ran on every page, after the crashes.
    expect(reflowModule.runReflowChecks).toHaveBeenCalledTimes(3);
    expect(a11yTreeModule.runA11yTreeChecks).toHaveBeenCalledTimes(3);
    // 1 initial launch + one relaunch after each of the 3 IBM crashes.
    expect(launchModule.launchChromium).toHaveBeenCalledTimes(4);
    // Every browser that is still up at the end is closed.
    expect(browsers[browsers.length - 1].closeCalls).toBe(1);
  });

  it('[scope] a plain (non-deep) scan does not create a shared browser', async () => {
    vi.mocked(scannerModule.scanUrls).mockImplementationOnce(async (urls) => ({
      pages: urls.map((u) => ({ url: u.url, issues: [], issueCount: 0, discoveryMethod: 'crawl' }) as never),
      errors: [],
    }));
    await createScanner({ singlePage: true }).scan(PAGES[0]);
    expect(scanOptionsSharedBrowser()).toBeUndefined();
    expect(launchModule.launchChromium).not.toHaveBeenCalled();
  });
});
