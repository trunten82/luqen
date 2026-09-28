import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverUrls } from '../../src/discovery/discover.js';
import * as robotsModule from '../../src/discovery/robots.js';
import * as sitemapModule from '../../src/discovery/sitemap.js';
import * as crawlerModule from '../../src/discovery/crawler.js';
import * as browserCrawlerModule from '../../src/discovery/browser-crawler.js';

vi.mock('../../src/discovery/robots.js');
vi.mock('../../src/discovery/sitemap.js');
vi.mock('../../src/discovery/crawler.js');
vi.mock('../../src/discovery/browser-crawler.js');

const mockFetchRobots = vi.mocked(robotsModule.fetchRobots);
const mockParseSitemap = vi.mocked(sitemapModule.parseSitemap);
const mockCrawlSite = vi.mocked(crawlerModule.crawlSite);
const mockBrowserCrawlSite = vi.mocked(browserCrawlerModule.browserCrawlSite);

describe('discoverUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRobots.mockResolvedValue({ sitemapUrls: [], isAllowed: () => true });
    mockParseSitemap.mockResolvedValue([]);
    mockCrawlSite.mockResolvedValue([]);
    mockBrowserCrawlSite.mockResolvedValue({ urls: [] });
  });

  it('uses sitemap from robots.txt when available', async () => {
    mockFetchRobots.mockResolvedValue({ sitemapUrls: ['https://example.com/custom-sitemap.xml'], isAllowed: () => true });
    mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/about']);
    const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
    expect(mockParseSitemap).toHaveBeenCalledWith('https://example.com/custom-sitemap.xml');
    expect(result).toHaveLength(2);
    expect(result[0].discoveryMethod).toBe('sitemap');
  });

  it('falls back to /sitemap.xml when robots has no sitemap', async () => {
    mockParseSitemap.mockResolvedValue(['https://example.com/']);
    const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
    expect(mockParseSitemap).toHaveBeenCalledWith('https://example.com/sitemap.xml');
    expect(result).toHaveLength(1);
  });

  it('crawls when no sitemap found', async () => {
    mockCrawlSite.mockResolvedValue(['https://example.com/', 'https://example.com/page']);
    const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
    expect(mockCrawlSite).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0].discoveryMethod).toBe('crawl');
  });

  it('merges sitemap and crawl when alsoCrawl is true', async () => {
    mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/about']);
    mockCrawlSite.mockResolvedValue(['https://example.com/', 'https://example.com/hidden']);
    const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: true });
    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/hidden');
    expect(urls.filter((u) => u === 'https://example.com/').length).toBe(1);
  });

  it('filters disallowed URLs from sitemap results', async () => {
    mockFetchRobots.mockResolvedValue({ sitemapUrls: [], isAllowed: (url: string) => !url.includes('/admin') });
    mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/admin']);
    const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
    expect(result.map((r) => r.url)).not.toContain('https://example.com/admin');
  });

  describe('discovery scope (DISCOVERY-SCOPE-3)', () => {
    it('sitemap URLs from another origin are dropped', async () => {
      mockParseSitemap.mockResolvedValue([
        'https://example.com/a',
        'https://cdn.example.org/b',
        'http://example.com/c',
      ]);
      const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
      const urls = result.map((r) => r.url);
      expect(urls).toContain('https://example.com/a');
      expect(urls).not.toContain('https://cdn.example.org/b');
      expect(urls).not.toContain('http://example.com/c');
    });

    it('sitemap URLs outside the start section are dropped', async () => {
      mockParseSitemap.mockResolvedValue([
        'https://example.com/dev/en-us/',
        'https://example.com/dev/en-us/a',
        'https://example.com/dev/fr-fr/b',
      ]);
      const result = await discoverUrls('https://example.com/dev/en-us/', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
      const urls = result.map((r) => r.url);
      expect(urls).toContain('https://example.com/dev/en-us/');
      expect(urls).toContain('https://example.com/dev/en-us/a');
      expect(urls).not.toContain('https://example.com/dev/fr-fr/b');
    });

    it('an all-out-of-scope sitemap still triggers the crawl fallback', async () => {
      mockParseSitemap.mockResolvedValue(['https://example.com/dev/fr-fr/']);
      mockCrawlSite.mockResolvedValue(['https://example.com/dev/en-us/']);
      await discoverUrls('https://example.com/dev/en-us/', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
      expect(mockCrawlSite).toHaveBeenCalled();
    });

    it('crawled URLs outside scope are dropped at the merge', async () => {
      mockCrawlSite.mockResolvedValue([
        'https://example.com/dev/en-us/',
        'https://example.com/dev/fr-fr/x',
      ]);
      const result = await discoverUrls('https://example.com/dev/en-us/', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
      const urls = result.map((r) => r.url);
      expect(urls).not.toContain('https://example.com/dev/fr-fr/x');
    });

    it('a root start URL keeps every same-origin sitemap URL', async () => {
      mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/about']);
      const result = await discoverUrls('https://example.com', { maxPages: 100, crawlDepth: 3, alsoCrawl: false });
      const urls = result.map((r) => r.url);
      expect(urls).toContain('https://example.com/');
      expect(urls).toContain('https://example.com/about');
    });
  });

  describe('browser fallback (WAF-BROWSER-2)', () => {
    const START = 'https://example.com/dev/en-us/';

    it('DB1: a site without a waf challenge never starts the browser crawl', async () => {
      mockCrawlSite.mockResolvedValue([START]);
      await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      expect(mockBrowserCrawlSite).not.toHaveBeenCalled();
    });

    it('DB1b: a site without a waf challenge (legacy array return) never starts the browser crawl', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START] } as never);
      await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      expect(mockBrowserCrawlSite).not.toHaveBeenCalled();
    });

    it('DB2: a waf challenge starts the browser crawl with the discovery limits and robots', async () => {
      const isAllowed = () => true;
      mockFetchRobots.mockResolvedValue({ sitemapUrls: [], isAllowed });
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true, headers: { 'X-H': '1' } }, true);
      expect(mockBrowserCrawlSite).toHaveBeenCalledTimes(1);
      expect(mockBrowserCrawlSite).toHaveBeenCalledWith(START, {
        maxPages: 50,
        maxDepth: 2,
        isAllowed,
        headers: { 'X-H': '1' },
      });
    });

    it('DB3: browser found pages replace the blocked result and clear the waf warning', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      mockBrowserCrawlSite.mockResolvedValue({ urls: [START, `${START}a`, `${START}b`] });
      const result = await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      const urls = result.urls.map((u) => u.url);
      expect(urls).toEqual(expect.arrayContaining([START, `${START}a`, `${START}b`]));
      expect(result.urls.every((u) => u.discoveryMethod === 'crawl')).toBe(true);
      expect(result.wafWarning).toBeUndefined();
      expect(result.discoveryFallback).toBe('browser');
    });

    it('DB4: browser found pages are scope filtered at the merge', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      mockBrowserCrawlSite.mockResolvedValue({ urls: [START, `${START}a`, 'https://example.com/dev/fr-fr/x'] });
      const result = await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      const urls = result.urls.map((u) => u.url);
      expect(urls).not.toContain('https://example.com/dev/fr-fr/x');
    });

    it('DB5: a browser crawl that finds only the start URL keeps the waf warning', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      mockBrowserCrawlSite.mockResolvedValue({ urls: [START] });
      const result = await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      expect(result.wafWarning).toBe('W');
      expect('discoveryFallback' in result).toBe(false);
    });

    it('DB6: a rejecting browser crawl keeps the waf warning and does not throw', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      mockBrowserCrawlSite.mockRejectedValue(new Error('boom'));
      const result = await discoverUrls(START, { maxPages: 50, crawlDepth: 2, alsoCrawl: true }, true);
      expect(result.wafWarning).toBe('W');
      expect('discoveryFallback' in result).toBe(false);
    });

    it('DB7: browser found pages respect maxPages', async () => {
      mockCrawlSite.mockResolvedValue({ urls: [START], wafWarning: 'W' } as never);
      const many = Array.from({ length: 10 }, (_, i) => `${START}p${i}`);
      mockBrowserCrawlSite.mockResolvedValue({ urls: [START, ...many] });
      const result = await discoverUrls(START, { maxPages: 5, crawlDepth: 2, alsoCrawl: true }, true);
      expect(result.urls.length).toBeLessThanOrEqual(5);
    });
  });
});
