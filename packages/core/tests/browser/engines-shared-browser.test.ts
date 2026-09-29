/**
 * DEEP-SCAN-BROWSER-REUSE-1 — every browser engine, handed a shared browser,
 * works on a LEASED page (its own fresh context) instead of launching Chromium,
 * and releases that lease on every exit path, including errors.
 *
 * `launchChromium` and `resolveChromium` are mocked to THROW: any engine that
 * still launched (or re-resolved) its own browser fails its assertions here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SharedBrowser } from '../../src/browser/shared-browser.js';

vi.mock('../../src/browser/launch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/launch.js')>();
  return { ...actual, launchChromium: vi.fn().mockRejectedValue(new Error('launchChromium must not be called')) };
});
vi.mock('../../src/browser/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/resolve.js')>();
  return { ...actual, resolveChromium: vi.fn().mockRejectedValue(new Error('resolveChromium must not be called')) };
});

const { launchChromium } = await import('../../src/browser/launch.js');
const { resolveChromium } = await import('../../src/browser/resolve.js');

const URL_UNDER_TEST = 'http://127.0.0.1:9/';
/** Lighthouse's first import alone is several seconds on a cold module cache. */
const LOAD_TIMEOUT = 60_000;
const GOTO_ERROR = 'goto failed on the leased page';

function fakePage() {
  return {
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockRejectedValue(new Error(GOTO_ERROR)),
    target: () => { throw new Error(GOTO_ERROR); },
    createCDPSession: vi.fn().mockRejectedValue(new Error(GOTO_ERROR)),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeShared() {
  const page = fakePage();
  const release = vi.fn().mockResolvedValue(undefined);
  const acquire = vi.fn().mockResolvedValue({ page, browser: { connected: true }, release });
  const shared = {
    guard: {},
    acquire,
    close: vi.fn().mockResolvedValue(undefined),
    launchCount: () => 0,
  } as unknown as SharedBrowser;
  return { shared, page, acquire, release };
}

beforeEach(() => {
  vi.mocked(launchChromium).mockClear();
  vi.mocked(resolveChromium).mockClear();
});

type Run = (shared: SharedBrowser) => Promise<{ pagesChecked: number; errors: ReadonlyArray<{ message: string }> }>;

const ENGINES: ReadonlyArray<readonly [string, Run]> = [
  ['behavioral', async (sharedBrowser) => (await import('../../src/behavioral/index.js')).runBehavioralChecks(URL_UNDER_TEST, { sharedBrowser })],
  ['a11y-tree', async (sharedBrowser) => (await import('../../src/a11y-tree/index.js')).runA11yTreeChecks(URL_UNDER_TEST, { sharedBrowser })],
  ['reflow', async (sharedBrowser) => (await import('../../src/reflow/index.js')).runReflowChecks(URL_UNDER_TEST, { sharedBrowser })],
  ['ibm', async (sharedBrowser) => (await import('../../src/ibm/index.js')).runIbmChecks(URL_UNDER_TEST, { sharedBrowser })],
  ['lighthouse', async (sharedBrowser) => (await import('../../src/lighthouse/index.js')).runLighthouseChecks(URL_UNDER_TEST, { sharedBrowser })],
];

describe.each(ENGINES)('[shared-lease] %s with a shared browser', (_name, run) => {
  it('works on a leased page, never launches, and releases the lease on error', async () => {
    const { shared, page, acquire, release } = fakeShared();
    const result = await run(shared);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(launchChromium).not.toHaveBeenCalled();
    expect(resolveChromium).not.toHaveBeenCalled();
    // The request guard is installed on the LEASED page (ENGINE-SSRF-1).
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain(GOTO_ERROR);
  }, LOAD_TIMEOUT);

  it('reports a lease failure as an engine error and releases nothing it never got', async () => {
    const { shared, acquire, release } = fakeShared();
    acquire.mockRejectedValueOnce(new Error('shared browser is gone'));
    const result = await run(shared);
    expect(result.pagesChecked).toBe(0);
    expect(result.errors[0].message).toContain('shared browser is gone');
    expect(release).not.toHaveBeenCalled();
    expect(launchChromium).not.toHaveBeenCalled();
  });
});

describe('[shared-lease] pa11y DirectScanner with a shared browser', () => {
  it('hands pa11y the leased page, never launches or re-resolves, and releases on error', async () => {
    const { DirectScanner } = await import('../../src/scanner/direct-scanner.js');
    const { shared, page, acquire, release } = fakeShared();
    await expect(
      new DirectScanner({ guard: {} }).scan(URL_UNDER_TEST, { standard: 'WCAG2AA', sharedBrowser: shared }),
    ).rejects.toThrow();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(launchChromium).not.toHaveBeenCalled();
    expect(resolveChromium).not.toHaveBeenCalled();
  });
});
