import { describe, it, expect } from 'vitest';
import { BrandingMatcher, countBrandMatches } from '../../src/matcher/index.js';
import type { BrandGuideline, MatchableIssue, IBrandingStore } from '../../src/types.js';

const guideline: BrandGuideline = {
  id: 'g1',
  orgId: 'org-1',
  name: 'Aperol Brand Guide',
  version: 3,
  active: true,
  colors: [
    { id: 'c1', name: 'Aperol Orange', hexValue: '#FF5722', usage: 'primary' },
    { id: 'c2', name: 'White', hexValue: '#FFFFFF', usage: 'background' },
  ],
  fonts: [{ id: 'f1', family: 'Montserrat', weights: ['400', '700'], usage: 'heading' }],
  selectors: [{ id: 's1', pattern: '.brand-*', description: 'Brand elements' }],
};

const matcher = new BrandingMatcher();

describe('BrandingMatcher', () => {
  it('matches color-pair issues and populates guidelineName and guidelineId', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast ratio 2.8:1',
      selector: '.hero-cta',
      context: '<span style="color: #ff5722; background-color: #ffffff;">Buy now</span>',
    };

    const results = matcher.match([issue], guideline);

    expect(results).toHaveLength(1);
    const branded = results[0];
    expect(branded.issue).toBe(issue);
    expect(branded.brandMatch.matched).toBe(true);
    if (branded.brandMatch.matched) {
      expect(branded.brandMatch.strategy).toBe('color-pair');
      expect(branded.brandMatch.guidelineName).toBe('Aperol Brand Guide');
      expect(branded.brandMatch.guidelineId).toBe('g1');
      expect(branded.brandMatch.matchDetail).toContain('Aperol Orange');
      expect(branded.brandMatch.matchDetail).toContain('White');
    }
  });

  it('matches selector rules for a non-contrast issue on .brand-logo img', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Img element missing alt attribute',
      selector: '.brand-logo img',
      context: '<img src="logo.png">',
    };

    const results = matcher.match([issue], guideline);

    expect(results).toHaveLength(1);
    const branded = results[0];
    expect(branded.brandMatch.matched).toBe(true);
    if (branded.brandMatch.matched) {
      expect(branded.brandMatch.strategy).toBe('selector');
      expect(branded.brandMatch.guidelineName).toBe('Aperol Brand Guide');
      expect(branded.brandMatch.guidelineId).toBe('g1');
      expect(branded.brandMatch.matchDetail).toContain('.brand-*');
    }
  });

  it('marks non-matching issues as { matched: false }', () => {
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent',
      type: 'error',
      message: 'Anchor has no link content',
      selector: '.footer-link',
      context: '<a href="/about"></a>',
    };

    const results = matcher.match([issue], guideline);

    expect(results).toHaveLength(1);
    expect(results[0].brandMatch.matched).toBe(false);
  });

  it('returns color strategy before font — color wins when both color and font match', () => {
    // Contrast issue on .brand-title with brand color AND brand font in context
    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast ratio 2.2:1',
      selector: '.brand-title',
      context: '<h1 style="color: #ff5722; background-color: #ffffff; font-family: Montserrat, sans-serif;">Title</h1>',
    };

    const results = matcher.match([issue], guideline);

    expect(results).toHaveLength(1);
    const branded = results[0];
    expect(branded.brandMatch.matched).toBe(true);
    if (branded.brandMatch.matched) {
      expect(branded.brandMatch.strategy).toBe('color-pair');
    }
  });

  it('countBrandMatches returns count of matched issues', () => {
    const issues: MatchableIssue[] = [
      {
        code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
        type: 'error',
        message: 'Contrast issue 1',
        selector: '.hero',
        context: '<span style="color: #ff5722; background-color: #ffffff;">A</span>',
      },
      {
        code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
        type: 'error',
        message: 'Contrast issue 2',
        selector: '.nav',
        context: '<span style="color: #ff5722; background-color: #ffffff;">B</span>',
      },
      {
        code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent',
        type: 'error',
        message: 'Anchor no content',
        selector: '.footer-link',
        context: '<a href="/about"></a>',
      },
    ];

    const branded = matcher.match(issues, guideline);
    expect(countBrandMatches(branded)).toBe(2);
  });

  it('matchForSite returns null when no guideline is assigned to the site', () => {
    const mockStore: IBrandingStore = {
      addGuideline: () => {},
      updateGuideline: () => {},
      removeGuideline: () => {},
      getGuideline: () => null,
      listGuidelines: () => [],
      assignToSite: () => {},
      unassignFromSite: () => {},
      getGuidelineForSite: () => null,
      getSiteAssignments: () => [],
    };

    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast issue',
      selector: '.hero',
      context: '<span style="color: #ff5722; background-color: #ffffff;">A</span>',
    };

    const result = matcher.matchForSite([issue], 'https://example.com', 'org-1', mockStore);
    expect(result).toBeNull();
  });

  it('matchForSite returns null when guideline exists but is inactive', () => {
    const inactiveGuideline: BrandGuideline = { ...guideline, active: false };
    const mockStore: IBrandingStore = {
      addGuideline: () => {},
      updateGuideline: () => {},
      removeGuideline: () => {},
      getGuideline: () => null,
      listGuidelines: () => [],
      assignToSite: () => {},
      unassignFromSite: () => {},
      getGuidelineForSite: () => inactiveGuideline,
      getSiteAssignments: () => [],
    };

    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast issue',
      selector: '.hero',
      context: '<span style="color: #ff5722; background-color: #ffffff;">A</span>',
    };

    const result = matcher.matchForSite([issue], 'https://example.com', 'org-1', mockStore);
    expect(result).toBeNull();
  });

  it('matchForSite returns branded issues when a guideline is assigned', () => {
    const mockStore: IBrandingStore = {
      addGuideline: () => {},
      updateGuideline: () => {},
      removeGuideline: () => {},
      getGuideline: () => null,
      listGuidelines: () => [],
      assignToSite: () => {},
      unassignFromSite: () => {},
      getGuidelineForSite: () => guideline,
      getSiteAssignments: () => [],
    };

    const issue: MatchableIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error',
      message: 'Contrast issue',
      selector: '.hero',
      context: '<span style="color: #ff5722; background-color: #ffffff;">A</span>',
    };

    const result = matcher.matchForSite([issue], 'https://example.com', 'org-1', mockStore);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    if (result !== null) {
      expect(result[0].brandMatch.matched).toBe(true);
    }
  });
});
