import { describe, it, expect } from 'vitest';
import { FontMatcher } from '../../src/matcher/font-matcher.js';
import type { BrandFont, MatchableIssue } from '../../src/types.js';

const brandFonts: readonly BrandFont[] = [
  { id: 'f1', family: 'Montserrat', weights: ['400', '700'], usage: 'heading' },
  { id: 'f2', family: 'Open Sans', weights: ['400'], usage: 'body' },
];

const matcher = new FontMatcher(brandFonts);

function makeIssue(context: string): MatchableIssue {
  return {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    type: 'error',
    message: 'Contrast issue',
    selector: '.heading',
    context,
  };
}

describe('FontMatcher', () => {
  it('matches when context contains a brand font family', () => {
    const issue = makeIssue('<h1 style="font-family: Montserrat, sans-serif;">Title</h1>');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('font');
      expect(result.matchDetail).toContain('Montserrat');
      expect(result.matchDetail).toContain('Brand Font');
    }
  });

  it('matches case-insensitively', () => {
    const issue = makeIssue('<p style="font-family: OPEN SANS, Arial;">Text</p>');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('font');
      expect(result.matchDetail).toContain('Open Sans');
    }
  });

  it('does not match when font is not in brand list', () => {
    const issue = makeIssue('<p style="font-family: Arial, Helvetica, sans-serif;">Text</p>');
    expect(matcher.match(issue).matched).toBe(false);
  });

  it('returns { matched: false } when no font-family in context', () => {
    const issue = makeIssue('<p class="text">Hello</p>');
    expect(matcher.match(issue).matched).toBe(false);
  });

  it('uses only the first font in the stack (before comma)', () => {
    // "Roboto" is not a brand font but "Open Sans" is; since Roboto comes first it should not match
    const issue = makeIssue('<p style="font-family: Roboto, Open Sans, sans-serif;">Text</p>');
    expect(matcher.match(issue).matched).toBe(false);
  });

  it('strips quotes from font name before comparing', () => {
    const issue = makeIssue('<h2 style="font-family: \'Montserrat\', serif;">Heading</h2>');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.matchDetail).toContain('Montserrat');
    }
  });
});
