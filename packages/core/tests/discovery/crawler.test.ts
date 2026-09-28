import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crawlSite, isWafChallenge } from '../../src/discovery/crawler.js';
import { PUBLIC_TEST_POLICY } from './ssrf-fixtures.js';

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
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/contact');
  });

  it('respects maxDepth', async () => {
    mockFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/level2']) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 1, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('respects maxPages', async () => {
    mockFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/a', '/b', '/c', '/d', '/e']) });
    const urls = await crawlSite('https://example.com', { maxPages: 3, maxDepth: 10, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls.length).toBeLessThanOrEqual(3);
  });

  it('skips disallowed URLs', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/public', '/admin']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: (url) => !url.includes('/admin'), guard: PUBLIC_TEST_POLICY });
    expect(urls).toContain('https://example.com/public');
    expect(urls).not.toContain('https://example.com/admin');
  });

  it('skips external links', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['https://other.com/page', '/local']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls).not.toContain('https://other.com/page');
    expect(urls).toContain('https://example.com/local');
  });

  it('skips non-HTML resources', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/page#section', '/image.png', '/doc.pdf', '/valid']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls).not.toContain('https://example.com/image.png');
    expect(urls).not.toContain('https://example.com/doc.pdf');
    expect(urls).toContain('https://example.com/valid');
  });

  describe('WAF detection', () => {
    it('detects Incapsula WAF challenge and returns warning', async () => {
      const wafHtml = '<html><body>Access denied. _Incapsula_Resource blocked.</body></html>';
      mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => wafHtml });
      const result = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY }, true);
      expect(result.wafWarning).toBeDefined();
      expect(result.wafWarning).toContain('WAF/bot protection detected');
      expect(result.wafWarning).toContain('https://example.com/');
    });

    it('detects Cloudflare WAF challenge and returns warning', async () => {
      const wafHtml = '<html><body>cf-browser-verification required</body></html>';
      mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => wafHtml });
      const result = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY }, true);
      expect(result.wafWarning).toBeDefined();
      expect(result.urls).toContain('https://example.com/');
    });

    it('still returns the start URL when WAF is detected', async () => {
      const wafHtml = '<html><body>__cf_chl challenge</body></html>';
      mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => wafHtml });
      const result = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY }, true);
      expect(result.urls).toContain('https://example.com/');
      expect(result.urls.length).toBe(1);
    });

    it('does not flag large pages as WAF challenges', async () => {
      const largePage = htmlPage(['/about']) + ' '.repeat(1500);
      mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => largePage })
        .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
      const result = await crawlSite('https://example.com', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY }, true);
      expect(result.wafWarning).toBeUndefined();
      expect(result.urls).toContain('https://example.com/about');
    });
  });
});

describe('crawlSite — discovery scope (DISCOVERY-SCOPE-3)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('crawler follows links inside the start section only', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['/dev/en-us/about', '/dev/fr-fr/', '/']) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage([]) });
    const urls = await crawlSite('https://example.com/dev/en-us/', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls).toContain('https://example.com/dev/en-us/');
    expect(urls).toContain('https://example.com/dev/en-us/about');
    expect(urls).not.toContain('https://example.com/dev/fr-fr/');
    expect(urls).not.toContain('https://example.com/');
  });

  it('crawler never follows a userinfo link to another host', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['https://example.com@127.0.0.1/dev/en-us/']) });
    const urls = await crawlSite('https://example.com/dev/en-us/', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls.some((u) => u.includes('127.0.0.1'))).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('crawler never follows a lookalike host', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['https://example.com.evil.test/page']) });
    const urls = await crawlSite('https://example.com/dev/en-us/', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls.some((u) => u.includes('evil.test'))).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('crawler never follows another port', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => htmlPage(['https://example.com:8443/x']) });
    const urls = await crawlSite('https://example.com/dev/en-us/', { maxPages: 100, maxDepth: 3, isAllowed: () => true, guard: PUBLIC_TEST_POLICY });
    expect(urls.some((u) => u.includes(':8443'))).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('isWafChallenge', () => {
  it('returns true for short pages with Incapsula signature', () => {
    expect(isWafChallenge('<html><body>_Incapsula_Resource</body></html>')).toBe(true);
  });

  it('returns true for short pages with cf-browser-verification', () => {
    expect(isWafChallenge('<html>cf-browser-verification</html>')).toBe(true);
  });

  it('returns true for short pages with __cf_chl', () => {
    expect(isWafChallenge('<html>__cf_chl</html>')).toBe(true);
  });

  it('returns true for short pages with challenge-platform', () => {
    expect(isWafChallenge('<html>challenge-platform</html>')).toBe(true);
  });

  it('returns false for pages >= 1000 bytes even with WAF signature', () => {
    const big = '_Incapsula_Resource' + 'x'.repeat(1100);
    expect(isWafChallenge(big)).toBe(false);
  });

  it('returns false for normal small pages', () => {
    expect(isWafChallenge('<html><body>Hello world</body></html>')).toBe(false);
  });
});
