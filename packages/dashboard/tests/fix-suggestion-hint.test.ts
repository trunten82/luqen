import { describe, it, expect } from 'vitest';
import { buildFixSuggestionHint } from '../src/fix-suggestions.js';

describe('buildFixSuggestionHint', () => {
  it('includes the issue HTML context as htmlContext in the hx-get URL', () => {
    const html = buildFixSuggestionHint(
      '1.1.1',
      'Img element missing an alt attribute',
      'scan-123',
      '<img src="/logo.png">',
    );
    expect(html).toContain('hx-get="/reports/scan-123/fix-suggestion?');
    expect(html).toContain(encodeURIComponent('<img src="/logo.png">').replace(/%20/g, '+'));
    expect(html).not.toContain('htmlContext=&');
    expect(html).not.toMatch(/htmlContext="=?"/);
  });

  it('sends an empty htmlContext when no context is available', () => {
    const html = buildFixSuggestionHint('1.1.1', 'Some issue', 'scan-123');
    expect(html).toContain('hx-get="/reports/scan-123/fix-suggestion?');
    expect(html).toContain('htmlContext=');
  });

  it('truncates very long contexts so the GET URL stays bounded', () => {
    const longContext = '<div>' + 'x'.repeat(5000) + '</div>';
    const html = buildFixSuggestionHint('1.1.1', 'Some issue', 'scan-123', longContext);
    const m = html.match(/htmlContext=([^"&]*)/);
    expect(m).not.toBeNull();
    expect(decodeURIComponent((m as RegExpMatchArray)[1].replace(/\+/g, ' ')).length).toBeLessThanOrEqual(1500);
  });

  it('escapes HTML in the summary label and returns empty string on missing inputs', () => {
    expect(buildFixSuggestionHint('', 'msg', 'scan-123', '<b>ctx</b>')).toBe('');
    expect(buildFixSuggestionHint('1.1.1', '', 'scan-123')).toBe('');
    expect(buildFixSuggestionHint('1.1.1', 'msg', '', '<b>ctx</b>')).toBe('');
    const html = buildFixSuggestionHint('<script>1.1.1', 'msg', 'scan-123');
    expect(html).not.toContain('<script>');
  });

  it('non-string context (handlebars options object) is treated as absent', () => {
    const optionsLike = { hash: {}, data: {} } as unknown as string;
    const html = buildFixSuggestionHint('1.1.1', 'msg', 'scan-123', optionsLike);
    expect(html).toContain('htmlContext=');
    expect(html).not.toContain('[object');
  });
});
