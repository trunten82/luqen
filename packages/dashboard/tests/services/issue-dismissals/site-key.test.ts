import { describe, it, expect } from 'vitest';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';

describe('toSiteKey', () => {
  it('maps the measured prod duplicate pair (trailing slash + host case) to ONE key', () => {
    expect(toSiteKey('https://Example.com/dev/en-us/')).toBe(toSiteKey('https://example.com/dev/en-us'));
    expect(toSiteKey('https://Example.com/dev/en-us/')).toBe('https://example.com/dev/en-us');
  });

  it.each([
    ['root URL with slash', 'https://example.com/', 'https://example.com'],
    ['root URL without slash', 'https://example.com', 'https://example.com'],
    ['several trailing slashes', 'https://example.com/a//', 'https://example.com/a'],
    ['explicit default https port', 'https://example.com:443/x', 'https://example.com/x'],
    ['explicit default http port', 'http://example.com:80/x', 'http://example.com/x'],
    ['non-default port is kept', 'https://example.com:8443/x/', 'https://example.com:8443/x'],
    ['query string is kept', 'https://example.com/p/?lang=it', 'https://example.com/p?lang=it'],
    ['fragment is dropped', 'https://example.com/p#section', 'https://example.com/p'],
    ['credentials are dropped', 'https://user:secret@example.com/p', 'https://example.com/p'],
    ['surrounding whitespace is trimmed', '  https://example.com/p/  ', 'https://example.com/p'],
    ['path case is preserved', 'https://example.com/Dev/En-US', 'https://example.com/Dev/En-US'],
  ])('%s', (_name, input, expected) => {
    expect(toSiteKey(input)).toBe(expected);
  });

  it('keeps http and https distinct', () => {
    expect(toSiteKey('http://example.com/p')).not.toBe(toSiteKey('https://example.com/p'));
  });

  it('keeps different paths distinct', () => {
    expect(toSiteKey('https://example.com/a')).not.toBe(toSiteKey('https://example.com/b'));
  });

  it.each([
    ['not a URL', 'not a url', 'not a url'],
    ['not a URL with trailing slash', 'foo/bar/', 'foo/bar'],
    ['empty string', '', ''],
    ['whitespace only', '   ', ''],
    ['non-http scheme', 'ftp://example.com/x/', 'ftp://example.com/x'],
  ])('unparseable or non-http(s) input: %s', (_name, input, expected) => {
    expect(toSiteKey(input)).toBe(expected);
  });

  it('never throws on a non-string', () => {
    expect(toSiteKey(undefined as unknown as string)).toBe('');
    expect(toSiteKey(null as unknown as string)).toBe('');
  });
});
