import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSitemap } from '../../src/discovery/sitemap.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('parseSitemap', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('extracts URLs from a simple urlset sitemap', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/about</loc></url>
          <url><loc>https://example.com/contact</loc></url>
        </urlset>`,
    });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual(['https://example.com/', 'https://example.com/about', 'https://example.com/contact']);
  });

  it('follows sitemapindex entries recursively', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
        </sitemapindex>`,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
        </urlset>`,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/blog/post-1</loc></url>
        </urlset>`,
    });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual(['https://example.com/', 'https://example.com/blog/post-1']);
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([]);
  });

  it('deduplicates URLs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/</loc></url>
        </urlset>`,
    });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual(['https://example.com/']);
  });
});
