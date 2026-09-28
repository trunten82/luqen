import { describe, it, expect } from 'vitest';
import { discoveryNotice } from '../../src/discovery/notice.js';

const START = 'https://example.com/dev/en-us/';

describe('discoveryNotice', () => {
  it('N1: blocked discovery notice is the waf warning', () => {
    const notice = discoveryNotice({ urls: [{ url: START, discoveryMethod: 'crawl' }], wafWarning: 'W' }, START);
    expect(notice).toBe('W');
  });

  it('N2: browser fallback notice names the discovered count', () => {
    const notice = discoveryNotice(
      {
        urls: [
          { url: START, discoveryMethod: 'crawl' },
          { url: `${START}a`, discoveryMethod: 'crawl' },
          { url: `${START}b`, discoveryMethod: 'crawl' },
        ],
        discoveryFallback: 'browser',
      },
      START,
    );
    expect(notice).toBeDefined();
    expect(notice).toContain('3');
    expect(notice).toContain(START);
    expect(notice).toContain('headless browser');
  });

  it('N3: clean discovery has no notice', () => {
    const notice = discoveryNotice({ urls: [{ url: START, discoveryMethod: 'crawl' }] }, START);
    expect(notice).toBeUndefined();
  });
});
