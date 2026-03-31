import type { MatchableIssue, BrandedIssue, BrandGuideline, IBrandingStore } from '../types.js';

export class BrandingMatcher {
  match<T extends MatchableIssue>(issues: readonly T[], guideline: BrandGuideline): readonly BrandedIssue<T>[] {
    return issues.map(issue => ({ issue, brandMatch: { matched: false as const } }));
  }

  matchForSite<T extends MatchableIssue>(issues: readonly T[], siteUrl: string, orgId: string, store: IBrandingStore): readonly BrandedIssue<T>[] | null {
    return null;
  }
}
