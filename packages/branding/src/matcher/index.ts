import type { BrandGuideline, MatchableIssue, BrandedIssue, BrandMatchResult, IBrandingStore } from '../types.js';
import { ColorMatcher } from './color-matcher.js';
import { FontMatcher } from './font-matcher.js';
import { SelectorMatcher } from './selector-matcher.js';

export class BrandingMatcher {
  match<T extends MatchableIssue>(issues: readonly T[], guideline: BrandGuideline): readonly BrandedIssue<T>[] {
    const colorMatcher = new ColorMatcher(guideline.colors);
    const fontMatcher = new FontMatcher(guideline.fonts);
    const selectorMatcher = new SelectorMatcher(guideline.selectors);

    return issues.map((issue) => {
      // Try strategies in order: color → font → selector. First match wins.
      let result: BrandMatchResult = colorMatcher.match(issue);
      if (!result.matched) result = fontMatcher.match(issue);
      if (!result.matched) result = selectorMatcher.match(issue);

      // Fill in guideline info for matches
      if (result.matched) {
        result = { ...result, guidelineName: guideline.name, guidelineId: guideline.id };
      }

      return { issue, brandMatch: result };
    });
  }

  matchForSite<T extends MatchableIssue>(issues: readonly T[], siteUrl: string, orgId: string, store: IBrandingStore): readonly BrandedIssue<T>[] | null {
    const guideline = store.getGuidelineForSite(siteUrl, orgId);
    if (guideline === null || !guideline.active) return null;
    return this.match(issues, guideline);
  }
}

export function countBrandMatches(branded: readonly BrandedIssue[]): number {
  return branded.filter((b) => b.brandMatch.matched).length;
}
