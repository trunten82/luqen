import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sha256,
  stripHtml,
  parseRssEntries,
  normaliseContent,
  diffContent,
  fetchSource,
  parseRobotsTxt,
} from '../src/sources.js';

// ---- sha256 ----

describe('sha256', () => {
  it('returns a 64-char hex string', () => {
    const hash = sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

// ---- stripHtml ----

describe('stripHtml', () => {
  it('strips basic tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script blocks', () => {
    const html = '<p>text</p><script>alert(1)</script><p>more</p>';
    expect(stripHtml(html)).not.toContain('alert');
    expect(stripHtml(html)).toContain('text');
    expect(stripHtml(html)).toContain('more');
  });

  it('removes style blocks', () => {
    const html = '<style>body{color:red}</style><p>content</p>';
    expect(stripHtml(html)).not.toContain('body{color');
    expect(stripHtml(html)).toContain('content');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39; &nbsp;')).toBe('& < > " \' \u00A0'.replace('\u00A0', ' ').trim());
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  hello   world  </p>')).toBe('hello world');
  });
});

// ---- parseRssEntries ----

describe('parseRssEntries', () => {
  const rss = `
    <rss>
      <channel>
        <item>
          <title>New regulation update</title>
          <description>Details about the <b>EAA</b> update.</description>
        </item>
        <item>
          <title>Another change</title>
          <description>Minor wording fix.</description>
        </item>
      </channel>
    </rss>
  `;

  it('extracts item titles', () => {
    const result = parseRssEntries(rss);
    expect(result).toContain('New regulation update');
    expect(result).toContain('Another change');
  });

  it('extracts item descriptions (stripped of HTML)', () => {
    const result = parseRssEntries(rss);
    expect(result).toContain('EAA');
    expect(result).not.toContain('<b>');
  });

  it('returns empty string for empty feed', () => {
    expect(parseRssEntries('<rss></rss>')).toBe('');
  });
});

// ---- normaliseContent ----

describe('normaliseContent', () => {
  it('strips HTML for html type', () => {
    const result = normaliseContent('<p>Hello</p>', 'html');
    expect(result).toBe('Hello');
  });

  it('parses RSS entries for rss type', () => {
    const rss = '<rss><channel><item><title>Test</title></item></channel></rss>';
    const result = normaliseContent(rss, 'rss');
    expect(result).toContain('Test');
  });

  it('normalises JSON for api type', () => {
    const json = '{ "b": 2, "a": 1 }';
    const result = normaliseContent(json, 'api');
    // Should be compact JSON
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('returns trimmed string for invalid JSON in api type', () => {
    const result = normaliseContent('not json at all', 'api');
    expect(result).toBe('not json at all');
  });
});

// ---- diffContent ----

describe('diffContent', () => {
  it('detects no change when hashes match', () => {
    const diff = diffContent('abc123', 'abc123');
    expect(diff.changed).toBe(false);
  });

  it('detects change when hashes differ', () => {
    const diff = diffContent('abc123', 'def456');
    expect(diff.changed).toBe(true);
  });

  it('preserves both hashes in result', () => {
    const diff = diffContent('old', 'new');
    expect(diff.oldHash).toBe('old');
    expect(diff.newHash).toBe('new');
  });
});

// ---- parseRobotsTxt ----

describe('parseRobotsTxt', () => {
  it('allows access when no relevant rules exist', () => {
    const robots = 'User-agent: *\nDisallow:';
    expect(parseRobotsTxt(robots, 'https://example.com/page', 'my-bot')).toBe(true);
  });

  it('respects Disallow for wildcard user-agent', () => {
    const robots = 'User-agent: *\nDisallow: /private/';
    expect(parseRobotsTxt(robots, 'https://example.com/private/data', 'any-bot')).toBe(false);
  });

  it('allows paths not matched by Disallow', () => {
    const robots = 'User-agent: *\nDisallow: /private/';
    expect(parseRobotsTxt(robots, 'https://example.com/public/data', 'any-bot')).toBe(true);
  });

  it('Allow overrides Disallow for specific path', () => {
    const robots = 'User-agent: *\nDisallow: /private/\nAllow: /private/open/';
    expect(parseRobotsTxt(robots, 'https://example.com/private/open/file', 'bot')).toBe(true);
  });

  it('handles agent-specific blocks', () => {
    const robots = 'User-agent: bad-bot\nDisallow: /\nUser-agent: *\nDisallow:';
    // our-bot matches the wildcard block which has no disallow
    expect(parseRobotsTxt(robots, 'https://example.com/page', 'our-bot')).toBe(true);
    // bad-bot matches the specific block
    expect(parseRobotsTxt(robots, 'https://example.com/page', 'bad-bot')).toBe(false);
  });

  it('returns true for unparseable URL', () => {
    expect(parseRobotsTxt('User-agent: *\nDisallow: /', 'not-a-url', 'bot')).toBe(true);
  });
});

// ---- fetchSource (mocked) ----

describe('fetchSource', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns normalised content and hash for an HTML page', async () => {
    vi.mocked(fetch)
      // First call: robots.txt
      .mockResolvedValueOnce(
        new Response('User-agent: *\nDisallow:', { status: 200 }),
      )
      // Second call: actual page
      .mockResolvedValueOnce(
        new Response('<p>Hello world</p>', { status: 200 }),
      );

    const result = await fetchSource('https://example.com/page', 'html');
    expect(result.content).toBe('Hello world');
    expect(result.contentHash).toHaveLength(64);
    expect(result.url).toBe('https://example.com/page');
    expect(result.type).toBe('html');
    expect(result.fetchedAt).toBeTruthy();
  });

  it('throws when robots.txt disallows the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('User-agent: *\nDisallow: /', { status: 200 }),
    );

    await expect(
      fetchSource('https://example.com/page', 'html', { userAgent: 'test-bot' }),
    ).rejects.toThrow('Robots.txt disallows');
  });

  it('throws on non-OK HTTP status', async () => {
    vi.mocked(fetch)
      // robots.txt OK
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      // page returns 500
      .mockResolvedValueOnce(new Response('', { status: 500 }));

    await expect(fetchSource('https://example.com/page', 'html')).rejects.toThrow('HTTP 500');
  });

  it('handles RSS source type', async () => {
    const rss =
      '<rss><channel><item><title>Update</title><description>Desc</description></item></channel></rss>';
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 404 })) // robots.txt 404 → allowed
      .mockResolvedValueOnce(new Response(rss, { status: 200 }));

    const result = await fetchSource('https://example.com/feed.xml', 'rss');
    expect(result.type).toBe('rss');
    expect(result.content).toContain('Update');
  });
});
