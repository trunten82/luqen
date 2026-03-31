import type { BrandSelector, MatchableIssue, BrandMatchResult } from '../types.js';

/**
 * Convert a user-supplied glob-like pattern to a RegExp.
 * - `*` becomes `.*` (matches anything including spaces and slashes)
 * - All other regex special characters are escaped
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`);
}

export class SelectorMatcher {
  private readonly rules: ReadonlyArray<{ readonly selector: BrandSelector; readonly re: RegExp }>;

  constructor(selectors: readonly BrandSelector[]) {
    this.rules = selectors.map((s) => ({ selector: s, re: patternToRegex(s.pattern) }));
  }

  match(issue: MatchableIssue): BrandMatchResult {
    for (const { selector, re } of this.rules) {
      if (re.test(issue.selector)) {
        const descriptionPart = selector.description ? ` (${selector.description})` : '';
        return {
          matched: true,
          strategy: 'selector',
          guidelineName: '',  // filled by BrandingMatcher
          guidelineId: '',    // filled by BrandingMatcher
          matchDetail: `Matched selector: ${selector.pattern}${descriptionPart}`,
        };
      }
    }
    return { matched: false };
  }
}
