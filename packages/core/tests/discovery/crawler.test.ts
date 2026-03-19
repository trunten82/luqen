import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crawlSite } from '../../src/discovery/crawler.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function htmlPage(links: string[]): string {
  const anchors = links.map((href) => `<a href="${href}">link</a>`).join('');
  return `<html><body>${anchors}</body></html>`;
}

describe('crawlSite', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('discovers pages by following links', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/about', '/contact']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true });
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/contact');
  });

  it('respects maxDepth', async () => {
    mockFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/level2']) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 1, isAllowed: () => true });
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('respects maxPages', async () => {
    mockFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/a', '/b', '/c', '/d', '/e']) });
    const urls = await crawlSite('https://example.com', { maxPages: 3, maxDepth: 10, isAllowed: () => true });
    expect(urls.length).toBeLessThanOrEqual(3);
  });

  it('skips disallowed URLs', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/public', '/admin']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: (url) => !url.includes('/admin') });
    expect(urls).toContain('https://example.com/public');
    expect(urls).not.toContain('https://example.com/admin');
  });

  it('skips external links', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['https://other.com/page', '/local']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true });
    expect(urls).not.toContain('https://other.com/page');
    expect(urls).toContain('https://example.com/local');
  });

  it('skips non-HTML resources', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/page#section', '/image.png', '/doc.pdf', '/valid']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true });
    expect(urls).not.toContain('https://example.com/image.png');
    expect(urls).not.toContain('https://example.com/doc.pdf');
    expect(urls).toContain('https://example.com/valid');
  });
});
