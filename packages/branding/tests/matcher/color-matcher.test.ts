import { describe, it, expect } from 'vitest';
import { ColorMatcher } from '../../src/matcher/color-matcher.js';
import type { BrandColor, MatchableIssue } from '../../src/types.js';

const brandColors: readonly BrandColor[] = [
  { id: 'c1', name: 'Aperol Orange', hexValue: '#FF5722', usage: 'primary', context: 'CTAs' },
  { id: 'c2', name: 'White', hexValue: '#FFFFFF', usage: 'background' },
];

const matcher = new ColorMatcher(brandColors);

describe('ColorMatcher', () => {
  it('matches when both foreground and background are brand colors', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast ratio 2.8:1',
      selector: '.hero-cta',
      context: '<span style="color: #ff5722; background-color: #ffffff;">Buy now</span>',
    };
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('color-pair');
      expect(result.matchDetail).toContain('Aperol Orange');
      expect(result.matchDetail).toContain('White');
    }
  });

  it('does not match when colors are not in brand palette', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast ratio 3.1:1',
      selector: '.footer-link',
      context: '<a style="color: #888888; background-color: #cccccc;">Link</a>',
    };
    expect(matcher.match(issue).matched).toBe(false);
  });

  it('matches when only one color is brand (partial match)', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast ratio 2.1:1',
      selector: '.card-title',
      context: '<h3 style="color: #FF5722; background-color: #FFF3E0;">Title</h3>',
    };
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.matchDetail).toContain('Aperol Orange');
  });

  it('only considers contrast-related WCAG codes', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Missing alt text',
      selector: 'img',
      context: '<img style="border-color: #FF5722;" src="photo.jpg">',
    };
    expect(matcher.match(issue).matched).toBe(false);
  });
});
