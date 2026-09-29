import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScanner } from '../../src/index.js';
import * as discoverModule from '../../src/discovery/discover.js';
import * as scannerModule from '../../src/scanner/scanner.js';

vi.mock('../../src/discovery/discover.js');
vi.mock('../../src/scanner/scanner.js');

const mockDiscoverUrls = vi.mocked(discoverModule.discoverUrls);
const mockScanUrls = vi.mocked(scannerModule.scanUrls);

const START_URL = 'https://example.com/';

describe('createScanner().scan() — wafWarning surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanUrls.mockResolvedValue({
      pages: [{ url: START_URL, issues: [], discoveryMethod: 'crawl' } as never],
      errors: [],
    });
  });

  it('site mode surfaces the discovery wafWarning', async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: [{ url: START_URL, discoveryMethod: 'crawl' }],
      wafWarning: 'W',
    });
    const scanner = createScanner({});
    const result = await scanner.scan(START_URL);
    expect(result.wafWarning).toBe('W');
    expect(result.summary.pagesScanned).toBe(1);
  });

  it('site mode without a challenge has no wafWarning key', async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: [{ url: START_URL, discoveryMethod: 'crawl' }],
    });
    const scanner = createScanner({});
    const result = await scanner.scan(START_URL);
    expect('wafWarning' in result).toBe(false);
  });

  it('single-page mode never runs discovery and has no wafWarning key', async () => {
    const scanner = createScanner({ singlePage: true });
    const result = await scanner.scan(START_URL);
    expect(mockDiscoverUrls).not.toHaveBeenCalled();
    expect('wafWarning' in result).toBe(false);
  });

  it('discovery failure falls back to the start URL without claiming a WAF', async () => {
    mockDiscoverUrls.mockRejectedValue(new Error('discovery boom'));
    const scanner = createScanner({});
    const result = await scanner.scan(START_URL);
    expect(result.summary.pagesScanned).toBe(1);
    expect('wafWarning' in result).toBe(false);
  });
});

describe('createScanner().scan() — discoveryFallback surfacing (WAF-BROWSER-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanUrls.mockResolvedValue({
      pages: [{ url: START_URL, issues: [], discoveryMethod: 'crawl' } as never],
      errors: [],
    });
  });

  it('CS1: site mode surfaces the browser discovery fallback', async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: [{ url: START_URL, discoveryMethod: 'crawl' }, { url: `${START_URL}a`, discoveryMethod: 'crawl' }],
      discoveryFallback: 'browser',
    } as never);
    const scanner = createScanner({});
    const result = await scanner.scan(START_URL);
    expect(result.discoveryFallback).toBe('browser');
    expect('wafWarning' in result).toBe(false);
  });

  it('CS2: site mode without a fallback has no discoveryFallback key', async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: [{ url: START_URL, discoveryMethod: 'crawl' }],
    });
    const scanner = createScanner({});
    const result = await scanner.scan(START_URL);
    expect('discoveryFallback' in result).toBe(false);
  });
});

describe('createScanner().scan() — discovery progress (DISCOVERY-PROGRESS-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanUrls.mockResolvedValue({
      pages: [{ url: START_URL, issues: [], discoveryMethod: 'crawl' } as never],
      errors: [],
    });
  });

  it('CSP1: onDiscoveryProgress is threaded to discovery and receives its events', async () => {
    mockDiscoverUrls.mockImplementation((async (_url: string, opts: { onProgress?: (p: unknown) => void }) => {
      opts.onProgress?.({ phase: 'browser', pagesFound: 3 });
      return { urls: [{ url: START_URL, discoveryMethod: 'crawl' }] };
    }) as never);
    const seen: unknown[] = [];
    const scanner = createScanner({ onDiscoveryProgress: (p) => seen.push(p) });
    await scanner.scan(START_URL);
    expect(seen).toEqual([{ phase: 'browser', pagesFound: 3 }]);
  });

  it('CSP2: without onDiscoveryProgress no listener is passed to discovery', async () => {
    mockDiscoverUrls.mockResolvedValue({ urls: [{ url: START_URL, discoveryMethod: 'crawl' }] });
    const scanner = createScanner({});
    await scanner.scan(START_URL);
    expect('onProgress' in (mockDiscoverUrls.mock.calls[0][1] as object)).toBe(false);
  });
});
