import { describe, it, expect } from 'vitest';
import { SelectorMatcher } from '../../src/matcher/selector-matcher.js';
import type { BrandSelector, MatchableIssue } from '../../src/types.js';

const brandSelectors: readonly BrandSelector[] = [
  { id: 's1', pattern: '.brand-logo', description: 'Logo element' },
  { id: 's2', pattern: '.brand-*', description: 'Brand components' },
  { id: 's3', pattern: '#hero-*', description: 'Hero section elements' },
];

const matcher = new SelectorMatcher(brandSelectors);

function makeIssue(selector: string): MatchableIssue {
  return {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    type: 'error',
    message: 'Contrast issue',
    selector,
    context: '<div>Content</div>',
  };
}

describe('SelectorMatcher', () => {
  it('matches exact CSS class', () => {
    const issue = makeIssue('.brand-logo');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('selector');
      expect(result.matchDetail).toContain('.brand-logo');
    }
  });

  it('matches wildcard pattern #hero-* against #hero-banner .text', () => {
    const issue = makeIssue('#hero-banner .text');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('selector');
      expect(result.matchDetail).toContain('#hero-*');
    }
  });

  it('matches .brand-* against .brand-logo img', () => {
    // .brand-logo is an exact match (s1 comes first), but also .brand-* would match
    // Test with a selector that only matches the wildcard
    const issue = makeIssue('.brand-nav a');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.strategy).toBe('selector');
      expect(result.matchDetail).toContain('.brand-*');
    }
  });

  it('does not match unrelated selectors', () => {
    const issue = makeIssue('.footer-link');
    expect(matcher.match(issue).matched).toBe(false);
  });

  it('returns first match when multiple patterns match', () => {
    // .brand-logo matches both s1 (exact) and s2 (wildcard); s1 should win
    const issue = makeIssue('.brand-logo');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.matchDetail).toContain('.brand-logo');
      expect(result.matchDetail).toContain('Logo element');
    }
  });

  it('includes description in matchDetail when present', () => {
    const issue = makeIssue('#hero-section');
    const result = matcher.match(issue);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.matchDetail).toContain('Hero section elements');
    }
  });

  it('returns { matched: false } for empty selector list', () => {
    const emptyMatcher = new SelectorMatcher([]);
    const issue = makeIssue('.brand-logo');
    expect(emptyMatcher.match(issue).matched).toBe(false);
  });
});
