import { describe, it, expect } from 'vitest';
import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import { calculateColorSubScore } from '../../../src/services/scoring/color-score.js';

function issue(opts: {
  code: string;
  context: string;
  matched: boolean;
}): BrandedIssue {
  return {
    issue: {
      code: opts.code,
      type: 'error',
      message: 'test',
      selector: 'div',
      context: opts.context,
    },
    brandMatch: opts.matched
      ? {
          matched: true,
          strategy: 'color-pair',
          guidelineName: 'Test',
          guidelineId: 'g1',
          matchDetail: 'x',
        }
      : { matched: false },
  };
}

const emptyGuideline: BrandGuideline = {
  id: 'g1',
  orgId: 'o1',
  name: 'Test',
  version: 1,
  active: true,
  colors: [],
  fonts: [],
  selectors: [],
};

describe('calculateColorSubScore', () => {
  it('returns unscorable when there are no issues at all', () => {
    const result = calculateColorSubScore([], emptyGuideline);
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-branded-issues' });
  });

  it('returns unscorable when there are issues but none are branded contrast', () => {
    const issues = [
      issue({ code: 'Guideline2_4.2_4_1', context: '#fff on #000', matched: true }),
      issue({ code: 'Guideline1_4.1_4_3', context: '#fff on #000', matched: false }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-branded-issues' });
  });

  it('scores 100 when all branded contrast issues pass AA', () => {
    const issues = [
      // White on black = ratio 21, passes AA normal
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #ffffff; background: #000000', matched: true }),
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #000000; background: #ffffff', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(100);
      expect(result.detail).toEqual({ dimension: 'color', passes: 2, fails: 0 });
    }
  });

  it('scores 0 when all branded contrast issues fail AA', () => {
    const issues = [
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #777777; background: #888888', matched: true }),
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #888888; background: #777777', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(0);
      expect(result.detail).toEqual({ dimension: 'color', passes: 0, fails: 2 });
    }
  });

  it('scores 50 with 1 pass and 1 fail rounded to the nearest integer', () => {
    const issues = [
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #ffffff; background: #000000', matched: true }),
      issue({ code: 'Guideline1_4.1_4_3', context: 'color: #777777; background: #888888', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(50);
      expect(result.detail).toEqual({ dimension: 'color', passes: 1, fails: 1 });
    }
  });

  it('applies AAA threshold for code 1_4_6', () => {
    // #767676 on #ffffff ratio is just under AAA normal threshold
    const issues = [
      issue({ code: 'Guideline1_4.1_4_6', context: 'color: #767676; background: #ffffff', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail).toEqual({ dimension: 'color', passes: 0, fails: 1 });
    }
  });

  it('treats unextractable hex pairs as fails (conservative)', () => {
    const issues = [
      issue({ code: 'Guideline1_4.1_4_3', context: 'no hex colors here', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail).toEqual({ dimension: 'color', passes: 0, fails: 1 });
    }
  });

  it('ignores issues whose brandMatch.matched is false', () => {
    const issues = [
      issue({ code: 'Guideline1_4.1_4_3', context: '#fff on #000', matched: false }),
      issue({ code: 'Guideline1_4.1_4_3', context: '#fff on #000', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'color' && result.detail.passes + result.detail.fails).toBe(1);
    }
  });

  it('handles non-text 1_4_11 as AA (documents Phase 15 conservative choice)', () => {
    // Document the Phase 15 conservative choice: 1_4_11 codes use AA normal
    // because isLargeText=false. This may under-credit genuine large-text /
    // non-text passes at lower ratios, but Phase 15 explicitly does not
    // infer large-text from issue.context.
    const issues = [
      issue({ code: 'Guideline1_4.1_4_11', context: 'color: #ffffff; background: #000000', matched: true }),
    ];
    const result = calculateColorSubScore(issues, emptyGuideline);
    expect(result.kind).toBe('scored');
  });
});
