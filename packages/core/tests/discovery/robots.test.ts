import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRobots } from '../../src/discovery/robots.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('fetchRobots', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('parses disallow rules and sitemap directives', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => ['User-agent: *', 'Disallow: /admin', 'Disallow: /private/', 'Sitemap: https://example.com/sitemap.xml'].join('\n'),
    });
    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(result.isAllowed('https://example.com/about')).toBe(true);
    expect(result.isAllowed('https://example.com/admin')).toBe(false);
    expect(result.isAllowed('https://example.com/private/stuff')).toBe(false);
  });

  it('returns permissive result when robots.txt is 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual([]);
    expect(result.isAllowed('https://example.com/admin')).toBe(true);
  });

  it('returns permissive result on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual([]);
    expect(result.isAllowed('https://example.com/anything')).toBe(true);
  });

  it('extracts multiple sitemap directives', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => ['User-agent: *', 'Disallow:', 'Sitemap: https://example.com/sitemap1.xml', 'Sitemap: https://example.com/sitemap2.xml'].join('\n'),
    });
    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toHaveLength(2);
  });
});
