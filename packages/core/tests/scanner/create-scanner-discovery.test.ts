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
