import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverUrls } from '../../src/discovery/discover.js';
import * as robotsModule from '../../src/discovery/robots.js';
import * as sitemapModule from '../../src/discovery/sitemap.js';
import * as crawlerModule from '../../src/discovery/crawler.js';

vi.mock('../../src/discovery/robots.js');
vi.mock('../../src/discovery/sitemap.js');
vi.mock('../../src/discovery/crawler.js');

const mockFetchRobots = vi.mocked(robotsModule.fetchRobots);
const mockParseSitemap = vi.mocked(sitemapModule.parseSitemap);
const mockCrawlSite = vi.mocked(crawlerModule.crawlSite);

describe('discoverUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRobots.mockResolvedValue({ sitemapUrls: [], isAllowed: () => true });
    mockParseSitemap.mockResolvedValue([]);
    mockCrawlSite.mockResolvedValue([]);
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
});
